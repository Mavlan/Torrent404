const STORAGE_KEY = "torlink.provider-preferences.v1";
const SCHEMA_VERSION = 1;

interface ProviderPreferencesDocument {
  version: typeof SCHEMA_VERSION;
  providerEnabled: Record<string, boolean>;
}

export interface PreferenceStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function isBooleanRecord(value: unknown): value is Record<string, boolean> {
  return typeof value === "object"
    && value !== null
    && !Array.isArray(value)
    && Object.entries(value).every(([providerId, enabled]) => providerId.length > 0 && typeof enabled === "boolean");
}

export function loadProviderPreferences(
  storage: PreferenceStorage = window.localStorage,
): Record<string, boolean> {
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw === null) return {};
    const value: unknown = JSON.parse(raw);
    if (
      typeof value !== "object"
      || value === null
      || (value as Partial<ProviderPreferencesDocument>).version !== SCHEMA_VERSION
      || !isBooleanRecord((value as Partial<ProviderPreferencesDocument>).providerEnabled)
    ) return {};
    return { ...(value as ProviderPreferencesDocument).providerEnabled };
  } catch {
    return {};
  }
}

export function saveProviderPreferences(
  providerEnabled: Record<string, boolean>,
  storage: PreferenceStorage = window.localStorage,
): boolean {
  if (!isBooleanRecord(providerEnabled)) return false;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify({
      version: SCHEMA_VERSION,
      providerEnabled,
    } satisfies ProviderPreferencesDocument));
    return true;
  } catch {
    return false;
  }
}
