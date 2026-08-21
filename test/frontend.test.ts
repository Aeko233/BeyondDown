import { describe, expect, test } from "bun:test";
import { parseSimpleToml } from "../src/config";
import { parseCookieFile } from "../src/features/auth";

describe("frontend config", () => {
  test("parses the supported TOML subset", () => {
    expect(
      parseSimpleToml(`
        # comment
        api_base = ""
        aria2_rpc = 'http://localhost:6800/jsonrpc'
        mode = proxy
      `),
    ).toEqual({
      api_base: "",
      aria2_rpc: "http://localhost:6800/jsonrpc",
      mode: "proxy",
    });
  });
});

describe("cookie file parsing", () => {
  test("parses browser JSON exports", () => {
    expect(
      parseCookieFile(
        JSON.stringify([
          { name: "SESSDATA", value: "session" },
          { name: "bili_jct", value: "csrf" },
        ]),
      ),
    ).toBe("SESSDATA=session; bili_jct=csrf");
  });

  test("parses Netscape cookies.txt", () => {
    expect(
      parseCookieFile(
        ".bilibili.com\tTRUE\t/\tTRUE\t0\tSESSDATA\tsession\n" +
          ".bilibili.com\tTRUE\t/\tTRUE\t0\tbili_jct\tcsrf",
      ),
    ).toBe("SESSDATA=session; bili_jct=csrf");
  });
});
