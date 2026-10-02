import { clearLogoutState } from "./logout_state.ts";
export async function deleteLocalSpaceData(): Promise<void> {
  const keys = Array.from({ length: localStorage.length }, (_, index) =>
    localStorage.key(index),
  );
  for (const key of keys) {
    if (
      key &&
      (key.startsWith("silverbullet.") ||
        key.startsWith("sb-local-encryption-verifier:") ||
        key === "enableEncryption")
    )
      localStorage.removeItem(key);
  }
  if (typeof sessionStorage !== "undefined") sessionStorage.clear();
  const databases = await indexedDB.databases();
  const deletions = await Promise.allSettled(
    databases.flatMap(({ name }) =>
      name && /^sb_(data|files)_[a-f0-9]{64}$/.test(name)
        ? [
            new Promise<void>((resolve, reject) => {
              const request = indexedDB.deleteDatabase(name);
              const timeout = setTimeout(
                () =>
                  reject(
                    new Error(
                      "Local data could not be completely removed. Close other SilverBullet windows, then retry cleanup.",
                    ),
                  ),
                5000,
              );
              request.onsuccess = () => {
                clearTimeout(timeout);
                resolve();
              };
              request.onerror = () => {
                clearTimeout(timeout);
                reject(request.error);
              };
            }),
          ]
        : [],
    ),
  );
  const failure = deletions.find((result) => result.status === "rejected");
  if (failure?.status === "rejected") throw failure.reason;
  clearLogoutState();
}
