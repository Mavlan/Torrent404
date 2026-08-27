import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import http from "node:http";
import process from "node:process";
import readline from "node:readline";

import { ProviderRegistry } from "./core/ProviderRegistry.js";
import { SearchAggregator } from "./core/SearchAggregator.js";
import { NyaaProvider } from "./core/NyaaProvider.js";
import { YtsProvider } from "./core/YtsProvider.js";
import { SearchCommandError, SearchService } from "./search-service.mjs";

const LOOPBACK_HOST = "127.0.0.1";
const IPC_PROTOCOL_VERSION = 1;
const MAX_REQUEST_BYTES = 64 * 1024;
const host = process.env.TORLINK_IPC_HOST ?? LOOPBACK_HOST;
const sessionToken = process.env.TORLINK_SESSION_TOKEN ?? "";

if (host !== LOOPBACK_HOST) {
  process.stderr.write("Sidecar IPC host must be IPv4 loopback\n");
  process.exit(78);
}

if (!/^[a-f0-9]{64}$/.test(sessionToken)) {
  process.stderr.write("Sidecar session token is missing or invalid\n");
  process.exit(78);
}

function fixtureFetch(filePath, contentType) {
  return async (_input, init = {}) => {
    if (init.signal?.aborted) throw init.signal.reason;
    const body = await readFile(filePath);
    if (init.signal?.aborted) throw init.signal.reason;
    return new Response(body, { status: 200, headers: { "content-type": contentType } });
  };
}

const ytsFixture = process.env.TORLINK_YTS_FIXTURE;
const nyaaFixture = process.env.TORLINK_NYAA_FIXTURE;
const providers = [
  new YtsProvider(ytsFixture
    ? { fetchImpl: fixtureFetch(ytsFixture, "application/json") }
    : {}),
  new NyaaProvider(nyaaFixture
    ? { fetchImpl: fixtureFetch(nyaaFixture, "application/rss+xml") }
    : {}),
];
const providerRegistry = new ProviderRegistry(providers);
const searchAggregator = new SearchAggregator(providerRegistry);
const searchService = new SearchService(providerRegistry, searchAggregator);

function sendJson(response, statusCode, body) {
  const payload = JSON.stringify(body);
  response.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
    connection: "close",
  });
  response.end(payload);
}

function sendError(response, statusCode, code, message) {
  sendJson(response, statusCode, {
    ok: false,
    protocolVersion: IPC_PROTOCOL_VERSION,
    error: { code, message },
  });
}

function isAuthorized(header) {
  if (typeof header !== "string" || !header.startsWith("Bearer ")) return false;
  const candidate = header.slice("Bearer ".length);
  const expectedBytes = Buffer.from(sessionToken);
  const candidateBytes = Buffer.from(candidate);
  return (
    candidateBytes.length === expectedBytes.length &&
    timingSafeEqual(candidateBytes, expectedBytes)
  );
}

function handleCommand(response, request) {
  if (
    request === null ||
    Array.isArray(request) ||
    typeof request !== "object" ||
    typeof request.protocolVersion !== "number" ||
    typeof request.command !== "string"
  ) {
    sendError(response, 400, "malformed_request", "Request body is invalid");
    return;
  }

  if (request.protocolVersion !== IPC_PROTOCOL_VERSION) {
    sendError(
      response,
      409,
      "protocol_version_mismatch",
      `Expected protocol version ${IPC_PROTOCOL_VERSION}`,
    );
    return;
  }

  if (request.command === "ping") {
    sendJson(response, 200, {
      ok: true,
      protocolVersion: IPC_PROTOCOL_VERSION,
      command: "ping",
      result: { reply: "pong" },
    });
    return;
  }

  if (request.command === "health") {
    sendJson(response, 200, {
      ok: true,
      protocolVersion: IPC_PROTOCOL_VERSION,
      command: "health",
      result: { status: "ok" },
    });
    return;
  }

  try {
    if (request.command === "search.providers") {
      sendJson(response, 200, {
        ok: true,
        protocolVersion: IPC_PROTOCOL_VERSION,
        command: "search.providers",
        result: searchService.providers(),
      });
      return;
    }

    if (request.command === "search.start") {
      sendJson(response, 200, {
        ok: true,
        protocolVersion: IPC_PROTOCOL_VERSION,
        command: "search.start",
        result: searchService.start(request.requestId, request.query, request.category),
      });
      return;
    }

    if (request.command === "search.poll") {
      sendJson(response, 200, {
        ok: true,
        protocolVersion: IPC_PROTOCOL_VERSION,
        command: "search.poll",
        result: searchService.poll(request.requestId, request.cursor),
      });
      return;
    }

    if (request.command === "search.cancel") {
      sendJson(response, 200, {
        ok: true,
        protocolVersion: IPC_PROTOCOL_VERSION,
        command: "search.cancel",
        result: searchService.cancel(request.requestId),
      });
      return;
    }
  } catch (error) {
    if (error instanceof SearchCommandError) {
      sendError(response, error.statusCode, error.code, error.message);
    } else {
      sendError(response, 500, "internal_error", "Search command failed");
    }
    return;
  }

  sendError(response, 404, "unknown_command", "Command is not supported");
}

const server = http.createServer((request, response) => {
  if (!isAuthorized(request.headers.authorization)) {
    sendError(response, 401, "unauthorized", "Authentication required");
    return;
  }

  if (request.method !== "POST" || request.url !== "/ipc") {
    sendError(response, 404, "unknown_command", "IPC endpoint is not supported");
    return;
  }

  const chunks = [];
  let bytesRead = 0;
  request.on("data", (chunk) => {
    bytesRead += chunk.length;
    if (bytesRead <= MAX_REQUEST_BYTES) chunks.push(chunk);
  });
  request.on("end", () => {
    if (bytesRead > MAX_REQUEST_BYTES) {
      sendError(response, 413, "malformed_request", "Request body is too large");
      return;
    }

    try {
      handleCommand(response, JSON.parse(Buffer.concat(chunks).toString("utf8")));
    } catch {
      sendError(response, 400, "malformed_request", "Request body is not valid JSON");
    }
  });
});

server.on("clientError", (_error, socket) => {
  socket.end("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
});

let stopping = false;
function shutdown(code = 0) {
  if (stopping) return;
  stopping = true;
  process.exitCode = code;
  process.stdin.pause();
  searchService.shutdown();
  server.close(() => process.exit(code));
  server.closeAllConnections();
}

const control = readline.createInterface({ input: process.stdin });
control.on("line", (line) => {
  if (line.trim() === "shutdown") shutdown(0);
});
control.on("close", () => shutdown(0));
process.stdin.on("error", () => shutdown(0));
process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

server.listen({ host: LOOPBACK_HOST, port: 0, exclusive: true }, () => {
  const address = server.address();
  if (address === null || typeof address === "string") {
    process.stderr.write("Sidecar failed to resolve its loopback endpoint\n");
    shutdown(1);
    return;
  }

  process.stdout.write(
    `${JSON.stringify({
      type: "ready",
      transport: "http",
      host: LOOPBACK_HOST,
      port: address.port,
      authentication: "session-token",
      protocolVersion: IPC_PROTOCOL_VERSION,
    })}\n`,
  );
});
