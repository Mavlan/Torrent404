import { access, copyFile, cp, mkdir, rm } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
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
const sidecarNodeModulesDirectory = path.join(sidecarDirectory, "node_modules");
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
  [path.join("search", "providers", "KnabenProvider.js"), "KnabenProvider.js"],
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

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  throw new Error("npm_execpath is required to prepare sidecar dependencies");
}
const { stdout: productionDependencyOutput } = await promisify(execFile)(
  process.execPath,
  [npmCli, "ls", "--omit=dev", "--all", "--parseable", "--workspace", "@torlink/core"],
  { cwd: repositoryRoot, windowsHide: true, maxBuffer: 1024 * 1024 },
);
const repositoryNodeModules = path.join(repositoryRoot, "node_modules");
const torlinkWorkspacePrefix = path.join(repositoryNodeModules, "@torlink") + path.sep;
const productionDependencySources = [
  ...new Set(
    productionDependencyOutput
      .split(/\r?\n/u)
      .filter(Boolean)
      .map((entry) => path.resolve(entry))
      .filter(
        (entry) =>
          entry.startsWith(repositoryNodeModules + path.sep) &&
          !entry.startsWith(torlinkWorkspacePrefix),
      ),
  ),
].sort((left, right) => left.length - right.length);

if (path.dirname(sidecarNodeModulesDirectory) !== sidecarDirectory) {
  throw new Error("Refusing to replace sidecar dependencies outside the sidecar directory");
}
await rm(sidecarNodeModulesDirectory, { recursive: true, force: true });
await mkdir(sidecarNodeModulesDirectory, { recursive: true });

for (const source of productionDependencySources) {
  const relativePath = path.relative(repositoryNodeModules, source);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    throw new Error(`Production dependency escaped node_modules: ${source}`);
  }
  const destinationPath = path.join(sidecarNodeModulesDirectory, relativePath);
  await mkdir(path.dirname(destinationPath), { recursive: true });
  await cp(source, destinationPath, {
    recursive: true,
    dereference: true,
    force: true,
  });
}

const adapterRequire = createRequire(
  path.join(sidecarCoreDirectory, "torrent", "WebTorrentAdapter.js"),
);
for (const packageName of ["node-datachannel", "webtorrent"]) {
  const resolvedPath = path.resolve(adapterRequire.resolve(packageName));
  if (!resolvedPath.startsWith(sidecarNodeModulesDirectory + path.sep)) {
    throw new Error(
      `Bundled ${packageName} resolved outside sidecar/node_modules: ${resolvedPath}`,
    );
  }
}
await access(
  path.join(sidecarNodeModulesDirectory, "bittorrent-tracker", "package.json"),
);
await promisify(execFile)(
  destination,
  [
    "--input-type=module",
    "--eval",
    `await import(${JSON.stringify(
      pathToFileURL(
        path.join(sidecarCoreDirectory, "torrent", "WebTorrentAdapter.js"),
      ).href,
    )})`,
  ],
  { cwd: sidecarDirectory, windowsHide: true },
);

process.stdout.write(
  `Prepared bundled Node sidecar runtime ${REQUIRED_NODE_VERSION}, Core modules, and ${productionDependencySources.length} production dependency paths\n`,
);
