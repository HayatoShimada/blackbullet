import type { SyncState } from "@silverbulletmd/silverbullet/type/revisions";

export function sameSyncState(a: SyncState, b: SyncState): boolean {
  if (a.state !== b.state) return false;
  switch (a.state) {
    case "conflicted":
      return (
        b.state === "conflicted" &&
        a.paths.length === b.paths.length &&
        a.paths.every((p, i) => p === b.paths[i])
      );
    case "paused":
      return b.state === "paused" && a.reason === b.reason;
    case "error":
      return (
        b.state === "error" && a.kind === b.kind && a.message === b.message
      );
    case "idle":
    case "syncing":
      return true;
  }
}

export function isLoudSyncState(state: SyncState): boolean {
  if (state.state === "conflicted") return state.paths.length > 0;
  return state.state === "error" || state.state === "paused";
}

// Reconnecting SSE must not resurrect a notification the user dismissed.
export function shouldFlashSyncNotification(
  next: SyncState,
  last: SyncState | undefined,
): boolean {
  if (!isLoudSyncState(next)) return false;
  return last === undefined || !sameSyncState(next, last);
}

export function syncStatusText(
  snapshot: import("@silverbulletmd/silverbullet/type/revisions").GitSyncSnapshot,
): string {
  if (!snapshot.enabled) return "Disconnected";
  if (snapshot.paused) return "Sync paused";
  switch (snapshot.sync.state) {
    case "syncing":
      return "Syncing…";
    case "conflicted":
      return `${snapshot.sync.paths.length} files need conflict resolution`;
    case "paused":
      return `Sync paused — ${snapshot.sync.reason}`;
    case "error":
      return "Sync needs attention";
    case "idle":
      if (snapshot.dirty)
        return "Changes waiting — local edits await an automatic commit";
      if (snapshot.pending || snapshot.incoming)
        return `Changes waiting — ${snapshot.pending ?? "unknown"} outgoing, ${snapshot.incoming ?? "unknown"} incoming`;
      if (!snapshot.lastSuccess) return "Waiting for the first successful sync";
      if (snapshot.pending === null || snapshot.incoming === null)
        return "Last sync succeeded; pending changes are not known";
      return `Up to date · ${new Date(snapshot.lastSuccess).toLocaleString()}`;
  }
}
