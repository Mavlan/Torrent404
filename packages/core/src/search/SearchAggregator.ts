import type { SearchResult } from "@torlink/protocol";

import type { ProviderRegistry } from "./ProviderRegistry";
import type { SearchProvider } from "./SearchProvider";

export type ProviderFailureCode = "error" | "timeout";

export interface ProviderSearchFailure {
  providerId: string;
  code: ProviderFailureCode;
  error?: unknown;
}

export interface SearchOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
  providerIds?: readonly string[];
  onProviderFailure?: (failure: ProviderSearchFailure) => void;
}

type QueueEvent =
  | { type: "result"; result: SearchResult }
  | { type: "done" };

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

function decodeBase32(value: string): string | undefined {
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];

  for (const character of value.toUpperCase()) {
    const digit = BASE32_ALPHABET.indexOf(character);
    if (digit < 0) return undefined;
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >>> bits) & 0xff);
    }
  }

  return bytes.length === 20
    ? Buffer.from(bytes).toString("hex")
    : undefined;
}

function normalizeInfoHash(value: string): string | undefined {
  const normalized = value.trim().replace(/^urn:btih:/i, "");
  if (/^[a-f\d]{40}$/i.test(normalized)) return normalized.toLowerCase();
  if (/^[a-z2-7]{32}$/i.test(normalized)) return decodeBase32(normalized);
  return undefined;
}

function resultInfoHash(result: SearchResult): string | undefined {
  if (result.infoHash) return normalizeInfoHash(result.infoHash);
  if (!result.magnet) return undefined;

  try {
    const magnet = new URL(result.magnet);
    for (const exactTopic of magnet.searchParams.getAll("xt")) {
      const infoHash = normalizeInfoHash(exactTopic);
      if (infoHash) return infoHash;
    }
  } catch {
    return undefined;
  }

  return undefined;
}

function selectedProviders(
  registry: ProviderRegistry,
  providerIds: readonly string[] | undefined,
): readonly SearchProvider[] {
  if (!providerIds) return registry.listEnabled();
  return providerIds.flatMap((id) => {
    const provider = registry.get(id);
    if (!provider || provider.enabled === false) return [];
    return [provider];
  });
}

function nextWithAbort<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
    void iterator.next().then(
      (result) => {
        signal.removeEventListener("abort", onAbort);
        resolve(result);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

export class SearchAggregator {
  constructor(
    private readonly registry: ProviderRegistry,
    private readonly defaultTimeoutMs = 15_000,
  ) {
    if (!Number.isFinite(defaultTimeoutMs) || defaultTimeoutMs <= 0) {
      throw new Error("Search timeout must be a positive finite number");
    }
  }

  async *search(
    query: string,
    options: SearchOptions = {},
  ): AsyncGenerator<SearchResult> {
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs;
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error("Search timeout must be a positive finite number");
    }

    const providers = selectedProviders(this.registry, options.providerIds);
    if (providers.length === 0 || options.signal?.aborted) return;

    const queue: QueueEvent[] = [];
    let wake: (() => void) | undefined;
    let active = providers.length;
    const controllers = new Set<AbortController>();
    const push = (event: QueueEvent): void => {
      queue.push(event);
      wake?.();
      wake = undefined;
    };

    const cancelAll = (): void => {
      for (const controller of controllers) controller.abort();
      wake?.();
      wake = undefined;
    };
    options.signal?.addEventListener("abort", cancelAll, { once: true });

    const runProvider = async (provider: SearchProvider): Promise<void> => {
      const controller = new AbortController();
      controllers.add(controller);
      let timedOut = false;
      const timeout = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);

      try {
        const iterator = provider.search(query, controller.signal)[Symbol.asyncIterator]();
        while (!controller.signal.aborted && !options.signal?.aborted) {
          const next = await nextWithAbort(iterator, controller.signal);
          if (next.done) break;
          push({ type: "result", result: next.value });
        }
        if (controller.signal.aborted) {
          void Promise.resolve(iterator.return?.()).catch(() => undefined);
        }
      } catch (error) {
        if (timedOut) {
          options.onProviderFailure?.({ providerId: provider.id, code: "timeout" });
        } else if (!options.signal?.aborted) {
          options.onProviderFailure?.({ providerId: provider.id, code: "error", error });
        }
      } finally {
        clearTimeout(timeout);
        controllers.delete(controller);
        active -= 1;
        push({ type: "done" });
      }
    };

    for (const provider of providers) void runProvider(provider);

    const seenInfoHashes = new Set<string>();
    try {
      while ((active > 0 || queue.length > 0) && !options.signal?.aborted) {
        if (queue.length === 0) {
          await new Promise<void>((resolve) => {
            wake = resolve;
          });
          continue;
        }

        const event = queue.shift()!;
        if (event.type === "done") continue;
        const infoHash = resultInfoHash(event.result);
        if (infoHash && seenInfoHashes.has(infoHash)) continue;
        if (infoHash) seenInfoHashes.add(infoHash);
        yield event.result;
      }
    } finally {
      options.signal?.removeEventListener("abort", cancelAll);
      cancelAll();
    }
  }
}
