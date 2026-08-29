import { readFile } from "node:fs/promises";

import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import { ProviderRegistry } from "../ProviderRegistry";
import { SearchAggregator, type ProviderSearchFailure } from "../SearchAggregator";
import type { SearchProvider } from "../SearchProvider";
import { KnabenProvider, KnabenProviderError } from "./KnabenProvider";

async function fixture(name: string): Promise<string> {
  return readFile(new URL(`./__fixtures__/${name}.json`, import.meta.url), "utf8");
}

function fixtureFetch(body: string) {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(body, {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

async function collect(results: AsyncIterable<SearchResult>): Promise<SearchResult[]> {
  const collected: SearchResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("KnabenProvider", () => {
  it("normalizes the documented JSON fields with one conservative request", async () => {
    const fetchImpl = fixtureFetch(await fixture("knaben-normal"));
    const provider = new KnabenProvider({ fetchImpl });

    const results = await collect(provider.search("  中文影视  ", new AbortController().signal));

    expect(results).toEqual([
      {
        id: "knaben:abcdef0123456789abcdef0123456789abcdef01",
        title: "中文电影测试",
        source: "knaben",
        infoHash: "abcdef0123456789abcdef0123456789abcdef01",
        category: "movies",
        sizeBytes: 1_048_576,
        seeders: 12,
        leechers: 3,
        magnet: "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=%E4%B8%AD%E6%96%87%E7%94%B5%E5%BD%B1%E6%B5%8B%E8%AF%95",
      },
      expect.objectContaining({
        source: "knaben",
        category: "tv",
        infoHash: "0123456789abcdef0123456789abcdef01234567",
        seeders: 21,
        leechers: 5,
      }),
    ]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [input, init] = fetchImpl.mock.calls[0]!;
    expect(input).toBe("https://api.knaben.org/v1");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({
      search_type: "100%",
      search_field: "title",
      query: "中文影视",
      order_by: "seeders",
      order_direction: "desc",
      categories: [2_000_000, 3_000_000, 4_000_000, 6_000_000],
      from: 0,
      size: 50,
      hide_unsafe: true,
      hide_xxx: true,
    });
  });

  it("returns an empty result and skips bad rows without losing valid mislabelled rows", async () => {
    const empty = new KnabenProvider({ fetchImpl: fixtureFetch(await fixture("knaben-empty")) });
    await expect(collect(empty.search("none", new AbortController().signal))).resolves.toEqual([]);

    const malformed = new KnabenProvider({
      fetchImpl: fixtureFetch(await fixture("knaben-malformed")),
    });
    const results = await collect(malformed.search("test", new AbortController().signal));
    expect(results).toHaveLength(2);
    expect(results.map(({ category }) => category)).toEqual(["anime", "other"]);
    expect(results[0]).toMatchObject({
      infoHash: "fedcba9876543210fedcba9876543210fedcba98",
      sizeBytes: 0,
      seeders: 0,
      leechers: 0,
    });
  });

  it.each([
    [403, "forbidden"],
    [429, "rate_limited"],
    [503, "server_error"],
  ] as const)("returns a structured error for HTTP %i", async (status, code) => {
    const provider = new KnabenProvider({
      fetchImpl: vi.fn(async () => new Response("", { status })),
    });
    await expect(collect(provider.search("test", new AbortController().signal)))
      .rejects.toMatchObject({ name: "KnabenProviderError", code, status });
  });

  it("structures malformed JSON and network failures", async () => {
    const malformed = new KnabenProvider({
      fetchImpl: vi.fn(async () => new Response("{", { status: 200 })),
    });
    await expect(collect(malformed.search("test", new AbortController().signal)))
      .rejects.toMatchObject({ code: "malformed_json" });

    const network = new KnabenProvider({
      fetchImpl: vi.fn(async () => { throw new TypeError("offline"); }),
    });
    await expect(collect(network.search("test", new AbortController().signal)))
      .rejects.toBeInstanceOf(KnabenProviderError);
    await expect(collect(network.search("test", new AbortController().signal)))
      .rejects.toMatchObject({ code: "network_error" });
  });

  it("is disabled by default but can be selected explicitly", async () => {
    const fetchImpl = fixtureFetch(await fixture("knaben-normal"));
    const provider = new KnabenProvider({ fetchImpl });
    const registry = new ProviderRegistry([provider]);
    const aggregator = new SearchAggregator(registry);

    expect(registry.describe()).toEqual([{
      id: "knaben",
      displayName: "Knaben",
      categories: ["movies", "tv", "anime", "games", "software"],
      enabled: false,
    }]);
    await expect(collect(aggregator.search("test"))).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(collect(aggregator.search("test", { providerIds: ["knaben"] })))
      .resolves.toHaveLength(2);
  });

  it("uses the official Knaben category IDs selected by the desktop category", async () => {
    const fetchImpl = fixtureFetch(await fixture("knaben-empty"));
    const provider = new KnabenProvider({ fetchImpl });

    await collect(provider.search("game", new AbortController().signal, "games"));
    await collect(provider.search("editor", new AbortController().signal, "software"));
    await collect(provider.search("anime", new AbortController().signal, "anime"));

    expect(JSON.parse(String(fetchImpl.mock.calls[0]?.[1]?.body)).categories).toEqual([4_001_000]);
    expect(JSON.parse(String(fetchImpl.mock.calls[1]?.[1]?.body)).categories).toEqual([
      4_002_000,
      4_003_000,
      4_004_000,
    ]);
    expect(JSON.parse(String(fetchImpl.mock.calls[2]?.[1]?.body)).categories).toEqual([6_000_000]);
  });

  it("obeys timeout/cancellation and remains isolated from healthy providers", async () => {
    const observedAbort = vi.fn();
    const hanging = new KnabenProvider({
      fetchImpl: vi.fn((_input, init) => new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          observedAbort();
          reject(init.signal?.reason);
        }, { once: true });
      })),
    });
    const failures: ProviderSearchFailure[] = [];
    await expect(collect(new SearchAggregator(
      new ProviderRegistry([hanging]),
      10,
    ).search("test", {
      providerIds: ["knaben"],
      onProviderFailure: (failure) => failures.push(failure),
    }))).resolves.toEqual([]);
    expect(observedAbort).toHaveBeenCalledOnce();
    expect(failures).toEqual([{ providerId: "knaben", code: "timeout" }]);

    const broken = new KnabenProvider({
      fetchImpl: vi.fn(async () => new Response("", { status: 503 })),
    });
    const healthy: SearchProvider = {
      id: "healthy",
      displayName: "Healthy",
      categories: ["movies"],
      async *search() {
        yield { id: "healthy:1", title: "Healthy", source: "healthy" };
      },
    };
    const isolatedFailures: ProviderSearchFailure[] = [];
    const isolatedResults = await collect(new SearchAggregator(
      new ProviderRegistry([broken, healthy]),
    ).search("test", {
      providerIds: ["knaben", "healthy"],
      onProviderFailure: (failure) => isolatedFailures.push(failure),
    }));
    expect(isolatedResults.map(({ source }) => source)).toEqual(["healthy"]);
    expect(isolatedFailures).toHaveLength(1);

    const controller = new AbortController();
    const cancellation = collect(new SearchAggregator(
      new ProviderRegistry([hanging]),
    ).search("test", { providerIds: ["knaben"], signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    await expect(cancellation).resolves.toEqual([]);
  });
});
