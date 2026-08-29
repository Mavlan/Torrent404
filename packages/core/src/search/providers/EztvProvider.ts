import type { SearchResult } from "@torlink/protocol";

import type { SearchProvider } from "../SearchProvider";

const EZTV_ENDPOINT = "https://eztvx.to/api/get-torrents";
const INFO_HASH = /^[a-f\d]{40}$/i;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface EztvProviderOptions {
  fetchImpl?: FetchImplementation;
  endpoint?: string;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function nonNegativeNumber(value: unknown): number {
  const numeric = typeof value === "string" ? Number(value) : value;
  return typeof numeric === "number" && Number.isFinite(numeric) && numeric >= 0
    ? numeric
    : 0;
}

function buildMagnet(infoHash: string, title: string): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`;
}

function normalizedMagnet(value: unknown, infoHash: string): string | undefined {
  const magnet = nonEmptyString(value);
  if (!magnet) return undefined;
  try {
    const url = new URL(magnet);
    if (url.protocol !== "magnet:") return undefined;
    return url.searchParams.getAll("xt").some((topic) => (
      topic.replace(/^urn:btih:/i, "").toLowerCase() === infoHash
    )) ? magnet : undefined;
  } catch {
    return undefined;
  }
}

function matchesQuery(title: string, query: string): boolean {
  const normalizedTitle = title.toLocaleLowerCase().replace(/[._-]+/g, " ");
  return query.toLocaleLowerCase().split(/\s+/u).filter(Boolean)
    .every((term) => normalizedTitle.includes(term));
}

function parseResponse(payload: unknown, query: string): SearchResult[] {
  const torrents = record(payload)?.torrents;
  if (!Array.isArray(torrents)) return [];

  const results: SearchResult[] = [];
  for (const value of torrents) {
    const torrent = record(value);
    const rawHash = nonEmptyString(torrent?.hash);
    const title = nonEmptyString(torrent?.title) ?? nonEmptyString(torrent?.filename);
    if (!torrent || !rawHash || !INFO_HASH.test(rawHash) || !title) continue;
    if (query.length > 0 && !matchesQuery(title, query)) continue;

    const infoHash = rawHash.toLowerCase();
    const magnet = normalizedMagnet(torrent.magnet_url, infoHash)
      ?? buildMagnet(infoHash, title);
    const added = nonNegativeNumber(torrent.date_released_unix);
    results.push({
      id: `eztv:${infoHash}`,
      title,
      source: "eztv",
      infoHash,
      category: "tv",
      sizeBytes: nonNegativeNumber(torrent.size_bytes),
      seeders: nonNegativeNumber(torrent.seeds),
      leechers: nonNegativeNumber(torrent.peers),
      ...(added > 0 ? { added } : {}),
      magnet,
    });
  }
  return results;
}

export class EztvProvider implements SearchProvider {
  readonly id = "eztv";
  readonly displayName = "EZTV";
  readonly categories = ["tv"] as const;

  readonly #fetch: FetchImplementation;
  readonly #endpoint: string;

  constructor({ fetchImpl = fetch, endpoint = EZTV_ENDPOINT }: EztvProviderOptions = {}) {
    this.#fetch = fetchImpl;
    this.#endpoint = endpoint;
  }

  async *search(query: string, signal: AbortSignal): AsyncIterable<SearchResult> {
    const normalizedQuery = query.trim();
    const url = new URL(this.#endpoint);
    url.searchParams.set("limit", "100");
    url.searchParams.set("page", "1");
    const response = await this.#fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Torrent404/0.1.0" },
      signal,
    });
    if (!response.ok) throw new Error(`EZTV returned HTTP ${response.status}`);
    const payload: unknown = await response.json();
    for (const result of parseResponse(payload, normalizedQuery)) yield result;
  }
}
