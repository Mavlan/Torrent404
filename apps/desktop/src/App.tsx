import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import {
  DEFAULT_LOCALE,
  translate,
  type Locale,
  type MessageKey,
} from "@torlink/i18n";
import {
  searchCategories,
  type DownloadTask,
  type SearchCategory,
  type SearchIpcEvent,
  type SearchProviderState,
  type SearchProviderStatus,
  type SearchResult,
} from "@torlink/protocol";
import { desktopSearchClient, type SearchClient } from "./searchClient";

type Page = "search" | "downloading" | "completed" | "settings" | "about";
type IconName = "search" | "arrow" | "check" | "settings" | "info" | "folder" | "shield";
type Translator = (key: MessageKey) => string;

const navItems: ReadonlyArray<{
  id: Page;
  labelKey: MessageKey;
  icon: IconName;
  count?: number;
}> = [
  { id: "search", labelKey: "nav.search", icon: "search" },
  { id: "downloading", labelKey: "nav.downloading", icon: "arrow", count: 0 },
  { id: "completed", labelKey: "nav.completed", icon: "check", count: 0 },
  { id: "settings", labelKey: "nav.settings", icon: "settings" },
  { id: "about", labelKey: "nav.about", icon: "info" },
];

const categoryLabelKeys: Record<SearchCategory, MessageKey> = {
  all: "category.all",
  movies: "category.movies",
  tv: "category.tv",
  anime: "category.anime",
  games: "category.games",
  software: "category.software",
};
const themeLabelKeys = {
  system: "settings.themeSystem",
  light: "settings.themeLight",
  dark: "settings.themeDark",
} as const satisfies Record<"system" | "light" | "dark", MessageKey>;
const localeLabelKeys: Record<Locale, MessageKey> = {
  "zh-CN": "settings.languageZh",
  "en-US": "settings.languageEn",
};

const providers: ReadonlyArray<{
  id: "yts" | "nyaa";
  displayName: string;
  categories: readonly SearchCategory[];
}> = [
  { id: "yts", displayName: "YTS", categories: ["movies"] },
  { id: "nyaa", displayName: "Nyaa", categories: ["anime"] },
] as const;
const noTasks: DownloadTask[] = [];

function formatBytes(value = 0): string {
  if (value < 1_024) return `${value} B`;
  const units = ["KiB", "MiB", "GiB", "TiB"];
  let amount = value;
  let unit = -1;
  do {
    amount /= 1_024;
    unit += 1;
  } while (amount >= 1_024 && unit < units.length - 1);
  return `${amount >= 10 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function providerStateLabel(state: SearchProviderState | undefined, t: Translator): string {
  if (!state) return t("provider.idle");
  const labelKeys: Record<SearchProviderState, MessageKey> = {
    searching: "provider.searching",
    complete: "provider.complete",
    error: "provider.error",
    timeout: "provider.timeout",
    cancelled: "provider.cancelled",
  };
  return t(labelKeys[state]);
}

function Icon({ name }: { name: IconName }) {
  const paths: Record<IconName, ReactNode> = {
    search: <><circle cx="11" cy="11" r="6.5" /><path d="m16 16 4 4" /></>,
    arrow: <><path d="M12 3v13" /><path d="m7 11 5 5 5-5" /><path d="M5 21h14" /></>,
    check: <><path d="m5 12 4 4L19 6" /><path d="M4 21h16" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M19 13.5v-3l-2-.7-.7-1.7.9-1.9-2.1-2.1-1.9.9-1.7-.7L10.5 2h-3l-.7 2-1.7.7-1.9-.9-2.1 2.1.9 1.9-.7 1.7-2 .7v3l2 .7.7 1.7-.9 1.9 2.1 2.1 1.9-.9 1.7.7.7 2h3l.7-2 1.7-.7 1.9.9 2.1-2.1-.9-1.9.7-1.7Z" transform="scale(.82) translate(2.6 2.6)" /></>,
    info: <><circle cx="12" cy="12" r="9" /><path d="M12 11v6" /><path d="M12 7.5h.01" /></>,
    folder: <><path d="M3 6.5h7l2 2h9v10H3z" /><path d="M3 8.5h18" /></>,
    shield: <><path d="M12 3 5 6v5c0 4.6 2.8 8 7 10 4.2-2 7-5.4 7-10V6z" /><path d="m9 12 2 2 4-4" /></>,
  };

  return <svg aria-hidden="true" className="icon" viewBox="0 0 24 24">{paths[name]}</svg>;
}

function EmptyState({ kind, t }: { kind: "downloads" | "completed"; t: Translator }) {
  const titleKey = kind === "downloads" ? "downloads.emptyTitle" : "completed.emptyTitle";
  const bodyKey = kind === "downloads" ? "downloads.emptyBody" : "completed.emptyBody";
  const kickerKey = kind === "downloads" ? "downloads.emptyKicker" : "completed.emptyKicker";
  return (
    <section className="empty-stage compact-stage" aria-labelledby={`${kind}-empty-title`}>
      <div className="empty-glyph" aria-hidden="true"><Icon name={kind === "downloads" ? "arrow" : "check"} /></div>
      <p className="section-kicker">{t(kickerKey)}</p>
      <h2 id={`${kind}-empty-title`}>{t(titleKey)}</h2>
      <p>{t(bodyKey)}</p>
    </section>
  );
}

function Metric({ label, value, unit }: { label: string; value: string; unit?: string }) {
  return (
    <article className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {unit ? <small>{unit}</small> : null}
    </article>
  );
}

interface AppProps {
  searchClient?: SearchClient;
}

function App({ searchClient = desktopSearchClient }: AppProps) {
  const [page, setPage] = useState<Page>("search");
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [category, setCategory] = useState<SearchCategory>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, SearchProviderStatus>>({});
  const [searchState, setSearchState] = useState<"idle" | "searching" | "complete" | "error">("idle");
  const activeSearch = useRef<{ generation: number; requestId: string | null }>({
    generation: 0,
    requestId: null,
  });
  const t: Translator = (key) => translate(locale, key);
  const activeLabel = useMemo(
    () => t(navItems.find((item) => item.id === page)?.labelKey ?? "nav.search"),
    [locale, page],
  );
  const activeProviders = useMemo(
    () => providers.filter((provider) => category === "all" || provider.categories.includes(category)),
    [category],
  );

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "app.name");
  }, [locale]);

  useEffect(() => () => {
    activeSearch.current.generation += 1;
    const requestId = activeSearch.current.requestId;
    if (requestId) void searchClient.cancel(requestId).catch(() => undefined);
  }, [searchClient]);

  const applySearchEvents = (events: SearchIpcEvent[]) => {
    const incomingResults: SearchResult[] = [];
    const incomingStatuses: SearchProviderStatus[] = [];
    for (const event of events) {
      if (event.type === "search.result") incomingResults.push(event.result);
      if (event.type === "search.provider-status") incomingStatuses.push(event.status);
      if (event.type === "search.error") {
        setSearchState("error");
        setNotice("error.searchUnavailable");
      }
    }
    if (incomingResults.length > 0) {
      setSearchResults((current) => [...current, ...incomingResults]);
    }
    if (incomingStatuses.length > 0) {
      setProviderStatuses((current) => {
        const next = { ...current };
        for (const status of incomingStatuses) next[status.providerId] = status;
        return next;
      });
    }
  };

  const cancelCurrentSearch = () => {
    activeSearch.current.generation += 1;
    const requestId = activeSearch.current.requestId;
    activeSearch.current.requestId = null;
    if (requestId) void searchClient.cancel(requestId).catch(() => undefined);
  };

  const selectCategory = (nextCategory: SearchCategory) => {
    if (nextCategory === category) return;
    cancelCurrentSearch();
    setCategory(nextCategory);
    setSearchResults([]);
    setProviderStatuses({});
    setSearchState("idle");
    setNotice(null);
  };

  const runSearch = async (value: string) => {
    const generation = activeSearch.current.generation + 1;
    const previousRequestId = activeSearch.current.requestId;
    activeSearch.current = { generation, requestId: null };
    setSearchResults([]);
    setProviderStatuses({});
    setSearchState("searching");
    setNotice(null);

    try {
      if (previousRequestId) {
        await searchClient.cancel(previousRequestId).catch(() => undefined);
      }
      if (activeSearch.current.generation !== generation) return;

      const started = await searchClient.start(value, category);
      if (activeSearch.current.generation !== generation) {
        await searchClient.cancel(started.requestId).catch(() => undefined);
        return;
      }
      activeSearch.current.requestId = started.requestId;

      let cursor = 0;
      while (activeSearch.current.generation === generation) {
        const poll = await searchClient.poll(started.requestId, cursor);
        if (activeSearch.current.generation !== generation) return;
        applySearchEvents(poll.events);
        cursor = poll.nextCursor;
        if (poll.done) {
          activeSearch.current.requestId = null;
          setSearchState((current) => current === "error" ? current : "complete");
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 40));
      }
    } catch {
      if (activeSearch.current.generation === generation) {
        activeSearch.current.requestId = null;
        setSearchState("error");
        setNotice("error.searchUnavailable");
      }
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setNotice("error.queryRequired");
      return;
    }
    void runSearch(value);
  };

  const emptyTitle = searchState === "searching"
    ? t("search.loadingTitle")
    : searchState === "complete"
      ? t("search.noResultsTitle")
      : t("search.emptyTitle");
  const emptyBody = searchState === "searching"
    ? t("search.loadingBody")
    : searchState === "complete"
      ? t("search.noResultsBody")
      : t("search.emptyBody");

  return (
    <div className="app-shell" data-theme={theme} lang={locale}>
      <aside className="sidebar" aria-label={t("nav.workspace")}>
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div><strong>{t("app.name")}</strong><small>{t("app.edition")}</small></div>
        </div>

        <nav>
          <p className="nav-caption">{t("nav.workspace")}</p>
          {navItems.map((item) => (
            <button
              className={page === item.id ? "nav-item active" : "nav-item"}
              key={item.id}
              onClick={() => { setPage(item.id); setNotice(null); }}
              type="button"
              aria-current={page === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{t(item.labelKey)}</span>
              {item.count !== undefined ? <b>{String(item.count).padStart(2, "0")}</b> : null}
            </button>
          ))}
        </nav>

        <div className="privacy-card">
          <Icon name="shield" />
          <div><strong>{t("status.localOnly")}</strong><span>{t("status.localOnlyBody")}</span></div>
        </div>
        <p className="version-label">v0.1.0 · PHASE 3.3.5</p>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="breadcrumb">{t("app.name")} /</span><strong>{activeLabel}</strong></div>
          <div className="local-status"><i /> {t("status.serviceReady")}</div>
        </header>

        <div className="page-frame" key={`${page}-${locale}`}>
          {page === "search" ? (
            <>
              <section className="search-hero" aria-labelledby="search-title">
                <div className="hero-copy">
                  <p className="section-kicker">{t("search.eyebrow")}</p>
                  <h1 id="search-title">{t("search.titleLead")}<br /><em>{t("search.titleAccent")}</em></h1>
                  <p className="hero-purpose">{t("search.purpose")}</p>
                  <p className="hero-intro">{t("search.intro")}</p>
                </div>
                <div className="signal-art" aria-hidden="true">
                  <span className="orbit orbit-one" /><span className="orbit orbit-two" />
                  <span className="signal-core"><i /><i /><i /></span>
                  <b>LOCAL<br />FIRST</b>
                </div>
              </section>

              <div className="category-strip" role="group" aria-label={t("search.categoryLabel")}>
                {searchCategories.map((item) => (
                  <button
                    aria-pressed={category === item}
                    className={category === item ? "selected" : ""}
                    key={item}
                    onClick={() => selectCategory(item)}
                    type="button"
                  >
                    <span>{t(categoryLabelKeys[item])}</span>
                    <small>{String(providers.filter((provider) => item === "all" || provider.categories.includes(item)).length).padStart(2, "0")}</small>
                  </button>
                ))}
              </div>

              <form className="search-form" onSubmit={submitSearch}>
                <Icon name="search" />
                <label className="sr-only" htmlFor="global-search">{t("search.fieldLabel")}</label>
                <input id="global-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search.placeholder")} autoComplete="off" />
                <kbd>ENTER</kbd>
                <button type="submit">{t("search.action")}<span aria-hidden="true">↗</span></button>
              </form>

              <section className="provider-line" aria-label={t("search.providers")}>
                <span>{t("search.providers")}</span>
                <div>{activeProviders.length > 0 ? activeProviders.map((provider) => {
                  const status = providerStatuses[provider.id];
                  return (
                    <b key={provider.id} data-state={status?.state ?? "idle"}>
                      <i />{provider.displayName}<small>{providerStateLabel(status?.state, t)}</small>
                    </b>
                  );
                }) : <small className="no-providers">{t("search.noProviders")}</small>}</div>
              </section>

              {searchResults.length > 0 ? (
                <section className="search-results" aria-label={t("search.results")}>
                  <header><span>{t("search.results")}</span><strong>{String(searchResults.length).padStart(2, "0")}</strong></header>
                  {searchResults.map((result) => (
                    <article className="search-result" key={result.id}>
                      <div>
                        <span className="result-source">{result.source}</span>
                        <h2>{result.title}</h2>
                        <p>{result.category ?? t("search.uncategorized")} · {formatBytes(result.sizeBytes)}</p>
                      </div>
                      <dl>
                        <div><dt>{t("result.seed")}</dt><dd>{result.seeders ?? 0}</dd></div>
                        <div><dt>{t("result.leech")}</dt><dd>{result.leechers ?? 0}</dd></div>
                      </dl>
                    </article>
                  ))}
                </section>
              ) : (
                <section className="empty-stage search-empty" aria-labelledby="search-empty-title">
                  <div className="empty-index">00</div>
                  <div>
                    <p className="section-kicker">{searchState === "searching" ? t("search.searchingKicker") : t("search.waitingKicker")}</p>
                    <h2 id="search-empty-title">{emptyTitle}</h2>
                    <p>{emptyBody}</p>
                  </div>
                  <span className="corner-mark" aria-hidden="true">⌁</span>
                </section>
              )}
            </>
          ) : null}

          {page === "downloading" ? (
            <>
              <div className="page-heading"><p className="section-kicker">{t("downloads.kicker")}</p><h1>{t("downloads.title")}</h1><span>{t("downloads.subtitle")}</span></div>
              <div className="metrics"><Metric label={t("downloads.metricTasks")} value={String(noTasks.length).padStart(2, "0")} /><Metric label={t("downloads.metricSpeed")} value="0" unit="B/s" /><Metric label={t("downloads.metricPeers")} value="00" /></div>
              <EmptyState kind="downloads" t={t} />
            </>
          ) : null}

          {page === "completed" ? (
            <>
              <div className="page-heading"><p className="section-kicker">{t("completed.kicker")}</p><h1>{t("completed.title")}</h1><span>{t("completed.subtitle")}</span></div>
              <div className="metrics"><Metric label={t("completed.metricTasks")} value="00" /><Metric label={t("completed.metricSeeding")} value="00" /><Metric label={t("completed.metricSize")} value="0" unit="B" /></div>
              <EmptyState kind="completed" t={t} />
            </>
          ) : null}

          {page === "settings" ? (
            <>
              <div className="page-heading"><p className="section-kicker">{t("settings.kicker")}</p><h1>{t("settings.title")}</h1><span>{t("settings.subtitle")}</span></div>
              <div className="settings-grid">
                <section className="setting-panel">
                  <div className="setting-icon"><Icon name="folder" /></div>
                  <div><p className="section-kicker">{t("settings.downloadKicker")}</p><h2>{t("settings.downloadTitle")}</h2><p>{t("settings.downloadBody")}</p><code>C:\Users\…\Downloads\涌流404</code></div>
                  <button type="button" onClick={() => setNotice("settings.changePending")}>{t("settings.change")}</button>
                </section>
                <section className="setting-panel theme-panel">
                  <div><p className="section-kicker">{t("settings.appearanceKicker")}</p><h2>{t("settings.appearanceTitle")}</h2><p>{t("settings.appearanceBody")}</p></div>
                  <div className="segmented" aria-label={t("settings.themeLabel")}>
                    {(["system", "light", "dark"] as const).map((item) => (
                      <button className={theme === item ? "selected" : ""} key={item} onClick={() => setTheme(item)} type="button">
                        {t(themeLabelKeys[item])}
                      </button>
                    ))}
                  </div>
                </section>
                <section className="setting-panel language-panel">
                  <div><p className="section-kicker">{t("settings.languageKicker")}</p><h2>{t("settings.languageTitle")}</h2><p>{t("settings.languageBody")}</p></div>
                  <div className="segmented" aria-label={t("settings.languageLabel")}>
                    {(["zh-CN", "en-US"] as const).map((item) => (
                      <button className={locale === item ? "selected" : ""} key={item} onClick={() => setLocale(item)} type="button">
                        {t(localeLabelKeys[item])}
                      </button>
                    ))}
                  </div>
                </section>
              </div>
            </>
          ) : null}

          {page === "about" ? (
            <>
              <div className="page-heading"><p className="section-kicker">{t("about.kicker")}</p><h1>{t("about.title")}</h1><span>{t("about.subtitle")}</span></div>
              <div className="about-grid">
                <section className="about-lead"><span className="about-number">404</span><h2>{t("about.privacyTitle")}</h2><p>{t("about.privacyBody")}</p></section>
                <section className="about-card"><p className="section-kicker">{t("about.creditsKicker")}</p><h2>{t("about.creditsTitle")}</h2><p>{t("about.creditsBody")}</p><div className="license-row"><span>TorLink</span><b>MIT</b></div><div className="license-row"><span>WebTorrent</span><b>MIT</b></div></section>
              </div>
            </>
          ) : null}
        </div>

        <div className={notice ? "toast visible" : "toast"} role="status" aria-live="polite">{notice ? t(notice) : null}</div>
      </main>
    </div>
  );
}

export default App;
