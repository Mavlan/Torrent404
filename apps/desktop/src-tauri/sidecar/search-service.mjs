const REQUEST_ID = /^[A-Za-z0-9:_-]{1,128}$/;
const MAX_QUERY_LENGTH = 500;
const MAX_POLL_EVENTS = 25;
const COMPLETED_SESSION_TTL_MS = 60_000;
const SEARCH_CATEGORIES = new Set(["all", "movies", "tv", "anime", "games", "software"]);

export class SearchCommandError extends Error {
  constructor(code, message, statusCode) {
    super(message);
    this.name = "SearchCommandError";
    this.code = code;
    this.statusCode = statusCode;
  }
}

export class SearchService {
  #aggregator;
  #providers;
  #sessions = new Map();

  constructor(registry, aggregator) {
    this.#aggregator = aggregator;
    this.#providers = new Map(
      registry.describe().map((provider) => [provider.id, provider]),
    );
  }

  providers() {
    return {
      providers: [...this.#providers.values()].map((provider) => ({
        providerId: provider.id,
        displayName: provider.displayName,
        categories: [...provider.categories],
        enabled: provider.enabled,
      })),
    };
  }

  start(requestId, query, category = "all", requestedProviderIds) {
    const normalizedQuery = typeof query === "string" ? query.trim() : "";
    const hasProviderSelection = requestedProviderIds !== undefined && requestedProviderIds !== null;
    if (
      !REQUEST_ID.test(requestId ?? "")
      || normalizedQuery.length === 0
      || normalizedQuery.length > MAX_QUERY_LENGTH
      || !SEARCH_CATEGORIES.has(category)
      || (hasProviderSelection && (
        !Array.isArray(requestedProviderIds)
        || requestedProviderIds.some((providerId) => typeof providerId !== "string")
      ))
    ) {
      throw new SearchCommandError(
        "invalid_search_request",
        "Search request ID or query is invalid",
        400,
      );
    }
    if (this.#sessions.has(requestId)) {
      throw new SearchCommandError(
        "duplicate_request_id",
        "Search request ID is already active",
        409,
      );
    }

    const selectedProviderIds = hasProviderSelection ? new Set(requestedProviderIds) : undefined;
    const providerIds = [...this.#providers.values()]
      .filter((provider) => provider.enabled
        && (category === "all" || provider.categories.includes(category))
        && (!selectedProviderIds || selectedProviderIds.has(provider.id)))
      .map(({ id }) => id);
    const controller = new AbortController();
    const session = {
      requestId,
      providerIds,
      controller,
      events: [],
      statuses: new Map(),
      done: false,
      cancelled: false,
      cleanupTimer: undefined,
    };
    this.#sessions.set(requestId, session);

    for (const providerId of providerIds) {
      this.#setProviderStatus(session, providerId, "searching");
    }
    void this.#run(session, normalizedQuery);

    return { requestId };
  }

  poll(requestId, cursor) {
    const session = this.#session(requestId);
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > session.events.length) {
      throw new SearchCommandError(
        "invalid_search_request",
        "Search event cursor is invalid",
        400,
      );
    }

    const events = session.events.slice(cursor, cursor + MAX_POLL_EVENTS);
    const nextCursor = cursor + events.length;
    const done = session.done && nextCursor === session.events.length;
    if (done) {
      clearTimeout(session.cleanupTimer);
      this.#sessions.delete(requestId);
    }
    return { requestId, events, nextCursor, done };
  }

  cancel(requestId) {
    const session = this.#session(requestId);
    const cancelled = !session.done && !session.cancelled;
    if (cancelled) {
      session.cancelled = true;
      for (const providerId of session.providerIds) {
        if (session.statuses.get(providerId)?.state === "searching") {
          this.#setProviderStatus(session, providerId, "cancelled");
        }
      }
      session.controller.abort();
    }
    return { requestId, cancelled };
  }

  shutdown() {
    for (const session of this.#sessions.values()) {
      clearTimeout(session.cleanupTimer);
      session.controller.abort();
    }
    this.#sessions.clear();
  }

  #session(requestId) {
    if (typeof requestId !== "string" || !REQUEST_ID.test(requestId)) {
      throw new SearchCommandError(
        "invalid_search_request",
        "Search request ID is invalid",
        400,
      );
    }
    const session = this.#sessions.get(requestId);
    if (!session) {
      throw new SearchCommandError(
        "search_request_not_found",
        "Search request was not found",
        404,
      );
    }
    return session;
  }

  #setProviderStatus(session, providerId, state, error) {
    const provider = this.#providers.get(providerId);
    if (!provider) return;
    const previous = session.statuses.get(providerId);
    const status = {
      providerId,
      displayName: provider.displayName,
      state,
      resultCount: previous?.resultCount ?? 0,
      ...(error ? { error } : {}),
    };
    session.statuses.set(providerId, status);
    session.events.push({
      type: "search.provider-status",
      requestId: session.requestId,
      status,
    });
  }

  async #run(session, query) {
    try {
      const results = this.#aggregator.search(query, {
        signal: session.controller.signal,
        providerIds: session.providerIds,
        onProviderFailure: ({ providerId, code }) => {
          const timedOut = code === "timeout";
          this.#setProviderStatus(
            session,
            providerId,
            timedOut ? "timeout" : "error",
            {
              code: timedOut ? "provider_timeout" : "provider_error",
              message: timedOut ? "Provider search timed out" : "Provider search failed",
            },
          );
        },
      });

      for await (const result of results) {
        if (session.cancelled) break;
        const status = session.statuses.get(result.source);
        if (status) {
          session.statuses.set(result.source, {
            ...status,
            resultCount: status.resultCount + 1,
          });
        }
        session.events.push({
          type: "search.result",
          requestId: session.requestId,
          result,
        });
      }
    } catch {
      if (!session.cancelled) {
        session.events.push({
          type: "search.error",
          requestId: session.requestId,
          error: { code: "search_failed", message: "Search failed unexpectedly" },
        });
      }
    } finally {
      for (const providerId of session.providerIds) {
        if (session.statuses.get(providerId)?.state === "searching") {
          this.#setProviderStatus(
            session,
            providerId,
            session.cancelled ? "cancelled" : "complete",
          );
        }
      }
      session.events.push({
        type: "search.complete",
        requestId: session.requestId,
        cancelled: session.cancelled,
      });
      session.done = true;
      session.cleanupTimer = setTimeout(() => {
        if (this.#sessions.get(session.requestId) === session) {
          this.#sessions.delete(session.requestId);
        }
      }, COMPLETED_SESSION_TTL_MS);
      session.cleanupTimer.unref();
    }
  }
}
