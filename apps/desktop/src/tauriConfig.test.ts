import { describe, expect, it } from "vitest";

import config from "../src-tauri/tauri.conf.json";

describe("Tauri Windows bundle configuration", () => {
  it("uses a Chinese WiX locale for the Chinese product metadata", () => {
    expect(config.productName).toBe("涌流");
    expect(config.bundle.targets).toContain("msi");
    expect(config.bundle.windows.wix.language).toBe("zh-CN");
  });
});
