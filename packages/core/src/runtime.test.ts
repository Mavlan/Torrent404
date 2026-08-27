import { describe, expect, it } from "vitest";
import { createCoreRuntimeStatus } from "./runtime";

describe("Phase 1 core runtime seam", () => {
  it("has no network or torrent side effects", () => {
    expect(createCoreRuntimeStatus()).toEqual({
      protocolVersion: 1,
      state: "idle",
      networkListeners: 0,
      torrentEngine: "not-configured",
    });
  });
});

