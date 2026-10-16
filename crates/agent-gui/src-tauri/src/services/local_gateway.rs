//! Own the desktop's Go Gateway process independently of the remote connection.
//!
//! These methods perform blocking process/network IO. Call them on a blocking
//! worker, never on the desktop event loop. Dropping/closing a window does not
//! stop the service; the application calls `shutdown` on actual exit.

use std::net::{Ipv4Addr, SocketAddrV4, TcpListener};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Mutex, MutexGuard};
use std::time::{Duration, Instant};

use sha2::{Digest, Sha256};

const INSTANCE_HEADER: &str = "X-LiveAgent-Instance";
const INSTANCE_PROBE_HEADER: &str = "X-LiveAgent-Instance-Probe";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(15);
const POLL_INTERVAL: Duration = Duration::from_millis(50);
const HEALTH_TIMEOUT: Duration = Duration::from_millis(300);

#[derive(Clone, PartialEq, Eq)]
pub struct LocalGatewayOptions {
    pub binary: PathBuf,
    pub data_dir: PathBuf,
    pub port: u16,
    pub token: String,
}

// Never derive Debug for options: bearer credentials must not reach logs.
impl std::fmt::Debug for LocalGatewayOptions {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("LocalGatewayOptions")
            .field("binary", &self.binary)
            .field("data_dir", &self.data_dir)
            .field("port", &self.port)
            .field("token", &"[redacted]")
            .finish()
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalGatewayReady {
    pub url: String,
    pub pid: u32,
    pub port: u16,
}

struct OwnedGateway {
    child: Child,
    options: LocalGatewayOptions,
    nonce: String,
    ready: bool,
}

impl OwnedGateway {
    fn terminate(&mut self) -> Result<(), String> {
        match self.child.try_wait() {
            Ok(Some(_)) => return Ok(()),
            Ok(None) => {}
            Err(_) => return Err("Unable to inspect the local Gateway process".into()),
        }
        // A child may exit between try_wait and kill. Recheck before reporting
        // failure; no process-name/port-based termination is ever performed.
        if self.child.kill().is_err() && !matches!(self.child.try_wait(), Ok(Some(_))) {
            return Err("Unable to stop the local Gateway process".into());
        }
        self.child
            .wait()
            .map(|_| ())
            .map_err(|_| "Unable to collect the local Gateway process".into())
    }
}

impl Drop for OwnedGateway {
    fn drop(&mut self) {
        let _ = self.terminate();
    }
}

/// Serialized, retryable process ownership. The state mutex is only held for
/// short process operations; readiness polling never blocks `cancel_start`.
pub struct LocalGatewayManager {
    operation: Mutex<()>,
    child: Mutex<Option<OwnedGateway>>,
    cancellation: AtomicU64,
    shutting_down: AtomicBool,
    startup_timeout: Duration,
}

impl Default for LocalGatewayManager {
    fn default() -> Self {
        Self::new()
    }
}

impl LocalGatewayManager {
    pub fn new() -> Self {
        Self::with_startup_timeout(STARTUP_TIMEOUT)
    }

    pub fn with_startup_timeout(startup_timeout: Duration) -> Self {
        Self {
            operation: Mutex::new(()),
            child: Mutex::new(None),
            cancellation: AtomicU64::new(0),
            shutting_down: AtomicBool::new(false),
            startup_timeout,
        }
    }

    fn lock_child(&self) -> MutexGuard<'_, Option<OwnedGateway>> {
        // Poisoning must not orphan a process during desktop shutdown.
        self.child.lock().unwrap_or_else(|e| e.into_inner())
    }

    fn cancelled(&self, epoch: u64) -> bool {
        self.shutting_down.load(Ordering::SeqCst)
            || self.cancellation.load(Ordering::SeqCst) != epoch
    }

    /// May be called directly on the UI/event thread before scheduling stop.
    pub fn cancel_start(&self) {
        self.cancellation.fetch_add(1, Ordering::SeqCst);
    }

    /// Capture before queueing work on a blocking executor. Passing this epoch
    /// into `start_with_epoch` also cancels work which has not begun executing
    /// when the configuration changes.
    pub fn start_epoch(&self) -> u64 {
        self.cancellation.load(Ordering::SeqCst)
    }

    /// Start exactly one owned process and wait for its private launch identity.
    /// Concurrent equivalent requests share the running child; changed settings
    /// replace only the owned child. Failed starts collect the child and leave
    /// the manager available for a later retry.
    #[cfg(test)]
    pub fn start(&self, options: LocalGatewayOptions) -> Result<LocalGatewayReady, String> {
        self.start_with_epoch(options, self.start_epoch())
    }

    pub fn start_with_epoch(
        &self,
        options: LocalGatewayOptions,
        epoch: u64,
    ) -> Result<LocalGatewayReady, String> {
        let _operation = self.operation.lock().unwrap_or_else(|e| e.into_inner());
        if self.cancelled(epoch) {
            return Err("Local Gateway startup was cancelled".into());
        }

        {
            let mut slot = self.lock_child();
            if let Some(owned) = slot.as_mut() {
                match owned.child.try_wait() {
                    Ok(Some(_)) => {
                        slot.take();
                    }
                    Ok(None) if owned.options == options && owned.ready => {
                        return Ok(ready_info(owned));
                    }
                    Ok(None) => {
                        validate_options(&options)?;
                        owned.terminate()?;
                        slot.take();
                    }
                    Err(_) => {
                        return Err("Unable to inspect the local Gateway process".into());
                    }
                }
            }
        }

        validate_options(&options)?;
        // Check before spawning, so an existing listener is neither contacted
        // using the managed token nor mistaken for the service we just started.
        let reservation =
            TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST, options.port))
                .map_err(|_| format!("Local Gateway port {} is already in use", options.port))?;
        std::fs::create_dir_all(&options.data_dir)
            .map_err(|_| "Unable to prepare the local Gateway data directory".to_string())?;
        let client = reqwest::blocking::Client::builder()
            .no_proxy()
            .redirect(reqwest::redirect::Policy::none())
            .timeout(HEALTH_TIMEOUT.min(self.startup_timeout))
            .connect_timeout(HEALTH_TIMEOUT.min(self.startup_timeout))
            .build()
            .map_err(|_| "Unable to prepare the local Gateway health check".to_string())?;
        if self.cancelled(epoch) {
            return Err("Local Gateway startup was cancelled".into());
        }

        let nonce = uuid::Uuid::new_v4().to_string();
        let mut command = Command::new(&options.binary);
        command
            // Desktop ownership uses its dedicated data directory and plain
            // loopback HTTP. Shell/developer settings for an external Gateway
            // must not redirect its database or enable unexpected TLS.
            .env_remove("LIVEAGENT_GATEWAY_AGENT_DB")
            .env_remove("LIVEAGENT_GATEWAY_TLS_CERT")
            .env_remove("LIVEAGENT_GATEWAY_TLS_KEY")
            .env(
                "LIVEAGENT_GATEWAY_HTTP_ADDR",
                format!("127.0.0.1:{}", options.port),
            )
            .env("LIVEAGENT_GATEWAY_DATA_DIR", &options.data_dir)
            .env("LIVEAGENT_GATEWAY_TOKEN", &options.token)
            .env("LIVEAGENT_GATEWAY_INSTANCE_NONCE", &nonce)
            .env("LIVEAGENT_GATEWAY_DESKTOP_PARENT", "1")
            // Keep Child.stdin's writer owned for the complete desktop process
            // lifetime. OS handle closure on abrupt desktop termination gives
            // Go EOF too, including Tauri dev watcher restarts which skip Drop.
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
        }
        #[cfg(test)]
        if options.data_dir.join(".gateway-test-fixture").is_file() {
            command.args([
                "--exact",
                "services::local_gateway::tests::gateway_fixture",
                "--ignored",
                "--nocapture",
            ]);
        }
        // There is inevitably a bind race between releasing this socket and Go
        // binding. The per-spawn nonce prevents adopting the winner of that race.
        drop(reservation);
        let child = command.spawn().map_err(|err| match err.kind() {
            std::io::ErrorKind::NotFound => "Local Gateway executable was not found".to_string(),
            std::io::ErrorKind::PermissionDenied => {
                "Permission denied starting the local Gateway executable".to_string()
            }
            _ => "Unable to start the local Gateway executable".to_string(),
        })?;
        *self.lock_child() = Some(OwnedGateway {
            child,
            options,
            nonce,
            ready: false,
        });

        let result = self.wait_until_ready(&client, epoch);
        if result.is_err() {
            // Keep ownership if collection fails, so stop/drop can retry.
            self.collect_child()?;
        }
        result
    }

    fn wait_until_ready(
        &self,
        client: &reqwest::blocking::Client,
        epoch: u64,
    ) -> Result<LocalGatewayReady, String> {
        let started = Instant::now();
        loop {
            if self.cancelled(epoch) {
                return Err("Local Gateway startup was cancelled".into());
            }
            let (url, nonce) = {
                let mut slot = self.lock_child();
                let owned = slot.as_mut().ok_or("Local Gateway startup was cancelled")?;
                match owned.child.try_wait() {
                    Ok(Some(status)) => {
                        return Err(format!(
                            "Local Gateway exited before becoming ready ({status})"
                        ));
                    }
                    Ok(None) => {}
                    Err(_) => return Err("Unable to inspect the local Gateway process".into()),
                }
                (
                    format!("http://127.0.0.1:{}/healthz", owned.options.port),
                    owned.nonce.clone(),
                )
            };
            // Only inspect status and a single bounded header. Do not buffer an
            // untrusted response body or propagate reqwest errors/credentials.
            let healthy = client
                .get(url)
                // Sending a credential here could expose it to a listener that
                // wins the unavoidable bind race. Prove nonce knowledge using a
                // one-way challenge; only our child can return the raw nonce.
                .header(INSTANCE_PROBE_HEADER, instance_probe(&nonce))
                .send()
                .is_ok_and(|response| {
                    response.status().is_success()
                        && response
                            .headers()
                            .get(INSTANCE_HEADER)
                            .is_some_and(|value| value.as_bytes() == nonce.as_bytes())
                });
            if self.cancelled(epoch) {
                return Err("Local Gateway startup was cancelled".into());
            }
            if healthy {
                let mut slot = self.lock_child();
                let owned = slot.as_mut().ok_or("Local Gateway startup was cancelled")?;
                if !matches!(owned.child.try_wait(), Ok(None)) {
                    return Err("Local Gateway exited during its health check".into());
                }
                owned.ready = true;
                return Ok(ready_info(owned));
            }
            if started.elapsed() >= self.startup_timeout {
                return Err("Local Gateway startup timed out waiting for its health check".into());
            }
            std::thread::sleep(
                POLL_INTERVAL
                    .min(self.startup_timeout - started.elapsed().min(self.startup_timeout)),
            );
        }
    }

    fn collect_child(&self) -> Result<(), String> {
        let mut slot = self.lock_child();
        if let Some(owned) = slot.as_mut() {
            owned.terminate()?;
        }
        slot.take();
        Ok(())
    }

    /// Cancel a pending start and collect only this manager's child. Retry is
    /// allowed after stop; `shutdown` additionally prevents any later start.
    pub fn stop(&self) -> Result<(), String> {
        self.cancel_start();
        let _operation = self.operation.lock().unwrap_or_else(|e| e.into_inner());
        self.collect_child()
    }

    pub fn shutdown(&self) -> Result<(), String> {
        self.shutting_down.store(true, Ordering::SeqCst);
        self.stop()
    }

    #[cfg(test)]
    pub fn is_running(&self) -> bool {
        let mut slot = self.lock_child();
        slot.as_mut()
            .is_some_and(|owned| owned.ready && matches!(owned.child.try_wait(), Ok(None)))
    }
}

impl Drop for LocalGatewayManager {
    fn drop(&mut self) {
        self.shutting_down.store(true, Ordering::SeqCst);
        // OwnedGateway::drop is a final safeguard even if a prior operation
        // panicked. No worker holds a borrowed manager once drop is possible.
        self.child
            .get_mut()
            .unwrap_or_else(|e| e.into_inner())
            .take();
    }
}

fn ready_info(owned: &OwnedGateway) -> LocalGatewayReady {
    LocalGatewayReady {
        url: format!("http://127.0.0.1:{}", owned.options.port),
        pid: owned.child.id(),
        port: owned.options.port,
    }
}

fn instance_probe(nonce: &str) -> String {
    Sha256::digest(nonce.as_bytes())
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn validate_options(options: &LocalGatewayOptions) -> Result<(), String> {
    if options.port == 0 {
        return Err("Local Gateway requires a nonzero loopback port".into());
    }
    if options.token.trim().is_empty() || options.token.bytes().any(|byte| byte.is_ascii_control())
    {
        return Err("Local Gateway requires a valid authentication token".into());
    }
    if !options.binary.is_file() {
        return Err("Local Gateway executable was not found".into());
    }
    #[cfg(windows)]
    if !options
        .binary
        .extension()
        .is_some_and(|extension| extension.eq_ignore_ascii_case("exe"))
    {
        return Err("Local Gateway must be a Windows executable (.exe)".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpStream;
    use std::sync::{Arc, Barrier};

    fn fixture_options(mode: &str) -> (tempfile::TempDir, LocalGatewayOptions) {
        let dir = tempfile::Builder::new()
            .prefix("gateway space 中文 ")
            .tempdir()
            .unwrap();
        std::fs::write(dir.path().join(".gateway-test-fixture"), mode).unwrap();
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        (
            dir,
            LocalGatewayOptions {
                binary: std::env::current_exe().unwrap(),
                data_dir: PathBuf::new(),
                port,
                token: "test-only-bearer-secret".into(),
            },
        )
    }

    fn fixture(mode: &str) -> (tempfile::TempDir, LocalGatewayOptions) {
        let (dir, mut options) = fixture_options(mode);
        options.data_dir = dir.path().to_path_buf();
        (dir, options)
    }

    /// The actual test executable is our portable subprocess fixture. Running
    /// it normally is harmless; only the dedicated child receives fixture env.
    #[test]
    #[ignore]
    fn gateway_fixture() {
        let Some(data_dir) = std::env::var_os("LIVEAGENT_GATEWAY_DATA_DIR") else {
            return;
        };
        let mode =
            std::fs::read_to_string(PathBuf::from(data_dir).join(".gateway-test-fixture")).unwrap();
        if mode == "early-exit" {
            std::process::exit(23);
        }
        let listener =
            TcpListener::bind(std::env::var("LIVEAGENT_GATEWAY_HTTP_ADDR").unwrap()).unwrap();
        let token = std::env::var("LIVEAGENT_GATEWAY_TOKEN").unwrap();
        let nonce = std::env::var("LIVEAGENT_GATEWAY_INSTANCE_NONCE").unwrap();
        assert_eq!(
            std::env::var("LIVEAGENT_GATEWAY_DESKTOP_PARENT").unwrap(),
            "1"
        );
        if mode == "parent-eof" {
            std::thread::spawn(|| {
                let mut input = std::io::stdin().lock();
                let mut buffer = [0; 1];
                loop {
                    match input.read(&mut buffer) {
                        Ok(0) => std::process::exit(0),
                        Ok(_) => {}
                        Err(error) if error.kind() == std::io::ErrorKind::Interrupted => {}
                        Err(_) => std::process::exit(1),
                    }
                }
            });
        }
        for key in [
            "LIVEAGENT_GATEWAY_AGENT_DB",
            "LIVEAGENT_GATEWAY_TLS_CERT",
            "LIVEAGENT_GATEWAY_TLS_KEY",
        ] {
            assert!(std::env::var_os(key).is_none(), "inherited {key}");
        }
        if mode == "hang" {
            std::thread::sleep(Duration::from_secs(60));
            return;
        }
        for incoming in listener.incoming() {
            let mut stream = incoming.unwrap();
            stream
                .set_read_timeout(Some(Duration::from_secs(1)))
                .unwrap();
            let mut buffer = Vec::new();
            while !buffer.windows(4).any(|bytes| bytes == b"\r\n\r\n") {
                let mut chunk = [0; 512];
                let count = stream.read(&mut chunk).unwrap();
                if count == 0 {
                    break;
                }
                buffer.extend_from_slice(&chunk[..count]);
                assert!(buffer.len() <= 4096);
            }
            let request = String::from_utf8_lossy(&buffer);
            assert!(
                !request.contains(&token),
                "health check exposed bearer token"
            );
            assert!(
                !request.to_ascii_lowercase().contains("authorization:"),
                "health check must not send credentials"
            );
            let authenticated = request.lines().any(|line| {
                line.eq_ignore_ascii_case(&format!(
                    "{INSTANCE_PROBE_HEADER}: {}",
                    instance_probe(&nonce)
                ))
            });
            let identity = if mode == "wrong-nonce" {
                "external"
            } else {
                &nonce
            };
            let response = if authenticated {
                format!("HTTP/1.1 200 OK\r\n{INSTANCE_HEADER}: {identity}\r\nContent-Length: 2\r\nConnection: close\r\n\r\nok")
            } else {
                "HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
            };
            let _ = stream.write_all(response.as_bytes());
            if mode == "die-after-ready" {
                std::thread::sleep(Duration::from_millis(150));
                std::process::exit(0);
            }
        }
    }

    fn assert_port_released(port: u16) {
        assert!(TcpListener::bind((Ipv4Addr::LOCALHOST, port)).is_ok());
    }

    #[test]
    fn starts_once_and_stops_only_owned_child() {
        let (_dir, options) = fixture("ready");
        let manager = LocalGatewayManager::new();
        let ready = manager.start(options.clone()).unwrap();
        assert!(manager.is_running());
        assert_eq!(ready, manager.start(options.clone()).unwrap());
        manager.stop().unwrap();
        manager.stop().unwrap();
        assert!(!manager.is_running());
        assert_port_released(options.port);
        let retried = manager.start(options.clone()).unwrap();
        assert_ne!(ready.pid, retried.pid);
        manager.shutdown().unwrap();
        assert!(manager
            .start(options.clone())
            .unwrap_err()
            .contains("cancelled"));
        assert_port_released(options.port);
    }

    #[test]
    fn changed_settings_restart_only_the_owned_process() {
        let (_dir, options) = fixture("ready");
        let manager = LocalGatewayManager::new();
        let old = manager.start(options.clone()).unwrap();
        let (_next_dir, next) = fixture("ready");
        let ready = manager.start(next.clone()).unwrap();
        assert_ne!(old.pid, ready.pid);
        assert_eq!(ready.port, next.port);
        assert_port_released(options.port);
        assert!(manager.is_running());
        manager.stop().unwrap();
        assert_port_released(next.port);
    }

    #[test]
    fn invalid_new_settings_preserve_the_running_child() {
        let (_dir, options) = fixture("ready");
        let manager = LocalGatewayManager::new();
        let ready = manager.start(options.clone()).unwrap();
        let mut invalid = options.clone();
        invalid.binary = options.data_dir.join("missing.exe");
        assert!(manager.start(invalid).unwrap_err().contains("not found"));
        assert_eq!(ready, manager.start(options.clone()).unwrap());
        manager.stop().unwrap();
        assert_port_released(options.port);
    }

    #[test]
    fn inherited_external_gateway_environment_is_not_used() {
        let status = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "services::local_gateway::tests::isolated_environment_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("LIVEAGENT_GATEWAY_AGENT_DB", "external-do-not-open.sqlite")
            .env("LIVEAGENT_GATEWAY_TLS_CERT", "external-do-not-open.crt")
            .env("LIVEAGENT_GATEWAY_TLS_KEY", "external-do-not-open.key")
            .status()
            .unwrap();
        assert!(status.success());
    }

    #[test]
    #[ignore]
    fn isolated_environment_fixture() {
        let (_dir, options) = fixture("ready");
        let manager = LocalGatewayManager::new();
        manager.start(options.clone()).unwrap();
        manager.stop().unwrap();
        assert_port_released(options.port);
    }

    #[test]
    #[ignore]
    fn abrupt_parent_fixture() {
        let Some(data_dir) = std::env::var_os("LIVEAGENT_GATEWAY_TEST_PARENT_DIR") else {
            return;
        };
        let data_dir = PathBuf::from(data_dir);
        let port = std::env::var("LIVEAGENT_GATEWAY_TEST_PARENT_PORT")
            .unwrap()
            .parse()
            .unwrap();
        let options = LocalGatewayOptions {
            binary: std::env::current_exe().unwrap(),
            data_dir: data_dir.clone(),
            port,
            token: "test-only-bearer-secret".into(),
        };
        let manager = LocalGatewayManager::new();
        manager.start(options).unwrap();
        std::fs::write(data_dir.join("parent-child-ready"), "ready").unwrap();
        // Deliberately bypass destructors, exactly like a terminated desktop
        // during a dev watcher rebuild. No manager stop/drop may save this test.
        std::process::exit(0);
    }

    #[test]
    fn abrupt_parent_exit_closes_lifetime_pipe_and_child_releases_port() {
        let (dir, options) = fixture("parent-eof");
        let mut parent = Command::new(std::env::current_exe().unwrap())
            .args([
                "--exact",
                "services::local_gateway::tests::abrupt_parent_fixture",
                "--ignored",
                "--nocapture",
            ])
            .env("LIVEAGENT_GATEWAY_TEST_PARENT_DIR", dir.path())
            .env(
                "LIVEAGENT_GATEWAY_TEST_PARENT_PORT",
                options.port.to_string(),
            )
            .spawn()
            .unwrap();
        let deadline = Instant::now() + Duration::from_secs(10);
        loop {
            match parent.try_wait().unwrap() {
                Some(status) => {
                    assert!(status.success());
                    break;
                }
                None if Instant::now() < deadline => {
                    std::thread::sleep(Duration::from_millis(20));
                }
                None => {
                    let _ = parent.kill();
                    let _ = parent.wait();
                    panic!("parent fixture did not exit");
                }
            }
        }
        assert!(dir.path().join("parent-child-ready").is_file());
        let deadline = Instant::now() + Duration::from_secs(4);
        while TcpListener::bind((Ipv4Addr::LOCALHOST, options.port)).is_err() {
            assert!(
                Instant::now() < deadline,
                "child survived its parent's exit"
            );
            std::thread::sleep(Duration::from_millis(20));
        }
    }

    #[test]
    fn concurrent_starts_share_a_single_process() {
        let (_dir, options) = fixture("ready");
        let manager = Arc::new(LocalGatewayManager::new());
        let barrier = Arc::new(Barrier::new(5));
        let workers: Vec<_> = (0..4)
            .map(|_| {
                let manager = manager.clone();
                let barrier = barrier.clone();
                let options = options.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    manager.start(options).unwrap().pid
                })
            })
            .collect();
        barrier.wait();
        let pids: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap())
            .collect();
        assert!(pids.iter().all(|pid| *pid == pids[0]));
        manager.stop().unwrap();
        assert_port_released(options.port);
    }

    #[test]
    fn drop_collects_the_child() {
        let (_dir, options) = fixture("ready");
        let manager = LocalGatewayManager::new();
        manager.start(options.clone()).unwrap();
        drop(manager);
        assert_port_released(options.port);
    }

    #[test]
    fn failures_are_retryable_and_do_not_leak_tokens() {
        for mode in ["early-exit", "hang", "wrong-nonce"] {
            let (dir, options) = fixture(mode);
            let manager = LocalGatewayManager::with_startup_timeout(Duration::from_millis(600));
            let started = Instant::now();
            let error = manager.start(options.clone()).unwrap_err();
            assert!(!error.contains(&options.token));
            assert!(!format!("{options:?}").contains(&options.token));
            assert!(!manager.is_running());
            assert!(started.elapsed() < Duration::from_secs(4));
            if mode == "early-exit" {
                assert!(error.contains("exited"), "{error}");
            } else {
                assert!(error.contains("timed out"), "{error}");
            }
            assert_port_released(options.port);
            std::fs::write(dir.path().join(".gateway-test-fixture"), "ready").unwrap();
            manager.start(options.clone()).unwrap();
            manager.stop().unwrap();
            assert_port_released(options.port);
        }
    }

    #[test]
    fn cancellation_interrupts_start_and_allows_retry() {
        let (dir, options) = fixture("hang");
        let manager = Arc::new(LocalGatewayManager::new());
        let worker = {
            let manager = manager.clone();
            let options = options.clone();
            std::thread::spawn(move || manager.start(options))
        };
        let deadline = Instant::now() + Duration::from_secs(4);
        while manager.lock_child().is_none() {
            assert!(Instant::now() < deadline, "child was never spawned");
            std::thread::sleep(Duration::from_millis(10));
        }
        let started = Instant::now();
        manager.cancel_start();
        manager.stop().unwrap();
        assert!(worker.join().unwrap().unwrap_err().contains("cancelled"));
        assert!(started.elapsed() < Duration::from_secs(2));
        assert_port_released(options.port);
        std::fs::write(dir.path().join(".gateway-test-fixture"), "ready").unwrap();
        manager.start(options.clone()).unwrap();
        manager.stop().unwrap();
    }

    #[test]
    fn shutdown_during_start_collects_and_permanently_prevents_restart() {
        let (_dir, options) = fixture("hang");
        let manager = Arc::new(LocalGatewayManager::new());
        let worker = {
            let manager = manager.clone();
            let options = options.clone();
            std::thread::spawn(move || manager.start(options))
        };
        let deadline = Instant::now() + Duration::from_secs(4);
        while manager.lock_child().is_none() {
            assert!(Instant::now() < deadline, "child was never spawned");
            std::thread::sleep(Duration::from_millis(10));
        }
        manager.shutdown().unwrap();
        assert!(worker.join().unwrap().unwrap_err().contains("cancelled"));
        assert_port_released(options.port);
        assert!(manager
            .start(options.clone())
            .unwrap_err()
            .contains("cancelled"));
        assert_port_released(options.port);
    }

    #[tokio::test(flavor = "current_thread")]
    async fn configuration_change_cancels_start_queued_on_blocking_executor() {
        let (_dir, options) = fixture("ready");
        let manager = Arc::new(LocalGatewayManager::new());
        let epoch = manager.start_epoch();
        let (release_tx, release_rx) = tokio::sync::oneshot::channel();
        let task = {
            let manager = manager.clone();
            let options = options.clone();
            tokio::task::spawn_blocking(move || {
                // Simulate a saturated blocking executor without relying on
                // scheduler timing. The cancellation arrives before start.
                release_rx.blocking_recv().unwrap();
                manager.start_with_epoch(options, epoch)
            })
        };
        manager.cancel_start();
        release_tx.send(()).unwrap();
        assert!(task.await.unwrap().unwrap_err().contains("cancelled"));
        assert!(manager.lock_child().is_none());
        assert_port_released(options.port);
        let retry = {
            let manager = manager.clone();
            let options = options.clone();
            tokio::task::spawn_blocking(move || manager.start(options))
        };
        retry.await.unwrap().unwrap();
        let stop = tokio::task::spawn_blocking(move || manager.stop());
        stop.await.unwrap().unwrap();
        assert_port_released(options.port);
    }

    #[test]
    fn existing_listener_is_not_contacted_or_stopped() {
        let (_dir, options) = fixture("ready");
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, options.port)).unwrap();
        listener.set_nonblocking(true).unwrap();
        let manager = LocalGatewayManager::new();
        assert!(manager
            .start(options.clone())
            .unwrap_err()
            .contains("already in use"));
        assert!(
            listener.accept().is_err(),
            "must not send managed credentials to an external listener"
        );
        manager.shutdown().unwrap();
        assert!(TcpStream::connect((Ipv4Addr::LOCALHOST, options.port)).is_ok());
    }

    #[test]
    fn missing_executable_and_invalid_token_are_actionable() {
        let (_dir, mut options) = fixture("ready");
        let manager = LocalGatewayManager::new();
        options.binary = options.data_dir.join("missing-gateway.exe");
        assert!(manager
            .start(options.clone())
            .unwrap_err()
            .contains("not found"));
        options.binary = std::env::current_exe().unwrap();
        options.token = "secret\r\ninjected-header".into();
        let error = manager.start(options.clone()).unwrap_err();
        assert!(error.contains("authentication token"));
        assert!(!error.contains("secret"));
        assert_port_released(options.port);
    }

    #[test]
    fn a_dead_child_can_be_restarted() {
        let (dir, options) = fixture("die-after-ready");
        let manager = LocalGatewayManager::new();
        let first = manager.start(options.clone()).unwrap();
        let deadline = Instant::now() + Duration::from_secs(4);
        while manager.is_running() {
            assert!(Instant::now() < deadline);
            std::thread::sleep(Duration::from_millis(20));
        }
        std::fs::write(dir.path().join(".gateway-test-fixture"), "ready").unwrap();
        let next = manager.start(options.clone()).unwrap();
        assert_ne!(first.pid, next.pid);
        manager.stop().unwrap();
        assert_port_released(options.port);
    }

    #[test]
    fn executable_path_supports_spaces_and_unicode() {
        let (dir, mut options) = fixture("ready");
        let file_name = if cfg!(windows) {
            "gateway 空格 test.exe"
        } else {
            "gateway 空格 test"
        };
        options.binary = dir.path().join(file_name);
        std::fs::copy(std::env::current_exe().unwrap(), &options.binary).unwrap();
        let manager = LocalGatewayManager::new();
        manager.start(options.clone()).unwrap();
        manager.stop().unwrap();
        assert_port_released(options.port);
    }
}
