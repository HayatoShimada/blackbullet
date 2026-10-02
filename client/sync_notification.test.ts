import { expect, test } from "vitest";
import {
  sameSyncState,
  shouldFlashSyncNotification,
} from "./sync_notification.ts";

test("sameSyncState: idle and syncing carry no fields, so any two are equal", () => {
  expect(sameSyncState({ state: "idle" }, { state: "idle" })).toBe(true);
  expect(sameSyncState({ state: "syncing" }, { state: "syncing" })).toBe(true);
});

test("sameSyncState: different states are never equal", () => {
  expect(sameSyncState({ state: "idle" }, { state: "syncing" })).toBe(false);
  expect(
    sameSyncState({ state: "conflicted", paths: ["a.md"] }, { state: "idle" }),
  ).toBe(false);
});

test("sameSyncState: conflicted compares the path list, order and length included", () => {
  expect(
    sameSyncState(
      { state: "conflicted", paths: ["a.md", "b.md"] },
      { state: "conflicted", paths: ["a.md", "b.md"] },
    ),
  ).toBe(true);
  expect(
    sameSyncState(
      { state: "conflicted", paths: ["a.md", "b.md"] },
      { state: "conflicted", paths: ["b.md", "a.md"] },
    ),
  ).toBe(false);
  expect(
    sameSyncState(
      { state: "conflicted", paths: ["a.md"] },
      { state: "conflicted", paths: ["a.md", "b.md"] },
    ),
  ).toBe(false);
});

test("sameSyncState: paused compares reason, error compares kind and message", () => {
  expect(
    sameSyncState(
      { state: "paused", reason: "detached HEAD" },
      { state: "paused", reason: "detached HEAD" },
    ),
  ).toBe(true);
  expect(
    sameSyncState(
      { state: "paused", reason: "detached HEAD" },
      { state: "paused", reason: "something else" },
    ),
  ).toBe(false);
  expect(
    sameSyncState(
      { state: "error", kind: "AuthFailed", message: "denied" },
      { state: "error", kind: "AuthFailed", message: "denied" },
    ),
  ).toBe(true);
  expect(
    sameSyncState(
      { state: "error", kind: "AuthFailed", message: "denied" },
      { state: "error", kind: "AuthFailed", message: "different" },
    ),
  ).toBe(false);
});

test("shouldFlashSyncNotification: false for the states that pause nothing", () => {
  expect(shouldFlashSyncNotification({ state: "idle" }, undefined)).toBe(false);
  expect(shouldFlashSyncNotification({ state: "syncing" }, undefined)).toBe(
    false,
  );
  // Reachable server-side (a swallowed merge-completion error can leave
  // Conflicted set with nothing left unmerged) and has nothing to show.
  expect(
    shouldFlashSyncNotification({ state: "conflicted", paths: [] }, undefined),
  ).toBe(false);
});

test("shouldFlashSyncNotification: a paused space is as loud as a conflict", () => {
  const paused = { state: "paused" as const, reason: "logo.png" };
  expect(shouldFlashSyncNotification(paused, undefined)).toBe(true);
  expect(shouldFlashSyncNotification(paused, paused)).toBe(false);
});

test("shouldFlashSyncNotification: an error is as loud as a conflict, once per transition", () => {
  const err = { state: "error" as const, kind: "AuthFailed" };
  expect(shouldFlashSyncNotification(err, undefined)).toBe(true);
  expect(shouldFlashSyncNotification(err, err)).toBe(false);
  expect(shouldFlashSyncNotification(err, { state: "idle" })).toBe(true);
  expect(
    shouldFlashSyncNotification(err, { state: "error", kind: "NoRemote" }),
  ).toBe(true);
});

test("shouldFlashSyncNotification: true for the first conflict seen", () => {
  expect(
    shouldFlashSyncNotification(
      { state: "conflicted", paths: ["a.md"] },
      undefined,
    ),
  ).toBe(true);
});

test("shouldFlashSyncNotification: false when it's the same conflict already shown -- the reconnect/lag case", () => {
  const state = { state: "conflicted" as const, paths: ["a.md"] };
  expect(shouldFlashSyncNotification(state, state)).toBe(false);
  expect(
    shouldFlashSyncNotification(
      { state: "conflicted", paths: ["a.md"] },
      { state: "conflicted", paths: ["a.md"] },
    ),
  ).toBe(false);
});

test("shouldFlashSyncNotification: true when the conflict set genuinely changed", () => {
  expect(
    shouldFlashSyncNotification(
      { state: "conflicted", paths: ["a.md", "b.md"] },
      { state: "conflicted", paths: ["a.md"] },
    ),
  ).toBe(true);
});

test("shouldFlashSyncNotification: true again once a resolved conflict recurs", () => {
  // idle in between means the previous conflict was cleared -- a fresh
  // conflict (even with the exact same path) is worth a fresh notification.
  expect(
    shouldFlashSyncNotification(
      { state: "conflicted", paths: ["a.md"] },
      { state: "idle" },
    ),
  ).toBe(true);
});

test("an idle engine with saved edits reports changes waiting", async () => {
  const { syncStatusText } = await import("./sync_notification.ts");
  expect(
    syncStatusText({
      sync: { state: "idle" },
      enabled: true,
      paused: false,
      lastAttempt: 10,
      lastSuccess: 10,
      version: 1,
      pending: 0,
      incoming: 0,
      dirty: true,
    }),
  ).toContain("Changes waiting");
});
