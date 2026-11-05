// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import {
  BOOT_RELOAD_WINDOW_MS,
  FOCUS_CHECK_MIN_MS,
  isStaleChunkError,
  reloadOnStaleChunks,
  STALE_RELOAD_MIN_MS,
  UPDATE_CHECK_MS,
  watchForUpdates,
  type WorkerLike,
} from "./app_update.ts";

function worker(state = "installed") {
  const posted: unknown[] = [];
  const w = Object.assign(new EventTarget(), {
    state,
    postMessage: (m: unknown) => posted.push(m),
  });
  return { w: w as WorkerLike & { state: string }, posted };
}

function setup(
  over: { controlled?: boolean; unsaved?: boolean; waiting?: WorkerLike } = {},
) {
  let clock = 1_000;
  let unsaved = !!over.unsaved;
  const calls = { update: 0, reload: 0, announce: 0 };
  let offered: (() => void) | undefined;
  const timers: { run: () => void; ms: number }[] = [];
  const container = Object.assign(new EventTarget(), {
    controller: over.controlled === false ? null : {},
  });
  const page = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  const registration = Object.assign(new EventTarget(), {
    update: () => {
      calls.update++;
      return Promise.resolve();
    },
    waiting: over.waiting ?? null,
    installing: null as WorkerLike | null,
  });
  watchForUpdates({
    registration,
    container,
    page,
    bootedAt: clock,
    now: () => clock,
    hasUnsavedChanges: () => unsaved,
    reload: () => calls.reload++,
    announce: (run) => {
      calls.announce++;
      offered = run;
    },
    every: (run, ms) => timers.push({ run, ms }),
  });
  return {
    calls,
    timers,
    advance: (ms: number) => {
      clock += ms;
    },
    setUnsaved: (v: boolean) => {
      unsaved = v;
    },
    /** A new worker installs and is waiting. */
    install: (w: WorkerLike & { state: string }) => {
      registration.installing = w;
      registration.dispatchEvent(new Event("updatefound"));
      w.state = "installed";
      w.dispatchEvent(new Event("statechange"));
    },
    takeOver: () => container.dispatchEvent(new Event("controllerchange")),
    focus: () => page.dispatchEvent(new Event("visibilitychange")),
    clickReload: () => offered?.(),
  };
}

test("a new version found right after a reload is taken at once", () => {
  const s = setup();
  const { w, posted } = worker("installing");
  s.advance(BOOT_RELOAD_WINDOW_MS - 1);
  s.install(w);
  expect(posted).toEqual([{ type: "skip-waiting" }]);
  s.takeOver();
  expect(s.calls).toMatchObject({ reload: 1, announce: 0 });
});

test("later, it waits for Reload; Reload takes it, then the page reloads", () => {
  const s = setup();
  const { w, posted } = worker("installing");
  s.advance(BOOT_RELOAD_WINDOW_MS);
  s.install(w);
  expect(posted).toEqual([]);
  expect(s.calls).toMatchObject({ reload: 0, announce: 1 });
  s.clickReload();
  expect(posted).toEqual([{ type: "skip-waiting" }]);
  s.takeOver();
  expect(s.calls).toMatchObject({ reload: 1, announce: 1 });
});

test("something unsaved means a Reload is offered, not done", () => {
  const s = setup({ unsaved: true });
  const { w, posted } = worker("installing");
  s.install(w);
  expect(posted).toEqual([]);
  expect(s.calls.announce).toBe(1);
});

test("a version already waiting at boot is handled the same way", () => {
  const { w, posted } = worker();
  setup({ waiting: w });
  expect(posted).toEqual([{ type: "skip-waiting" }]);
});

test("the first install is not an update", () => {
  const s = setup({ controlled: false });
  const { w, posted } = worker("installing");
  s.install(w);
  s.takeOver();
  expect(posted).toEqual([]);
  expect(s.calls).toMatchObject({ reload: 0, announce: 0 });
});

test("another tab took the new version: one notice, and it reloads", () => {
  const s = setup();
  const { w } = worker("installing");
  s.advance(BOOT_RELOAD_WINDOW_MS);
  s.install(w);
  w.state = "activated";
  s.takeOver();
  s.takeOver();
  expect(s.calls.announce).toBe(1);
  s.clickReload();
  expect(s.calls.reload).toBe(1);
});

test("an open tab asks for a new client now and then, and on coming back", () => {
  const s = setup();
  expect(s.timers.map((t) => t.ms)).toEqual([UPDATE_CHECK_MS]);
  s.timers[0].run();
  expect(s.calls.update).toBe(1);
  s.focus();
  expect(s.calls.update).toBe(1);
  s.advance(FOCUS_CHECK_MIN_MS);
  s.focus();
  expect(s.calls.update).toBe(2);
});

test("stale chunk errors are recognised across browsers", () => {
  expect(
    isStaleChunkError(
      new TypeError("Failed to fetch dynamically imported module: x.js"),
    ),
  ).toBe(true);
  expect(
    isStaleChunkError(new TypeError("Importing a module script failed.")),
  ).toBe(true);
  expect(isStaleChunkError(new Error("Something else"))).toBe(false);
});

test("a stale chunk reloads once a minute at most, and never over unsaved work", () => {
  const target = new EventTarget();
  let clock = STALE_RELOAD_MIN_MS * 10;
  let last = 0;
  let unsaved = false;
  const calls = { reload: 0, announce: 0 };
  reloadOnStaleChunks({
    target,
    now: () => clock,
    lastReload: () => last,
    markReload: (at) => {
      last = at;
    },
    hasUnsavedChanges: () => unsaved,
    reload: () => calls.reload++,
    announce: () => calls.announce++,
  });
  const reject = () =>
    target.dispatchEvent(
      Object.assign(new Event("unhandledrejection"), {
        reason: new TypeError("Failed to fetch dynamically imported module"),
      }),
    );
  reject();
  expect(calls).toEqual({ reload: 1, announce: 0 });
  reject();
  expect(calls).toEqual({ reload: 1, announce: 1 });
  clock += STALE_RELOAD_MIN_MS;
  unsaved = true;
  reject();
  expect(calls).toEqual({ reload: 1, announce: 2 });
});
