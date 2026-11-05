---
tags: component
partOf: "[[Architecture/Service Worker]]"
references:
- client/asset_bundle/bundle.ts
- client/asset_bundle/builder.ts
- client/boot.ts
---
The cached SilverBullet client code (JS, CSS, HTML) the [[Architecture/Service Worker]] serves so the app loads without the network.

## How it is kept current (BlackBullet)
- **Built per version.** Each build stamps the worker with `cache-<build time>`, so the worker file changes and the browser installs it as a new version. Its install fetches every client file into that cache; a file that came back through a redirect (an auth proxy's login page) is not kept.
- **Page loads go to the server first.** A navigation is answered by the server's shell, and by the precached one only when the server cannot be reached or does not answer within 4 seconds. Before this, `/` came from the copy taken at install until the next version.
- **A new version waits.** It does not skip waiting on install. `client/app_update.ts` lets it take over: at once right after a reload when nothing is unsaved, otherwise when the reader picks **Reload** on "A new version is ready". It is the only update notice; a server reporting a newer version only makes the tab look for it.
- **The previous version stays one more version.** Activation deletes every cache but its own and the newest before it (`client/service_worker/cache_names.ts`), so a tab still running the old code can load its lazy chunks. A chunk that is gone anyway reloads the page (once a minute at most) or, with unsaved work, offers the reload.
- **Resetting.** `Client: Reset Cache` deletes every cache and unregisters the worker, then reloads from the server; the synced notes in IndexedDB stay, and edits not yet sent go out with the next worker's first sync. It refuses when the server cannot be reached. `Client: Wipe` also drops the notes' local copy. The boot asks for persistent storage (`navigator.storage.persist()`) so Safari does not clear it after a week without a visit.
