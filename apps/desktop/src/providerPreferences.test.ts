import { describe, expect, it, vi } from "vitest";

import {
  loadProviderPreferences,
  saveProviderPreferences,
  type PreferenceStorage,
} from "./providerPreferences";

function memoryStorage(initialValue: string | null = null): PreferenceStorage {
  let value = initialValue;
  return {
    getItem: vi.fn(() => value),
    setItem: vi.fn((_key, nextValue) => { value = nextValue; }),
  };
}

describe("provider preferences", () => {
  it("defaults safely when settings are missing, malformed, or contain invalid fields", () => {
    expect(loadProviderPreferences(memoryStorage())).toEqual({});
    expect(loadProviderPreferences(memoryStorage("{not-json"))).toEqual({});
    expect(loadProviderPreferences(memoryStorage(JSON.stringify({
      version: 1,
      providerEnabled: { yts: "no" },
    })))).toEqual({});
    expect(loadProviderPreferences(memoryStorage(JSON.stringify({
      version: 99,
      providerEnabled: { yts: false },
    })))).toEqual({});
  });

  it("round-trips an extensible provider-ID boolean map without sensitive data", () => {
    const storage = memoryStorage();
    expect(saveProviderPreferences({ yts: false, nyaa: true, tpb: false }, storage)).toBe(true);
    expect(loadProviderPreferences(storage)).toEqual({ yts: false, nyaa: true, tpb: false });
  });

  it("keeps the application usable when browser storage is unavailable", () => {
    const unavailable: PreferenceStorage = {
      getItem: vi.fn(() => { throw new Error("blocked"); }),
      setItem: vi.fn(() => { throw new Error("quota"); }),
    };
    expect(loadProviderPreferences(unavailable)).toEqual({});
    expect(saveProviderPreferences({ yts: false }, unavailable)).toBe(false);
  });
});
