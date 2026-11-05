// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { type CacheReset, describeStorage, resetCache } from "./cache_reset.ts";

function setup(over: Partial<CacheReset> = {}) {
  const calls: string[] = [];
  const r: CacheReset = {
    reachable: async () => true,
    confirm: async (m) => {
      calls.push(`confirm:${m}`);
      return true;
    },
    notify: (m) => calls.push(`notify:${m}`),
    storage: async () => ({ usage: 12_300_000, persisted: true }),
    flush: async () => {
      calls.push("flush");
    },
    reload: () => calls.push("reload"),
    ...over,
  };
  return { r, calls };
}

test("asks, then flushes and reloads", async () => {
  const { r, calls } = setup();
  expect(await resetCache(r)).toBe(true);
  expect(calls[0]).toContain("12.3 MB");
  expect(calls.slice(1)).toEqual(["flush", "reload"]);
});

test("offline, nothing is dropped", async () => {
  const { r, calls } = setup({ reachable: async () => false });
  expect(await resetCache(r)).toBe(false);
  expect(calls).toHaveLength(1);
  expect(calls[0]).toMatch(/^notify:/);
});

test("a no keeps everything", async () => {
  const { r, calls } = setup({ confirm: async () => false });
  expect(await resetCache(r)).toBe(false);
  expect(calls).toEqual([]);
});

test("storage is described only as far as it is known", () => {
  expect(describeStorage({})).toBe("");
  expect(describeStorage({ persisted: false })).toMatch(/may clear/);
});
