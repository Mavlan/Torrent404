import { describe, expect, it } from "vitest";
import { DEFAULT_LOCALE, enUS, LOCALES, translate, zhCN } from "./index";

describe("localized messages", () => {
  it("uses zh-CN by default and exposes both supported locales", () => {
    expect(DEFAULT_LOCALE).toBe("zh-CN");
    expect(LOCALES).toEqual(["zh-CN", "en-US"]);
  });

  it("keeps the locale catalogs complete and translates typed keys", () => {
    expect(Object.keys(enUS)).toEqual(Object.keys(zhCN));
    expect(translate("zh-CN", "nav.search")).toBe("搜索");
    expect(translate("en-US", "nav.search")).toBe("Search");
    expect(translate("en-US", "search.purpose")).toBe(
      "Search movies, TV, anime, games and other torrents",
    );
    expect(translate("en-US", "about.upstreamAuthorValue")).toBe("bairon / bairon.dev");
    expect(translate("zh-CN", "about.upstreamLicenseValue")).toBe("MIT License");
  });
});
