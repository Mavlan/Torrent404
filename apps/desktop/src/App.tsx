import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { zhCN } from "@torlink/i18n";
import type {
  DownloadTask,
  SearchIpcEvent,
  SearchProviderState,
  SearchProviderStatus,
  SearchResult,
} from "@torlink/protocol";
import { desktopSearchClient, type SearchClient } from "./searchClient";

type Page = "search" | "downloading" | "completed" | "settings" | "about";
type IconName = "search" | "arrow" | "check" | "settings" | "info" | "folder" | "shield";

const navItems: ReadonlyArray<{ id: Page; label: string; icon: IconName; count?: number }> = [
  { id: "search", label: zhCN["nav.search"], icon: "search" },
  { id: "downloading", label: zhCN["nav.downloading"], icon: "arrow", count: 0 },
  { id: "completed", label: zhCN["nav.completed"], icon: "check", count: 0 },
  { id: "settings", label: zhCN["nav.settings"], icon: "settings" },
  { id: "about", label: zhCN["nav.about"], icon: "info" },
];

const providers = [
  { id: "yts", displayName: "YTS" },
  { id: "nyaa", displayName: "Nyaa" },
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

function providerStateLabel(state: SearchProviderState | undefined): string {
  if (!state) return "待命";
  return {
    searching: "搜索中",
    complete: "完成",
    error: "错误",
    timeout: "超时",
    cancelled: "已取消",
  }[state];
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

function EmptyState({ kind }: { kind: "downloads" | "completed" }) {
  const title = kind === "downloads" ? zhCN["downloads.emptyTitle"] : zhCN["completed.emptyTitle"];
  const body = kind === "downloads" ? zhCN["downloads.emptyBody"] : zhCN["completed.emptyBody"];
  return (
    <section className="empty-stage compact-stage" aria-labelledby={`${kind}-empty-title`}>
      <div className="empty-glyph" aria-hidden="true"><Icon name={kind === "downloads" ? "arrow" : "check"} /></div>
      <p className="section-kicker">{kind === "downloads" ? "QUEUE / 00" : "ARCHIVE / 00"}</p>
      <h2 id={`${kind}-empty-title`}>{title}</h2>
      <p>{body}</p>
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
  const [query, setQuery] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [theme, setTheme] = useState<"system" | "light" | "dark">("system");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [providerStatuses, setProviderStatuses] = useState<Record<string, SearchProviderStatus>>({});
  const [searchState, setSearchState] = useState<"idle" | "searching" | "complete" | "error">("idle");
  const activeSearch = useRef<{ generation: number; requestId: string | null }>({
    generation: 0,
    requestId: null,
  });

  const activeLabel = useMemo(() => navItems.find((item) => item.id === page)?.label ?? "搜索", [page]);

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
        setNotice(event.error.message);
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

      const started = await searchClient.start(value);
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
        setNotice("本机搜索服务暂时不可用，请稍后重试。");
      }
    }
  };

  const submitSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = query.trim();
    if (!value) {
      setNotice("输入关键词、Magnet 或 infohash 后再试。");
      return;
    }
    void runSearch(value);
  };

  return (
    <div className="app-shell" data-theme={theme}>
      <aside className="sidebar" aria-label="主导航">
        <div className="brand-block">
          <span className="brand-mark" aria-hidden="true"><i /><i /><i /></span>
          <div><strong>{zhCN["app.name"]}</strong><small>COMMUNITY DESKTOP</small></div>
        </div>

        <nav>
          <p className="nav-caption">工作区</p>
          {navItems.map((item) => (
            <button
              className={page === item.id ? "nav-item active" : "nav-item"}
              key={item.id}
              onClick={() => { setPage(item.id); setNotice(null); }}
              type="button"
              aria-current={page === item.id ? "page" : undefined}
            >
              <Icon name={item.icon} />
              <span>{item.label}</span>
              {item.count !== undefined ? <b>{String(item.count).padStart(2, "0")}</b> : null}
            </button>
          ))}
        </nav>

        <div className="privacy-card">
          <Icon name="shield" />
          <div><strong>{zhCN["status.localOnly"]}</strong><span>无中央代理服务</span></div>
        </div>
        <p className="version-label">v0.1.0 · PHASE 3</p>
      </aside>

      <main className="workspace">
        <header className="topbar">
          <div><span className="breadcrumb">涌流 /</span><strong>{activeLabel}</strong></div>
          <div className="local-status"><i /> 本机服务准备就绪</div>
        </header>

        <div className="page-frame" key={page}>
          {page === "search" ? (
            <>
              <section className="search-hero" aria-labelledby="search-title">
                <div className="hero-copy">
                  <p className="section-kicker">{zhCN["search.eyebrow"]}</p>
                  <h1 id="search-title">从一个入口，<br /><em>抵达整个网络。</em></h1>
                  <p className="hero-intro">结果按来源增量抵达。任何单点失联，都不会让整次搜索停摆。</p>
                </div>
                <div className="signal-art" aria-hidden="true">
                  <span className="orbit orbit-one" /><span className="orbit orbit-two" />
                  <span className="signal-core"><i /><i /><i /></span>
                  <b>LOCAL<br />FIRST</b>
                </div>
              </section>

              <form className="search-form" onSubmit={submitSearch}>
                <Icon name="search" />
                <label className="sr-only" htmlFor="global-search">搜索 Torrent</label>
                <input id="global-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={zhCN["search.placeholder"]} autoComplete="off" />
                <kbd>ENTER</kbd>
                <button type="submit">{zhCN["search.action"]}<span aria-hidden="true">↗</span></button>
              </form>

              <section className="provider-line" aria-label="搜索来源">
                <span>来源矩阵</span>
                <div>{providers.map((provider) => {
                  const status = providerStatuses[provider.id];
                  return (
                    <b key={provider.id} data-state={status?.state ?? "idle"}>
                      <i />{provider.displayName}<small>{providerStateLabel(status?.state)}</small>
                    </b>
                  );
                })}</div>
              </section>

              {searchResults.length > 0 ? (
                <section className="search-results" aria-label="搜索结果">
                  <header><span>RESULT STREAM</span><strong>{String(searchResults.length).padStart(2, "0")}</strong></header>
                  {searchResults.map((result) => (
                    <article className="search-result" key={result.id}>
                      <div>
                        <span className="result-source">{result.source}</span>
                        <h2>{result.title}</h2>
                        <p>{result.category ?? "未分类"} · {formatBytes(result.sizeBytes)}</p>
                      </div>
                      <dl>
                        <div><dt>SEED</dt><dd>{result.seeders ?? 0}</dd></div>
                        <div><dt>LEECH</dt><dd>{result.leechers ?? 0}</dd></div>
                      </dl>
                    </article>
                  ))}
                </section>
              ) : (
                <section className="empty-stage search-empty" aria-labelledby="search-empty-title">
                  <div className="empty-index">00</div>
                  <div>
                    <p className="section-kicker">{searchState === "searching" ? "SEARCHING YTS + NYAA" : "WAITING FOR A QUERY"}</p>
                    <h2 id="search-empty-title">
                      {searchState === "searching"
                        ? "正在等待首批结果"
                        : searchState === "complete"
                          ? "没有找到匹配结果"
                          : zhCN["search.emptyTitle"]}
                    </h2>
                    <p>{searchState === "searching" ? "结果会在各来源返回时立即出现。" : zhCN["search.emptyBody"]}</p>
                  </div>
                  <span className="corner-mark" aria-hidden="true">⌁</span>
                </section>
              )}
            </>
          ) : null}

          {page === "downloading" ? (
            <>
              <div className="page-heading"><p className="section-kicker">ACTIVE TRANSFERS</p><h1>下载中</h1><span>实时查看任务状态，不打扰正在发生的传输。</span></div>
              <div className="metrics"><Metric label="活动任务" value={String(noTasks.length).padStart(2, "0")} /><Metric label="下载速度" value="0" unit="B/s" /><Metric label="连接 Peers" value="00" /></div>
              <EmptyState kind="downloads" />
            </>
          ) : null}

          {page === "completed" ? (
            <>
              <div className="page-heading"><p className="section-kicker">LOCAL ARCHIVE</p><h1>已完成</h1><span>打开保存位置，或随时停止继续分享。</span></div>
              <div className="metrics"><Metric label="完成任务" value="00" /><Metric label="正在做种" value="00" /><Metric label="累计体积" value="0" unit="B" /></div>
              <EmptyState kind="completed" />
            </>
          ) : null}

          {page === "settings" ? (
            <>
              <div className="page-heading"><p className="section-kicker">PREFERENCES</p><h1>设置</h1><span>所有偏好保存在这台设备上。</span></div>
              <div className="settings-grid">
                <section className="setting-panel">
                  <div className="setting-icon"><Icon name="folder" /></div>
                  <div><p className="section-kicker">DOWNLOAD DIRECTORY</p><h2>默认下载目录</h2><p>下载文件将保存到系统 Downloads 下的“涌流”目录。</p><code>C:\Users\…\Downloads\涌流</code></div>
                  <button type="button" onClick={() => setNotice("原生目录选择器将在 Phase 3 接入。")}>更改</button>
                </section>
                <section className="setting-panel theme-panel">
                  <div><p className="section-kicker">APPEARANCE</p><h2>外观</h2><p>默认跟随 Windows，也可以固定当前主题。</p></div>
                  <div className="segmented" aria-label="主题">
                    {(["system", "light", "dark"] as const).map((item) => <button className={theme === item ? "selected" : ""} key={item} onClick={() => setTheme(item)} type="button">{{ system: "跟随系统", light: "浅色", dark: "深色" }[item]}</button>)}
                  </div>
                </section>
              </div>
            </>
          ) : null}

          {page === "about" ? (
            <>
              <div className="page-heading"><p className="section-kicker">ABOUT THIS BUILD</p><h1>关于涌流</h1><span>独立、透明、保持边界。</span></div>
              <div className="about-grid">
                <section className="about-lead"><span className="about-number">0.1</span><h2>不是匿名工具，<br />也不假装是。</h2><p>BitTorrent peers 可以看到你的公网 IP。涌流不提供 Tor、VPN 或任何规避网络安全机制的功能。</p></section>
                <section className="about-card"><p className="section-kicker">OPEN SOURCE CREDITS</p><h2>站在成熟项目之上</h2><p>本项目受 TorLink 启发，下载能力由 WebTorrent 生态提供。涌流是独立社区项目，并非 TorLink 官方版本。</p><div className="license-row"><span>TorLink</span><b>MIT</b></div><div className="license-row"><span>WebTorrent</span><b>MIT</b></div></section>
              </div>
            </>
          ) : null}
        </div>

        <div className={notice ? "toast visible" : "toast"} role="status" aria-live="polite">{notice}</div>
      </main>
    </div>
  );
}

export default App;
