import process from "node:process";
import readline from "node:readline";

const LOOPBACK_HOST = "127.0.0.1";
const host = process.env.TORLINK_IPC_HOST ?? LOOPBACK_HOST;

if (host !== LOOPBACK_HOST) {
  process.stderr.write("Sidecar IPC host must be IPv4 loopback\n");
  process.exit(78);
}

// Phase 3.1 reserves the transport and token environment contract. The server
// and authenticated command surface arrive in later Phase 3 steps.
const ready = {
  type: "ready",
  transport: process.env.TORLINK_IPC_TRANSPORT ?? "http",
  host: LOOPBACK_HOST,
  port: 0,
  authentication: "session-token",
};

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  process.stdin.pause();
  setImmediate(() => process.exit(code));
}

const control = readline.createInterface({ input: process.stdin });
control.on("line", (line) => {
  if (line.trim() === "shutdown") shutdown(0);
});
control.on("close", () => shutdown(0));
process.stdin.on("error", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

process.stdout.write(`${JSON.stringify(ready)}\n`);
