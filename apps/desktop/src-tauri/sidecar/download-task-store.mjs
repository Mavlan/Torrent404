import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

const SCHEMA_VERSION = 1;

export class DownloadTaskStore {
  #filePath;
  #pending = Promise.resolve();

  constructor(filePath) {
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      throw new Error("Download task store path is required");
    }
    this.#filePath = filePath;
  }

  async load() {
    try {
      const document = JSON.parse(await readFile(this.#filePath, "utf8"));
      if (
        document === null
        || Array.isArray(document)
        || typeof document !== "object"
        || document.schemaVersion !== SCHEMA_VERSION
        || !Array.isArray(document.tasks)
      ) return [];
      return document.tasks;
    } catch {
      return [];
    }
  }

  replace(tasks) {
    const document = `${JSON.stringify({ schemaVersion: SCHEMA_VERSION, tasks }, null, 2)}\n`;
    const temporaryPath = `${this.#filePath}.tmp`;
    this.#pending = this.#pending
      .catch(() => undefined)
      .then(async () => {
        await mkdir(dirname(this.#filePath), { recursive: true });
        await writeFile(temporaryPath, document, { encoding: "utf8", mode: 0o600 });
        await rename(temporaryPath, this.#filePath);
      });
  }

  async flush() {
    await this.#pending;
  }
}
