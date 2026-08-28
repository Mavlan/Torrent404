import { randomBytes } from "node:crypto";
import { access, mkdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";

const HEX_INFO_HASH = /^[a-f\d]{40}$/i;
const BASE32_INFO_HASH = /^[a-z2-7]{32}$/i;

export class DownloadCommandError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "DownloadCommandError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

function decodeBase32InfoHash(value) {
  let bits = 0;
  let buffer = 0;
  const bytes = [];
  for (const character of value.toUpperCase()) {
    const alphabetIndex = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".indexOf(character);
    if (alphabetIndex < 0) return undefined;
    buffer = (buffer << 5) | alphabetIndex;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((buffer >>> bits) & 0xff);
      buffer &= (1 << bits) - 1;
    }
  }
  return bytes.length === 20 ? Buffer.from(bytes).toString("hex") : undefined;
}

export function parseMagnetInfoHash(value) {
  if (typeof value !== "string" || value.length > 8_192) return undefined;
  let magnet;
  try {
    magnet = new URL(value.trim());
  } catch {
    return undefined;
  }
  if (magnet.protocol !== "magnet:") return undefined;

  const exactTopic = magnet.searchParams
    .getAll("xt")
    .find((topic) => topic.toLowerCase().startsWith("urn:btih:"));
  if (!exactTopic) return undefined;
  const rawInfoHash = exactTopic.slice("urn:btih:".length);
  if (HEX_INFO_HASH.test(rawInfoHash)) return rawInfoHash.toLowerCase();
  if (BASE32_INFO_HASH.test(rawInfoHash)) return decodeBase32InfoHash(rawInfoHash);
  return undefined;
}

async function ensureDownloadDirectory(downloadDir) {
  try {
    await mkdir(downloadDir, { recursive: true });
    const metadata = await stat(downloadDir);
    if (!metadata.isDirectory()) throw new Error("Download path is not a directory");
    await access(downloadDir, fsConstants.W_OK);
  } catch {
    throw new DownloadCommandError(
      "download_directory_unavailable",
      "The download directory is unavailable",
      422,
    );
  }
}

function taskName(name, infoHash) {
  if (typeof name !== "string") return infoHash;
  const normalized = name.trim();
  return normalized.length > 0 && normalized.length <= 500 ? normalized : infoHash;
}

function taskTotal(total) {
  return Number.isSafeInteger(total) && total >= 0 ? total : 0;
}

export class DownloadService {
  #manager;
  #ensureDirectory;
  #createTaskId;

  constructor(manager, options = {}) {
    this.#manager = manager;
    this.#ensureDirectory = options.ensureDirectory ?? ensureDownloadDirectory;
    this.#createTaskId = options.createTaskId
      ?? (() => `download-${randomBytes(16).toString("hex")}`);
  }

  async add(input) {
    const magnet = typeof input?.magnet === "string" ? input.magnet.trim() : "";
    const infoHash = parseMagnetInfoHash(magnet);
    if (!infoHash) {
      throw new DownloadCommandError("invalid_magnet", "Magnet URI is invalid", 400);
    }
    const downloadDir = typeof input?.downloadDir === "string"
      ? input.downloadDir.trim()
      : "";
    if (downloadDir.length === 0) {
      throw new DownloadCommandError(
        "download_directory_unavailable",
        "The download directory is unavailable",
        422,
      );
    }
    await this.#ensureDirectory(downloadDir);

    try {
      const task = await this.#manager.add({
        id: this.#createTaskId(),
        infoHash,
        name: taskName(input?.name, infoHash),
        savePath: downloadDir,
        source: magnet,
        total: taskTotal(input?.total),
      });
      if (task.status === "error") {
        await this.#manager.remove(task.id).catch(() => false);
        throw new DownloadCommandError(
          "engine_add_failed",
          "The torrent engine could not start this download",
          502,
        );
      }
      return { taskId: task.id, task };
    } catch (error) {
      if (error instanceof DownloadCommandError) throw error;
      if (error?.name === "DuplicateTorrentError") {
        throw new DownloadCommandError(
          "duplicate_torrent",
          `This torrent is already in the download list (${error.existingTaskId})`,
          409,
        );
      }
      throw new DownloadCommandError(
        "engine_add_failed",
        "The torrent engine could not start this download",
        502,
      );
    }
  }

  pause(input) {
    return this.#changeState(input, "pause", ["queued", "downloading", "seeding"]);
  }

  resume(input) {
    return this.#changeState(input, "resume", ["paused"]);
  }

  async remove(input) {
    const { taskId } = this.#existingTask(input);
    try {
      if (!await this.#manager.remove(taskId)) {
        throw new DownloadCommandError(
          "engine_control_failed",
          "The torrent engine could not remove this task",
          502,
        );
      }
    } catch (error) {
      if (error instanceof DownloadCommandError) throw error;
      throw new DownloadCommandError(
        "engine_control_failed",
        "The torrent engine could not remove this task",
        502,
      );
    }
    return { taskId, removed: true };
  }

  #existingTask(input) {
    const taskId = typeof input?.taskId === "string" ? input.taskId.trim() : "";
    if (taskId.length === 0 || taskId.length > 500) {
      throw new DownloadCommandError(
        "invalid_download_task_request",
        "Download task ID is invalid",
        400,
      );
    }
    const task = this.#manager.get(taskId);
    if (!task) {
      throw new DownloadCommandError(
        "download_task_not_found",
        "Download task was not found",
        404,
      );
    }
    return { taskId, task };
  }

  #changeState(input, operation, allowedStatuses) {
    const { taskId, task } = this.#existingTask(input);
    if (!allowedStatuses.includes(task.status)) {
      throw new DownloadCommandError(
        "invalid_download_task_transition",
        `Download task cannot ${operation} from its current state`,
        409,
      );
    }

    try {
      if (!this.#manager[operation](taskId)) {
        throw new DownloadCommandError(
          "engine_control_failed",
          `The torrent engine could not ${operation} this task`,
          502,
        );
      }
    } catch (error) {
      if (error instanceof DownloadCommandError) throw error;
      throw new DownloadCommandError(
        "engine_control_failed",
        `The torrent engine could not ${operation} this task`,
        502,
      );
    }

    const updated = this.#manager.get(taskId);
    if (!updated) {
      throw new DownloadCommandError(
        "engine_control_failed",
        `The torrent engine could not ${operation} this task`,
        502,
      );
    }
    return { taskId, task: updated };
  }

  async shutdown() {
    await this.#manager.destroy();
  }
}
