import assert from "node:assert/strict";
import test from "node:test";

import { ProviderRegistry } from "./core/ProviderRegistry.js";
import { SearchAggregator } from "./core/SearchAggregator.js";
import { SearchService } from "./search-service.mjs";

function provider(id, search) {
  return { id, displayName: id.toUpperCase(), categories: ["test"], search };
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
