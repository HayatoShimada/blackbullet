// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * (BlackBullet) The browser's side of notifications: permission and the push
 * subscription. The sidecar keeps the subscriptions and sends the messages;
 * the commands that join the two live in Library/Std/Editor/Notifications.
 */
import type { SysCallMapping } from "../system.ts";

export type NotificationStatus = {
  /** This browser can receive push messages here at all. */
  supported: boolean;
  /** "default" (not asked yet), "granted" or "denied". */
  permission: string;
  /** This browser has a push subscription for this app. */
  subscribed: boolean;
  /** An iPhone or iPad browsing in Safari, not the installed app: push
   * needs the app added to the Home Screen first. */
  needsInstall: boolean;
};

const isIOS = () =>
  /iPad|iPhone|iPod/.test(navigator.userAgent) ||
  (navigator.userAgent.includes("Mac") && navigator.maxTouchPoints > 1);
const isStandalone = () =>
  globalThis.matchMedia?.("(display-mode: standalone)").matches ||
  (navigator as { standalone?: boolean }).standalone === true;

export function urlBase64ToBytes(key: string): Uint8Array<ArrayBuffer> {
  const pad = "=".repeat((4 - (key.length % 4)) % 4);
  const raw = atob((key + pad).replace(/-/g, "+").replace(/_/g, "/"));
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function registration(): Promise<ServiceWorkerRegistration> {
  if (!navigator.serviceWorker) {
    throw new Error("Notifications need the app's service worker.");
  }
  return await navigator.serviceWorker.ready;
}

async function status(): Promise<NotificationStatus> {
  const supported =
    "serviceWorker" in navigator &&
    "PushManager" in globalThis &&
    "Notification" in globalThis;
  let subscribed = false;
  if (supported && navigator.serviceWorker.controller) {
    const reg = await navigator.serviceWorker.getRegistration();
    subscribed = !!(await reg?.pushManager.getSubscription());
  }
  return {
    supported,
    permission: supported ? Notification.permission : "denied",
    subscribed,
    needsInstall: isIOS() && !isStandalone(),
  };
}

export function notificationSyscalls(): SysCallMapping {
  return {
    "notifications.status": {
      callback: () => status(),
      description:
        "Whether this browser can receive notifications, has allowed them, and is subscribed.",
      returns: [
        {
          type: "table",
          description:
            "`supported`, `permission` (default, granted or denied), `subscribed` and `needsInstall` (an iPhone outside the installed app).",
        },
      ],
    },
    "notifications.requestPermission": {
      // Asked first thing in a command: Safari only shows the prompt close
      // to the tap that started it.
      callback: async () =>
        "Notification" in globalThis
          ? await Notification.requestPermission()
          : "denied",
      description:
        "Asks the reader to allow notifications; returns default, granted or denied.",
      returns: [{ type: "string", description: "The permission." }],
    },
    "notifications.subscribe": {
      callback: async (_ctx, publicKey: string) => {
        const reg = await registration();
        const key = urlBase64ToBytes(publicKey);
        const existing = await reg.pushManager.getSubscription();
        if (existing) {
          // A subscription made for another server key is useless here.
          const same =
            existing.options.applicationServerKey &&
            new Uint8Array(existing.options.applicationServerKey).every(
              (b, i) => b === key[i],
            );
          if (same) return existing.toJSON();
          await existing.unsubscribe();
        }
        const sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        return sub.toJSON();
      },
      description:
        "Subscribes this browser to push messages signed with the given server key.",
      parameters: [
        {
          name: "publicKey",
          type: "string",
          description: "The sender's VAPID public key, base64url.",
        },
      ],
      returns: [
        {
          type: "table",
          description: "The subscription: `endpoint` and `keys`.",
        },
      ],
    },
    "notifications.unsubscribe": {
      callback: async () => {
        const reg = await registration();
        const sub = await reg.pushManager.getSubscription();
        if (!sub) return null;
        const endpoint = sub.endpoint;
        await sub.unsubscribe();
        return endpoint;
      },
      description:
        "Ends this browser's push subscription; returns its endpoint, or nil when there was none.",
      returns: [{ type: "string", description: "The endpoint, or nil." }],
    },
    "notifications.endpoint": {
      callback: async () => {
        const reg = await registration();
        return (await reg.pushManager.getSubscription())?.endpoint ?? null;
      },
      description: "This browser's push endpoint, or nil when not subscribed.",
      returns: [{ type: "string", description: "The endpoint, or nil." }],
    },
  };
}
