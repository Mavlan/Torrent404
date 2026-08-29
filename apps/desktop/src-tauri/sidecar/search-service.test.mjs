import assert from "node:assert/strict";
import test from "node:test";

import { ProviderRegistry } from "./core/ProviderRegistry.js";
import { SearchAggregator } from "./core/SearchAggregator.js";
import { SearchService } from "./search-service.mjs";

function provider(
  id,
  search,
  { categories = ["test"], enabled = true, defaultEnabled } = {},
) {
  return { id, displayName: id.toUpperCase(), categories, enabled, defaultEnabled, search };
}

async function collect(service, requestId, { cursor = 0, timeoutMs = 1_000 } = {}) {
  const events = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const poll = service.poll(requestId, cursor);
    cursor = poll.nextCursor;
    events.push(...poll.events);
    if (poll.done) return { events, cursor };
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("search session did not finish");
}

test("returns results before every provider finishes", async () => {
  let releaseSlow;
  const slowGate = new Promise((resolve) => {
    releaseSlow = resolve;
  });
  const registry = new ProviderRegistry([
    provider("fast", async function* () {
      yield { id: "fast:1", title: "Fast", source: "fast" };
    }),
    provider("slow", async function* () {
      await slowGate;
      yield { id: "slow:1", title: "Slow", source: "slow" };
    }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry));
  service.start("search-incremental", "linux");

  await new Promise((resolve) => setTimeout(resolve, 0));
  const firstPoll = service.poll("search-incremental", 0);
  assert.equal(firstPoll.done, false);
  assert.ok(firstPoll.events.some((event) => event.type === "search.result" && event.result.source === "fast"));
  assert.ok(!firstPoll.events.some((event) => event.type === "search.result" && event.result.source === "slow"));

  releaseSlow();
  const completion = await collect(service, "search-incremental", {
    cursor: firstPoll.nextCursor,
  });
  assert.ok(completion.events.some((event) => event.type === "search.result" && event.result.source === "slow"));
  assert.ok(completion.events.some((event) => event.type === "search.complete" && !event.cancelled));
});

test("reports enabled provider capabilities from the current registry", () => {
  const registry = new ProviderRegistry([
    provider("movies", async function* () {}, { categories: ["movies"] }),
    provider("anime", async function* () {}, { categories: ["anime"], enabled: false }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry));

  assert.deepEqual(service.providers(), {
    providers: [
      { providerId: "movies", displayName: "MOVIES", categories: ["movies"], enabled: true },
      { providerId: "anime", displayName: "ANIME", categories: ["anime"], enabled: false },
    ],
  });
});

test("maps provider errors and timeouts without losing healthy results", async () => {
  const registry = new ProviderRegistry([
    provider("broken", async function* () {
      throw new Error("offline");
    }),
    provider("hanging", async function* () {
      await new Promise(() => undefined);
    }),
    provider("healthy", async function* () {
      yield { id: "healthy:1", title: "Healthy", source: "healthy" };
    }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry, 20));
  service.start("search-failures", "linux");

  const { events } = await collect(service, "search-failures");
  assert.ok(events.some((event) => event.type === "search.result" && event.result.source === "healthy"));
  assert.ok(events.some((event) => event.type === "search.provider-status"
    && event.status.providerId === "broken" && event.status.state === "error"));
  assert.ok(events.some((event) => event.type === "search.provider-status"
    && event.status.providerId === "hanging" && event.status.state === "timeout"));
});

test("cancels an active search and reports cancelled provider state", async () => {
  let observedAbort = false;
  const registry = new ProviderRegistry([
    provider("slow", async function* (_query, signal) {
      signal.addEventListener("abort", () => {
        observedAbort = true;
      }, { once: true });
      await new Promise(() => undefined);
    }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry));
  service.start("search-cancel", "linux");
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.deepEqual(service.cancel("search-cancel"), {
    requestId: "search-cancel",
    cancelled: true,
  });
  const { events } = await collect(service, "search-cancel");
  assert.equal(observedAbort, true);
  assert.ok(events.some((event) => event.type === "search.provider-status"
    && event.status.state === "cancelled"));
  assert.ok(events.some((event) => event.type === "search.complete" && event.cancelled));
});

test("filters providers by category and skips disabled providers", async () => {
  let moviesCalls = 0;
  let selectedCategory;
  let animeCalls = 0;
  let disabledCalls = 0;
  const registry = new ProviderRegistry([
    provider("movies", async function* (_query, _signal, category) {
      moviesCalls += 1;
      selectedCategory = category;
      yield { id: "movies:1", title: "Movie", source: "movies" };
    }, { categories: ["movies"] }),
    provider("anime", async function* () {
      animeCalls += 1;
      yield { id: "anime:1", title: "Anime", source: "anime" };
    }, { categories: ["anime"] }),
    provider("disabled", async function* () {
      disabledCalls += 1;
      yield { id: "disabled:1", title: "Disabled", source: "disabled" };
    }, { categories: ["movies"], enabled: false }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry));

  service.start("search-category", "legal fixture", "movies");
  const { events } = await collect(service, "search-category");

  assert.equal(moviesCalls, 1);
  assert.equal(selectedCategory, "movies");
  assert.equal(animeCalls, 0);
  assert.equal(disabledCalls, 0);
  assert.deepEqual(
    events
      .filter((event) => event.type === "search.provider-status")
      .map((event) => event.status.providerId),
    ["movies", "movies"],
  );
  assert.ok(events.some((event) => event.type === "search.result" && event.result.source === "movies"));
});

test("honors the caller's enabled provider selection without invoking other sources", async () => {
  let moviesCalls = 0;
  let animeCalls = 0;
  const registry = new ProviderRegistry([
    provider("movies", async function* () {
      moviesCalls += 1;
      yield { id: "movies:1", title: "Movie", source: "movies" };
    }, { categories: ["movies"] }),
    provider("anime", async function* () {
      animeCalls += 1;
      yield { id: "anime:1", title: "Anime", source: "anime" };
    }, { categories: ["anime"] }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry));

  service.start("search-selection", "legal fixture", "all", ["anime"]);
  const selected = await collect(service, "search-selection");
  assert.equal(moviesCalls, 0);
  assert.equal(animeCalls, 1);
  assert.ok(selected.events.some((event) => event.type === "search.result" && event.result.source === "anime"));
  assert.ok(!selected.events.some((event) => event.type === "search.result" && event.result.source === "movies"));

  service.start("search-empty-selection", "legal fixture", "all", []);
  const empty = await collect(service, "search-empty-selection");
  assert.equal(moviesCalls, 0);
  assert.equal(animeCalls, 1);
  assert.deepEqual(empty.events, [{
    type: "search.complete",
    requestId: "search-empty-selection",
    cancelled: false,
  }]);
});

test("allows explicit opt-in to a provider that is disabled only by default", async () => {
  let betaCalls = 0;
  const registry = new ProviderRegistry([
    provider("beta", async function* () {
      betaCalls += 1;
      yield { id: "beta:1", title: "Beta", source: "beta" };
    }, { categories: ["movies", "tv"], defaultEnabled: false }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry));

  assert.equal(service.providers().providers[0].enabled, false);
  service.start("search-beta-default", "test", "movies");
  await collect(service, "search-beta-default");
  assert.equal(betaCalls, 0);

  service.start("search-beta-opt-in", "test", "movies", ["beta"]);
  const selected = await collect(service, "search-beta-opt-in");
  assert.equal(betaCalls, 1);
  assert.ok(selected.events.some((event) => event.type === "search.result"
    && event.result.source === "beta"));
});

test("completes cleanly when no provider supports a category", async () => {
  let calls = 0;
  const registry = new ProviderRegistry([
    provider("anime", async function* () {
      calls += 1;
    }, { categories: ["anime"] }),
  ]);
  const service = new SearchService(registry, new SearchAggregator(registry));

  service.start("search-no-provider", "legal fixture", "software");
  const { events } = await collect(service, "search-no-provider");

  assert.equal(calls, 0);
  assert.deepEqual(events, [{
    type: "search.complete",
    requestId: "search-no-provider",
    cancelled: false,
  }]);
});
