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
const sidecarCoreDirectory = path.join(sidecarDirectory, "core");
const coreOutputDirectory = path.join(repositoryRoot, "packages", "core", "dist");
const typescriptCompiler = path.join(
  repositoryRoot,
  "node_modules",
  "typescript",
  "bin",
  "tsc",
);

await mkdir(sidecarDirectory, { recursive: true });
if (path.resolve(runtimeSource) !== path.resolve(destination)) {
  await copyFile(runtimeSource, destination);
}
await promisify(execFile)(process.execPath, [
  typescriptCompiler,
  "-p",
  path.join(repositoryRoot, "packages", "core", "tsconfig.build.json"),
], { cwd: repositoryRoot, windowsHide: true });
await mkdir(sidecarCoreDirectory, { recursive: true });
for (const [source, target] of [
  [path.join("search", "ProviderRegistry.js"), "ProviderRegistry.js"],
  [path.join("search", "SearchAggregator.js"), "SearchAggregator.js"],
  [path.join("search", "providers", "NyaaProvider.js"), "NyaaProvider.js"],
  [path.join("search", "providers", "YtsProvider.js"), "YtsProvider.js"],
  [path.join("tasks", "DownloadTaskModel.js"), path.join("tasks", "DownloadTaskModel.js")],
  [path.join("torrent", "TorrentManager.js"), path.join("torrent", "TorrentManager.js")],
  [path.join("torrent", "WebTorrentAdapter.js"), path.join("torrent", "WebTorrentAdapter.js")],
]) {
  await mkdir(path.dirname(path.join(sidecarCoreDirectory, target)), { recursive: true });
  await copyFile(
    path.join(coreOutputDirectory, source),
    path.join(sidecarCoreDirectory, target),
  );
}

process.stdout.write(
  `Prepared bundled Node sidecar runtime ${REQUIRED_NODE_VERSION} and Core search/torrent modules\n`,
);
