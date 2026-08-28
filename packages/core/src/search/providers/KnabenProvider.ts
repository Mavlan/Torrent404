import type { SearchResult } from "@torlink/protocol";

import type { SearchProvider } from "../SearchProvider";

const KNABEN_ENDPOINT = "https://api.knaben.org/v1";
const KNABEN_CATEGORIES = [2_000_000, 3_000_000] as const;
const INFO_HASH = /^[a-f\d]{40}$/i;

type FetchImplementation = (
  input: string | URL,
  init?: RequestInit,
) => Promise<Response>;

export type KnabenProviderErrorCode =
  | "forbidden"
  | "rate_limited"
  | "server_error"
  | "http_error"
  | "malformed_json"
  | "network_error";

export class KnabenProviderError extends Error {
  constructor(
    readonly code: KnabenProviderErrorCode,
    message: string,
    readonly status?: number,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "KnabenProviderError";
  }
}

export interface KnabenProviderOptions {
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

function nonNegativeNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0
    ? value
    : 0;
}

function normalizedMagnet(value: unknown, expectedInfoHash: string): string | undefined {
  const magnet = nonEmptyString(value);
  if (!magnet) return undefined;
  try {
    const url = new URL(magnet);
    if (url.protocol !== "magnet:") return undefined;
    const matches = url.searchParams.getAll("xt").some((topic) => {
      const hash = topic.trim().replace(/^urn:btih:/i, "");
      return INFO_HASH.test(hash) && hash.toLowerCase() === expectedInfoHash;
    });
    return matches ? magnet : undefined;
  } catch {
    return undefined;
  }
}

function normalizedCategory(value: unknown): "movies" | "tv" | "movies-tv" {
  const category = nonEmptyString(value)?.toLowerCase();
  if (category?.startsWith("movies")) return "movies";
  if (category?.startsWith("tv")) return "tv";
  return "movies-tv";
}

function parseResponse(payload: unknown): SearchResult[] {
  const hits = record(payload)?.hits;
  if (!Array.isArray(hits)) return [];

  const results: SearchResult[] = [];
  for (const value of hits) {
    const hit = record(value);
    const title = nonEmptyString(hit?.title);
    const rawHash = nonEmptyString(hit?.hash);
    if (!hit || !title || !rawHash || !INFO_HASH.test(rawHash)) continue;

    const infoHash = rawHash.toLowerCase();
    const magnet = normalizedMagnet(hit.magnetUrl, infoHash);
    if (!magnet) continue;

    results.push({
      id: `knaben:${infoHash}`,
      title,
      source: "knaben",
      infoHash,
      category: normalizedCategory(hit.category),
      sizeBytes: nonNegativeNumber(hit.bytes),
      seeders: nonNegativeNumber(hit.seeders),
      leechers: nonNegativeNumber(hit.peers),
      magnet,
    });
  }
  return results;
}

function httpError(status: number): KnabenProviderError {
  if (status === 403) {
    return new KnabenProviderError("forbidden", "Knaben rejected the request", status);
  }
  if (status === 429) {
    return new KnabenProviderError("rate_limited", "Knaben rate limit exceeded", status);
  }
  if (status >= 500) {
    return new KnabenProviderError("server_error", "Knaben service is unavailable", status);
  }
  return new KnabenProviderError("http_error", `Knaben returned HTTP ${status}`, status);
}

export class KnabenProvider implements SearchProvider {
  readonly id = "knaben";
  readonly displayName = "Knaben";
  readonly categories = ["movies", "tv"] as const;
  readonly defaultEnabled = false;

  readonly #fetch: FetchImplementation;

  constructor({ fetchImpl = fetch }: KnabenProviderOptions = {}) {
    this.#fetch = fetchImpl;
  }

  async *search(query: string, signal: AbortSignal): AsyncIterable<SearchResult> {
    let response: Response;
    try {
      response = await this.#fetch(KNABEN_ENDPOINT, {
        method: "POST",
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "TorLink-Desktop/0.1.0",
        },
        body: JSON.stringify({
          search_type: "100%",
          search_field: "title",
          query: query.trim(),
          order_by: "seeders",
          order_direction: "desc",
          categories: KNABEN_CATEGORIES,
          from: 0,
          size: 50,
          hide_unsafe: true,
          hide_xxx: true,
        }),
        signal,
      });
    } catch (error) {
      if (signal.aborted) throw signal.reason ?? error;
      throw new KnabenProviderError(
        "network_error",
        "Knaben network request failed",
        undefined,
        { cause: error },
      );
    }

    if (!response.ok) throw httpError(response.status);

    let payload: unknown;
    try {
      payload = await response.json();
    } catch (error) {
      throw new KnabenProviderError(
        "malformed_json",
        "Knaben returned malformed JSON",
        response.status,
        { cause: error },
      );
    }

    for (const result of parseResponse(payload)) yield result;
  }
}
