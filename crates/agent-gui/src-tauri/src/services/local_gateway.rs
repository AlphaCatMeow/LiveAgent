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
