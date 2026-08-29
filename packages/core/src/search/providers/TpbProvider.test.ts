import { readFile } from "node:fs/promises";

import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import { ProviderRegistry } from "../ProviderRegistry";
import { SearchAggregator } from "../SearchAggregator";
import { TpbProvider } from "./TpbProvider";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(
    new URL(`./__fixtures__/${name}.json`, import.meta.url),
    "utf8",
  )) as unknown;
}

function fixtureFetch(payload: unknown) {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) => (
    new Response(JSON.stringify(payload), { status: 200 })
  ));
}

async function collect(results: AsyncIterable<SearchResult>): Promise<SearchResult[]> {
  const collected: SearchResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("TpbProvider", () => {
  it("normalizes apibay rows and filters Movies and TV by category ID", async () => {
    const payload = await fixture("tpb-normal");
    const provider = new TpbProvider({ fetchImpl: fixtureFetch(payload) });

    const movies = await collect(provider.search(
      "public domain",
      new AbortController().signal,
      "movies",
    ));
    const tv = await collect(provider.search(
      "public domain",
      new AbortController().signal,
      "tv",
    ));

    expect(movies).toEqual([expect.objectContaining({
      id: "tpb:abcdef0123456789abcdef0123456789abcdef01",
      source: "tpb",
      category: "movies",
      seeders: 12,
      leechers: 3,
      added: 1_780_000_000,
    })]);
    expect(tv).toEqual([expect.objectContaining({
      id: "tpb:0123456789abcdef0123456789abcdef01234567",
      category: "tv",
    })]);
    expect(movies[0]?.magnet).toContain("urn:btih:abcdef0123456789abcdef0123456789abcdef01");
  });

  it("handles apibay's empty sentinel and retries only its alternate URL form", async () => {
    const sentinel = [{
      id: "0",
      name: "No results returned",
      info_hash: "0000000000000000000000000000000000000000",
    }];
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(sentinel), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(sentinel), { status: 200 }));
    const provider = new TpbProvider({ fetchImpl });

    await expect(collect(provider.search("none", new AbortController().signal, "movies")))
      .resolves.toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect((fetchImpl.mock.calls[0]?.[0] as URL).searchParams.get("cat")).toBe("200");
    expect((fetchImpl.mock.calls[1]?.[0] as URL).searchParams.get("cat")).toBe("0");
  });

  it("is discoverable but disabled until the user explicitly enables TPB", async () => {
    const fetchImpl = fixtureFetch(await fixture("tpb-normal"));
    const provider = new TpbProvider({ fetchImpl });
    const registry = new ProviderRegistry([provider]);
    const aggregator = new SearchAggregator(registry);

    expect(registry.describe()).toEqual([{
      id: "tpb",
      displayName: "TPB",
      categories: ["movies", "tv"],
      enabled: false,
    }]);
    await expect(collect(aggregator.search("test"))).resolves.toEqual([]);
    expect(fetchImpl).not.toHaveBeenCalled();
    await expect(collect(aggregator.search("test", {
      providerIds: ["tpb"],
      category: "movies",
    }))).resolves.toHaveLength(1);
  });
});
