import { readFile } from "node:fs/promises";

import type { SearchResult } from "@torlink/protocol";
import { describe, expect, it } from "vitest";

import { ProviderRegistry } from "../ProviderRegistry";
import { SearchAggregator } from "../SearchAggregator";
import { NyaaProvider } from "./NyaaProvider";
import { YtsProvider } from "./YtsProvider";

async function fixture(name: string, extension: "json" | "xml"): Promise<string> {
  return readFile(
    new URL(`./__fixtures__/${name}.${extension}`, import.meta.url),
    "utf8",
  );
}

async function collect(results: AsyncIterable<SearchResult>): Promise<SearchResult[]> {
  const collected: SearchResult[] = [];
  for await (const result of results) collected.push(result);
  return collected;
}

describe("provider adapter integration", () => {
  it("streams YTS JSON and Nyaa RSS together through SearchAggregator", async () => {
    const ytsJson = await fixture("yts-normal", "json");
    const nyaaXml = await fixture("nyaa-normal", "xml");
    const registry = new ProviderRegistry([
      new YtsProvider({
        fetchImpl: async () => new Response(ytsJson, { status: 200 }),
      }),
      new NyaaProvider({
        fetchImpl: async () => new Response(nyaaXml, { status: 200 }),
      }),
    ]);

    const results = await collect(new SearchAggregator(registry).search("open"));

    expect(results).toHaveLength(2);
    expect(results.map(({ source }) => source).sort()).toEqual(["nyaa", "yts"]);
    expect(results.every(({ infoHash, magnet }) =>
      infoHash?.length === 40 && magnet?.startsWith("magnet:?xt=urn:btih:"),
    )).toBe(true);
  });
});
