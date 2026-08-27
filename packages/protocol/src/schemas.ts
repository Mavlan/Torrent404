import { z } from "zod";
import { downloadStatuses, searchCategories, themes } from "./models";
import { PROTOCOL_VERSION } from "./messages";

const nonEmpty = z.string().trim().min(1);

export const searchResultSchema = z
  .object({
    id: nonEmpty,
    title: nonEmpty,
    source: nonEmpty,
    category: nonEmpty.optional(),
    sizeBytes: z.number().nonnegative().optional(),
    seeders: z.number().int().nonnegative().optional(),
    leechers: z.number().int().nonnegative().optional(),
    magnet: nonEmpty.optional(),
    torrentUrl: z.url().optional(),
  })
  .refine((value) => value.magnet !== undefined || value.torrentUrl !== undefined, {
    message: "A search result must include a magnet or torrent URL",
  });

export const downloadTaskSchema = z.object({
  id: nonEmpty,
  infoHash: z.string().regex(/^[a-f0-9]{40}$/i),
  name: nonEmpty,
  status: z.enum(downloadStatuses),
  progress: z.number().min(0).max(1),
  downloadSpeed: z.number().nonnegative(),
  uploadSpeed: z.number().nonnegative(),
  downloaded: z.number().nonnegative(),
  total: z.number().nonnegative(),
  etaSeconds: z.number().nonnegative().optional(),
  savePath: nonEmpty,
  error: nonEmpty.optional(),
});

export const settingsSchema = z.object({
  schemaVersion: z.number().int().positive(),
  downloadDir: nonEmpty,
  language: z.enum(["zh-CN", "en-US"]),
  theme: z.enum(themes),
  providerEnabled: z.record(z.string(), z.boolean()),
});

export const sourceStatusSchema = z.object({
  source: nonEmpty,
  displayName: nonEmpty,
  state: z.enum(["idle", "searching", "complete", "error"]),
  resultCount: z.number().int().nonnegative(),
  errorCode: nonEmpty.optional(),
  detail: nonEmpty.optional(),
});

const requestId = nonEmpty.max(128);
const taskId = nonEmpty.max(256);

export const coreCommandSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("search"),
    requestId,
    query: z.string().trim().max(500),
    category: z.enum(searchCategories).optional(),
  }),
  z.object({ type: z.literal("addMagnet"), requestId, magnet: nonEmpty.max(16_384), savePath: nonEmpty.optional() }),
  z.object({ type: z.literal("addTorrentFile"), requestId, path: nonEmpty, savePath: nonEmpty.optional() }),
  z.object({ type: z.literal("pauseTask"), requestId, id: taskId }),
  z.object({ type: z.literal("resumeTask"), requestId, id: taskId }),
  z.object({ type: z.literal("removeTask"), requestId, id: taskId, deleteFiles: z.boolean().optional() }),
  z.object({ type: z.literal("stopSeeding"), requestId, id: taskId }),
  z.object({ type: z.literal("setDefaultDownloadDir"), requestId, path: nonEmpty }),
  z.object({ type: z.literal("getSettings"), requestId }),
  z.object({ type: z.literal("listTasks"), requestId }),
]);

export const protocolEnvelopeSchema = <T extends z.ZodType>(payload: T) =>
  z.object({
    version: z.literal(PROTOCOL_VERSION),
    payload,
  });
