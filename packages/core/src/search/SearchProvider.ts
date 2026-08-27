import type { SearchResult } from "@torlink/protocol";

/** Stable provider boundary. Network policy and aggregation live above adapters. */
export interface SearchProvider {
  readonly id: string;
  readonly displayName: string;
  readonly categories: readonly string[];
  search(query: string, signal: AbortSignal): AsyncIterable<SearchResult>;
  healthCheck?(): Promise<boolean>;
}

export interface SearchProviderDescriptor {
  id: string;
  displayName: string;
  categories: readonly string[];
}
