import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, translate, zhCN } from "./index";

describe("zh-CN messages", () => {
  it("is the default locale", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
  });

  it("resolves typed navigation messages", () => {
    expect(translate("nav.search")).toBe("搜索");
    expect(Object.keys(zhCN)).toContain("error.sourceUnavailable");
  });
});

