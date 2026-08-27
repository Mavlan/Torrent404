import type { DownloadStatus, DownloadTask } from "@torlink/protocol";
import { describe, expect, it } from "vitest";

import {
  canTransitionDownloadTask,
  createDownloadTask,
  InvalidDownloadTaskTransitionError,
  transitionDownloadTask,
} from "./DownloadTaskModel";

const HASH = "ABCDEF0123456789ABCDEF0123456789ABCDEF01";

function task(status: DownloadStatus): DownloadTask {
  return {
    ...createDownloadTask({
      id: "task-1",
      infoHash: HASH,
      name: "Legal fixture",
      savePath: "C:\\Downloads",
      total: 100,
    }),
    status,
    progress: 0.25,
    downloaded: 25,
    downloadSpeed: 10,
    uploadSpeed: 5,
    etaSeconds: 30,
    ...(status === "error" ? { error: "old error" } : {}),
  };
}

describe("DownloadTaskModel", () => {
  it("creates a normalized queued task with safe runtime defaults", () => {
    expect(createDownloadTask({
      id: " task-1 ",
      infoHash: HASH,
      name: " Legal fixture ",
      savePath: " C:\\Downloads ",
      total: 1_024,
    })).toEqual({
      id: "task-1",
      infoHash: HASH.toLowerCase(),
      name: "Legal fixture",
      status: "queued",
      progress: 0,
      downloadSpeed: 0,
      uploadSpeed: 0,
      downloaded: 0,
      total: 1_024,
      savePath: "C:\\Downloads",
    });
  });

  it("rejects invalid required fields and sizes", () => {
    expect(() => createDownloadTask({
      id: "",
      infoHash: HASH,
      name: "Legal fixture",
      savePath: "C:\\Downloads",
    })).toThrow("id must not be empty");
    expect(() => createDownloadTask({
      id: "task-1",
      infoHash: "not-a-hash",
      name: "Legal fixture",
      savePath: "C:\\Downloads",
    })).toThrow("infoHash must be a 40-character hexadecimal value");
    expect(() => createDownloadTask({
      id: "task-1",
      infoHash: HASH,
      name: "Legal fixture",
      savePath: "C:\\Downloads",
      total: -1,
    })).toThrow("total must be a non-negative safe integer");
  });

  it("exposes the complete legal status transition table", () => {
    const allowed: Record<DownloadStatus, DownloadStatus[]> = {
      queued: ["downloading", "paused", "error"],
      downloading: ["paused", "completed", "seeding", "error"],
      paused: ["queued", "downloading", "completed", "seeding", "error"],
      completed: ["seeding"],
      seeding: ["paused", "completed", "error"],
      error: ["queued"],
    };
    const statuses = Object.keys(allowed) as DownloadStatus[];

    for (const from of statuses) {
      for (const to of statuses) {
        expect(canTransitionDownloadTask(from, to), `${from} -> ${to}`)
          .toBe(allowed[from].includes(to));
      }
    }
  });

  it("rejects illegal and same-state transitions without mutating the task", () => {
    const original = task("queued");

    expect(() => transitionDownloadTask(original, { status: "completed" }))
      .toThrow(InvalidDownloadTaskTransitionError);
    expect(() => transitionDownloadTask(original, { status: "queued" }))
      .toThrow("queued -> queued");
    expect(original.status).toBe("queued");
  });

  it("requires an error message and clears it when retrying", () => {
    expect(() => transitionDownloadTask(task("downloading"), {
      status: "error",
      error: "  ",
    })).toThrow("error transition requires a message");

    const failed = transitionDownloadTask(task("downloading"), {
      status: "error",
      error: "  disk unavailable  ",
    });
    expect(failed).toMatchObject({
      status: "error",
      error: "disk unavailable",
      downloadSpeed: 0,
      uploadSpeed: 0,
    });

    const retried = transitionDownloadTask(failed, { status: "queued" });
    expect(retried.status).toBe("queued");
    expect(retried).not.toHaveProperty("error");
  });

  it("normalizes inactive and finished runtime fields", () => {
    const paused = transitionDownloadTask(task("downloading"), { status: "paused" });
    expect(paused).toMatchObject({
      status: "paused",
      progress: 0.25,
      downloaded: 25,
      downloadSpeed: 0,
      uploadSpeed: 0,
    });
    expect(paused).not.toHaveProperty("etaSeconds");

    const seeded = transitionDownloadTask(task("downloading"), { status: "seeding" });
    expect(seeded).toMatchObject({
      status: "seeding",
      progress: 1,
      downloaded: 100,
      total: 100,
      downloadSpeed: 0,
      uploadSpeed: 0,
    });
  });
});
