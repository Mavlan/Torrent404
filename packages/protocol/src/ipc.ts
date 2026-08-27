export const IPC_PROTOCOL_VERSION = 1 as const;

export const IPC_COMMANDS = ["ping", "health"] as const;

export type IpcCommand = (typeof IPC_COMMANDS)[number];

export type IpcErrorCode =
  | "malformed_request"
  | "unauthorized"
  | "protocol_version_mismatch"
  | "unknown_command";

export interface IpcRequest {
  protocolVersion: number;
  command: string;
}

export interface IpcErrorResponse {
  ok: false;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  error: {
    code: IpcErrorCode;
    message: string;
  };
}

export interface PingResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "ping";
  result: {
    reply: "pong";
  };
}

export interface HealthResponse {
  ok: true;
  protocolVersion: typeof IPC_PROTOCOL_VERSION;
  command: "health";
  result: {
    status: "ok";
  };
}

export type IpcResponse = IpcErrorResponse | PingResponse | HealthResponse;
