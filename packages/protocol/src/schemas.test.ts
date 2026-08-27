import { describe, expect, it } from "vitest";
import {
  coreCommandSchema,
  downloadTaskSchema,
  protocolEnvelopeSchema,
  searchResultSchema,
  settingsSchema,
} from "./schemas";

describe("protocol schemas", () => {
  it("accepts a versioned search command", () => {
    const schema = protocolEnvelopeSchema(coreCommandSchema);
    expect(
      schema.parse({ version: 1, payload: { type: "search", requestId: "req-1", query: "Ubuntu" } }),
    ).toEqual({ version: 1, payload: { type: "search", requestId: "req-1", query: "Ubuntu" } });
  });

  it("rejects incompatible protocol versions", () => {
    const schema = protocolEnvelopeSchema(coreCommandSchema);
    expect(() => schema.parse({ version: 2, payload: { type: "listTasks", requestId: "req-2" } })).toThrow();
  });

  it("accepts both supported interface locales", () => {
    const base = {
      schemaVersion: 1,
      downloadDir: "C:\\Downloads",
      theme: "system",
      providerEnabled: {},
    };
    expect(settingsSchema.parse({ ...base, language: "zh-CN" }).language).toBe("zh-CN");
    expect(settingsSchema.parse({ ...base, language: "en-US" }).language).toBe("en-US");
    expect(() => settingsSchema.parse({ ...base, language: "fr-FR" })).toThrow();
  });

  it("requires a downloadable locator on search results", () => {
    expect(() => searchResultSchema.parse({ id: "x", title: "Example", source: "test" })).toThrow();
  });

  it("keeps task progress inside the public 0..1 range", () => {
    expect(() =>
      downloadTaskSchema.parse({
        id: "task-1",
        infoHash: "a".repeat(40),
        name: "Example",
        status: "downloading",
        progress: 1.1,
        downloadSpeed: 0,
        uploadSpeed: 0,
        downloaded: 0,
        total: 0,
        savePath: "C:\\Downloads",
      }),
    ).toThrow();
  });
});
