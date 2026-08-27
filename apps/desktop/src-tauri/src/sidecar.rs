use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    error::Error,
    fmt,
    io::{self, BufRead, BufReader, Read, Write},
    net::{Ipv4Addr, SocketAddrV4, TcpStream},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

const LOOPBACK_HOST: &str = "127.0.0.1";
const IPC_TRANSPORT: &str = "http";
const IPC_PROTOCOL_VERSION: u32 = 1;
const SESSION_TOKEN_ENV: &str = "TORLINK_SESSION_TOKEN";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const IPC_TIMEOUT: Duration = Duration::from_secs(1);
const MAX_IPC_RESPONSE_BYTES: u64 = 64 * 1024;

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
    /// Tests may inject a deterministic value. Normal launches always generate
    /// a new 256-bit token and pass it only through the child environment.
    pub(crate) session_token: Option<String>,
}

#[derive(Clone)]
struct SidecarEndpoint {
    port: u16,
    session_token: String,
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
    InvalidSessionToken,
    RandomToken,
    Spawn(io::Error),
    ReadinessFailed,
    ReadinessTimeout,
    Ipc(io::Error),
    IpcProtocol,
    Process(io::Error),
}

impl fmt::Display for SidecarError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::AlreadyRunning => formatter.write_str("sidecar is already running"),
            Self::InvalidSessionToken => formatter.write_str("sidecar session token is invalid"),
            Self::RandomToken => formatter.write_str("failed to create sidecar session token"),
            Self::Spawn(_) => formatter.write_str("failed to start bundled Node sidecar"),
            Self::ReadinessFailed => formatter.write_str("sidecar exited before readiness"),
            Self::ReadinessTimeout => formatter.write_str("sidecar readiness timed out"),
            Self::Ipc(_) => formatter.write_str("failed to communicate with Node sidecar"),
            Self::IpcProtocol => {
                formatter.write_str("Node sidecar returned an invalid IPC response")
            }
            Self::Process(_) => formatter.write_str("failed to manage sidecar process"),
        }
    }
}

impl Error for SidecarError {
    fn source(&self) -> Option<&(dyn Error + 'static)> {
        match self {
            Self::Spawn(error) | Self::Ipc(error) | Self::Process(error) => Some(error),
            _ => None,
        }
    }
}

#[derive(Debug, Deserialize)]
struct ReadySignal {
    #[serde(rename = "type")]
    message_type: String,
    transport: String,
    host: String,
    port: u16,
    authentication: String,
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
}

impl ReadySignal {
    fn is_valid(&self) -> bool {
        self.message_type == "ready"
            && self.transport == IPC_TRANSPORT
            && self.host == LOOPBACK_HOST
            && self.port != 0
            && self.authentication == "session-token"
            && self.protocol_version == IPC_PROTOCOL_VERSION
    }
}

#[derive(Serialize)]
struct IpcRequest<'a> {
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    command: &'a str,
}

#[derive(Debug, Deserialize)]
struct IpcResponse {
    ok: bool,
    #[serde(rename = "protocolVersion")]
    protocol_version: u32,
    command: Option<String>,
    result: Option<Value>,
}

#[derive(Debug)]
struct HttpResponse {
    status_code: u16,
    body: Value,
}

#[derive(Default)]
pub(crate) struct SidecarSupervisor {
    child: Option<Child>,
    endpoint: Option<SidecarEndpoint>,
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

        let session_token = match &config.session_token {
            Some(token) => token.clone(),
            None => generate_session_token()?,
        };
        if !is_valid_session_token(&session_token) {
            return Err(SidecarError::InvalidSessionToken);
        }

        let mut command = Command::new(&paths.node);
        command
            .arg(&paths.bootstrap)
            .env("TORLINK_IPC_HOST", LOOPBACK_HOST)
            .env("TORLINK_IPC_TRANSPORT", IPC_TRANSPORT)
            .env(SESSION_TOKEN_ENV, &session_token)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());

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
                .ok()
                .filter(|bytes| *bytes > 0)
                .and_then(|_| serde_json::from_str::<ReadySignal>(line.trim()).ok())
                .filter(ReadySignal::is_valid);
            let _ = sender.send(ready);
        });

        let ready = match receiver.recv_timeout(STARTUP_TIMEOUT) {
            Ok(Some(ready)) => ready,
            Ok(None) | Err(mpsc::RecvTimeoutError::Disconnected) => {
                let _ = stop_child(&mut child, Duration::from_millis(250));
                return Err(SidecarError::ReadinessFailed);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                let _ = stop_child(&mut child, Duration::from_millis(250));
                return Err(SidecarError::ReadinessTimeout);
            }
        };

        self.endpoint = Some(SidecarEndpoint {
            port: ready.port,
            session_token,
        });
        self.child = Some(child);

        let ping = self.command("ping");
        if !matches!(
            ping,
            Ok(IpcResponse {
                ok: true,
                protocol_version: IPC_PROTOCOL_VERSION,
                command: Some(ref command),
                result: Some(ref result),
            }) if command == "ping" && result.get("reply") == Some(&Value::String("pong".into()))
        ) {
            let _ = self.stop();
            return Err(SidecarError::IpcProtocol);
        }

        Ok(())
    }

    fn command(&self, command: &str) -> Result<IpcResponse, SidecarError> {
        let endpoint = self.endpoint.as_ref().ok_or(SidecarError::IpcProtocol)?;
        let body = serde_json::to_string(&IpcRequest {
            protocol_version: IPC_PROTOCOL_VERSION,
            command,
        })
        .map_err(|_| SidecarError::IpcProtocol)?;
        let response = send_ipc_request(endpoint, &endpoint.session_token, &body)?;
        if response.status_code != 200 {
            return Err(SidecarError::IpcProtocol);
        }
        let response: IpcResponse =
            serde_json::from_value(response.body).map_err(|_| SidecarError::IpcProtocol)?;
        if !response.ok
            || response.protocol_version != IPC_PROTOCOL_VERSION
            || response.command.as_deref() != Some(command)
        {
            return Err(SidecarError::IpcProtocol);
        }
        Ok(response)
    }

    #[cfg(test)]
    fn endpoint(&self) -> Option<(u16, &str)> {
        self.endpoint
            .as_ref()
            .map(|endpoint| (endpoint.port, endpoint.session_token.as_str()))
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
        self.endpoint = None;
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

fn generate_session_token() -> Result<String, SidecarError> {
    let mut random_bytes = [0_u8; 32];
    getrandom::fill(&mut random_bytes).map_err(|_| SidecarError::RandomToken)?;
    let mut token = String::with_capacity(random_bytes.len() * 2);
    for byte in random_bytes {
        use fmt::Write as _;
        write!(&mut token, "{byte:02x}").map_err(|_| SidecarError::RandomToken)?;
    }
    Ok(token)
}

fn is_valid_session_token(token: &str) -> bool {
    token.len() == 64
        && token
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
}

fn send_ipc_request(
    endpoint: &SidecarEndpoint,
    session_token: &str,
    body: &str,
) -> Result<HttpResponse, SidecarError> {
    let address = SocketAddrV4::new(Ipv4Addr::LOCALHOST, endpoint.port);
    let mut stream =
        TcpStream::connect_timeout(&address.into(), IPC_TIMEOUT).map_err(SidecarError::Ipc)?;
    stream
        .set_read_timeout(Some(IPC_TIMEOUT))
        .map_err(SidecarError::Ipc)?;
    stream
        .set_write_timeout(Some(IPC_TIMEOUT))
        .map_err(SidecarError::Ipc)?;

    write!(
        stream,
        "POST /ipc HTTP/1.1\r\nHost: {LOOPBACK_HOST}:{}\r\nAuthorization: Bearer {session_token}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
        endpoint.port,
        body.len(),
    )
    .map_err(SidecarError::Ipc)?;
    stream.flush().map_err(SidecarError::Ipc)?;

    let mut response_bytes = Vec::new();
    stream
        .take(MAX_IPC_RESPONSE_BYTES + 1)
        .read_to_end(&mut response_bytes)
        .map_err(SidecarError::Ipc)?;
    if response_bytes.len() as u64 > MAX_IPC_RESPONSE_BYTES {
        return Err(SidecarError::IpcProtocol);
    }

    let response_text =
        std::str::from_utf8(&response_bytes).map_err(|_| SidecarError::IpcProtocol)?;
    let (headers, body) = response_text
        .split_once("\r\n\r\n")
        .ok_or(SidecarError::IpcProtocol)?;
    let status_code = headers
        .lines()
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .and_then(|status| status.parse::<u16>().ok())
        .ok_or(SidecarError::IpcProtocol)?;
    let body = serde_json::from_str(body).map_err(|_| SidecarError::IpcProtocol)?;

    Ok(HttpResponse { status_code, body })
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

    fn started_supervisor() -> SidecarSupervisor {
        let mut supervisor = SidecarSupervisor::default();
        supervisor
            .start(&test_paths(), &SidecarLaunchConfig::default())
            .expect("sidecar should start");
        supervisor
    }

    fn raw_request(supervisor: &SidecarSupervisor, token: &str, body: &str) -> HttpResponse {
        let (port, _) = supervisor.endpoint().expect("endpoint should exist");
        send_ipc_request(
            &SidecarEndpoint {
                port,
                session_token: String::new(),
            },
            token,
            body,
        )
        .expect("IPC response should be readable")
    }

    #[test]
    fn starts_on_random_loopback_port_and_serves_ping_and_health() {
        let mut supervisor = started_supervisor();
        let (port, token) = supervisor.endpoint().expect("endpoint should exist");

        assert_ne!(port, 0);
        assert!(is_valid_session_token(token));
        let health = supervisor.command("health").expect("health should succeed");
        assert!(health.ok);
        assert_eq!(health.protocol_version, IPC_PROTOCOL_VERSION);
        assert_eq!(health.command.as_deref(), Some("health"));
        assert_eq!(
            health
                .result
                .and_then(|result| result.get("status").cloned()),
            Some(Value::String("ok".into()))
        );
        assert!(supervisor.is_running().expect("status should be readable"));
        assert_eq!(
            supervisor.stop().expect("sidecar should stop"),
            StopOutcome::Graceful
        );
    }

    #[test]
    fn creates_a_fresh_session_token_for_each_launch() {
        let mut first = started_supervisor();
        let first_token = first
            .endpoint()
            .expect("endpoint should exist")
            .1
            .to_owned();
        first.stop().expect("first sidecar should stop");

        let mut second = started_supervisor();
        let second_token = second
            .endpoint()
            .expect("endpoint should exist")
            .1
            .to_owned();
        second.stop().expect("second sidecar should stop");

        assert_ne!(first_token, second_token);
    }

    #[test]
    fn rejects_missing_and_wrong_tokens_with_structured_errors() {
        let mut supervisor = started_supervisor();
        for token in ["", &"0".repeat(64)] {
            let response = raw_request(
                &supervisor,
                token,
                r#"{"protocolVersion":1,"command":"ping"}"#,
            );
            assert_eq!(response.status_code, 401);
            assert_eq!(response.body["ok"], false);
            assert_eq!(response.body["error"]["code"], "unauthorized");
        }
        supervisor.stop().expect("sidecar should stop");
    }

    #[test]
    fn returns_structured_errors_for_version_malformed_and_unknown_requests() {
        let mut supervisor = started_supervisor();
        let token = supervisor
            .endpoint()
            .expect("endpoint should exist")
            .1
            .to_owned();
        let cases = [
            (
                r#"{"protocolVersion":2,"command":"ping"}"#,
                409,
                "protocol_version_mismatch",
            ),
            ("{", 400, "malformed_request"),
            (
                r#"{"protocolVersion":1,"command":"not-a-command"}"#,
                404,
                "unknown_command",
            ),
        ];

        for (body, status, code) in cases {
            let response = raw_request(&supervisor, &token, body);
            assert_eq!(response.status_code, status);
            assert_eq!(response.body["ok"], false);
            assert_eq!(response.body["protocolVersion"], IPC_PROTOCOL_VERSION);
            assert_eq!(response.body["error"]["code"], code);
        }
        supervisor.stop().expect("sidecar should stop");
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
            .env(SESSION_TOKEN_ENV, "a".repeat(64))
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .expect("bundled Node runtime should start");

        assert_eq!(status.code(), Some(78));
    }

    #[test]
    fn stdin_guardian_exits_when_parent_pipe_closes() {
        let mut supervisor = started_supervisor();
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
            let supervisor = started_supervisor();
            supervisor.process_id().expect("sidecar should have a pid")
        };

        assert!(!process_exists(process_id));
    }
}
