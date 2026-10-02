import { space } from "@silverbulletmd/silverbullet/syscalls";
import type { GitSyncSnapshot } from "@silverbulletmd/silverbullet/type/revisions";

let snapshot: GitSyncSnapshot | undefined;
let sequence = 0;
let streamConnected: boolean | undefined;
let stale = false;

export function setGitSyncStreamConnected(connected: boolean): boolean {
  const changed = streamConnected !== connected;
  streamConnected = connected;
  if (!connected) stale = true;
  return changed;
}

export async function loadGitSyncStatus(): Promise<{
  snapshot?: GitSyncSnapshot;
  stale: boolean;
}> {
  const request = ++sequence;
  try {
    const next = await space.getGitSyncStatus();
    if (request === sequence) {
      snapshot = next;
      stale = streamConnected === false;
    }
  } catch (error: any) {
    if (request === sequence) {
      if (error?.status === 404 || typeof space.getGitSyncStatus !== "function")
        return { stale: false };
      stale = true;
    }
  }
  return { snapshot, stale };
}
