import { describe, expect, it } from "vitest";

import { ProviderRegistry } from "./ProviderRegistry";
import { EztvProvider } from "./providers/EztvProvider";
import { KnabenProvider } from "./providers/KnabenProvider";
import { NyaaProvider } from "./providers/NyaaProvider";
import { TpbProvider } from "./providers/TpbProvider";
import { YtsProvider } from "./providers/YtsProvider";

describe("Torrent404 search coverage", () => {
  it("registers the frozen source set with the intended categories and defaults", () => {
    const registry = new ProviderRegistry([
      new YtsProvider(),
      new NyaaProvider(),
      new KnabenProvider(),
      new EztvProvider(),
      new TpbProvider(),
    ]);

    expect(registry.describe()).toEqual([
      { id: "yts", displayName: "YTS", categories: ["movies"], enabled: true },
      { id: "nyaa", displayName: "Nyaa", categories: ["anime"], enabled: true },
      {
        id: "knaben",
        displayName: "Knaben",
        categories: ["movies", "tv", "anime", "games", "software"],
        enabled: true,
      },
      { id: "eztv", displayName: "EZTV", categories: ["tv"], enabled: true },
      { id: "tpb", displayName: "TPB", categories: ["movies", "tv"], enabled: true },
    ]);
    expect(registry.listEnabled().map(({ id }) => id)).toEqual([
      "yts",
      "nyaa",
      "knaben",
      "eztv",
      "tpb",
    ]);
  });
});
