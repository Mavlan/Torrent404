import { describe, expect, it } from "vitest";

import { IPC_COMMANDS, IPC_PROTOCOL_VERSION } from "./ipc";

describe("authenticated IPC protocol", () => {
  it("keeps search commands on protocol version 1", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(1);
    expect(IPC_COMMANDS).toEqual([
      "ping",
      "health",
      "search.start",
      "search.poll",
      "search.cancel",
    ]);
  });
});
