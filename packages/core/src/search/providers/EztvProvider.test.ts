import { readFile } from "node:fs/promises";

import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it, vi } from "vitest";

import { ProviderRegistry } from "../ProviderRegistry";
import { SearchAggregator, type ProviderSearchFailure } from "../SearchAggregator";
import type { SearchProvider } from "../SearchProvider";
import { EztvProvider } from "./EztvProvider";

async function fixture(name: string): Promise<unknown> {
  return JSON.parse(await readFile(
    new URL(`./__fixtures__/${name}.json`, import.meta.url),
    "utf8",
  )) as unknown;
}

function fixtureFetch(payload: unknown) {
  return vi.fn(async (_input: string | URL, _init?: RequestInit) => new Response(JSON.stringify(payload), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  }));
}

async function collect(results: AsyncIterable<SearchResult>): Promise<SearchResult[]> {
  const collected: SearchResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("EztvProvider", () => {
  it("filters the structured latest-torrents response locally by title", async () => {
    const fetchImpl = fixtureFetch(await fixture("eztv-normal"));
    const provider = new EztvProvider({ fetchImpl });
    const results = await collect(provider.search(
      "foundation s03",
      new AbortController().signal,
    ));

    expect(results).toEqual([{
      id: "eztv:abcdef0123456789abcdef0123456789abcdef01",
      title: "Foundation S03E01 1080p WEB EZTV",
      source: "eztv",
      infoHash: "abcdef0123456789abcdef0123456789abcdef01",
      category: "tv",
      sizeBytes: 1_048_576,
      seeders: 42,
      leechers: 7,
      added: 1_780_000_000,
      magnet: "magnet:?xt=urn:btih:ABCDEF0123456789ABCDEF0123456789ABCDEF01&dn=Foundation",
    }]);
    const url = fetchImpl.mock.calls[0]?.[0] as URL;
    expect(url.searchParams.get("limit")).toBe("100");
    expect(url.searchParams.get("page")).toBe("1");
  });

  it("returns empty fixtures and skips malformed or non-matching rows", async () => {
    const empty = new EztvProvider({
      fetchImpl: fixtureFetch(await fixture("eztv-empty")),
    });
    await expect(collect(empty.search("none", new AbortController().signal)))
      .resolves.toEqual([]);

    const normal = new EztvProvider({
      fetchImpl: fixtureFetch(await fixture("eztv-normal")),
    });
    await expect(collect(normal.search("missing", new AbortController().signal)))
      .resolves.toEqual([]);
  });

  it("isolates an EZTV upstream failure from a healthy provider", async () => {
    const eztv = new EztvProvider({
      fetchImpl: vi.fn(async () => new Response("", { status: 503 })),
    });
    const healthy: SearchProvider = {
      id: "healthy",
      displayName: "Healthy",
      categories: ["tv"],
      async *search() {
        yield { id: "healthy:1", title: "Healthy", source: "healthy" };
      },
    };
    const failures: ProviderSearchFailure[] = [];
    const results = await collect(new SearchAggregator(
      new ProviderRegistry([eztv, healthy]),
    ).search("fixture", {
      providerIds: ["eztv", "healthy"],
      category: "tv",
      onProviderFailure: (failure) => failures.push(failure),
    }));

    expect(results.map(({ source }) => source)).toEqual(["healthy"]);
    expect(failures).toEqual([expect.objectContaining({ providerId: "eztv", code: "error" })]);
  });
});
