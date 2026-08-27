import { PROTOCOL_VERSION } from "@torlink/protocol";

export interface CoreRuntimeStatus {
  protocolVersion: number;
  state: "idle";
  networkListeners: 0;
  torrentEngine: "not-configured";
}

/**
 * Phase 1 runtime seam. It deliberately opens no ports, starts no torrent
 * client and reads no user files. Later phases inject transport/providers here.
 */
export function createCoreRuntimeStatus(): CoreRuntimeStatus {
  return {
    protocolVersion: PROTOCOL_VERSION,
    state: "idle",
    networkListeners: 0,
    torrentEngine: "not-configured",
  };
}

