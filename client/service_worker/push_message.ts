// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

/** (BlackBullet) What the sidecar's notifications carry. */
export type PushMessage = {
  title: string;
  body: string;
  url: string;
  tag: string;
};

const FALLBACK: PushMessage = {
  title: "BlackBullet",
  body: "",
  url: "/Library/Std/Pages/Today",
  tag: "blackbullet",
};

/** The message in a push event's data; a broken one still shows something. */
export function parsePushMessage(
  data: { json(): unknown } | null | undefined,
): PushMessage {
  let raw: unknown;
  try {
    raw = data?.json();
  } catch {
    return FALLBACK;
  }
  if (!raw || typeof raw !== "object") return FALLBACK;
  const m = raw as Record<string, unknown>;
  const text = (v: unknown, fallback: string) =>
    typeof v === "string" && v.trim() ? v : fallback;
  return {
    title: text(m.title, FALLBACK.title),
    body: typeof m.body === "string" ? m.body : "",
    url: text(m.url, FALLBACK.url),
    tag: text(m.tag, FALLBACK.tag),
  };
}

/**
 * Where a click on the notification goes: a path inside this app only. A
 * full URL elsewhere (or a scheme) is not followed.
 */
export function notificationTarget(url: unknown): string {
  if (typeof url !== "string" || !url.startsWith("/") || url.startsWith("//"))
    return FALLBACK.url.slice(1);
  // Relative to the app's base, so a space under a prefix keeps it.
  return url.slice(1);
}
