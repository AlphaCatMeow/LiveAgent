use std::collections::HashMap;
use std::sync::Mutex;

#[cfg(all(target_os = "macos", not(test)))]
use std::process::{Child, Command, Stdio};
#[cfg(all(windows, not(test)))]
use std::{
    io,
    sync::mpsc,
    thread::{self, JoinHandle},
    time::Duration,
};

#[derive(Default)]
pub struct PowerActivityManager {
    state: Mutex<PowerActivityState>,
}

#[derive(Default)]
struct PowerActivityState {
    requests: HashMap<String, String>,
    keep_awake: Option<KeepAwakeHandle>,
}

impl PowerActivityManager {
    pub fn begin(&self, activity_id: impl Into<String>, reason: impl Into<String>) {
        let activity_id = activity_id.into().trim().to_string();
        if activity_id.is_empty() {
            return;
        }

        let reason = reason.into().trim().to_string();
        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        state.requests.insert(activity_id, reason);
        sync_keep_awake(&mut state);
    }

    pub fn end(&self, activity_id: impl AsRef<str>) {
        let activity_id = activity_id.as_ref().trim();
        if activity_id.is_empty() {
            return;
        }

        let mut state = match self.state.lock() {
            Ok(state) => state,
            Err(_) => return,
        };

        state.requests.remove(activity_id);
        sync_keep_awake(&mut state);
    }

    #[cfg(test)]
    fn snapshot(&self) -> HashMap<String, String> {
        self.state
            .lock()
            .map(|state| state.requests.clone())
            .unwrap_or_default()
    }
}

fn sync_keep_awake(state: &mut PowerActivityState) {
    if state.requests.is_empty() {
        if let Some(mut handle) = state.keep_awake.take() {
            handle.stop();
        }
        return;
    }

    if state.keep_awake.is_some() {
        return;
    }

    match KeepAwakeHandle::start() {
        Ok(handle) => {
            state.keep_awake = Some(handle);
        }
        Err(error) => {
            eprintln!("start power activity keep-awake failed: {error}");
        }
    }
}

#[cfg(all(target_os = "macos", not(test)))]
struct KeepAwakeHandle {
    child: Child,
}

#[cfg(all(windows, not(test)))]
struct KeepAwakeHandle {
    stop_tx: Option<mpsc::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

#[cfg(any(test, not(any(target_os = "macos", windows))))]
struct KeepAwakeHandle;

#[cfg(all(target_os = "macos", not(test)))]
impl KeepAwakeHandle {
    fn start() -> Result<Self, String> {
        let child = Command::new("caffeinate")
            .arg("-i")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|error| format!("spawn caffeinate failed: {error}"))?;
        Ok(Self { child })
    }

    fn stop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(any(test, not(any(target_os = "macos", windows))))]
impl KeepAwakeHandle {
    fn start() -> Result<Self, String> {
        Ok(Self)
    }

    fn stop(&mut self) {}
}

#[cfg(all(windows, not(test)))]
impl KeepAwakeHandle {
    fn start() -> Result<Self, String> {
        let (ready_tx, ready_rx) = mpsc::channel::<Result<(), String>>();
        let (stop_tx, stop_rx) = mpsc::channel::<()>();
        let thread = thread::Builder::new()
            .name("liveagent-keep-awake".to_string())
            .spawn(move || {
                let start_result = set_windows_keep_awake(true);
                let should_wait = start_result.is_ok();
                let _ = ready_tx.send(start_result);
                if should_wait {
                    let _ = stop_rx.recv();
                    if let Err(error) = set_windows_keep_awake(false) {
                        eprintln!("stop Windows power activity keep-awake failed: {error}");
                    }
                }
            })
            .map_err(|error| format!("spawn Windows keep-awake thread failed: {error}"))?;

        match ready_rx.recv_timeout(Duration::from_secs(2)) {
            Ok(Ok(())) => Ok(Self {
                stop_tx: Some(stop_tx),
                thread: Some(thread),
            }),
            Ok(Err(error)) => {
                let _ = thread.join();
                Err(error)
            }
            Err(error) => {
                let _ = stop_tx.send(());
                let _ = thread.join();
                Err(format!("start Windows keep-awake timed out: {error}"))
            }
        }
    }

    fn stop(&mut self) {
        if let Some(stop_tx) = self.stop_tx.take() {
            let _ = stop_tx.send(());
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
    }
}

#[cfg(all(windows, not(test)))]
fn set_windows_keep_awake(active: bool) -> Result<(), String> {
    const ES_CONTINUOUS: u32 = 0x8000_0000;
    const ES_SYSTEM_REQUIRED: u32 = 0x0000_0001;
    const ES_DISPLAY_REQUIRED: u32 = 0x0000_0002;

    #[link(name = "kernel32")]
    unsafe extern "system" {
        fn SetThreadExecutionState(es_flags: u32) -> u32;
    }

    let flags = if active {
        ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
    } else {
        ES_CONTINUOUS
    };
    let previous = unsafe { SetThreadExecutionState(flags) };
    if previous == 0 {
        Err(format!(
            "SetThreadExecutionState failed: {}",
            io::Error::last_os_error()
        ))
    } else {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::PowerActivityManager;
    use std::collections::HashMap;

    #[test]
    fn tracks_request_lifecycle() {
        let activity = PowerActivityManager::default();

        activity.begin("req-a", "conversation");
        activity.begin("req-b", "cron");

        assert_eq!(
            activity.snapshot(),
            HashMap::from([
                ("req-a".to_string(), "conversation".to_string()),
                ("req-b".to_string(), "cron".to_string()),
            ]),
        );

        activity.end("req-a");

        assert_eq!(
            activity.snapshot(),
            HashMap::from([("req-b".to_string(), "cron".to_string())]),
        );
    }

    #[test]
    fn ignores_empty_activity_id() {
        let activity = PowerActivityManager::default();

        activity.begin("", "noop");
        activity.end("");

        assert!(activity.snapshot().is_empty());
    }
}
