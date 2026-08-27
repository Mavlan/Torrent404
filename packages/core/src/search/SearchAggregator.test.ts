import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import { ProviderRegistry } from "./ProviderRegistry";
import { SearchAggregator, type ProviderSearchFailure } from "./SearchAggregator";
import type { SearchProvider } from "./SearchProvider";

function provider(
  id: string,
  search: SearchProvider["search"],
): SearchProvider {
  return { id, displayName: id, categories: ["general"], search };
}

async function collect(
  results: AsyncIterable<SearchResult>,
): Promise<SearchResult[]> {
  const collected: SearchResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("SearchAggregator", () => {
  it("consumes providers concurrently and deduplicates by normalized infohash", async () => {
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((resolve) => {
      releaseSlow = resolve;
    });
    const hash = "0123456789abcdef0123456789abcdef01234567";
    const slow = provider("slow", async function* () {
      await slowGate;
      yield { id: "slow", title: "duplicate", source: "slow", infoHash: hash };
    });
    const fast = provider("fast", async function* () {
      yield {
        id: "fast",
        title: "first",
        source: "fast",
        magnet: `magnet:?xt=urn:btih:${hash.toUpperCase()}`,
      };
    });
    const iterator = new SearchAggregator(
      new ProviderRegistry([slow, fast]),
    ).search("linux")[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { id: "fast" },
    });
    releaseSlow();
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("isolates provider errors while preserving healthy results", async () => {
    const failure = new Error("provider unavailable");
    const broken = provider("broken", async function* () {
      throw failure;
    });
    const healthy = provider("healthy", async function* () {
      yield { id: "ok", title: "Linux", source: "healthy" };
    });
    const failures: ProviderSearchFailure[] = [];

    const results = await collect(new SearchAggregator(
      new ProviderRegistry([broken, healthy]),
    ).search("linux", { onProviderFailure: (event) => failures.push(event) }));

    expect(results.map(({ id }) => id)).toEqual(["ok"]);
    expect(failures).toEqual([{ providerId: "broken", code: "error", error: failure }]);
  });

  it("drains results already queued when providers finish", async () => {
    const fast = provider("fast", async function* () {
      yield { id: "one", title: "One", source: "fast" };
      yield { id: "two", title: "Two", source: "fast" };
      yield { id: "three", title: "Three", source: "fast" };
    });

    const results = await collect(new SearchAggregator(
      new ProviderRegistry([fast]),
    ).search("linux"));

    expect(results.map(({ id }) => id)).toEqual(["one", "two", "three"]);
  });

  it("times out one provider without blocking the others", async () => {
    const failures: ProviderSearchFailure[] = [];
    const observedAbort = vi.fn();
    const hanging = provider("hanging", async function* (_query, signal) {
      signal.addEventListener("abort", observedAbort, { once: true });
      await new Promise(() => undefined);
    });
    const healthy = provider("healthy", async function* () {
      yield { id: "ok", title: "Linux", source: "healthy" };
    });

    const results = await collect(new SearchAggregator(
      new ProviderRegistry([hanging, healthy]),
      20,
    ).search("linux", { onProviderFailure: (event) => failures.push(event) }));

    expect(results.map(({ id }) => id)).toEqual(["ok"]);
    expect(observedAbort).toHaveBeenCalledOnce();
    expect(failures).toEqual([{ providerId: "hanging", code: "timeout" }]);
  });

  it("propagates caller cancellation to every active provider", async () => {
    const aborts: string[] = [];
    const hangingProvider = (id: string) => provider(id, async function* (_query, signal) {
      signal.addEventListener("abort", () => aborts.push(id), { once: true });
      await new Promise(() => undefined);
    });
    const controller = new AbortController();
    const search = new SearchAggregator(new ProviderRegistry([
      hangingProvider("one"),
      hangingProvider("two"),
    ])).search("linux", { signal: controller.signal });
    const completion = collect(search);

    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();

    await expect(completion).resolves.toEqual([]);
    expect(aborts.sort()).toEqual(["one", "two"]);
  });
});
