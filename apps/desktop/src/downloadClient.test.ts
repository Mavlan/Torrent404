import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  open: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: mocks.invoke }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: mocks.open }));

import { desktopDownloadClient } from "./downloadClient";

describe("desktop download directory client", () => {
  beforeEach(() => {
    mocks.invoke.mockReset();
    mocks.open.mockReset();
  });

  it("opens a native folder-only picker and persists the selected path", async () => {
    mocks.open.mockResolvedValue("D:\\Torrent Downloads");
    mocks.invoke.mockResolvedValue("D:\\Torrent Downloads");

    await expect(desktopDownloadClient.selectDirectory("C:\\Downloads\\Torrent404"))
      .resolves.toBe("D:\\Torrent Downloads");

    expect(mocks.open).toHaveBeenCalledWith({
      directory: true,
      multiple: false,
      title: "Torrent404",
      defaultPath: "C:\\Downloads\\Torrent404",
    });
    expect(mocks.invoke).toHaveBeenCalledWith("download_directory_set", {
      path: "D:\\Torrent Downloads",
    });
  });

  it("does not update settings when the folder picker is cancelled", async () => {
    mocks.open.mockResolvedValue(null);

    await expect(desktopDownloadClient.selectDirectory()).resolves.toBeNull();

    expect(mocks.invoke).not.toHaveBeenCalled();
  });

  it("opens a native .torrent picker and sends only the selected local path", async () => {
    mocks.open.mockResolvedValue("C:\\Fixtures\\legal.torrent");
    mocks.invoke.mockResolvedValue({ ok: true, command: "download.add" });

    await desktopDownloadClient.selectTorrent?.();

    expect(mocks.open).toHaveBeenCalledWith({
      directory: false,
      multiple: false,
      title: "Torrent404",
      filters: [{ name: "Torrent", extensions: ["torrent"] }],
    });
    expect(mocks.invoke).toHaveBeenCalledWith("download_add_torrent", {
      path: "C:\\Fixtures\\legal.torrent",
    });
  });

  it("does not invoke Core when the .torrent picker is cancelled", async () => {
    mocks.open.mockResolvedValue(null);

    await expect(desktopDownloadClient.selectTorrent?.()).resolves.toBeNull();
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});
