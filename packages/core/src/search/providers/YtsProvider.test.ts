import { readFile } from "node:fs/promises";

import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import { ProviderRegistry } from "../ProviderRegistry";
import { SearchAggregator } from "../SearchAggregator";
import { YtsProvider } from "./YtsProvider";

async function fixture(name: string): Promise<unknown> {
  const contents = await readFile(
    new URL(`./__fixtures__/${name}.json`, import.meta.url),
    "utf8",
  );
  return JSON.parse(contents) as unknown;
}

function fixtureFetch(payload: unknown) {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(payload), {
      headers: { "Content-Type": "application/json" },
      status: 200,
    }));
}

async function collect(results: AsyncIterable<SearchResult>): Promise<SearchResult[]> {
  const collected: SearchResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("YtsProvider", () => {
  it("normalizes a local fixture through registry and aggregator", async () => {
    const fetchImpl = fixtureFetch(await fixture("yts-normal"));
    const provider = new YtsProvider({ fetchImpl });
    const aggregator = new SearchAggregator(new ProviderRegistry([provider]));

    const results = await collect(aggregator.search("  public domain  "));

    expect(results).toEqual([{
      id: "yts:abcdef0123456789abcdef0123456789abcdef01",
      title: "Public Domain Test Film (2026) [1080p web]",
      source: "yts",
      infoHash: "abcdef0123456789abcdef0123456789abcdef01",
      category: "movies",
      sizeBytes: 1_048_576,
      seeders: 12,
      leechers: 3,
      magnet: "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Public%20Domain%20Test%20Film%20(2026)%20%5B1080p%20web%5D",
    }]);
    const requestedUrl = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.searchParams.get("query_term")).toBe("public domain");
    expect(requestedUrl.searchParams.get("limit")).toBe("50");
  });

  it("returns no results for the local empty fixture", async () => {
    const provider = new YtsProvider({
      fetchImpl: fixtureFetch(await fixture("yts-empty")),
    });

    await expect(collect(provider.search("nothing", new AbortController().signal)))
      .resolves.toEqual([]);
  });

  it("skips malformed rows and safely defaults missing optional fields", async () => {
    const provider = new YtsProvider({
      fetchImpl: fixtureFetch(await fixture("yts-malformed")),
    });

    const results = await collect(provider.search("test", new AbortController().signal));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "yts:fedcba9876543210fedcba9876543210fedcba98",
      title: "Unknown title",
      infoHash: "fedcba9876543210fedcba9876543210fedcba98",
      sizeBytes: 0,
      seeders: 0,
      leechers: 0,
    });
  });
});
