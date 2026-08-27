import { readFile } from "node:fs/promises";

import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import { ProviderRegistry } from "../ProviderRegistry";
import { SearchAggregator } from "../SearchAggregator";
import { NyaaProvider } from "./NyaaProvider";

async function fixture(name: string): Promise<string> {
  return readFile(
    new URL(`./__fixtures__/${name}.xml`, import.meta.url),
    "utf8",
  );
}

function fixtureFetch(xml: string) {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) =>
    new Response(xml, {
      headers: { "Content-Type": "application/rss+xml" },
      status: 200,
    }));
}

async function collect(results: AsyncIterable<SearchResult>): Promise<SearchResult[]> {
  const collected: SearchResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("NyaaProvider", () => {
  it("parses and normalizes local RSS through registry and aggregator", async () => {
    const fetchImpl = fixtureFetch(await fixture("nyaa-normal"));
    const provider = new NyaaProvider({ fetchImpl });
    const aggregator = new SearchAggregator(new ProviderRegistry([provider]));

    const results = await collect(aggregator.search("  open animation  "));

    expect(results).toEqual([{
      id: "nyaa:abcdef0123456789abcdef0123456789abcdef01",
      title: "Open Animation & Test [1080p]",
      source: "nyaa",
      infoHash: "abcdef0123456789abcdef0123456789abcdef01",
      category: "anime",
      sizeBytes: 1_610_612_736,
      seeders: 42,
      leechers: 7,
      magnet: "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01&dn=Open%20Animation%20%26%20Test%20%5B1080p%5D",
    }]);
    const requestedUrl = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(requestedUrl.searchParams.get("page")).toBe("rss");
    expect(requestedUrl.searchParams.get("q")).toBe("open animation");
  });

  it("returns no results for the local empty RSS fixture", async () => {
    const provider = new NyaaProvider({
      fetchImpl: fixtureFetch(await fixture("nyaa-empty")),
    });

    await expect(collect(provider.search("nothing", new AbortController().signal)))
      .resolves.toEqual([]);
  });

  it("skips invalid required fields and defaults malformed optional fields", async () => {
    const provider = new NyaaProvider({
      fetchImpl: fixtureFetch(await fixture("nyaa-malformed")),
    });

    const results = await collect(provider.search("test", new AbortController().signal));

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      id: "nyaa:fedcba9876543210fedcba9876543210fedcba98",
      title: "Valid fallback & fields",
      infoHash: "fedcba9876543210fedcba9876543210fedcba98",
      sizeBytes: 0,
      seeders: 0,
      leechers: 0,
    });
  });
});
