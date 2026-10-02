import { afterEach, expect, test, vi } from "vitest";
import {
  clearLogoutState,
  canCleanUpLogout,
  rememberLogoutForTab,
  setLogoutState,
  waitForLogout,
} from "./logout_state.ts";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("a boot paused for logout restarts instead of resuming stale state after fast cleanup", async () => {
  const storage = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  });
  const reload = vi.fn();
  vi.stubGlobal("location", { reload });
  vi.useFakeTimers();
  setLogoutState("fast", false);
  const boot = waitForLogout();
  setLogoutState("fast", true);
  clearLogoutState();
  await vi.advanceTimersByTimeAsync(100);
  expect(await boot).toBe(false);
  expect(reload).toHaveBeenCalledOnce();
});

test("a tab retains cleanup authorization after another tab clears shared logout state", () => {
  for (const name of ["localStorage", "sessionStorage"]) {
    const values = new Map<string, string>();
    vi.stubGlobal(name, {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    });
  }
  expect(canCleanUpLogout()).toBe(false);
  setLogoutState("two-tabs", false);
  rememberLogoutForTab();
  expect(canCleanUpLogout()).toBe(false);
  setLogoutState("two-tabs", true);
  rememberLogoutForTab();
  clearLogoutState();
  expect(canCleanUpLogout()).toBe(true);
  sessionStorage.removeItem("sb-logout-state");
  expect(canCleanUpLogout()).toBe(false);
});
