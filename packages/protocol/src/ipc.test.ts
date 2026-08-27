import { describe, expect, it } from "vitest";

import { IPC_COMMANDS, IPC_PROTOCOL_VERSION } from "./ipc";
import { searchCategories } from "./models";

describe("authenticated IPC protocol", () => {
  it("keeps search commands on protocol version 1", () => {
    expect(IPC_PROTOCOL_VERSION).toBe(1);
    expect(IPC_COMMANDS).toEqual([
      "ping",
      "health",
      "search.providers",
      "search.start",
      "search.poll",
      "search.cancel",
    ]);
  });

  it("defines the stable product search categories", () => {
    expect(searchCategories).toEqual([
      "all",
      "movies",
      "tv",
      "anime",
      "games",
      "software",
    ]);
  });
});
