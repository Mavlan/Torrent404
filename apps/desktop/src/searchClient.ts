import { invoke } from "@tauri-apps/api/core";
import type {
  SearchCancelResponse,
  SearchPollResponse,
  SearchStartResponse,
} from "@torlink/protocol";

export interface SearchClient {
  start(query: string): Promise<SearchStartResponse["result"]>;
  poll(requestId: string, cursor: number): Promise<SearchPollResponse["result"]>;
  cancel(requestId: string): Promise<SearchCancelResponse["result"]>;
}

export const desktopSearchClient: SearchClient = {
  start: (query) => invoke("search_start", { query }),
  poll: (requestId, cursor) => invoke("search_poll", { requestId, cursor }),
  cancel: (requestId) => invoke("search_cancel", { requestId }),
};
