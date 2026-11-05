// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { DELETE_SETTLE_MS, relayIndexChanges } from "./live_widgets.ts";
import { EventHook } from "./plugos/hooks/event.ts";

let hook: EventHook;
let told: unknown[];

beforeEach(() => {
  vi.useFakeTimers();
  hook = new EventHook();
  // Only local listeners matter here: a system with no plugs loaded.
  (hook as any).system = { loadedPlugs: new Map() };
  told = [];
  relayIndexChanges(hook, (m) => told.push(m));
});

afterEach(() => {
  vi.useRealTimers();
});

const drained = () => hook.dispatchEvent("mq:emptyQueue:indexQueue");

test("a change from elsewhere is told once the index has taken it in", async () => {
  await hook.dispatchEvent("file:changed", "Projects/A.md", 1, 2, false);
  expect(told).toEqual([]);
  await drained();
  expect(told).toEqual([{ type: "index-changed" }]);
  await drained();
  expect(told).toHaveLength(1);
});

test("the client's own writes are not told", async () => {
  await hook.dispatchEvent("file:changed", "index.md", 1, 2, true);
  await drained();
  expect(told).toEqual([]);
});

test("a deletion is told without waiting for indexing", async () => {
  await hook.dispatchEvent("file:deleted", "Tasks/Old.md");
  vi.advanceTimersByTime(DELETE_SETTLE_MS);
  expect(told).toEqual([{ type: "index-changed" }]);
});
