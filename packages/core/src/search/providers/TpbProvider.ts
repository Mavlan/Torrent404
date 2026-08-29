import type { SearchResult } from "@torlink/protocol";

import type { SearchProvider } from "../SearchProvider";

const APIBAY_ENDPOINT = "https://apibay.org/q.php";
const INFO_HASH = /^[a-f\d]{40}$/i;
const ZERO_HASH = "0000000000000000000000000000000000000000";
const MOVIE_CATEGORIES = new Set([201, 202, 207, 209]);
const TV_CATEGORIES = new Set([205, 208]);

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface TpbProviderOptions {
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

function categoriesFor(category: string | undefined): ReadonlySet<number> {
  if (category === "movies") return MOVIE_CATEGORIES;
  if (category === "tv") return TV_CATEGORIES;
  return new Set([...MOVIE_CATEGORIES, ...TV_CATEGORIES]);
}

function isSentinel(payload: unknown): boolean {
  if (!Array.isArray(payload) || payload.length !== 1) return false;
  return record(payload[0])?.id === "0";
}

function parseResponse(payload: unknown, category: string | undefined): SearchResult[] {
  if (!Array.isArray(payload)) return [];
  const allowedCategories = categoriesFor(category);
  const results: SearchResult[] = [];
  for (const value of payload) {
    const item = record(value);
    const rawHash = nonEmptyString(item?.info_hash);
    const title = nonEmptyString(item?.name);
    const remoteCategory = nonNegativeNumber(item?.category);
    if (
      !item
      || item.id === "0"
      || !rawHash
      || rawHash.toLowerCase() === ZERO_HASH
      || !INFO_HASH.test(rawHash)
      || !title
      || !allowedCategories.has(remoteCategory)
    ) continue;

    const infoHash = rawHash.toLowerCase();
    const added = nonNegativeNumber(item.added);
    results.push({
      id: `tpb:${infoHash}`,
      title,
      source: "tpb",
      infoHash,
      category: MOVIE_CATEGORIES.has(remoteCategory) ? "movies" : "tv",
      sizeBytes: nonNegativeNumber(item.size),
      seeders: nonNegativeNumber(item.seeders),
      leechers: nonNegativeNumber(item.leechers),
      ...(added > 0 ? { added } : {}),
      magnet: buildMagnet(infoHash, title),
    });
  }
  return results;
}

export class TpbProvider implements SearchProvider {
  readonly id = "tpb";
  readonly displayName = "TPB";
  readonly categories = ["movies", "tv"] as const;
  readonly defaultEnabled = true;

  readonly #fetch: FetchImplementation;
  readonly #endpoint: string;

  constructor({ fetchImpl = fetch, endpoint = APIBAY_ENDPOINT }: TpbProviderOptions = {}) {
    this.#fetch = fetchImpl;
    this.#endpoint = endpoint;
  }

  async #fetchItems(query: string, signal: AbortSignal, categoryId: string): Promise<unknown> {
    const url = new URL(this.#endpoint);
    url.searchParams.set("q", query);
    url.searchParams.set("cat", categoryId);
    const response = await this.#fetch(url, {
      headers: { Accept: "application/json", "User-Agent": "Torrent404/0.1.0" },
      signal,
    });
    if (!response.ok) throw new Error(`TPB returned HTTP ${response.status}`);
    return response.json();
  }

  async *search(
    query: string,
    signal: AbortSignal,
    category?: string,
  ): AsyncIterable<SearchResult> {
    const normalizedQuery = query.trim();
    if (normalizedQuery.length === 0) return;
    let payload = await this.#fetchItems(normalizedQuery, signal, "200");
    if (isSentinel(payload)) {
      payload = await this.#fetchItems(normalizedQuery, signal, "0");
    }
    for (const result of parseResponse(payload, category)) yield result;
  }
}
