import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it } from "vitest";

import { ProviderRegistry } from "./ProviderRegistry";
import type { SearchProvider } from "./SearchProvider";

function provider(id: string, results: SearchResult[] = []): SearchProvider {
  return {
    id,
    displayName: id.toUpperCase(),
    categories: ["general"],
    async *search(_query, signal) {
      for (const result of results) {
        if (signal.aborted) return;
        yield result;
      }
    },
  };
}

describe("ProviderRegistry", () => {
  it("preserves registration order and exposes immutable metadata copies", () => {
    const registry = new ProviderRegistry([provider("alpha"), provider("beta")]);

    expect(registry.list().map(({ id }) => id)).toEqual(["alpha", "beta"]);
    expect(registry.get("beta")?.displayName).toBe("BETA");
    expect(registry.has("missing")).toBe(false);

    const descriptors = registry.describe();
    expect(descriptors).toEqual([
      { id: "alpha", displayName: "ALPHA", categories: ["general"], enabled: true },
      { id: "beta", displayName: "BETA", categories: ["general"], enabled: true },
    ]);
    (descriptors[0]!.categories as string[]).push("changed");
    expect(registry.describe()[0]!.categories).toEqual(["general"]);
  });

  it("keeps disabled providers discoverable but excludes them from enabled searches", () => {
    const registry = new ProviderRegistry([
      provider("enabled"),
      { ...provider("disabled"), displayName: "中文来源", enabled: false },
    ]);

    expect(registry.list().map(({ id }) => id)).toEqual(["enabled", "disabled"]);
    expect(registry.listEnabled().map(({ id }) => id)).toEqual(["enabled"]);
    expect(registry.describe()[1]).toEqual({
      id: "disabled",
      displayName: "中文来源",
      categories: ["general"],
      enabled: false,
    });
  });

  it("separates an overridable default preference from static availability", () => {
    const registry = new ProviderRegistry([
      { ...provider("beta"), defaultEnabled: false },
      { ...provider("unavailable"), enabled: false },
    ]);

    expect(registry.listEnabled()).toEqual([]);
    expect(registry.describe().map(({ id, enabled }) => ({ id, enabled }))).toEqual([
      { id: "beta", enabled: false },
      { id: "unavailable", enabled: false },
    ]);
  });

  it("rejects duplicate or invalid provider metadata", () => {
    expect(() => new ProviderRegistry([provider("same"), provider("same")]))
      .toThrow("Duplicate provider id: same");
    expect(() => new ProviderRegistry([provider("Not Canonical")]))
      .toThrow("Invalid provider id: Not Canonical");
    expect(() => new ProviderRegistry([{ ...provider("blank"), displayName: " " }]))
      .toThrow("Provider blank has an empty display name");
  });

  it("keeps search incremental and cancellation-aware at the provider boundary", async () => {
    const first: SearchResult = { id: "1", title: "One", source: "alpha" };
    const second: SearchResult = { id: "2", title: "Two", source: "alpha" };
    const registry = new ProviderRegistry([provider("alpha", [first, second])]);
    const controller = new AbortController();
    const received: SearchResult[] = [];

    for await (const result of registry.get("alpha")!.search("linux", controller.signal)) {
      received.push(result);
      controller.abort();
    }

    expect(received).toEqual([first]);
  });
});
