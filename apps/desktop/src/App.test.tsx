import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import App from "./App";
import type { SearchClient } from "./searchClient";

describe("desktop shell", () => {
  it("renders the Chinese-first search surface", () => {
    render(<App />);
    expect(screen.getByRole("heading", { name: /从一个入口/ })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("输入关键词、Magnet 或 infohash")).toBeInTheDocument();
    expect(screen.getByText("无中央代理服务")).toBeInTheDocument();
  });

  it("navigates to downloads and shows its empty state", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: /下载中/ }));
    expect(screen.getByRole("heading", { name: "下载队列安静待命" })).toBeInTheDocument();
  });

  it("states the privacy boundary in About", async () => {
    const user = userEvent.setup();
    render(<App />);
    await user.click(screen.getByRole("button", { name: "关于" }));
    expect(screen.getByText(/peers 可以看到你的公网 IP/)).toBeInTheDocument();
    expect(screen.getByText(/并非 TorLink 官方版本/)).toBeInTheDocument();
  });

  it("renders YTS and Nyaa results incrementally from IPC", async () => {
    const requestId = "search-ui-results";
    const client: SearchClient = {
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
    const user = userEvent.setup();
    render(<App searchClient={client} />);

    await user.type(screen.getByPlaceholderText("输入关键词、Magnet 或 infohash"), "open media");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));

    expect(await screen.findByRole("heading", { name: "Public Domain Film" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Open Animation Test" })).toBeInTheDocument();
    expect(screen.getByText(/1\.0 MiB/)).toBeInTheDocument();
    expect(screen.getByText(/1\.5 GiB/)).toBeInTheDocument();
    expect(client.poll).toHaveBeenNthCalledWith(1, requestId, 0);
    expect(client.poll).toHaveBeenNthCalledWith(2, requestId, 2);
  });

  it("cancels the prior IPC search when a new query starts", async () => {
    let finishOldPoll!: (value: Awaited<ReturnType<SearchClient["poll"]>>) => void;
    const oldPoll = new Promise<Awaited<ReturnType<SearchClient["poll"]>>>((resolve) => {
      finishOldPoll = resolve;
    });
    const client: SearchClient = {
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
    render(<App searchClient={client} />);
    const input = screen.getByPlaceholderText("输入关键词、Magnet 或 infohash");

    await user.type(input, "first");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));
    await waitFor(() => expect(client.poll).toHaveBeenCalledWith("search-old", 0));
    await user.clear(input);
    await user.type(input, "second");
    await user.click(screen.getByRole("button", { name: /^开始搜索/ }));

    await waitFor(() => expect(client.cancel).toHaveBeenCalledWith("search-old"));
    await waitFor(() => expect(client.start).toHaveBeenLastCalledWith("second"));
    finishOldPoll({ requestId: "search-old", events: [], nextCursor: 0, done: true });
  });
});
