import type {
  SearchProvider,
  SearchProviderDescriptor,
} from "./SearchProvider";

const PROVIDER_ID = /^[a-z0-9](?:[a-z0-9-]{0,62})$/;

function validateProvider(provider: SearchProvider): void {
  if (!PROVIDER_ID.test(provider.id)) {
    throw new Error(`Invalid provider id: ${provider.id}`);
  }
  if (provider.displayName.trim().length === 0) {
    throw new Error(`Provider ${provider.id} has an empty display name`);
  }
  if (provider.categories.some((category) => category.trim().length === 0)) {
    throw new Error(`Provider ${provider.id} has an empty category`);
  }
}

export class ProviderRegistry {
  readonly #providers = new Map<string, SearchProvider>();

  constructor(providers: Iterable<SearchProvider>) {
    for (const provider of providers) {
      validateProvider(provider);
      if (this.#providers.has(provider.id)) {
        throw new Error(`Duplicate provider id: ${provider.id}`);
      }
      this.#providers.set(provider.id, provider);
    }
  }

  get(id: string): SearchProvider | undefined {
    return this.#providers.get(id);
  }

  has(id: string): boolean {
    return this.#providers.has(id);
  }

  list(): readonly SearchProvider[] {
    return [...this.#providers.values()];
  }

  listEnabled(): readonly SearchProvider[] {
    return this.list().filter(({ enabled, defaultEnabled }) => (
      enabled !== false && defaultEnabled !== false
    ));
  }

  describe(): readonly SearchProviderDescriptor[] {
    return this.list().map(({ id, displayName, categories, enabled, defaultEnabled }) => ({
      id,
      displayName,
      categories: [...categories],
      enabled: enabled !== false && defaultEnabled !== false,
    }));
  }
}
