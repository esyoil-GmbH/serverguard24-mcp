import { describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";

describe("loadConfig", () => {
  it("throws when the token is missing", () => {
    expect(() => loadConfig({})).toThrow(/SG24_API_TOKEN is not set/);
  });

  it("throws when the token is blank", () => {
    expect(() => loadConfig({ SG24_API_TOKEN: "  " })).toThrow(/SG24_API_TOKEN is not set/);
  });

  it("parses ids and ignores whitespace and empty parts", () => {
    expect(loadConfig({ SG24_API_TOKEN: "t", SG24_CHECK_IDS: " 111, 222 ,," })).toEqual({
      token: "t",
      checkIds: [111, 222],
    });
  });

  it("returns no ids when the variable is missing", () => {
    expect(loadConfig({ SG24_API_TOKEN: "t" }).checkIds).toEqual([]);
  });

  it("rejects a non-numeric id and names it", () => {
    expect(() => loadConfig({ SG24_API_TOKEN: "t", SG24_CHECK_IDS: "111,abc" })).toThrow(
      /SG24_CHECK_IDS.*"abc"/,
    );
  });

  it("rejects negative and decimal ids", () => {
    expect(() => loadConfig({ SG24_API_TOKEN: "t", SG24_CHECK_IDS: "-1" })).toThrow(/"-1"/);
    expect(() => loadConfig({ SG24_API_TOKEN: "t", SG24_CHECK_IDS: "1.5" })).toThrow(/"1.5"/);
  });

  it("removes duplicate ids", () => {
    expect(loadConfig({ SG24_API_TOKEN: "t", SG24_CHECK_IDS: "111,111" }).checkIds).toEqual([111]);
  });

  it("trims the token", () => {
    expect(loadConfig({ SG24_API_TOKEN: " t \n" }).token).toBe("t");
  });
});
