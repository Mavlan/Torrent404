import { describe, expect, it } from "vitest";

import config from "../src-tauri/tauri.conf.json";

describe("Tauri Windows bundle configuration", () => {
  it("uses a Chinese WiX locale for the Chinese product metadata", () => {
    expect(config.productName).toBe("涌流");
    expect(config.bundle.targets).toContain("msi");
    expect(config.bundle.windows.wix.language).toBe("zh-CN");
  });

  it("bundles the pinned Node runtime and sidecar bootstrap as resources", () => {
    expect(config.bundle.resources).toEqual({
      "sidecar/node.exe": "sidecar/node.exe",
      "sidecar/bootstrap.mjs": "sidecar/bootstrap.mjs",
    });
  });
});
