import { expect, test, vi } from "vitest";
const getGitSyncStatus = vi.fn();
vi.mock("@silverbulletmd/silverbullet/syscalls", () => ({
  space: { getGitSyncStatus },
}));
const snapshot = {
  sync: { state: "idle" },
  lastSuccess: 123,
  lastAttempt: 123,
  version: 1,
  enabled: true,
  paused: false,
  pending: 0,
  incoming: 0,
};

test("a failed status refresh preserves the successful timestamp and marks it stale", async () => {
  vi.resetModules();
  const { loadGitSyncStatus } = await import("./git_sync_status.ts");
  getGitSyncStatus.mockResolvedValueOnce(snapshot);
  expect((await loadGitSyncStatus()).stale).toBe(false);
  getGitSyncStatus.mockRejectedValueOnce(new Error("offline"));
  const result = await loadGitSyncStatus();
  expect(result.stale).toBe(true);
  expect(result.snapshot?.lastSuccess).toBe(123);
});

test("an earlier status response cannot replace a newer successful check", async () => {
  vi.resetModules();
  const { loadGitSyncStatus } = await import("./git_sync_status.ts");
  let finish!: (value: typeof snapshot) => void;
  getGitSyncStatus.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const earlier = loadGitSyncStatus();
  getGitSyncStatus.mockResolvedValueOnce({
    ...snapshot,
    version: 2,
    lastSuccess: 456,
  });
  await loadGitSyncStatus();
  finish(snapshot);
  expect((await earlier).snapshot?.lastSuccess).toBe(456);
});

test("a successful HTTP refresh remains stale while the event stream is disconnected", async () => {
  vi.resetModules();
  const { loadGitSyncStatus, setGitSyncStreamConnected } = await import(
    "./git_sync_status.ts"
  );
  setGitSyncStreamConnected(false);
  getGitSyncStatus.mockResolvedValueOnce(snapshot);
  expect((await loadGitSyncStatus()).stale).toBe(true);
  setGitSyncStreamConnected(true);
  getGitSyncStatus.mockResolvedValueOnce(snapshot);
  expect((await loadGitSyncStatus()).stale).toBe(false);
});
