import { describe, expect, it } from "vitest";
import { luaString, proxyFailure } from "./sidecar.ts";

describe("luaString", () => {
  it("hex-escapes every byte so no character can end the literal", () => {
    expect(luaString('a"b')).toBe('"\\x61\\x22\\x62"');
  });

  it("encodes non-ASCII as UTF-8 bytes", () => {
    expect(luaString("é")).toBe('"\\xc3\\xa9"');
  });
});

describe("proxyFailure", () => {
  it("accepts a 2xx reply", () => {
    expect(proxyFailure({ ok: true, status: 200 })).toBeNull();
    expect(proxyFailure({ ok: true })).toBeNull();
  });

  it("reports the upstream status the proxy hides behind ok: true", () => {
    expect(proxyFailure({ ok: true, status: 401 })).toMatch(/token.*401/);
    expect(proxyFailure({ ok: true, status: 404 })).toBe(
      "sidecar returned HTTP 404",
    );
    expect(proxyFailure({ ok: true, status: 502 })).toBe(
      "sidecar returned HTTP 502",
    );
  });

  it("reports a failed or missing reply", () => {
    expect(proxyFailure({ ok: false, status: 500 })).toBe(
      "sidecar returned HTTP 500",
    );
    expect(proxyFailure(undefined)).toBe("sidecar returned HTTP ?");
  });
});
