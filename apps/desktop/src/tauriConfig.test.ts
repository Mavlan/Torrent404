import { describe, expect, it } from "vitest";

import config from "../src-tauri/tauri.conf.json";

describe("Tauri Windows bundle configuration", () => {
  it("uses a Chinese WiX locale for the Chinese product metadata", () => {
    expect(config.productName).toBe("涌流404");
    expect(config.app.windows[0]?.title).toBe("涌流404");
    expect(config.bundle.shortDescription).toContain("涌流404");
    expect(config.bundle.targets).toContain("msi");
    expect(config.bundle.windows.wix.language).toBe("zh-CN");
  });

  it("bundles the pinned runtime, bootstrap, and Core search modules", () => {
    expect(config.bundle.resources).toEqual({
      "sidecar/node.exe": "sidecar/node.exe",
      "sidecar/bootstrap.mjs": "sidecar/bootstrap.mjs",
      "sidecar/search-service.mjs": "sidecar/search-service.mjs",
      "sidecar/core/": "sidecar/core/",
    });
  });
});
