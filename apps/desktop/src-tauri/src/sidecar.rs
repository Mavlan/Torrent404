use std::{
    error::Error,
    fmt,
    io::{self, BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const LOOPBACK_HOST: &str = "127.0.0.1";
const IPC_TRANSPORT: &str = "http";
const SESSION_TOKEN_ENV: &str = "TORLINK_SESSION_TOKEN";
const READY_SIGNAL: &str = r#"{"type":"ready","transport":"http","host":"127.0.0.1","port":0,"authentication":"session-token"}"#;
const STARTUP_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);

#[derive(Debug, Clone)]
pub(crate) struct SidecarPaths {
    node: PathBuf,
    bootstrap: PathBuf,
}

impl SidecarPaths {
    pub(crate) fn from_resource_dir(resource_dir: &Path) -> Self {
        let sidecar_dir = resource_dir.join("sidecar");
        Self {
            node: sidecar_dir.join("node.exe"),
            bootstrap: sidecar_dir.join("bootstrap.mjs"),
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct SidecarLaunchConfig {
    /// Reserved for Phase 3.2. It is passed only via the child environment and
    /// is never included in readiness output or supervisor errors.
    pub(crate) session_token: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum StopOutcome {
    NotRunning,
    Graceful,
    Forced,
}

#[derive(Debug)]
pub(crate) enum SidecarError {
    AlreadyRunning,
    Spawn(io::Error),
    ReadinessFailed,
    ReadinessTimeout,
    Process(io::Error),
}

impl fmt::Display for SidecarError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyRunning => formatter.write_str("sidecar is already running"),
            Self::Spawn(_) => formatter.write_str("failed to start bundled Node sidecar"),
            Self::ReadinessFailed => formatter.write_str("sidecar exited before readiness"),
            Self::ReadinessTimeout => formatter.write_str("sidecar readiness timed out"),
            Self::Process(_) => formatter.write_str("failed to manage sidecar process"),
        }
    }
}

impl Error for SidecarError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Spawn(error) | Self::Process(error) => Some(error),
            _ => None,
        }
    }
}

#[derive(Debug, Default)]
pub(crate) struct SidecarSupervisor {
    child: Option<Child>,
}

impl SidecarSupervisor {
    pub(crate) fn start(
        &mut self,
        paths: &SidecarPaths,
        config: &SidecarLaunchConfig,
    ) -> Result<(), SidecarError> {
        if self.child.is_some() {
            return Err(SidecarError::AlreadyRunning);
        }

        let mut command = Command::new(&paths.node);
        command
            .arg(&paths.bootstrap)
            .env("TORLINK_IPC_HOST", LOOPBACK_HOST)
            .env("TORLINK_IPC_TRANSPORT", IPC_TRANSPORT)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(token) = &config.session_token {
            command.env(SESSION_TOKEN_ENV, token);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command.spawn().map_err(SidecarError::Spawn)?;
        let stdout = child.stdout.take().ok_or(SidecarError::ReadinessFailed)?;
        let (sender, receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let mut line = String::new();
            let ready = BufReader::new(stdout)
                .read_line(&mut line)
                .map(|bytes| bytes > 0 && line.trim() == READY_SIGNAL)
                .unwrap_or(false);
            let _ = sender.send(ready);
        });

        let readiness = match receiver.recv_timeout(STARTUP_TIMEOUT) {
            Ok(true) => Ok(()),
            Ok(false) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                Err(SidecarError::ReadinessFailed)
            }
            Err(mpsc::RecvTimeoutError::Timeout) => Err(SidecarError::ReadinessTimeout),
        };
        if let Err(error) = readiness {
            let _ = stop_child(&mut child, Duration::from_millis(250));
            return Err(error);
        }

        self.child = Some(child);
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn is_running(&mut self) -> Result<bool, SidecarError> {
        let Some(child) = self.child.as_mut() else {
            return Ok(false);
        };
        child
            .try_wait()
            .map(|status| status.is_none())
            .map_err(SidecarError::Process)
    }

    #[cfg(test)]
    pub(crate) fn process_id(&self) -> Option<u32> {
        self.child.as_ref().map(Child::id)
    }

    pub(crate) fn stop(&mut self) -> Result<StopOutcome, SidecarError> {
        let Some(mut child) = self.child.take() else {
            return Ok(StopOutcome::NotRunning);
        };
        stop_child(&mut child, SHUTDOWN_TIMEOUT).map_err(SidecarError::Process)
    }
}

impl Drop for SidecarSupervisor {
    fn drop(&mut self) {
        let _ = self.stop();
    }
}

fn stop_child(child: &mut Child, timeout: Duration) -> io::Result<StopOutcome> {
    if child.try_wait()?.is_some() {
        return Ok(StopOutcome::Graceful);
    }

    if let Some(mut stdin) = child.stdin.take() {
        let _ = stdin.write_all(b"shutdown\n");
        let _ = stdin.flush();
    }

    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        if child.try_wait()?.is_some() {
            return Ok(StopOutcome::Graceful);
        }
        thread::sleep(Duration::from_millis(20));
    }

    child.kill()?;
    child.wait()?;
    Ok(StopOutcome::Forced)
}

#[cfg(all(test, target_os = "windows"))]
mod tests {
    use super::*;

    fn test_paths() -> SidecarPaths {
        SidecarPaths::from_resource_dir(Path::new(env!("CARGO_MANIFEST_DIR")))
    }

    fn process_exists(process_id: u32) -> bool {
        let filter = format!("PID eq {process_id}");
        let output = Command::new("tasklist")
            .args(["/FI", &filter, "/FO", "CSV", "/NH"])
            .output()
            .expect("tasklist should run");
        String::from_utf8_lossy(&output.stdout).contains(&format!("\"{process_id}\""))
    }

    #[test]
    fn starts_ready_and_stops_gracefully() {
        let mut supervisor = SidecarSupervisor::default();
        supervisor
            .start(&test_paths(), &SidecarLaunchConfig::default())
            .expect("sidecar should start");

        assert!(supervisor.is_running().expect("status should be readable"));
        assert!(supervisor.process_id().is_some());
        assert_eq!(
            supervisor.stop().expect("sidecar should stop"),
            StopOutcome::Graceful
        );
        assert!(!supervisor.is_running().expect("status should be readable"));
    }

    #[test]
    fn reports_missing_runtime_as_startup_error() {
        let paths = SidecarPaths {
            node: PathBuf::from("missing-node-runtime.exe"),
            bootstrap: test_paths().bootstrap,
        };
        let error = SidecarSupervisor::default()
            .start(&paths, &SidecarLaunchConfig::default())
            .expect_err("missing runtime must fail");

        assert!(matches!(error, SidecarError::Spawn(_)));
    }

    #[test]
    fn reports_bootstrap_exit_before_readiness() {
        let paths = SidecarPaths {
            node: test_paths().node,
            bootstrap: PathBuf::from("missing-bootstrap.mjs"),
        };
        let error = SidecarSupervisor::default()
            .start(&paths, &SidecarLaunchConfig::default())
            .expect_err("missing bootstrap must fail");

        assert!(matches!(error, SidecarError::ReadinessFailed));
    }

    #[test]
    fn bootstrap_rejects_non_loopback_host() {
        let paths = test_paths();
        let status = Command::new(paths.node)
            .arg(paths.bootstrap)
            .env("TORLINK_IPC_HOST", "0.0.0.0")
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("bundled Node runtime should start");

        assert_eq!(status.code(), Some(78));
    }

    #[test]
    fn stdin_guardian_exits_when_parent_pipe_closes() {
        let mut supervisor = SidecarSupervisor::default();
        supervisor
            .start(&test_paths(), &SidecarLaunchConfig::default())
            .expect("sidecar should start");
        let child = supervisor.child.as_mut().expect("child should be managed");
        drop(child.stdin.take());

        let deadline = Instant::now() + Duration::from_secs(1);
        while Instant::now() < deadline {
            if child
                .try_wait()
                .expect("status should be readable")
                .is_some()
            {
                break;
            }
            thread::sleep(Duration::from_millis(20));
        }

        assert!(!supervisor.is_running().expect("status should be readable"));
    }

    #[test]
    fn drop_does_not_leave_an_orphan_process() {
        let process_id = {
            let mut supervisor = SidecarSupervisor::default();
            supervisor
                .start(&test_paths(), &SidecarLaunchConfig::default())
                .expect("sidecar should start");
            supervisor.process_id().expect("sidecar should have a pid")
        };

        assert!(!process_exists(process_id));
    }
}
