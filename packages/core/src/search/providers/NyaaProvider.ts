import type { SearchResult } from "@torlink/protocol";

import type { SearchProvider } from "../SearchProvider";

const NYAA_ENDPOINT = "https://nyaa.si/";
const INFO_HASH = /^[a-f\d]{40}$/i;
const SIZE_UNITS: Readonly<Record<string, number>> = {
  B: 1,
  KB: 1_000,
  KIB: 1_024,
  MB: 1_000_000,
  MIB: 1_024 ** 2,
  GB: 1_000_000_000,
  GIB: 1_024 ** 3,
  TB: 1_000_000_000_000,
  TIB: 1_024 ** 4,
};

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface NyaaProviderOptions {
  fetchImpl?: FetchImplementation;
}

function decodeXmlText(value: string): string {
  return value
    .replace(/&(?:#39|apos);/gi, "'")
    .replace(/&(?:#34|quot);/gi, '"')
    .replace(/&(?:#60|lt);/gi, "<")
    .replace(/&(?:#62|gt);/gi, ">")
    .replace(/&(?:#38|amp);/gi, "&");
}

function tag(item: string, name: string): string {
  const match = item.match(new RegExp(
    `<${name}(?:\\s[^>]*)?>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([\\s\\S]*?))\\s*</${name}>`,
    "i",
  ));
  return (match?.[1] ?? match?.[2] ?? "").trim();
}

function parseCount(value: string): number {
  if (!/^\d+$/.test(value)) return 0;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 0;
}

function parseSize(value: string): number {
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*([kmgt]?i?b)$/i);
  if (!match) return 0;
  const amount = Number(match[1]);
  const multiplier = SIZE_UNITS[match[2]!.toUpperCase()];
  const bytes = amount * (multiplier ?? 0);
  return Number.isSafeInteger(Math.round(bytes)) && bytes >= 0
    ? Math.round(bytes)
    : 0;
}

function buildMagnet(infoHash: string, title: string): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`;
}

function parseRss(xml: string): SearchResult[] {
  const results: SearchResult[] = [];
  const items = xml.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/gi);

  for (const match of items) {
    const item = match[1]!;
    const rawInfoHash = tag(item, "nyaa:infoHash");
    const title = decodeXmlText(tag(item, "title"));
    if (!INFO_HASH.test(rawInfoHash) || title.length === 0) continue;

    const infoHash = rawInfoHash.toLowerCase();
    results.push({
      id: `nyaa:${infoHash}`,
      title,
      source: "nyaa",
      infoHash,
      category: "anime",
      sizeBytes: parseSize(tag(item, "nyaa:size")),
      seeders: parseCount(tag(item, "nyaa:seeders")),
      leechers: parseCount(tag(item, "nyaa:leechers")),
      magnet: buildMagnet(infoHash, title),
    });
  }

  return results;
}

export class NyaaProvider implements SearchProvider {
  readonly id = "nyaa";
  readonly displayName = "Nyaa";
  readonly categories = ["anime"] as const;

  readonly #fetch: FetchImplementation;

  constructor({ fetchImpl = fetch }: NyaaProviderOptions = {}) {
    this.#fetch = fetchImpl;
  }

  async *search(query: string, signal: AbortSignal): AsyncIterable<SearchResult> {
    const url = new URL(NYAA_ENDPOINT);
    url.searchParams.set("page", "rss");
    url.searchParams.set("q", query.trim());
    url.searchParams.set("c", "0_0");
    url.searchParams.set("f", "0");

    const response = await this.#fetch(url, {
      headers: {
        Accept: "application/rss+xml, application/xml;q=0.9",
        "User-Agent": "TorLink-Desktop/0.1.0",
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`Nyaa returned HTTP ${response.status}`);
    }

    const xml = await response.text();
    for (const result of parseRss(xml)) yield result;
  }
}
