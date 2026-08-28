import { invoke } from "@tauri-apps/api/core";
import type {
  SearchCancelResponse,
  SearchCategory,
  SearchPollResponse,
  SearchProvidersResponse,
  SearchStartResponse,
} from "@torlink/protocol";

export interface SearchClient {
  providers(): Promise<SearchProvidersResponse["result"]>;
  start(
    query: string,
    category: SearchCategory,
    providerIds: string[],
  ): Promise<SearchStartResponse["result"]>;
  poll(requestId: string, cursor: number): Promise<SearchPollResponse["result"]>;
  cancel(requestId: string): Promise<SearchCancelResponse["result"]>;
}

export const desktopSearchClient: SearchClient = {
  providers: () => invoke("search_providers"),
  start: (query, category, providerIds) => invoke("search_start", { query, category, providerIds }),
  poll: (requestId, cursor) => invoke("search_poll", { requestId, cursor }),
  cancel: (requestId) => invoke("search_cancel", { requestId }),
};
