import { describe, expect, it } from "vitest";

import { isMagnetInput } from "./magnetInput";

describe("magnet input detection", () => {
  it("recognizes magnet-shaped input before download validation", () => {
    expect(isMagnetInput(" magnet:?xt=urn:btih:abcdef0123456789abcdef0123456789abcdef01 ")).toBe(true);
    expect(isMagnetInput("MAGNET:?xt=urn:btih:invalid")).toBe(true);
  });

  it("leaves ordinary search keywords unchanged", () => {
    expect(isMagnetInput("open source animation")).toBe(false);
    expect(isMagnetInput("infohash abcdef0123456789")).toBe(false);
  });
});
