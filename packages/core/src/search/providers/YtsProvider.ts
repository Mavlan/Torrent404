import type { SearchResult } from "@torlink/protocol";

import type { SearchProvider } from "../SearchProvider";

const YTS_ENDPOINTS = [
  "https://yts.mx/api/v2/list_movies.json",
  "https://yts.am/api/v2/list_movies.json",
  "https://yts.rs/api/v2/list_movies.json",
] as const;
const INFO_HASH = /^[a-f\d]{40}$/i;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface YtsProviderOptions {
  fetchImpl?: FetchImplementation;
  endpoints?: readonly string[];
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
    const added = nonNegativeNumber(movie.date_uploaded_unix);

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
        ...(added === undefined ? {} : { added }),
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
  readonly #endpoints: readonly string[];

  constructor({ fetchImpl = fetch, endpoints = YTS_ENDPOINTS }: YtsProviderOptions = {}) {
    this.#fetch = fetchImpl;
    this.#endpoints = [...endpoints];
  }

  async *search(query: string, signal: AbortSignal): AsyncIterable<SearchResult> {
    const normalizedQuery = query.trim();
    let lastError: unknown;
    for (const endpoint of this.#endpoints) {
      const url = new URL(endpoint);
      url.searchParams.set("limit", "50");
      if (normalizedQuery.length > 0) {
        url.searchParams.set("query_term", normalizedQuery);
      } else {
        url.searchParams.set("sort_by", "date_added");
      }

      try {
        const response = await this.#fetch(url, {
          headers: {
            Accept: "application/json",
            "User-Agent": "Torrent404/0.1.0",
          },
          signal,
        });
        if (!response.ok) {
          throw new Error(`YTS returned HTTP ${response.status}`);
        }
        const payload: unknown = await response.json();
        for (const result of parseResponse(payload)) yield result;
        return;
      } catch (error) {
        if (signal.aborted) throw signal.reason ?? error;
        lastError = error;
      }
    }
    throw lastError instanceof Error ? lastError : new Error("YTS is unreachable");
  }
}
