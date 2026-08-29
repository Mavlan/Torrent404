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
  type IpcErrorCode,
  type SearchCategory,
  type SearchIpcEvent,
  type SearchProviderDescriptor,
  type SearchProviderState,
  type SearchProviderStatus,
  type SearchResult,
} from "@torlink/protocol";
import { desktopDownloadClient, type DownloadClient } from "./downloadClient";
import { isMagnetInput } from "./magnetInput";
import { loadProviderPreferences, saveProviderPreferences } from "./providerPreferences";
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

function interpolate(template: string, values: Record<string, string | number>): string {
  return Object.entries(values).reduce(
    (message, [key, value]) => message.replace(`{${key}}`, String(value)),
    template,
  );
}

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

function formatEta(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value) || value < 0) return "—";
  const seconds = Math.ceil(value);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.ceil(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function progressPercent(value: number): string {
  const percent = Math.min(100, Math.max(0, value * 100));
  return `${percent > 0 && percent < 100 ? percent.toFixed(1) : percent.toFixed(0)}%`;
}

function providerStateLabel(state: SearchProviderState | undefined, t: Translator): string {
  if (!state) return t("provider.ready");
  const labelKeys: Record<SearchProviderState, MessageKey> = {
    searching: "provider.searching",
    complete: "provider.complete",
    error: "provider.error",
    timeout: "provider.timeout",
    cancelled: "provider.cancelled",
  };
  return t(labelKeys[state]);
}

function taskStatusLabel(task: DownloadTask, t: Translator): string {
  const labels = {
    queued: "task.status.queued",
    downloading: "task.status.downloading",
    paused: "task.status.paused",
    completed: "task.status.completed",
    seeding: "task.status.seeding",
    error: "task.status.error",
  } as const satisfies Record<DownloadTask["status"], MessageKey>;
  return t(labels[task.status]);
}

function downloadErrorLabel(code: IpcErrorCode): MessageKey {
  const labels: Partial<Record<IpcErrorCode, MessageKey>> = {
    invalid_magnet: "error.invalidMagnet",
    duplicate_torrent: "error.duplicateTorrent",
    download_directory_unavailable: "error.downloadDirectoryUnavailable",
    engine_add_failed: "error.engineAddFailed",
    download_task_not_found: "error.downloadTaskNotFound",
    invalid_download_task_transition: "error.invalidDownloadTaskTransition",
    engine_control_failed: "error.engineControlFailed",
  };
  return labels[code] ?? "error.downloadUnavailable";
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
  downloadClient?: DownloadClient;
}

function App({
  searchClient = desktopSearchClient,
  downloadClient = desktopDownloadClient,
}: AppProps) {
  const [page, setPage] = useState<Page>("search");
  const [locale, setLocale] = useState<Locale>(DEFAULT_LOCALE);
  const [category, setCategory] = useState<SearchCategory>("all");
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<MessageKey | null>(null);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, SearchProviderStatus>>({});
  const [providers, setProviders] = useState<SearchProviderDescriptor[]>([]);
  const [providersLoaded, setProvidersLoaded] = useState(false);
  const [searchState, setSearchState] = useState<"idle" | "searching" | "complete" | "error">("idle");
  const [downloadTasks, setDownloadTasks] = useState<DownloadTask[]>([]);
  const [addingMagnet, setAddingMagnet] = useState(false);
  const [addingResultIds, setAddingResultIds] = useState<Set<string>>(new Set());
  const [controllingTaskIds, setControllingTaskIds] = useState<Set<string>>(new Set());
  const [downloadDirectory, setDownloadDirectory] = useState<string | null>(null);
  const [selectingDownloadDirectory, setSelectingDownloadDirectory] = useState(false);
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
    () => providers.filter(
      (provider) => provider.enabled && (category === "all" || provider.categories.includes(category)),
    ),
    [category, providers],
  );
  const magnetMode = isMagnetInput(query);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = translate(locale, "app.name");
  }, [locale]);

  useEffect(() => {
    let active = true;
    void searchClient.providers().then(
      ({ providers: availableProviders }) => {
        if (!active) return;
        const saved = loadProviderPreferences();
        setProviders(availableProviders.map((provider) => ({
          ...provider,
          enabled: saved[provider.providerId] ?? provider.enabled,
        })));
        setProvidersLoaded(true);
      },
      () => {
        if (!active) return;
        setProvidersLoaded(true);
        setNotice("error.searchUnavailable");
      },
    );
    return () => {
      active = false;
    };
  }, [searchClient]);

  useEffect(() => {
    let active = true;
    void downloadClient.directory().then(
      (directory) => { if (active) setDownloadDirectory(directory); },
      () => undefined,
    );
    return () => { active = false; };
  }, [downloadClient]);

  useEffect(() => () => {
    activeSearch.current.generation += 1;
    const requestId = activeSearch.current.requestId;
    if (requestId) void searchClient.cancel(requestId).catch(() => undefined);
  }, [searchClient]);

  useEffect(() => {
    if (page !== "downloading" && page !== "completed") return;
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const poll = async () => {
      try {
        const response = await downloadClient.list();
        if (active) setDownloadTasks(response.tasks);
      } catch {
        // Keep the last known task snapshot during a transient local IPC failure.
      } finally {
        if (active) timer = setTimeout(() => void poll(), 750);
      }
    };
    void poll();
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [downloadClient, page]);

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
    setCategory(nextCategory);
    const value = query.trim();
    const nextProviders = providers.filter(
      (provider) => provider.enabled
        && (nextCategory === "all" || provider.categories.includes(nextCategory)),
    );
    if (value && !isMagnetInput(value) && providersLoaded && nextProviders.length > 0) {
      void runSearch(value, nextCategory);
      return;
    }
    cancelCurrentSearch();
    setSearchResults([]);
    setProviderStatuses({});
    setSearchState("idle");
    setNotice(null);
  };

  const runSearch = async (value: string, searchCategory = category) => {
    const searchProviders = providers.filter(
      (provider) => provider.enabled
        && (searchCategory === "all" || provider.categories.includes(searchCategory)),
    );
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

      const started = await searchClient.start(
        value,
        searchCategory,
        searchProviders.map((provider) => provider.providerId),
      );
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
    if (isMagnetInput(value)) {
      void addMagnetDownload(value);
      return;
    }
    if (!providersLoaded || activeProviders.length === 0) return;
    void runSearch(value);
  };

  const addMagnetDownload = async (magnet: string) => {
    if (addingMagnet) return;
    cancelCurrentSearch();
    setAddingMagnet(true);
    setNotice(null);
    try {
      const response = await downloadClient.add({ magnet });
      if (!response.ok) {
        setNotice(downloadErrorLabel(response.error.code));
        return;
      }
      setDownloadTasks((current) => current.some((task) => task.id === response.result.taskId)
        ? current
        : [...current, response.result.task]);
      setPage("downloading");
      setNotice("download.added");
    } catch {
      setNotice("error.downloadUnavailable");
    } finally {
      setAddingMagnet(false);
    }
  };

  const addDownload = async (result: SearchResult) => {
    if (!result.magnet || addingResultIds.has(result.id)) return;
    setAddingResultIds((current) => new Set(current).add(result.id));
    setNotice(null);
    try {
      const response = await downloadClient.add({
        magnet: result.magnet,
        name: result.title,
        ...(result.sizeBytes === undefined ? {} : { total: result.sizeBytes }),
      });
      if (!response.ok) {
        setNotice(downloadErrorLabel(response.error.code));
        return;
      }
      setDownloadTasks((current) => current.some((task) => task.id === response.result.taskId)
        ? current
        : [...current, response.result.task]);
      setPage("downloading");
      setNotice("download.added");
    } catch {
      setNotice("error.downloadUnavailable");
    } finally {
      setAddingResultIds((current) => {
        const next = new Set(current);
        next.delete(result.id);
        return next;
      });
    }
  };

  const controlDownload = async (
    task: DownloadTask,
    operation: "pause" | "resume" | "startSeeding" | "stopSeeding" | "remove",
  ) => {
    if (controllingTaskIds.has(task.id)) return;
    if (operation === "remove" && !window.confirm(t("downloads.removeConfirm"))) return;
    setControllingTaskIds((current) => new Set(current).add(task.id));
    setNotice(null);
    try {
      const response = await downloadClient[operation](task.id);
      if (!response.ok) {
        setNotice(downloadErrorLabel(response.error.code));
        return;
      }
      if (response.command === "download.remove") {
        setDownloadTasks((current) => current.filter((item) => item.id !== task.id));
        setNotice("download.removed");
      } else {
        setDownloadTasks((current) => current.map((item) => (
          item.id === task.id ? response.result.task : item
        )));
        setNotice(
          operation === "pause"
            ? "download.paused"
            : operation === "resume"
              ? "download.resumed"
              : operation === "startSeeding"
                ? "download.seedingStarted"
                : "download.seedingStopped",
        );
      }
    } catch {
      setNotice("error.downloadUnavailable");
    } finally {
      setControllingTaskIds((current) => {
        const next = new Set(current);
        next.delete(task.id);
        return next;
      });
    }
  };

  const toggleProvider = (providerId: string) => {
    cancelCurrentSearch();
    const nextProviders = providers.map((provider) => (
      provider.providerId === providerId ? { ...provider, enabled: !provider.enabled } : provider
    ));
    setProviders(nextProviders);
    saveProviderPreferences(Object.fromEntries(
      nextProviders.map((provider) => [provider.providerId, provider.enabled]),
    ));
    setSearchResults([]);
    setProviderStatuses({});
    setSearchState("idle");
    setNotice(null);
  };

  const chooseDownloadDirectory = async () => {
    if (selectingDownloadDirectory) return;
    setSelectingDownloadDirectory(true);
    setNotice(null);
    try {
      const selected = await downloadClient.selectDirectory(downloadDirectory ?? undefined);
      if (selected) {
        setDownloadDirectory(selected);
        setNotice("settings.downloadUpdated");
      }
    } catch {
      setNotice("error.downloadDirectoryUnavailable");
    } finally {
      setSelectingDownloadDirectory(false);
    }
  };

  const providerCountFor = (item: SearchCategory): number => providers.filter(
    (provider) => provider.enabled && (item === "all" || provider.categories.includes(item)),
  ).length;
  const providerCountLabel = (count: number): string => count === 0
    ? t("category.sourceNone")
    : count === 1
      ? t("category.sourceOne")
      : interpolate(t("category.sourceMany"), { count });
  const categoryName = t(categoryLabelKeys[category]);
  const hasNoSources = providersLoaded && activeProviders.length === 0;
  const emptyTitle = hasNoSources
    ? interpolate(t("search.noSourceTitle"), { category: categoryName })
    : searchState === "searching"
      ? t("search.loadingTitle")
      : searchState === "complete"
        ? t("search.noResultsTitle")
        : t("search.emptyTitle");
  const emptyBody = hasNoSources
    ? t("search.noSourceBody")
    : searchState === "searching"
      ? t("search.loadingBody")
      : searchState === "complete"
        ? t("search.noResultsBody")
        : t("search.emptyBody");
  const activeTasks = downloadTasks.filter((task) => !["completed", "seeding"].includes(task.status));
  const completedTasks = downloadTasks.filter((task) => ["completed", "seeding"].includes(task.status));
  const seedingTasks = completedTasks.filter((task) => task.status === "seeding");
  const activeDownloadSpeed = activeTasks.reduce((sum, task) => sum + task.downloadSpeed, 0);
  const connectedPeers = activeTasks.reduce((sum, task) => sum + (task.peers ?? 0), 0);
  const completedSize = completedTasks.reduce((sum, task) => sum + task.total, 0);

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
              {item.count !== undefined ? <b>{String(
                item.id === "downloading"
                  ? activeTasks.length
                  : item.id === "completed"
                    ? completedTasks.length
                    : item.count,
              ).padStart(2, "0")}</b> : null}
            </button>
          ))}
        </nav>

        <div className="privacy-card">
          <Icon name="shield" />
          <div><strong>{t("status.localOnly")}</strong><span>{t("status.localOnlyBody")}</span></div>
        </div>
        <p className="version-label">v0.1.0 · RC</p>
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
                    data-empty={providersLoaded && providerCountFor(item) === 0 ? "true" : "false"}
                    key={item}
                    onClick={() => selectCategory(item)}
                    type="button"
                  >
                    <span>{t(categoryLabelKeys[item])}</span>
                    <small>· {providersLoaded ? providerCountLabel(providerCountFor(item)) : "…"}</small>
                  </button>
                ))}
              </div>

              <form className="search-form" onSubmit={submitSearch}>
                <Icon name="search" />
                <label className="sr-only" htmlFor="global-search">{t("search.fieldLabel")}</label>
                <input id="global-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("search.placeholder")} autoComplete="off" />
                <kbd>ENTER</kbd>
                <button
                  data-mode={magnetMode ? "magnet" : "search"}
                  disabled={addingMagnet || (!magnetMode && (!providersLoaded || activeProviders.length === 0))}
                  type="submit"
                >
                  {addingMagnet ? t("search.addingDownload") : t(magnetMode ? "search.addDownload" : "search.action")}
                  <span aria-hidden="true">↗</span>
                </button>
              </form>
              <p className="magnet-hint">{t("search.magnetHint")}</p>

              <section className="source-panel" aria-label={t("search.sourcesTitle")}>
                <header>
                  <h2>{t("search.sourcesTitle")}</h2>
                  <strong>{providersLoaded
                    ? interpolate(t("search.sourcesEnabled"), {
                      enabled: providers.filter((provider) => provider.enabled).length,
                      total: providers.length,
                    })
                    : "…"}</strong>
                </header>
                <div className="source-chips">
                  {!providersLoaded ? <p className="source-message">{t("search.sourcesLoading")}</p> : null}
                  {providers.map((provider) => {
                    const status = providerStatuses[provider.providerId];
                    const detailedCategories = provider.categories
                      .map((item) => t(categoryLabelKeys[item]))
                      .join(" / ");
                    const compactCategories = provider.providerId === "knaben"
                      ? t("search.allCategories")
                      : detailedCategories;
                    const state = provider.enabled ? status?.state ?? "ready" : "disabled";
                    return (
                      <article
                        className="source-chip"
                        data-state={state}
                        key={provider.providerId}
                        title={`${provider.displayName} · ${detailedCategories}`}
                      >
                        <i aria-hidden="true" />
                        <strong>{provider.displayName}</strong>
                        <span>· {compactCategories}</span>
                        <em>{provider.enabled
                          ? providerStateLabel(status?.state, t)
                          : t("settings.sourceDisabled")}</em>
                      </article>
                    );
                  })}
                </div>
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
                      <button
                        className="result-download"
                        disabled={!result.magnet || addingResultIds.has(result.id)}
                        onClick={() => void addDownload(result)}
                        title={result.magnet ? t("result.download") : t("result.downloadUnavailable")}
                        type="button"
                      >
                        {addingResultIds.has(result.id) ? t("result.adding") : t("result.download")}
                      </button>
                    </article>
                  ))}
                </section>
              ) : (
                <section className="empty-stage search-empty" aria-labelledby="search-empty-title">
                  <div className="empty-index">{hasNoSources ? "—" : "00"}</div>
                  <div>
                    <p className="section-kicker">{hasNoSources ? t("search.sourcesTitle") : searchState === "searching" ? t("search.searchingKicker") : t("search.waitingKicker")}</p>
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
              <div className="metrics"><Metric label={t("downloads.metricTasks")} value={String(activeTasks.length).padStart(2, "0")} /><Metric label={t("downloads.metricSpeed")} value={formatBytes(activeDownloadSpeed)} unit="/s" /><Metric label={t("downloads.metricPeers")} value={String(connectedPeers).padStart(2, "0")} /></div>
              {activeTasks.length === 0 ? <EmptyState kind="downloads" t={t} /> : (
                <section className="download-task-list" aria-label={t("downloads.taskList")}>
                  {activeTasks.map((task) => (
                    <article className="download-task" key={task.id}>
                      <div className="task-summary">
                        <span>{taskStatusLabel(task, t)}</span><h2>{task.name}</h2>
                        <div className="task-progress-heading"><small>{t("downloads.progress")}</small><strong>{progressPercent(task.progress)}</strong></div>
                        <div aria-label={t("downloads.progress")} aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(task.progress * 100)} className="task-progress" role="progressbar"><i style={{ width: progressPercent(task.progress) }} /></div>
                        <dl className="task-stats">
                          <div><dt>{t("downloads.transferred")}</dt><dd>{formatBytes(task.downloaded)} / {task.total > 0 ? formatBytes(task.total) : t("downloads.unknownTotal")}</dd></div>
                          <div><dt>{t("downloads.downloadSpeed")}</dt><dd>{formatBytes(task.status === "paused" ? 0 : task.downloadSpeed)}/s</dd></div>
                          <div><dt>{t("downloads.uploadSpeed")}</dt><dd>{formatBytes(task.status === "paused" ? 0 : task.uploadSpeed)}/s</dd></div>
                          <div><dt>{t("downloads.eta")}</dt><dd>{task.status === "paused" ? "—" : formatEta(task.etaSeconds)}</dd></div>
                          <div><dt>{t("downloads.peers")}</dt><dd>{task.peers ?? 0}</dd></div>
                        </dl>
                        {task.status === "error" ? <p className="task-error">{t("downloads.taskError")}</p> : null}
                      </div>
                      <div className="task-actions">
                        <div className="task-identity"><small>{t("downloads.taskId")}</small><code>{task.id}</code></div>
                        <div className="task-controls">
                          {task.status === "paused" ? (
                            <button disabled={controllingTaskIds.has(task.id)} onClick={() => void controlDownload(task, "resume")} type="button">{t("downloads.resume")}</button>
                          ) : ["queued", "downloading"].includes(task.status) ? (
                            <button disabled={controllingTaskIds.has(task.id)} onClick={() => void controlDownload(task, "pause")} type="button">{t("downloads.pause")}</button>
                          ) : null}
                          <button className="remove" disabled={controllingTaskIds.has(task.id)} onClick={() => void controlDownload(task, "remove")} type="button">{t("downloads.remove")}</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              )}
            </>
          ) : null}

          {page === "completed" ? (
            <>
              <div className="page-heading"><p className="section-kicker">{t("completed.kicker")}</p><h1>{t("completed.title")}</h1><span>{t("completed.subtitle")}</span></div>
              <div className="metrics"><Metric label={t("completed.metricTasks")} value={String(completedTasks.length).padStart(2, "0")} /><Metric label={t("completed.metricSeeding")} value={String(seedingTasks.length).padStart(2, "0")} /><Metric label={t("completed.metricSize")} value={formatBytes(completedSize)} /></div>
              {completedTasks.length === 0 ? <EmptyState kind="completed" t={t} /> : (
                <section className="download-task-list" aria-label={t("completed.title")}>
                  {completedTasks.map((task) => (
                    <article className="download-task" key={task.id}>
                      <div className="task-summary">
                        <span>{taskStatusLabel(task, t)}</span><h2>{task.name}</h2>
                        <div className="task-progress-heading"><small>{t("downloads.progress")}</small><strong>{progressPercent(task.progress)}</strong></div>
                        <div aria-label={t("downloads.progress")} aria-valuemax={100} aria-valuemin={0} aria-valuenow={Math.round(task.progress * 100)} className="task-progress" role="progressbar"><i style={{ width: progressPercent(task.progress) }} /></div>
                        <dl className="task-stats">
                          <div><dt>{t("downloads.transferred")}</dt><dd>{formatBytes(task.downloaded)} / {formatBytes(task.total)}</dd></div>
                          <div><dt>{t("downloads.uploadSpeed")}</dt><dd>{formatBytes(task.status === "seeding" ? task.uploadSpeed : 0)}/s</dd></div>
                          <div><dt>{t("downloads.peers")}</dt><dd>{task.status === "seeding" ? task.peers ?? 0 : 0}</dd></div>
                        </dl>
                      </div>
                      <div className="task-actions">
                        <div className="task-identity"><small>{t("downloads.taskId")}</small><code>{task.id}</code></div>
                        <div className="task-controls">
                          {task.status === "seeding" ? (
                            <button disabled={controllingTaskIds.has(task.id)} onClick={() => void controlDownload(task, "stopSeeding")} type="button">{t("completed.stopSeeding")}</button>
                          ) : (
                            <button disabled={controllingTaskIds.has(task.id)} onClick={() => void controlDownload(task, "startSeeding")} type="button">{t("completed.startSeeding")}</button>
                          )}
                          <button className="remove" disabled={controllingTaskIds.has(task.id)} onClick={() => void controlDownload(task, "remove")} type="button">{t("downloads.remove")}</button>
                        </div>
                      </div>
                    </article>
                  ))}
                </section>
              )}
            </>
          ) : null}

          {page === "settings" ? (
            <>
              <div className="page-heading"><p className="section-kicker">{t("settings.kicker")}</p><h1>{t("settings.title")}</h1><span>{t("settings.subtitle")}</span></div>
              <div className="settings-grid">
                <section className="setting-panel">
                  <div className="setting-icon"><Icon name="folder" /></div>
                  <div><p className="section-kicker">{t("settings.downloadKicker")}</p><h2>{t("settings.downloadTitle")}</h2><p>{t("settings.downloadBody")}</p><code>{downloadDirectory ?? "C:\\Users\\…\\Downloads\\Torrent404"}</code></div>
                  <button disabled={selectingDownloadDirectory} onClick={() => void chooseDownloadDirectory()} type="button">
                    {t(selectingDownloadDirectory
                      ? "settings.downloadChoosing"
                      : "settings.downloadChoose")}
                  </button>
                </section>
                <section className="setting-panel source-settings-panel">
                  <div>
                    <p className="section-kicker">{t("settings.sourcesKicker")}</p>
                    <h2>{t("settings.sourcesTitle")}</h2>
                    <p>{t("settings.sourcesBody")}</p>
                  </div>
                  <div className="settings-source-list">
                    {!providersLoaded ? <span>{t("search.sourcesLoading")}</span> : null}
                    {providers.map((provider) => {
                      const isBeta = provider.providerId === "knaben";
                      const stateLabel = t(provider.enabled
                        ? "settings.sourceEnabled"
                        : "settings.sourceDisabled");
                      const categoryLabel = provider.categories
                        .map((item) => t(categoryLabelKeys[item]))
                        .join(" / ");
                      const details = `${categoryLabel}${isBeta ? ` · ${t("settings.sourceBeta")}` : ""} · ${stateLabel}`;
                      return (
                        <article key={provider.providerId}>
                          <div>
                            <strong>{provider.displayName}</strong>
                            <small>{details}</small>
                          </div>
                          <button
                            aria-checked={provider.enabled}
                            aria-label={isBeta
                              ? `${provider.displayName} · ${details}`
                              : `${provider.displayName} · ${stateLabel}`}
                            className={provider.enabled ? "source-toggle enabled" : "source-toggle"}
                            onClick={() => toggleProvider(provider.providerId)}
                            role="switch"
                            type="button"
                          ><i /></button>
                        </article>
                      );
                    })}
                  </div>
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
                <section className="about-card"><p className="section-kicker">{t("about.creditsKicker")}</p><h2>{t("about.creditsTitle")}</h2><p>{t("about.creditsBody")}</p><div className="license-row"><span>{t("about.versionLabel")}</span><b>0.1.0</b></div><div className="license-row"><span>TorLink</span><b>MIT</b></div><div className="license-row"><span>WebTorrent</span><b>MIT</b></div></section>
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
