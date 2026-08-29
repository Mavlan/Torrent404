import { describe, expect, it } from "vitest";

import { desktopTestInclude } from "../vitest.config";
import desktopPackage from "../package.json";
import config from "../src-tauri/tauri.conf.json";

describe("Tauri Windows bundle configuration", () => {
  it("keeps Vitest scoped away from Node-native sidecar suites", () => {
    expect(desktopTestInclude).toEqual(["src/**/*.test.{ts,tsx}"]);
    expect(desktopPackage.scripts.test).toContain("node --test src-tauri/sidecar/search-service.test.mjs");
    expect(desktopPackage.scripts.test).toContain("src-tauri/sidecar/download-service.test.mjs");
  });

  it("uses a Chinese WiX locale for the Chinese product metadata", () => {
    expect(config.productName).toBe("Torrent404");
    expect(config.mainBinaryName).toBe("Torrent404");
    expect(config.version).toBe("0.1.0");
    expect(config.identifier).toBe("io.github.yongliu404.desktop");
    expect(config.app.windows[0]?.title).toBe("Torrent404");
    expect(config.bundle.shortDescription).toContain("Torrent404");
    expect(config.bundle.targets).toContain("msi");
    expect(config.bundle.windows.wix.language).toBe("zh-CN");
  });

  it("bundles the pinned runtime and Core search/download sidecar modules", () => {
    expect(config.bundle.resources).toEqual({
      "sidecar/node.exe": "sidecar/node.exe",
      "sidecar/bootstrap.mjs": "sidecar/bootstrap.mjs",
      "sidecar/download-service.mjs": "sidecar/download-service.mjs",
      "sidecar/search-service.mjs": "sidecar/search-service.mjs",
      "sidecar/core/": "sidecar/core/",
      "sidecar/node_modules/": "sidecar/node_modules/",
    });
  });
});
