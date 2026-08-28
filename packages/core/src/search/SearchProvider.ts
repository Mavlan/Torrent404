import type { SearchResult } from "@torlink/protocol";

/** Stable provider boundary. Network policy and aggregation live above adapters. */
export interface SearchProvider {
  readonly id: string;
  readonly displayName: string;
  readonly categories: readonly string[];
  /** Static availability boundary; false providers cannot be selected. */
  readonly enabled?: boolean;
  /** Initial product preference; users may explicitly override it. */
  readonly defaultEnabled?: boolean;
  search(query: string, signal: AbortSignal): AsyncIterable<SearchResult>;
  healthCheck?(): Promise<boolean>;
}

export interface SearchProviderDescriptor {
  id: string;
  displayName: string;
  categories: readonly string[];
  enabled: boolean;
}
