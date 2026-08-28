import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { DownloadClient } from "./downloadClient";
import type { SearchClient } from "./searchClient";

const providerResult = {
  providers: [
    { providerId: "yts", displayName: "YTS", categories: ["movies"], enabled: true },
    { providerId: "nyaa", displayName: "Nyaa", categories: ["anime"], enabled: true },
  ],
} as const;

function shellClient(): SearchClient {
  return {
    providers: vi.fn().mockResolvedValue(providerResult),
    start: vi.fn().mockRejectedValue(new Error("search not expected")),
    poll: vi.fn().mockRejectedValue(new Error("poll not expected")),
    cancel: vi.fn().mockResolvedValue({ requestId: "none", cancelled: false }),
  };
}

function shellDownloadClient(): DownloadClient {
  return {
    add: vi.fn().mockRejectedValue(new Error("download not expected")),
    directory: vi.fn().mockResolvedValue("C:\\Users\\Tester\\Downloads\\涌流404"),
  };
}

describe("desktop shell", () => {
  it("renders human-readable category counts from provider descriptors", async () => {
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    expect(screen.getByText("涌流404")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /从一个入口/ })).toBeInTheDocument();
    expect(screen.getByText("搜索电影、剧集、动漫、游戏和其他 Torrent 资源")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入关键词、Magnet 或 infohash")).toBeInTheDocument();
    expect(screen.getByText("无中央代理服务")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "搜索分类" })).toBeInTheDocument();
    for (const label of [
      /全部.*2 来源/,
      /电影.*1 来源/,
      /剧集.*暂无/,
      /动漫.*1 来源/,
      /游戏.*暂无/,
      /软件.*暂无/,
    ]) {
      expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
    }
    expect(screen.getByRole("region", { name: "搜索来源" })).toBeInTheDocument();
    expect(screen.getAllByText("就绪")).toHaveLength(2);
  });

  it("navigates to downloads and shows its empty state", async () => {
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: /下载中/ }));
    expect(screen.getByRole("heading", { name: "下载队列安静待命" })).toBeInTheDocument();
  });

  it("states the privacy boundary in About", async () => {
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByRole("heading", { name: "关于涌流404" })).toBeInTheDocument();
    expect(screen.getByText(/peers 可以看到你的公网 IP/)).toBeInTheDocument();
    expect(screen.getByText(/并非 TorLink 官方版本/)).toBeInTheDocument();
  });

  it("switches the complete shell to English without restarting", async () => {
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.title).toBe("涌流404");
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Search movies, TV, anime, games and other torrents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Movies/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /TV.*None/ })).toBeInTheDocument();
    expect(screen.getAllByText("Ready")).toHaveLength(2);
    const searchButtons = screen.getAllByRole("button", { name: "Search" });
    await user.click(searchButtons.at(-1)!);
    expect(screen.getByText("Enter keywords, a magnet, or an infohash first.")).toBeInTheDocument();
  });

  it("shows a category-specific empty state and never searches without sources", async () => {
    const client = shellClient();
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={shellDownloadClient()} />);

    await user.click(await screen.findByRole("button", { name: /剧集.*暂无/ }));

    expect(screen.getByRole("heading", { name: "当前暂无剧集搜索来源" })).toBeInTheDocument();
    expect(screen.getByText("更多搜索来源将在后续版本加入。")).toBeInTheDocument();
    const searchButton = screen.getByRole("button", { name: /^开始搜索/ });
    expect(searchButton).toBeDisabled();
    await user.click(searchButton);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("shows current built-in sources in Settings without management controls", async () => {
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "内置搜索来源" })).toBeInTheDocument();
    expect(screen.getByText("YTS")).toBeInTheDocument();
    expect(screen.getByText("Nyaa")).toBeInTheDocument();
    expect(screen.getAllByText("内置 · 已启用")).toHaveLength(2);
  });

  it("renders YTS and Nyaa results incrementally from IPC", async () => {
    const requestId = "search-ui-results";
    const client: SearchClient = {
      providers: vi.fn().mockResolvedValue(providerResult),
      start: vi.fn().mockResolvedValue({ requestId }),
      poll: vi.fn()
        .mockResolvedValueOnce({
          requestId,
          events: [
            {
              type: "search.provider-status",
              requestId,
              status: { providerId: "yts", displayName: "YTS", state: "searching", resultCount: 0 },
            },
            {
              type: "search.result",
              requestId,
              result: {
                id: "yts:one",
                title: "Public Domain Film",
                source: "yts",
                sizeBytes: 1_048_576,
                seeders: 12,
                leechers: 3,
                magnet: "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01",
              },
            },
          ],
          nextCursor: 2,
          done: false,
        })
        .mockResolvedValueOnce({
          requestId,
          events: [
            {
              type: "search.result",
              requestId,
              result: {
                id: "nyaa:one",
                title: "Open Animation Test",
                source: "nyaa",
                sizeBytes: 1_610_612_736,
                seeders: 42,
                leechers: 7,
                magnet: "magnet:?xt=urn:btih:0123456789abcdef0123456789abcdef01234567",
              },
            },
            {
              type: "search.provider-status",
              requestId,
              status: { providerId: "nyaa", displayName: "Nyaa", state: "complete", resultCount: 1 },
            },
            { type: "search.complete", requestId, cancelled: false },
          ],
          nextCursor: 5,
          done: true,
        }),
      cancel: vi.fn().mockResolvedValue({ requestId, cancelled: true }),
    };
    const downloads: DownloadClient = {
      add: vi.fn().mockResolvedValue({
        ok: true,
        protocolVersion: 1,
        command: "download.add",
        result: {
          taskId: "download-public-domain",
          task: {
            id: "download-public-domain",
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            name: "Public Domain Film",
            status: "downloading",
            progress: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
            downloaded: 0,
            total: 1_048_576,
            savePath: "C:\\Users\\Tester\\Downloads\\涌流404",
          },
        },
      }),
      directory: vi.fn().mockResolvedValue("C:\\Users\\Tester\\Downloads\\涌流404"),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={downloads} />);

    await user.type(screen.getByPlaceholderText("输入关键词、Magnet 或 infohash"), "open media");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));

    expect(await screen.findByRole("heading", { name: "Public Domain Film" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Open Animation Test" })).toBeInTheDocument();
    expect(screen.getByText(/1\.0 MiB/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 GiB/)).toBeInTheDocument();
    expect(client.start).toHaveBeenCalledWith("open media", "all");
    expect(client.poll).toHaveBeenNthCalledWith(1, requestId, 0);
    expect(client.poll).toHaveBeenNthCalledWith(2, requestId, 2);

    await user.click(screen.getAllByRole("button", { name: "下载" })[0]!);
    expect(downloads.add).toHaveBeenCalledWith({
      magnet: "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01",
      name: "Public Domain Film",
      total: 1_048_576,
    });
    expect(await screen.findByRole("heading", { name: "Public Domain Film" })).toBeInTheDocument();
    expect(screen.getByText("download-public-domain")).toBeInTheDocument();
    expect(screen.getByText("下载任务已创建，可在“下载中”查看。")).toBeInTheDocument();
  });

  it("disables results without a magnet and localizes structured download errors", async () => {
    const requestId = "search-download-errors";
    const client: SearchClient = {
      providers: vi.fn().mockResolvedValue(providerResult),
      start: vi.fn().mockResolvedValue({ requestId }),
      poll: vi.fn().mockResolvedValue({
        requestId,
        events: [
          {
            type: "search.result",
            requestId,
            result: { id: "missing", title: "Missing Magnet", source: "yts" },
          },
          {
            type: "search.result",
            requestId,
            result: { id: "duplicate", title: "Duplicate Fixture", source: "nyaa", magnet: `magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01` },
          },
          { type: "search.complete", requestId, cancelled: false },
        ],
        nextCursor: 3,
        done: true,
      }),
      cancel: vi.fn().mockResolvedValue({ requestId, cancelled: true }),
    };
    const downloads: DownloadClient = {
      add: vi.fn().mockResolvedValue({
        ok: false,
        protocolVersion: 1,
        error: { code: "duplicate_torrent", message: "internal task identity" },
      }),
      directory: vi.fn().mockResolvedValue("C:\\Downloads\\涌流404"),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={downloads} />);

    await user.type(screen.getByPlaceholderText("输入关键词、Magnet 或 infohash"), "fixture");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));
    const buttons = await screen.findAllByRole("button", { name: "下载" });
    expect(buttons[0]).toBeDisabled();
    expect(buttons[0]).toHaveAttribute("title", "该结果没有可用的 Magnet，暂时无法下载");
    await user.click(buttons[1]!);
    expect(await screen.findByText("这个 Torrent 已在下载列表中。")).toBeInTheDocument();
    expect(screen.queryByText("internal task identity")).not.toBeInTheDocument();

    vi.mocked(downloads.add).mockRejectedValueOnce(new Error("private sidecar stack"));
    await user.click(buttons[1]!);
    expect(await screen.findByText("本机下载服务暂时不可用，请稍后重试。")).toBeInTheDocument();
    expect(screen.queryByText("private sidecar stack")).not.toBeInTheDocument();
  });

  it("cancels the prior IPC search when a new query starts", async () => {
    let finishOldPoll!: (value: Awaited<ReturnType<SearchClient["poll"]>>) => void;
    const oldPoll = new Promise<Awaited<ReturnType<SearchClient["poll"]>>>((resolve) => {
      finishOldPoll = resolve;
    });
    const client: SearchClient = {
      providers: vi.fn().mockResolvedValue(providerResult),
      start: vi.fn()
        .mockResolvedValueOnce({ requestId: "search-old" })
        .mockResolvedValueOnce({ requestId: "search-new" }),
      poll: vi.fn().mockImplementation((requestId: string) => requestId === "search-old"
        ? oldPoll
        : Promise.resolve({
          requestId,
          events: [{ type: "search.complete", requestId, cancelled: false }],
          nextCursor: 1,
          done: true,
        })),
      cancel: vi.fn().mockResolvedValue({ requestId: "search-old", cancelled: true }),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={shellDownloadClient()} />);
    const input = screen.getByPlaceholderText("输入关键词、Magnet 或 infohash");

    await user.type(input, "first");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));
    await waitFor(() => expect(client.poll).toHaveBeenCalledWith("search-old", 0));
    await user.clear(input);
    await user.type(input, "second");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));

    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith("search-old"));
    await waitFor(() => expect(client.start).toHaveBeenLastCalledWith("second", "all"));
    finishOldPoll({ requestId: "search-old", events: [], nextCursor: 0, done: true });
  });

  it("passes the selected category to authenticated search IPC", async () => {
    const requestId = "search-movies";
    const client: SearchClient = {
      providers: vi.fn().mockResolvedValue(providerResult),
      start: vi.fn().mockResolvedValue({ requestId }),
      poll: vi.fn().mockResolvedValue({
        requestId,
        events: [{ type: "search.complete", requestId, cancelled: false }],
        nextCursor: 1,
        done: true,
      }),
      cancel: vi.fn().mockResolvedValue({ requestId, cancelled: true }),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={shellDownloadClient()} />);

    await user.click(screen.getByRole("button", { name: /电影/ }));
    await user.type(screen.getByPlaceholderText("输入关键词、Magnet 或 infohash"), "legal movie");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));

    await waitFor(() => expect(client.start).toHaveBeenCalledWith("legal movie", "movies"));
    expect(screen.getByText("YTS")).toBeInTheDocument();
    expect(screen.queryByText("Nyaa")).not.toBeInTheDocument();
  });
});
