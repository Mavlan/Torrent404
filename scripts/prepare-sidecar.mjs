import { copyFile, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const REQUIRED_NODE_VERSION = "v24.20.0";

if (process.platform !== "win32" || process.arch !== "x64") {
  throw new Error("Phase 3.1 sidecar packaging currently requires Windows x64");
}
const runtimeSource = process.env.TORLINK_NODE_RUNTIME
  ? path.resolve(process.env.TORLINK_NODE_RUNTIME)
  : process.execPath;
const { stdout: runtimeVersionOutput } = await promisify(execFile)(
  runtimeSource,
  ["--version"],
  { windowsHide: true },
);
const runtimeVersion = runtimeVersionOutput.trim();
if (runtimeVersion !== REQUIRED_NODE_VERSION) {
  throw new Error(
    `Sidecar runtime must be ${REQUIRED_NODE_VERSION}; received ${runtimeVersion}`,
  );
}

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const sidecarDirectory = path.join(
  repositoryRoot,
  "apps",
  "desktop",
  "src-tauri",
  "sidecar",
);
const destination = path.join(sidecarDirectory, "node.exe");

await mkdir(sidecarDirectory, { recursive: true });
await copyFile(runtimeSource, destination);

process.stdout.write(`Prepared bundled Node sidecar runtime ${REQUIRED_NODE_VERSION}\n`);
