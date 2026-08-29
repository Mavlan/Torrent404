use serde::Deserialize;
use serde_json::{json, Value};
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
const YTS_FIXTURE_ENV: &str = "TORLINK_YTS_FIXTURE";
const NYAA_FIXTURE_ENV: &str = "TORLINK_NYAA_FIXTURE";
const TORRENT_ENGINE_FIXTURE_ENV: &str = "TORLINK_TORRENT_ENGINE_FIXTURE";
const TASK_STORE_PATH_ENV: &str = "TORLINK_TASK_STORE_PATH";
const STARTUP_TIMEOUT: Duration = Duration::from_secs(3);
const SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(2);
const IPC_TIMEOUT: Duration = Duration::from_secs(5);
const MAX_IPC_RESPONSE_BYTES: u64 = 64 * 1024;
const MAX_STARTUP_STDERR_BYTES: u64 = 8 * 1024;

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
    pub(crate) yts_fixture: Option<PathBuf>,
    pub(crate) nyaa_fixture: Option<PathBuf>,
    pub(crate) torrent_engine_fixture: Option<String>,
    pub(crate) task_store_path: Option<PathBuf>,
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
    ReadinessFailed {
        exit_code: Option<i32>,
        stderr: String,
    },
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
            Self::ReadinessFailed { exit_code, stderr } => {
                write!(formatter, "sidecar exited before readiness")?;
                if let Some(code) = exit_code {
                    write!(formatter, " (exit code {code})")?;
                }
                if !stderr.is_empty() {
                    write!(formatter, ": {stderr}")?;
                }
                Ok(())
            }
            Self::ReadinessTimeout => formatter.write_str("sidecar readiness timed out"),
            Self::Ipc(_) => formatter.write_str("failed to communicate with Node sidecar"),
            Self::IpcProtocol => {
                formatter.write_str("Node sidecar returned an invalid IPC response")
            }
            Self::Process(_) => formatter.write_str("failed to manage sidecar process"),
        }
    }
}

impl SidecarError {
    pub(crate) fn safe_startup_reason(&self) -> String {
        match self {
            Self::AlreadyRunning => "the local Core process is already running".to_owned(),
            Self::InvalidSessionToken | Self::RandomToken => {
                "the local Core session could not be initialized".to_owned()
            }
            Self::Spawn(_) => "the bundled Node Core process could not be started".to_owned(),
            Self::ReadinessFailed { exit_code, .. } => match exit_code {
                Some(code) => format!(
                    "the bundled Node Core process exited before it was ready (exit code {code})"
                ),
                None => "the bundled Node Core process exited before it was ready".to_owned(),
            },
            Self::ReadinessTimeout => {
                "the bundled Node Core process did not become ready in time".to_owned()
            }
            Self::Ipc(_) | Self::IpcProtocol => "the local Core readiness check failed".to_owned(),
            Self::Process(_) => "the bundled Node Core process could not be managed".to_owned(),
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

        let bootstrap_path = node_cli_path(&paths.bootstrap);
        let mut command = Command::new(&paths.node);
        command
            .arg(&bootstrap_path)
            .env("TORLINK_IPC_HOST", LOOPBACK_HOST)
            .env("TORLINK_IPC_TRANSPORT", IPC_TRANSPORT)
            .env(SESSION_TOKEN_ENV, &session_token)
            .env_remove(YTS_FIXTURE_ENV)
            .env_remove(NYAA_FIXTURE_ENV)
            .env_remove(TORRENT_ENGINE_FIXTURE_ENV)
            .env_remove(TASK_STORE_PATH_ENV)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path) = &config.yts_fixture {
            command.env(YTS_FIXTURE_ENV, path);
        }
        if let Some(path) = &config.nyaa_fixture {
            command.env(NYAA_FIXTURE_ENV, path);
        }
        if let Some(fixture) = &config.torrent_engine_fixture {
            command.env(TORRENT_ENGINE_FIXTURE_ENV, fixture);
        }
        if let Some(path) = &config.task_store_path {
            command.env(TASK_STORE_PATH_ENV, path);
        }

        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x0800_0000);
        }

        let mut child = command.spawn().map_err(SidecarError::Spawn)?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| SidecarError::ReadinessFailed {
                exit_code: None,
                stderr: "sidecar stdout pipe was unavailable".to_owned(),
            })?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| SidecarError::ReadinessFailed {
                exit_code: None,
                stderr: "sidecar stderr pipe was unavailable".to_owned(),
            })?;
        let (stderr_sender, stderr_receiver) = mpsc::sync_channel(1);
        thread::spawn(move || {
            let mut bytes = Vec::new();
            let _ = stderr
                .take(MAX_STARTUP_STDERR_BYTES)
                .read_to_end(&mut bytes);
            let _ = stderr_sender.send(String::from_utf8_lossy(&bytes).trim().to_owned());
        });
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
                return Err(startup_failure(&mut child, &stderr_receiver));
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

        let ping = self.command("ping", json!({}));
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

    fn raw_command(&self, command: &str, fields: Value) -> Result<HttpResponse, SidecarError> {
        let endpoint = self.endpoint.as_ref().ok_or(SidecarError::IpcProtocol)?;
        let mut request = serde_json::Map::from_iter([
            ("protocolVersion".into(), json!(IPC_PROTOCOL_VERSION)),
            ("command".into(), json!(command)),
        ]);
        let Value::Object(fields) = fields else {
            return Err(SidecarError::IpcProtocol);
        };
        request.extend(fields);
        let body = serde_json::to_string(&request).map_err(|_| SidecarError::IpcProtocol)?;
        send_ipc_request(endpoint, &endpoint.session_token, &body)
    }

    fn command(&self, command: &str, fields: Value) -> Result<IpcResponse, SidecarError> {
        let response = self.raw_command(command, fields)?;
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

    pub(crate) fn start_search(
        &self,
        query: &str,
        category: &str,
        provider_ids: Option<&[String]>,
    ) -> Result<Value, SidecarError> {
        let request_id = format!("search-{}", generate_random_hex(16)?);
        self.command(
            "search.start",
            json!({
                "requestId": request_id,
                "query": query,
                "category": category,
                "providerIds": provider_ids,
            }),
        )?
        .result
        .ok_or(SidecarError::IpcProtocol)
    }

    pub(crate) fn search_providers(&self) -> Result<Value, SidecarError> {
        self.command("search.providers", json!({}))?
            .result
            .ok_or(SidecarError::IpcProtocol)
    }

    pub(crate) fn poll_search(&self, request_id: &str, cursor: u64) -> Result<Value, SidecarError> {
        self.command(
            "search.poll",
            json!({ "requestId": request_id, "cursor": cursor }),
        )?
        .result
        .ok_or(SidecarError::IpcProtocol)
    }

    pub(crate) fn cancel_search(&self, request_id: &str) -> Result<Value, SidecarError> {
        self.command("search.cancel", json!({ "requestId": request_id }))?
            .result
            .ok_or(SidecarError::IpcProtocol)
    }

    pub(crate) fn add_download(
        &self,
        magnet: &str,
        name: Option<&str>,
        total: Option<u64>,
        download_dir: &Path,
    ) -> Result<Value, SidecarError> {
        let response = self.raw_command(
            "download.add",
            json!({
                "magnet": magnet,
                "name": name,
                "total": total,
                "downloadDir": download_dir,
            }),
        )?;
        let protocol_version = response.body["protocolVersion"].as_u64();
        if protocol_version != Some(u64::from(IPC_PROTOCOL_VERSION)) {
            return Err(SidecarError::IpcProtocol);
        }
        let valid_success = response.status_code == 200
            && response.body["ok"] == true
            && response.body["command"] == "download.add"
            && response.body["result"]["taskId"].is_string()
            && response.body["result"]["task"].is_object();
        let valid_error = response.status_code >= 400
            && response.status_code < 600
            && response.body["ok"] == false
            && response.body["error"]["code"].is_string()
            && response.body["error"]["message"].is_string();
        if !valid_success && !valid_error {
            return Err(SidecarError::IpcProtocol);
        }
        Ok(response.body)
    }

    pub(crate) fn list_downloads(&self) -> Result<Value, SidecarError> {
        let result = self
            .command("download.list", json!({}))?
            .result
            .ok_or(SidecarError::IpcProtocol)?;
        if !result["tasks"].is_array() {
            return Err(SidecarError::IpcProtocol);
        }
        Ok(result)
    }

    pub(crate) fn control_download(
        &self,
        command: &str,
        task_id: &str,
    ) -> Result<Value, SidecarError> {
        if !matches!(
            command,
            "download.pause"
                | "download.resume"
                | "download.seed.start"
                | "download.seed.stop"
                | "download.remove"
        ) {
            return Err(SidecarError::IpcProtocol);
        }
        let response = self.raw_command(command, json!({ "taskId": task_id }))?;
        if response.body["protocolVersion"].as_u64() != Some(u64::from(IPC_PROTOCOL_VERSION)) {
            return Err(SidecarError::IpcProtocol);
        }
        let result = &response.body["result"];
        let valid_state_success = command != "download.remove"
            && response.status_code == 200
            && response.body["ok"] == true
            && response.body["command"] == command
            && result["taskId"].is_string()
            && result["task"].is_object();
        let valid_remove_success = command == "download.remove"
            && response.status_code == 200
            && response.body["ok"] == true
            && response.body["command"] == command
            && result["taskId"].is_string()
            && result["removed"] == true;
        let valid_error = response.status_code >= 400
            && response.status_code < 600
            && response.body["ok"] == false
            && response.body["error"]["code"].is_string()
            && response.body["error"]["message"].is_string();
        if !valid_state_success && !valid_remove_success && !valid_error {
            return Err(SidecarError::IpcProtocol);
        }
        Ok(response.body)
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
    generate_random_hex(32)
}

#[cfg(target_os = "windows")]
fn node_cli_path(path: &Path) -> PathBuf {
    use std::{
        ffi::OsString,
        os::windows::ffi::{OsStrExt, OsStringExt},
    };

    const VERBATIM_PREFIX: [u16; 4] = [b'\\' as u16, b'\\' as u16, b'?' as u16, b'\\' as u16];
    const VERBATIM_UNC_PREFIX: [u16; 8] = [
        b'\\' as u16,
        b'\\' as u16,
        b'?' as u16,
        b'\\' as u16,
        b'U' as u16,
        b'N' as u16,
        b'C' as u16,
        b'\\' as u16,
    ];

    let encoded: Vec<u16> = path.as_os_str().encode_wide().collect();
    if encoded.starts_with(&VERBATIM_UNC_PREFIX) {
        let normalized = [b'\\' as u16, b'\\' as u16]
            .into_iter()
            .chain(encoded[VERBATIM_UNC_PREFIX.len()..].iter().copied())
            .collect::<Vec<_>>();
        return PathBuf::from(OsString::from_wide(&normalized));
    }
    if encoded.starts_with(&VERBATIM_PREFIX)
        && encoded.get(4).is_some_and(|unit| {
            (*unit >= b'A' as u16 && *unit <= b'Z' as u16)
                || (*unit >= b'a' as u16 && *unit <= b'z' as u16)
        })
        && encoded.get(5) == Some(&(b':' as u16))
    {
        return PathBuf::from(OsString::from_wide(&encoded[VERBATIM_PREFIX.len()..]));
    }
    path.to_owned()
}

#[cfg(not(target_os = "windows"))]
fn node_cli_path(path: &Path) -> PathBuf {
    path.to_owned()
}

fn startup_failure(child: &mut Child, stderr: &mpsc::Receiver<String>) -> SidecarError {
    let mut exit_code = child
        .try_wait()
        .ok()
        .flatten()
        .and_then(|status| status.code());
    if exit_code.is_none() {
        let _ = stop_child(child, Duration::from_millis(250));
        exit_code = child
            .try_wait()
            .ok()
            .flatten()
            .and_then(|status| status.code());
    }
    let stderr = stderr
        .recv_timeout(Duration::from_millis(250))
        .unwrap_or_default();
    SidecarError::ReadinessFailed { exit_code, stderr }
}

fn generate_random_hex(byte_count: usize) -> Result<String, SidecarError> {
    let mut random_bytes = vec![0_u8; byte_count];
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
        started_supervisor_with_config(&SidecarLaunchConfig::default())
    }

    fn started_supervisor_with_config(config: &SidecarLaunchConfig) -> SidecarSupervisor {
        let mut supervisor = SidecarSupervisor::default();
        supervisor
            .start(&test_paths(), config)
            .expect("sidecar should start");
        supervisor
    }

    fn search_fixture(name: &str) -> PathBuf {
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../packages/core/src/search/providers/__fixtures__")
            .join(name)
            .canonicalize()
            .expect("search fixture should exist")
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
        let health = supervisor
            .command("health", json!({}))
            .expect("health should succeed");
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
    fn starts_from_tauri_verbatim_resource_paths() {
        let normal = test_paths();
        let paths = SidecarPaths {
            node: PathBuf::from(format!(r"\\?\{}", normal.node.display())),
            bootstrap: PathBuf::from(format!(r"\\?\{}", normal.bootstrap.display())),
        };
        assert_eq!(node_cli_path(&paths.bootstrap), normal.bootstrap);

        let mut supervisor = SidecarSupervisor::default();
        supervisor
            .start(&paths, &SidecarLaunchConfig::default())
            .expect("sidecar should accept Tauri verbatim resource paths");
        assert!(supervisor.is_running().expect("status should be readable"));
        assert_eq!(
            supervisor.stop().expect("sidecar should stop"),
            StopOutcome::Graceful
        );
    }

    #[test]
    fn startup_failure_summary_does_not_expose_sidecar_stderr() {
        let error = SidecarError::ReadinessFailed {
            exit_code: Some(1),
            stderr: "private runtime details and session material".to_owned(),
        };

        let summary = error.safe_startup_reason();
        assert!(summary.contains("exit code 1"));
        assert!(!summary.contains("private runtime details"));
        assert!(!summary.contains("session material"));
    }

    #[test]
    fn streams_yts_and_nyaa_fixture_results_over_authenticated_ipc() {
        let config = SidecarLaunchConfig {
            session_token: None,
            yts_fixture: Some(search_fixture("yts-normal.json")),
            nyaa_fixture: Some(search_fixture("nyaa-normal.xml")),
            torrent_engine_fixture: None,
            task_store_path: None,
        };
        let mut supervisor = started_supervisor_with_config(&config);
        let providers = supervisor
            .search_providers()
            .expect("provider descriptors should load");
        assert_eq!(providers["providers"][0]["providerId"], "yts");
        assert_eq!(providers["providers"][0]["categories"][0], "movies");
        assert_eq!(providers["providers"][1]["providerId"], "nyaa");
        assert_eq!(providers["providers"][1]["categories"][0], "anime");
        assert_eq!(providers["providers"][2]["providerId"], "knaben");
        assert_eq!(
            providers["providers"][2]["categories"],
            json!(["movies", "tv", "anime", "games", "software"])
        );
        assert_eq!(providers["providers"][2]["enabled"], true);
        assert_eq!(providers["providers"][3]["providerId"], "eztv");
        assert_eq!(providers["providers"][3]["categories"], json!(["tv"]));
        assert_eq!(providers["providers"][3]["enabled"], true);
        assert_eq!(providers["providers"][4]["providerId"], "tpb");
        assert_eq!(
            providers["providers"][4]["categories"],
            json!(["movies", "tv"])
        );
        assert_eq!(providers["providers"][4]["enabled"], true);
        let fixture_providers = vec!["yts".to_owned(), "nyaa".to_owned()];
        let started = supervisor
            .start_search("legal fixture", "all", Some(&fixture_providers))
            .expect("search should start");
        let request_id = started["requestId"]
            .as_str()
            .expect("search should return request ID");
        let mut cursor = 0;
        let mut events = Vec::new();
        let deadline = Instant::now() + Duration::from_secs(2);

        loop {
            let poll = supervisor
                .poll_search(request_id, cursor)
                .expect("search poll should succeed");
            cursor = poll["nextCursor"]
                .as_u64()
                .expect("poll should return a cursor");
            events.extend(
                poll["events"]
                    .as_array()
                    .expect("poll should return events")
                    .iter()
                    .cloned(),
            );
            if poll["done"] == true {
                break;
            }
            assert!(Instant::now() < deadline, "fixture search should complete");
            thread::sleep(Duration::from_millis(10));
        }

        let sources: Vec<_> = events
            .iter()
            .filter(|event| event["type"] == "search.result")
            .filter_map(|event| event["result"]["source"].as_str())
            .collect();
        assert!(sources.contains(&"yts"));
        assert!(sources.contains(&"nyaa"));
        assert!(events
            .iter()
            .any(|event| { event["type"] == "search.complete" && event["cancelled"] == false }));
        let second = supervisor
            .start_search("second fixture", "all", Some(&fixture_providers))
            .expect("second search should start");
        let second_request_id = second["requestId"]
            .as_str()
            .expect("second search should return request ID");
        assert_ne!(request_id, second_request_id);
        supervisor
            .cancel_search(second_request_id)
            .expect("second search should cancel");
        supervisor.stop().expect("sidecar should stop");
    }

    #[test]
    fn adds_downloads_and_returns_structured_failures_over_authenticated_ipc() {
        let download_dir = std::env::temp_dir().join(format!(
            "torlink-phase-3-4-{}-{}",
            std::process::id(),
            generate_random_hex(4).expect("test suffix should be random")
        ));
        let config = SidecarLaunchConfig {
            torrent_engine_fixture: Some("success".to_owned()),
            ..SidecarLaunchConfig::default()
        };
        let mut supervisor = started_supervisor_with_config(&config);
        let magnet = "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01";

        let added = supervisor
            .add_download(magnet, Some("Legal fixture"), Some(42), &download_dir)
            .expect("download command should return a structured response");
        assert_eq!(added["ok"], true);
        assert_eq!(added["command"], "download.add");
        assert_eq!(added["result"]["task"]["status"], "downloading");
        assert_eq!(
            added["result"]["task"]["savePath"].as_str(),
            Some(download_dir.to_string_lossy().as_ref())
        );

        let duplicate = supervisor
            .add_download(magnet, Some("Duplicate"), Some(42), &download_dir)
            .expect("duplicate should remain a structured IPC response");
        assert_eq!(duplicate["ok"], false);
        assert_eq!(duplicate["error"]["code"], "duplicate_torrent");

        let task_id = added["result"]["taskId"]
            .as_str()
            .expect("download should have task ID");
        let snapshots = supervisor
            .list_downloads()
            .expect("task snapshots should return over authenticated IPC");
        assert_eq!(snapshots["tasks"][0]["progress"], 0.5);
        assert_eq!(snapshots["tasks"][0]["downloaded"], 21);
        assert_eq!(snapshots["tasks"][0]["downloadSpeed"], 2_048);
        assert_eq!(snapshots["tasks"][0]["uploadSpeed"], 256);
        assert_eq!(snapshots["tasks"][0]["peers"], 3);
        assert_eq!(snapshots["tasks"][0]["etaSeconds"], 10);
        let invalid_transition = supervisor
            .control_download("download.resume", task_id)
            .expect("invalid transition should remain a structured IPC response");
        assert_eq!(
            invalid_transition["error"]["code"],
            "invalid_download_task_transition"
        );
        let invalid_seed = supervisor
            .control_download("download.seed.start", task_id)
            .expect("explicit seed command should return a structured IPC response");
        assert_eq!(
            invalid_seed["error"]["code"],
            "invalid_download_task_transition"
        );
        let paused = supervisor
            .control_download("download.pause", task_id)
            .expect("pause should return a structured response");
        assert_eq!(paused["result"]["task"]["status"], "paused");
        let paused_snapshots = supervisor
            .list_downloads()
            .expect("paused snapshots should return over authenticated IPC");
        assert_eq!(paused_snapshots["tasks"][0]["downloadSpeed"], 0);
        assert_eq!(paused_snapshots["tasks"][0]["uploadSpeed"], 0);
        assert!(paused_snapshots["tasks"][0]["etaSeconds"].is_null());
        let resumed = supervisor
            .control_download("download.resume", task_id)
            .expect("resume should return a structured response");
        assert_eq!(resumed["result"]["task"]["status"], "downloading");
        let removed = supervisor
            .control_download("download.remove", task_id)
            .expect("remove should return a structured response");
        assert_eq!(removed["result"]["removed"], true);
        let missing = supervisor
            .control_download("download.pause", task_id)
            .expect("missing task should remain a structured IPC response");
        assert_eq!(missing["error"]["code"], "download_task_not_found");

        let invalid = supervisor
            .add_download("not-a-magnet", None, None, &download_dir)
            .expect("invalid magnet should remain a structured IPC response");
        assert_eq!(invalid["ok"], false);
        assert_eq!(invalid["error"]["code"], "invalid_magnet");

        supervisor.stop().expect("sidecar should stop");
        let _ = std::fs::remove_dir_all(download_dir);
    }

    #[test]
    fn persists_paused_downloads_across_sidecar_restarts_and_removes_them_durably() {
        let root = std::env::temp_dir().join(format!(
            "torrent404-task-persistence-{}-{}",
            std::process::id(),
            generate_random_hex(4).expect("test suffix should be random")
        ));
        let download_dir = root.join("downloads");
        let task_store_path = root.join("state").join("download-tasks.v1.json");
        let config = SidecarLaunchConfig {
            torrent_engine_fixture: Some("success".to_owned()),
            task_store_path: Some(task_store_path.clone()),
            ..SidecarLaunchConfig::default()
        };
        let magnet = "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01";

        let mut first = started_supervisor_with_config(&config);
        let added = first
            .add_download(magnet, Some("Restart fixture"), Some(42), &download_dir)
            .expect("download should be added");
        let task_id = added["result"]["taskId"]
            .as_str()
            .expect("download should have task ID")
            .to_owned();
        let paused = first
            .control_download("download.pause", &task_id)
            .expect("download should pause");
        assert_eq!(paused["result"]["task"]["status"], "paused");
        first.stop().expect("first sidecar should stop cleanly");
        assert!(task_store_path.is_file());

        let stored: Value = serde_json::from_slice(
            &std::fs::read(&task_store_path).expect("task store should be readable"),
        )
        .expect("task store should contain JSON");
        assert_eq!(stored["schemaVersion"], 1);
        assert_eq!(stored["tasks"][0]["status"], "paused");
        assert!(stored["tasks"][0].get("downloadSpeed").is_none());
        assert!(stored["tasks"][0].get("peers").is_none());

        let mut second = started_supervisor_with_config(&config);
        let restored = second
            .list_downloads()
            .expect("restored snapshots should be available");
        assert_eq!(restored["tasks"][0]["id"], task_id);
        assert_eq!(restored["tasks"][0]["status"], "paused");
        assert_eq!(
            restored["tasks"][0]["savePath"],
            download_dir.to_string_lossy().as_ref()
        );
        assert_eq!(
            restored["tasks"][0]["infoHash"],
            "abcdef0123456789abcdef0123456789abcdef01"
        );

        let resumed = second
            .control_download("download.resume", &task_id)
            .expect("restored task should resume through its stored source");
        assert_eq!(resumed["result"]["task"]["status"], "downloading");
        let removed = second
            .control_download("download.remove", &task_id)
            .expect("restored task should be removable");
        assert_eq!(removed["result"]["removed"], true);
        second.stop().expect("second sidecar should stop cleanly");

        let mut third = started_supervisor_with_config(&config);
        let after_remove = third
            .list_downloads()
            .expect("empty restored snapshots should be available");
        assert_eq!(after_remove["tasks"], json!([]));
        third.stop().expect("third sidecar should stop cleanly");
        let _ = std::fs::remove_dir_all(root);
    }

    #[test]
    fn returns_structured_engine_add_failure() {
        let download_dir =
            std::env::temp_dir().join(format!("torlink-phase-3-4-failure-{}", std::process::id()));
        let config = SidecarLaunchConfig {
            torrent_engine_fixture: Some("failure".to_owned()),
            ..SidecarLaunchConfig::default()
        };
        let mut supervisor = started_supervisor_with_config(&config);
        let failed = supervisor
            .add_download(
                "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
                Some("Failure fixture"),
                None,
                &download_dir,
            )
            .expect("engine failure should remain a structured IPC response");
        assert_eq!(failed["ok"], false);
        assert_eq!(failed["error"]["code"], "engine_add_failed");
        assert!(!failed["error"]["message"]
            .as_str()
            .expect("message should be text")
            .contains("fixture engine failure"));

        supervisor.stop().expect("sidecar should stop");
        let _ = std::fs::remove_dir_all(download_dir);
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

        match error {
            SidecarError::ReadinessFailed { exit_code, stderr } => {
                assert_eq!(exit_code, Some(1));
                assert!(stderr.contains("missing-bootstrap.mjs"));
            }
            other => panic!("expected readiness failure, received {other:?}"),
        }
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
