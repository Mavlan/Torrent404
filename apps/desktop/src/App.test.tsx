import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { confirm } from "@tauri-apps/plugin-dialog";
import type { DownloadTask } from "@torlink/protocol";
import App from "./App";
import type { DownloadClient } from "./downloadClient";
import type { SearchClient } from "./searchClient";

vi.mock("@tauri-apps/plugin-dialog", () => ({
  confirm: vi.fn().mockResolvedValue(true),
  open: vi.fn().mockResolvedValue(null),
}));

const providerResult = {
  providers: [
    { providerId: "yts", displayName: "YTS", categories: ["movies"], enabled: true },
    { providerId: "nyaa", displayName: "Nyaa", categories: ["anime"], enabled: true },
    { providerId: "knaben", displayName: "Knaben", categories: ["movies", "tv", "anime", "games", "software"], enabled: true },
    { providerId: "eztv", displayName: "EZTV", categories: ["tv"], enabled: true },
    { providerId: "tpb", displayName: "TPB", categories: ["movies", "tv"], enabled: true },
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
    pause: vi.fn().mockRejectedValue(new Error("pause not expected")),
    resume: vi.fn().mockRejectedValue(new Error("resume not expected")),
    startSeeding: vi.fn().mockRejectedValue(new Error("start seeding not expected")),
    stopSeeding: vi.fn().mockRejectedValue(new Error("stop seeding not expected")),
    remove: vi.fn().mockRejectedValue(new Error("remove not expected")),
    list: vi.fn().mockResolvedValue({ tasks: [] }),
    directory: vi.fn().mockResolvedValue("C:\\Users\\Tester\\Downloads\\Torrent404"),
    selectDirectory: vi.fn().mockResolvedValue(null),
  };
}

function searchActionButton(): HTMLElement {
  return screen.getAllByRole("button", { name: "搜索" }).at(-1)!;
}

describe("desktop shell", () => {
  it("renders human-readable category counts from provider descriptors", async () => {
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    expect(screen.getByText("Torrent404")).toBeInTheDocument();
    expect(screen.getByText("v0.2.0 · RC")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: /从一个入口/ })).toBeInTheDocument();
    expect(screen.getByText("搜索电影、剧集、动漫、游戏和其他 Torrent 资源")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载")).toBeInTheDocument();
    expect(screen.getByText("Torrent404 运行正常")).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "搜索分类" })).toBeInTheDocument();
    for (const label of [
      /全部.*5 来源/,
      /电影.*3 来源/,
      /剧集.*3 来源/,
      /动漫.*2 来源/,
      /游戏.*1 来源/,
      /软件.*1 来源/,
    ]) {
      expect(await screen.findByRole("button", { name: label })).toBeInTheDocument();
    }
    const sources = screen.getByRole("region", { name: "搜索来源" });
    expect(sources).toBeInTheDocument();
    expect(screen.getByText("5/5 已启用")).toBeInTheDocument();
    expect(sources.querySelectorAll(".source-chip")).toHaveLength(5);
    expect(screen.getByText("· 全分类")).toBeInTheDocument();
    expect(screen.getAllByText("就绪")).toHaveLength(5);
  });

  it("navigates to downloads and shows its empty state", async () => {
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: /下载中/ }));
    expect(screen.getByRole("heading", { name: "下载队列安静待命" })).toBeInTheDocument();
  });

  it("hydrates persisted task counts on startup without opening Downloads or Completed", async () => {
  const completedTask: DownloadTask = {
    id: "download-completed",
    infoHash: "abcdef0123456789abcdef0123456789abcdef02",
    name: "Completed fixture",
    status: "completed",
    progress: 1,
    downloadSpeed: 0,
    uploadSpeed: 0,
    downloaded: 1_048_576,
    total: 1_048_576,
    peers: 0,
    etaSeconds: 0,
    savePath: "C:\\Downloads\\Torrent404",
  };

  const downloads: DownloadClient = {
    add: vi.fn().mockRejectedValue(new Error("add not expected")),
    pause: vi.fn().mockRejectedValue(new Error("pause not expected")),
    resume: vi.fn().mockRejectedValue(new Error("resume not expected")),
    startSeeding: vi.fn().mockRejectedValue(new Error("start seeding not expected")),
    stopSeeding: vi.fn().mockRejectedValue(new Error("stop seeding not expected")),
    remove: vi.fn().mockRejectedValue(new Error("remove not expected")),
    list: vi.fn().mockResolvedValue({ tasks: [completedTask] }),
    directory: vi.fn().mockResolvedValue("C:\\Downloads\\Torrent404"),
    selectDirectory: vi.fn().mockResolvedValue(null),
  };

  render(<App searchClient={shellClient()} downloadClient={downloads} />);

  expect(
    await screen.findByRole("button", { name: /已完成.*01/ }),
  ).toBeInTheDocument();

  expect(downloads.list).toHaveBeenCalled();
});
it("marks startup-restored paused tasks as pending verification until resume", async () => {
  let snapshot: DownloadTask = {
    id: "download-restored-paused",
    infoHash: "abcdef0123456789abcdef0123456789abcdef03",
    name: "Restored paused fixture",
    status: "paused",
    progress: 0,
    downloadSpeed: 0,
    uploadSpeed: 0,
    downloaded: 0,
    total: 1_048_576,
    peers: 0,
    savePath: "C:\\Downloads\\Torrent404",
  };

  const downloads: DownloadClient = {
    ...shellDownloadClient(),
    list: vi.fn().mockImplementation(async () => ({ tasks: [{ ...snapshot }] })),
    resume: vi.fn().mockImplementation(async () => {
      snapshot = {
        ...snapshot,
        status: "downloading",
        progress: 0.5,
        downloaded: 524_288,
        downloadSpeed: 131_072,
        peers: 3,
      };

      return {
        ok: true as const,
        protocolVersion: 1 as const,
        command: "download.resume" as const,
        result: { taskId: snapshot.id, task: { ...snapshot } },
      };
    }),
  };

  const user = userEvent.setup();

  render(<App searchClient={shellClient()} downloadClient={downloads} />);

  await waitFor(() => expect(downloads.list).toHaveBeenCalled());
  await user.click(screen.getByRole("button", { name: /下载中/ }));

  expect(await screen.findAllByText("待校验")).toHaveLength(2);
  expect(screen.queryByText("0.0%")).not.toBeInTheDocument();

  await user.click(screen.getByRole("button", { name: "继续" }));

  expect(downloads.resume).toHaveBeenCalledWith("download-restored-paused");
  expect(await screen.findByText("50.0%")).toBeInTheDocument();
  expect(screen.getByText("512 KiB / 1.0 MiB")).toBeInTheDocument();
  expect(screen.queryByText("待校验")).not.toBeInTheDocument();
});

  it("polls live task snapshots and refreshes them when re-entering Downloads", async () => {
    let snapshot: DownloadTask = {
      id: "download-live",
      infoHash: "abcdef0123456789abcdef0123456789abcdef01",
      name: "Legal live fixture",
      status: "downloading",
      progress: 0.25,
      downloadSpeed: 131_072,
      uploadSpeed: 65_536,
      downloaded: 262_144,
      total: 1_048_576,
      peers: 3,
      etaSeconds: 90,
      savePath: "C:\\Downloads\\Torrent404",
    };
    const downloads: DownloadClient = {
      add: vi.fn().mockRejectedValue(new Error("add not expected")),
      pause: vi.fn().mockRejectedValue(new Error("pause not expected")),
      resume: vi.fn().mockRejectedValue(new Error("resume not expected")),
      startSeeding: vi.fn().mockRejectedValue(new Error("start seeding not expected")),
      stopSeeding: vi.fn().mockRejectedValue(new Error("stop seeding not expected")),
      remove: vi.fn().mockRejectedValue(new Error("remove not expected")),
      list: vi.fn().mockImplementation(async () => ({ tasks: [{ ...snapshot }] })),
      directory: vi.fn().mockResolvedValue("C:\\Downloads\\Torrent404"),
      selectDirectory: vi.fn().mockResolvedValue(null),
    };
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={downloads} />);

    await user.click(screen.getByRole("button", { name: /下载中/ }));
    expect(await screen.findByText("25.0%")).toBeInTheDocument();
    expect(screen.getByText("256 KiB / 1.0 MiB")).toBeInTheDocument();
    expect(screen.getAllByText("128 KiB/s").length).toBeGreaterThan(0);
    expect(screen.getByText("64 KiB/s")).toBeInTheDocument();
    expect(screen.getByText("2m")).toBeInTheDocument();
    expect(screen.getByText("Peers")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();

    snapshot = {
      ...snapshot,
      status: "paused",
      progress: 0.5,
      downloaded: 524_288,
      downloadSpeed: 999_999,
      uploadSpeed: 999_999,
      etaSeconds: 5,
    };
    expect(await screen.findByText("50.0%", {}, { timeout: 1_500 })).toBeInTheDocument();
    expect(screen.getByText("已暂停")).toBeInTheDocument();
    expect(screen.getAllByText("0 B/s")).toHaveLength(2);
    expect(screen.getAllByText("—").length).toBeGreaterThanOrEqual(1);

    await user.click(screen.getByRole("button", { name: "搜索" }));
    const { etaSeconds: _etaSeconds, ...withoutEta } = snapshot;
    snapshot = {
      ...withoutEta,
      status: "seeding",
      progress: 1,
      downloaded: 1_048_576,
      downloadSpeed: 0,
      uploadSpeed: 32_768,
    };
    await user.click(screen.getByRole("button", { name: /已完成/ }));
    expect(await screen.findByText("100%")).toBeInTheDocument();
    expect(screen.getByText("做种中")).toBeInTheDocument();
    expect(screen.getByText("1.0 MiB / 1.0 MiB")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "搜索" }));
    snapshot = { ...snapshot, status: "error", error: "private engine stack" };
    await user.click(screen.getByRole("button", { name: /下载中/ }));
    expect(await screen.findByText("下载遇到错误，请稍后重试或移除任务。")).toBeInTheDocument();
    expect(screen.queryByText("private engine stack")).not.toBeInTheDocument();
  });

  it("moves completed tasks out of Downloads and exposes explicit seeding controls", async () => {
    let snapshot: DownloadTask = {
      id: "download-complete",
      infoHash: "abcdef0123456789abcdef0123456789abcdef01",
      name: "Completed legal fixture",
      status: "completed",
      progress: 1,
      downloadSpeed: 0,
      uploadSpeed: 0,
      downloaded: 1_048_576,
      total: 1_048_576,
      peers: 0,
      savePath: "C:\\Downloads\\Torrent404",
    };
    const downloads: DownloadClient = {
      add: vi.fn().mockRejectedValue(new Error("add not expected")),
      pause: vi.fn().mockRejectedValue(new Error("pause not expected")),
      resume: vi.fn().mockRejectedValue(new Error("resume not expected")),
      startSeeding: vi.fn().mockImplementation(async () => {
        snapshot = { ...snapshot, status: "seeding", uploadSpeed: 512, peers: 2 };
        return {
          ok: true as const,
          protocolVersion: 1 as const,
          command: "download.seed.start" as const,
          result: { taskId: snapshot.id, task: { ...snapshot } },
        };
      }),
      stopSeeding: vi.fn().mockImplementation(async () => {
        snapshot = { ...snapshot, status: "completed", uploadSpeed: 0, peers: 0 };
        return {
          ok: true as const,
          protocolVersion: 1 as const,
          command: "download.seed.stop" as const,
          result: { taskId: snapshot.id, task: { ...snapshot } },
        };
      }),
      remove: vi.fn().mockRejectedValue(new Error("remove not expected")),
      list: vi.fn().mockImplementation(async () => ({ tasks: [{ ...snapshot }] })),
      directory: vi.fn().mockResolvedValue("C:\\Downloads\\Torrent404"),
      selectDirectory: vi.fn().mockResolvedValue(null),
    };
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={downloads} />);

    await user.click(screen.getByRole("button", { name: /已完成/ }));
    await waitFor(() => expect(downloads.list).toHaveBeenCalled());
    expect(screen.getByRole("button", { name: /下载中.*00/ })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Completed legal fixture" })).toBeInTheDocument();
    expect(screen.getAllByText("已完成").length).toBeGreaterThan(0);
    expect(screen.getByText("0 B/s")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "开始做种" }));
    expect(downloads.startSeeding).toHaveBeenCalledWith("download-complete");
    expect(await screen.findByText("做种中")).toBeInTheDocument();
    expect(screen.getByText("512 B/s")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "停止做种" }));
    expect(downloads.stopSeeding).toHaveBeenCalledWith("download-complete");
    expect(await screen.findByText("已停止做种，本地文件保持不变。")).toBeInTheDocument();
    expect(screen.getByText("0 B/s")).toBeInTheDocument();
  });

  it("states the privacy boundary in About", async () => {
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByRole("heading", { name: "关于 Torrent404" })).toBeInTheDocument();
    expect(screen.getByText(/peers 可以看到你的公网 IP/)).toBeInTheDocument();
    expect(screen.getByText(/使用并修改了开源 TorLink 项目的部分代码/)).toBeInTheDocument();
    expect(screen.getByText(/并非 TorLink 官方版本/)).toBeInTheDocument();
    expect(screen.getByText("bairon / bairon.dev")).toBeInTheDocument();
    expect(screen.getByText("https://github.com/baairon/torlink")).toBeInTheDocument();
    expect(screen.getByText("MIT License")).toBeInTheDocument();
    expect(screen.getByText("0.2.0")).toBeInTheDocument();
    expect(screen.getByText("WebTorrent")).toBeInTheDocument();
  });

  it("switches the complete shell to English without restarting", async () => {
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("button", { name: "English" }));

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("switch", {
      name: "Knaben · Movies / TV / Anime / Games / Software · Beta · Enabled",
    })).toBeChecked();
    expect(document.documentElement.lang).toBe("en-US");
    expect(document.title).toBe("Torrent404");
    await user.click(screen.getByRole("button", { name: "About" }));
    expect(screen.getByText(/incorporates and modifies portions/)).toBeInTheDocument();
    expect(screen.getByText(/independent downstream project/)).toBeInTheDocument();
    expect(screen.getByText("TorLink author")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Search" }));
    expect(screen.getByText("Search movies, TV, anime, games and other torrents")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Movies/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /TV.*3 sources/ })).toBeInTheDocument();
    expect(screen.getAllByText("Ready")).toHaveLength(5);
    const searchButtons = screen.getAllByRole("button", { name: "Search" });
    await user.click(searchButtons.at(-1)!);
    expect(screen.getByText("Enter keywords, a magnet, or an infohash first.")).toBeInTheDocument();
  });

  it("shows a category-specific empty state and never searches without sources", async () => {
    const client = shellClient();
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={shellDownloadClient()} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(await screen.findByRole("switch", {
      name: "Knaben · 电影 / 剧集 / 动漫 / 游戏 / 软件 · Beta · 已启用",
    }));
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.click(await screen.findByRole("button", { name: /游戏.*暂无/ }));

    expect(screen.getByRole("heading", { name: "当前暂无游戏搜索来源" })).toBeInTheDocument();
    expect(screen.getByText("更多搜索来源将在后续版本加入。")).toBeInTheDocument();
    const searchButton = searchActionButton();
    expect(searchButton).toBeDisabled();
    await user.click(searchButton);
    expect(client.start).not.toHaveBeenCalled();
  });

  it("toggles search sources and updates category availability", async () => {
    const client = shellClient();
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={shellDownloadClient()} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("heading", { name: "内置搜索来源" })).toBeInTheDocument();
    expect(screen.getByText("YTS")).toBeInTheDocument();
    expect(screen.getByText("Nyaa")).toBeInTheDocument();
    expect(screen.getByText("EZTV")).toBeInTheDocument();
    expect(screen.getByText("TPB")).toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "EZTV · 已启用" })).toBeChecked();
    const tpbToggle = screen.getByRole("switch", { name: "TPB · 已启用" });
    expect(tpbToggle).toBeChecked();
    const knabenToggle = screen.getByRole("switch", {
      name: "Knaben · 电影 / 剧集 / 动漫 / 游戏 / 软件 · Beta · 已启用",
    });
    expect(knabenToggle).toBeChecked();
    const nyaaToggle = screen.getByRole("switch", { name: "Nyaa · 已启用" });
    expect(nyaaToggle).toBeChecked();
    await user.click(nyaaToggle);
    await user.click(knabenToggle);
    expect(screen.getByRole("switch", { name: "Nyaa · 已停用" })).not.toBeChecked();

    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("button", { name: /动漫.*暂无/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /全部.*3 来源/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /动漫.*暂无/ }));
    expect(searchActionButton()).toBeDisabled();
    expect(client.start).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("switch", { name: "YTS · 已启用" }));
    await user.click(screen.getByRole("switch", { name: "EZTV · 已启用" }));
    await user.click(screen.getByRole("switch", { name: "TPB · 已启用" }));
    await user.click(screen.getByRole("button", { name: "搜索" }));
    await user.click(screen.getByRole("button", { name: /全部.*暂无/ }));
    const input = screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载");
    await user.type(input, "nothing should run");
    expect(searchActionButton()).toBeDisabled();
    expect(client.start).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(screen.getByRole("switch", { name: "Nyaa · 已停用" }));
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("button", { name: /动漫.*1 来源/ })).toBeInTheDocument();
  });

  it("selects and displays a persisted default download directory", async () => {
    const downloads: DownloadClient = {
      ...shellDownloadClient(),
      selectDirectory: vi.fn().mockResolvedValue("D:\\Torrent Downloads"),
    };
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={downloads} />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByText("C:\\Users\\Tester\\Downloads\\Torrent404"))
      .toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "选择文件夹" }));

    expect(downloads.selectDirectory).toHaveBeenCalledWith(
      "C:\\Users\\Tester\\Downloads\\Torrent404",
    );
    expect(await screen.findByText("D:\\Torrent Downloads")).toBeInTheDocument();
    expect(screen.getByText("默认下载目录已更新。")).toBeInTheDocument();
  });

  it("restores persisted source choices after the desktop UI remounts", async () => {
    const user = userEvent.setup();
    const firstRun = render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    await user.click(await screen.findByRole("switch", { name: "Nyaa · 已启用" }));
    firstRun.unmount();

    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("switch", { name: "Nyaa · 已停用" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("button", { name: /动漫.*1 来源/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /全部.*4 来源/ })).toBeInTheDocument();
  });

  it("keeps Knaben on by default and prioritizes persisted disable and enable choices", async () => {
    const user = userEvent.setup();
    const firstRun = render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    const enabled = await screen.findByRole("switch", {
      name: "Knaben · 电影 / 剧集 / 动漫 / 游戏 / 软件 · Beta · 已启用",
    });
    expect(enabled).toBeChecked();
    await user.click(enabled);
    expect(screen.getByRole("switch", {
      name: "Knaben · 电影 / 剧集 / 动漫 / 游戏 / 软件 · Beta · 已停用",
    })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByRole("button", { name: /全部.*4 来源/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /电影.*2 来源/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /剧集.*2 来源/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /游戏.*暂无/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /软件.*暂无/ })).toBeInTheDocument();
    firstRun.unmount();

    const secondRun = render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    const restored = await screen.findByRole("switch", {
      name: "Knaben · 电影 / 剧集 / 动漫 / 游戏 / 软件 · Beta · 已停用",
    });
    expect(restored).not.toBeChecked();
    await user.click(restored);
    secondRun.unmount();

    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("switch", {
      name: "Knaben · 电影 / 剧集 / 动漫 / 游戏 / 软件 · Beta · 已启用",
    })).toBeChecked();
  });

  it("keeps TPB on by default and prioritizes a persisted opt-out", async () => {
    const user = userEvent.setup();
    const firstRun = render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    const enabled = await screen.findByRole("switch", { name: "TPB · 已启用" });
    expect(enabled).toBeChecked();
    await user.click(enabled);
    expect(screen.getByRole("switch", { name: "TPB · 已停用" })).not.toBeChecked();
    firstRun.unmount();

    render(<App searchClient={shellClient()} downloadClient={shellDownloadClient()} />);
    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByRole("switch", { name: "TPB · 已停用" })).not.toBeChecked();
    await user.click(screen.getByRole("button", { name: "搜索" }));
    expect(await screen.findByText("4/5 已启用")).toBeInTheDocument();
    expect(screen.getByText("TPB").closest(".source-chip"))
      .toHaveAttribute("data-state", "disabled");
  });

  it("recognizes a magnet and creates a download through the existing client", async () => {
    const client = shellClient();
    const magnet = "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01";
    const downloads: DownloadClient = {
      ...shellDownloadClient(),
      add: vi.fn().mockResolvedValue({
        ok: true,
        protocolVersion: 1,
        command: "download.add",
        result: {
          taskId: "download-direct-magnet",
          task: {
            id: "download-direct-magnet",
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            name: "Magnet download",
            status: "downloading",
            progress: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
            downloaded: 0,
            total: 0,
            savePath: "C:\\Users\\Tester\\Downloads\\Torrent404",
          },
        },
      }),
      list: vi.fn().mockRejectedValue(new Error("poll not expected")),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={downloads} />);

    await user.type(screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载"), magnet);
    const addButton = screen.getByRole("button", { name: "添加下载" });
    expect(addButton).toHaveAttribute("data-mode", "magnet");
    await user.click(addButton);

    expect(downloads.add).toHaveBeenCalledWith({ magnet });
    expect(client.start).not.toHaveBeenCalled();
    expect(await screen.findByText("download-direct-magnet")).toBeInTheDocument();
    expect(screen.getByText("下载任务已创建，可在“下载中”查看。")).toBeInTheDocument();
  });

  it("localizes invalid and duplicate direct magnet errors", async () => {
    const client = shellClient();
    const downloads: DownloadClient = {
      ...shellDownloadClient(),
      add: vi.fn()
        .mockResolvedValueOnce({
          ok: false,
          protocolVersion: 1,
          error: { code: "invalid_magnet", message: "private parser detail" },
        })
        .mockResolvedValueOnce({
          ok: false,
          protocolVersion: 1,
          error: { code: "duplicate_torrent", message: "private task identity" },
        }),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={downloads} />);
    const input = screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载");

    await user.type(input, "magnet:?xt=urn:btih:not-valid");
    await user.click(screen.getByRole("button", { name: "添加下载" }));
    expect(await screen.findByText("这个 Magnet 无效，无法创建下载任务。")).toBeInTheDocument();
    expect(screen.queryByText("private parser detail")).not.toBeInTheDocument();

    await user.clear(input);
    await user.type(input, "magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01");
    await user.click(screen.getByRole("button", { name: "添加下载" }));
    expect(await screen.findByText("这个 Torrent 已在下载列表中。")).toBeInTheDocument();
    expect(screen.queryByText("private task identity")).not.toBeInTheDocument();
    expect(client.start).not.toHaveBeenCalled();
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
            savePath: "C:\\Users\\Tester\\Downloads\\Torrent404",
          },
        },
      }),
      pause: vi.fn().mockResolvedValue({
        ok: true,
        protocolVersion: 1,
        command: "download.pause",
        result: {
          taskId: "download-public-domain",
          task: {
            id: "download-public-domain",
            infoHash: "abcdef0123456789abcdef0123456789abcdef01",
            name: "Public Domain Film",
            status: "paused",
            progress: 0,
            downloadSpeed: 0,
            uploadSpeed: 0,
            downloaded: 0,
            total: 1_048_576,
            savePath: "C:\\Users\\Tester\\Downloads\\Torrent404",
          },
        },
      }),
      resume: vi.fn().mockResolvedValue({
        ok: true,
        protocolVersion: 1,
        command: "download.resume",
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
            savePath: "C:\\Users\\Tester\\Downloads\\Torrent404",
          },
        },
      }),
      startSeeding: vi.fn().mockRejectedValue(new Error("start seeding not expected")),
      stopSeeding: vi.fn().mockRejectedValue(new Error("stop seeding not expected")),
      remove: vi.fn().mockResolvedValue({
        ok: true,
        protocolVersion: 1,
        command: "download.remove",
        result: { taskId: "download-public-domain", removed: true },
      }),
      list: vi.fn().mockRejectedValue(new Error("poll not expected")),
      directory: vi.fn().mockResolvedValue("C:\\Users\\Tester\\Downloads\\Torrent404"),
      selectDirectory: vi.fn().mockResolvedValue(null),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={downloads} />);

    await user.type(screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载"), "open media");
    await user.click(searchActionButton());

    expect(await screen.findByRole("heading", { name: "Public Domain Film" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Open Animation Test" })).toBeInTheDocument();
    expect(screen.getByText(/1\.0 MiB/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 GiB/)).toBeInTheDocument();
    expect(client.start).toHaveBeenCalledWith(
      "open media",
      "all",
      ["yts", "nyaa", "knaben", "eztv", "tpb"],
    );
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

    await user.click(screen.getByRole("button", { name: "暂停" }));
    expect(downloads.pause).toHaveBeenCalledWith("download-public-domain");
    expect(await screen.findByText("已暂停")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "继续" }));
    expect(downloads.resume).toHaveBeenCalledWith("download-public-domain");
    expect(await screen.findByText("下载任务已恢复。")).toBeInTheDocument();

    const confirmMock = vi.mocked(confirm);
    confirmMock.mockClear();
    confirmMock.mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    await user.click(screen.getByRole("button", { name: "移除" }));
    expect(downloads.remove).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "移除" }));
    expect(downloads.remove).toHaveBeenCalledWith("download-public-domain");
    expect(await screen.findByRole("heading", { name: "下载队列安静待命" })).toBeInTheDocument();
    expect(screen.getByText("任务已从列表移除，本地文件已保留。")).toBeInTheDocument();
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
      pause: vi.fn().mockRejectedValue(new Error("pause not expected")),
      resume: vi.fn().mockRejectedValue(new Error("resume not expected")),
      startSeeding: vi.fn().mockRejectedValue(new Error("start seeding not expected")),
      stopSeeding: vi.fn().mockRejectedValue(new Error("stop seeding not expected")),
      remove: vi.fn().mockRejectedValue(new Error("remove not expected")),
      list: vi.fn().mockRejectedValue(new Error("poll not expected")),
      directory: vi.fn().mockResolvedValue("C:\\Downloads\\Torrent404"),
      selectDirectory: vi.fn().mockResolvedValue(null),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={downloads} />);

    await user.type(screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载"), "fixture");
    await user.click(searchActionButton());
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
    const input = screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载");

    await user.type(input, "first");
    await user.click(searchActionButton());
    await waitFor(() => expect(client.poll).toHaveBeenCalledWith("search-old", 0));
    await user.clear(input);
    await user.type(input, "second");
    await user.click(searchActionButton());

    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith("search-old"));
    await waitFor(() => expect(client.start).toHaveBeenLastCalledWith(
      "second",
      "all",
      ["yts", "nyaa", "knaben", "eztv", "tpb"],
    ));
    finishOldPoll({ requestId: "search-old", events: [], nextCursor: 0, done: true });
  });

  it("automatically searches the newly selected category when the query is not empty", async () => {
    const client: SearchClient = {
      providers: vi.fn().mockResolvedValue(providerResult),
      start: vi.fn()
        .mockResolvedValueOnce({ requestId: "search-all" })
        .mockResolvedValueOnce({ requestId: "search-games" }),
      poll: vi.fn().mockImplementation(async (requestId: string) => ({
        requestId,
        events: [{ type: "search.complete" as const, requestId, cancelled: false }],
        nextCursor: 1,
        done: true,
      })),
      cancel: vi.fn().mockResolvedValue({ requestId: "search-all", cancelled: true }),
    };
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={shellDownloadClient()} />);
    const input = screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载");

    await user.type(input, "grand theft auto");
    await user.click(searchActionButton());
    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(1));
    await user.click(screen.getByRole("button", { name: /游戏.*1 来源/ }));

    await waitFor(() => expect(client.start).toHaveBeenCalledTimes(2));
    expect(client.start).toHaveBeenNthCalledWith(
      2,
      "grand theft auto",
      "games",
      ["knaben"],
    );
    expect(input).toHaveValue("grand theft auto");
  });

  it("switches category without searching when the query is empty", async () => {
    const client = shellClient();
    const user = userEvent.setup();
    render(<App searchClient={client} downloadClient={shellDownloadClient()} />);

    const games = await screen.findByRole("button", { name: /游戏.*1 来源/ });
    await user.click(games);

    expect(games).toHaveAttribute("aria-pressed", "true");
    expect(client.start).not.toHaveBeenCalled();
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
    await user.type(screen.getByPlaceholderText("搜索资源，或粘贴 Magnet 链接直接下载"), "legal movie");
    await user.click(searchActionButton());

    await waitFor(() => expect(client.start).toHaveBeenCalledWith(
      "legal movie",
      "movies",
      ["yts", "knaben", "tpb"],
    ));
    expect(screen.getByText("YTS")).toBeInTheDocument();
    expect(screen.getByText("Nyaa")).toBeInTheDocument();
  });

  it("imports a selected .torrent and labels only actual connections as Connected", async () => {
    const importedTask: DownloadTask = {
      id: "download-torrent-file",
      infoHash: "abcdef0123456789abcdef0123456789abcdef01",
      name: "fixture.bin",
      status: "downloading",
      progress: 0.25,
      downloadSpeed: 1024,
      uploadSpeed: 0,
      downloaded: 1,
      total: 4,
      peers: 18,
      savePath: "C:\\Users\\Tester\\Downloads\\Torrent404",
    };
    const downloads: DownloadClient = {
      ...shellDownloadClient(),
      list: vi.fn().mockResolvedValue({ tasks: [importedTask] }),
      selectTorrent: vi.fn().mockResolvedValue({
        ok: true,
        protocolVersion: 1,
        command: "download.add",
        result: {
          taskId: "download-torrent-file",
          task: importedTask,
        },
      }),
    };
    const user = userEvent.setup();
    render(<App searchClient={shellClient()} downloadClient={downloads} />);

    await user.click(screen.getByRole("button", { name: "选择 .torrent 文件" }));

    expect(downloads.selectTorrent).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole("heading", { name: "fixture.bin" })).toBeInTheDocument();
    expect(screen.getByText(".torrent 任务已创建，可在“下载中”查看。")).toBeInTheDocument();
    expect(screen.getByText("Seeds")).toBeInTheDocument();
    expect(screen.getByText("Peers")).toBeInTheDocument();
    expect(screen.getByText("Connected")).toBeInTheDocument();
    expect(screen.getAllByText("18")).toHaveLength(2);
  });
});
