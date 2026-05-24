use std::io;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::time::{Duration, Instant};

#[cfg(unix)]
pub(crate) fn configure_child_process_group(command: &mut Command) {
    use std::os::unix::process::CommandExt;
    command.process_group(0);
}

#[cfg(windows)]
pub(crate) fn configure_child_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;

    const CREATE_NO_WINDOW: u32 = 0x08000000;
    command.creation_flags(CREATE_NO_WINDOW);
}

#[cfg(not(any(unix, windows)))]
pub(crate) fn configure_child_process_group(_command: &mut Command) {}

#[cfg(unix)]
fn signal_child_process_tree(child: &Child, force: bool) {
    let signal = if force { "-KILL" } else { "-TERM" };
    let process_group = format!("-{}", child.id());
    let _ = Command::new("kill")
        .arg(signal)
        .arg(process_group)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(windows)]
fn signal_child_process_tree(child: &Child, _force: bool) {
    let mut command = Command::new("taskkill");
    configure_child_process_group(&mut command);
    let _ = command
        .arg("/PID")
        .arg(child.id().to_string())
        .arg("/T")
        .arg("/F")
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status();
}

#[cfg(not(any(unix, windows)))]
fn signal_child_process_tree(_child: &Child, _force: bool) {}

pub(crate) fn terminate_child_process_tree(
    child: &mut Child,
    grace: Duration,
) -> io::Result<ExitStatus> {
    signal_child_process_tree(child, false);
    let grace_started = Instant::now();
    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(status);
        }
        if grace_started.elapsed() >= grace {
            break;
        }
        std::thread::sleep(Duration::from_millis(25));
    }

    signal_child_process_tree(child, true);
    let _ = child.kill();
    child.wait()
}

pub(crate) fn kill_child_process_tree_best_effort(child: &mut Child) {
    signal_child_process_tree(child, true);
    let _ = child.kill();
    let _ = child.wait();
}
