import type { SearchResult } from "@torlink/protocol";

import type { SearchProvider } from "../SearchProvider";

const YTS_ENDPOINT = "https://yts.mx/api/v2/list_movies.json";
const INFO_HASH = /^[a-f\d]{40}$/i;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface YtsProviderOptions {
  fetchImpl?: FetchImplementation;
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

function nonNegativeNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : undefined;
}

function buildMagnet(infoHash: string, title: string): string {
  return `magnet:?xt=urn:btih:${infoHash}&dn=${encodeURIComponent(title)}`;
}

function parseResponse(payload: unknown): SearchResult[] {
  const movies = record(record(payload)?.data)?.movies;
  if (!Array.isArray(movies)) return [];

  const results: SearchResult[] = [];
  for (const movieValue of movies) {
    const movie = record(movieValue);
    if (!movie || !Array.isArray(movie.torrents)) continue;

    const baseTitle = nonEmptyString(movie.title_long)
      ?? nonEmptyString(movie.title)
      ?? "Unknown title";

    for (const torrentValue of movie.torrents) {
      const torrent = record(torrentValue);
      const rawHash = nonEmptyString(torrent?.hash);
      if (!torrent || !rawHash || !INFO_HASH.test(rawHash)) continue;

      const infoHash = rawHash.toLowerCase();
      const tags = [
        nonEmptyString(torrent.quality),
        nonEmptyString(torrent.type),
      ].filter((tag): tag is string => tag !== undefined);
      const title = tags.length > 0
        ? `${baseTitle} [${tags.join(" ")}]`
        : baseTitle;

      results.push({
        id: `yts:${infoHash}`,
        title,
        source: "yts",
        infoHash,
        category: "movies",
        sizeBytes: nonNegativeNumber(torrent.size_bytes) ?? 0,
        seeders: nonNegativeNumber(torrent.seeds) ?? 0,
        leechers: nonNegativeNumber(torrent.peers) ?? 0,
        magnet: buildMagnet(infoHash, title),
      });
    }
  }

  return results;
}

export class YtsProvider implements SearchProvider {
  readonly id = "yts";
  readonly displayName = "YTS";
  readonly categories = ["movies"] as const;

  readonly #fetch: FetchImplementation;

  constructor({ fetchImpl = fetch }: YtsProviderOptions = {}) {
    this.#fetch = fetchImpl;
  }

  async *search(query: string, signal: AbortSignal): AsyncIterable<SearchResult> {
    const url = new URL(YTS_ENDPOINT);
    const normalizedQuery = query.trim();
    url.searchParams.set("limit", "50");
    if (normalizedQuery.length > 0) {
      url.searchParams.set("query_term", normalizedQuery);
    } else {
      url.searchParams.set("sort_by", "date_added");
    }

    const response = await this.#fetch(url, {
      headers: {
        Accept: "application/json",
        "User-Agent": "TorLink-Desktop/0.1.0",
      },
      signal,
    });
    if (!response.ok) {
      throw new Error(`YTS returned HTTP ${response.status}`);
    }

    const payload: unknown = await response.json();
    for (const result of parseResponse(payload)) yield result;
  }
}
