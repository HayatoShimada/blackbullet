// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import {
  BOOT_RELOAD_WINDOW_MS,
  FOCUS_CHECK_MIN_MS,
  UPDATE_CHECK_MS,
  watchForUpdates,
} from "./app_update.ts";

function setup(over: { controlled?: boolean; unsaved?: boolean } = {}) {
  let clock = 1_000;
  const calls = { update: 0, reload: 0, announce: 0 };
  const timers: { run: () => void; ms: number }[] = [];
  const container = Object.assign(new EventTarget(), {
    controller: over.controlled === false ? null : {},
  });
  const page = Object.assign(new EventTarget(), {
    visibilityState: "visible",
  });
  watchForUpdates({
    registration: {
      update: () => {
        calls.update++;
        return Promise.resolve();
      },
    },
    container,
    page,
    bootedAt: clock,
    now: () => clock,
    hasUnsavedChanges: () => !!over.unsaved,
    reload: () => calls.reload++,
    announce: () => calls.announce++,
    every: (run, ms) => timers.push({ run, ms }),
  });
  return {
    calls,
    timers,
    advance: (ms: number) => {
      clock += ms;
    },
    takeOver: () => container.dispatchEvent(new Event("controllerchange")),
    focus: () => page.dispatchEvent(new Event("visibilitychange")),
  };
}

test("a new client found right after a reload loads at once", () => {
  const s = setup();
  s.advance(BOOT_RELOAD_WINDOW_MS - 1);
  s.takeOver();
  expect(s.calls).toMatchObject({ reload: 1, announce: 0 });
});

test("later, or with something unsaved, a reload is offered instead", () => {
  const late = setup();
  late.advance(BOOT_RELOAD_WINDOW_MS);
  late.takeOver();
  expect(late.calls).toMatchObject({ reload: 0, announce: 1 });

  const unsaved = setup({ unsaved: true });
  unsaved.takeOver();
  expect(unsaved.calls).toMatchObject({ reload: 0, announce: 1 });
});

test("the first install is not an update, and an update is offered once", () => {
  const s = setup({ controlled: false });
  s.takeOver();
  expect(s.calls).toMatchObject({ reload: 0, announce: 0 });
  s.advance(BOOT_RELOAD_WINDOW_MS);
  s.takeOver();
  s.takeOver();
  expect(s.calls.announce).toBe(1);
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
