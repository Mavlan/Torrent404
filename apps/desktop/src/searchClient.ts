import { invoke } from "@tauri-apps/api/core";
import type {
  SearchCancelResponse,
  SearchCategory,
  SearchPollResponse,
  SearchStartResponse,
} from "@torlink/protocol";

export interface SearchClient {
  start(query: string, category: SearchCategory): Promise<SearchStartResponse["result"]>;
  poll(requestId: string, cursor: number): Promise<SearchPollResponse["result"]>;
  cancel(requestId: string): Promise<SearchCancelResponse["result"]>;
}

export const desktopSearchClient: SearchClient = {
  start: (query, category) => invoke("search_start", { query, category }),
  poll: (requestId, cursor) => invoke("search_poll", { requestId, cursor }),
  cancel: (requestId) => invoke("search_cancel", { requestId }),
};
