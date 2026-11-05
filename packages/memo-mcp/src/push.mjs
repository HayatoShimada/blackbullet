// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * Web Push: a morning digest of what is due, sent to the phones and browsers
 * that asked for it. Only node:crypto, no dependency:
 * - VAPID (RFC 8292): an ES256 JWT that says this server sent it.
 * - Message encryption (RFC 8291, aes128gcm): the push service (Google,
 *   Apple, Mozilla) carries the message but cannot read it.
 *
 * State lives in MEMO_STATE_DIR (not the index cache, which may be deleted):
 * `vapid.json` (the server's key pair, made on first use, mode 0600) and
 * `push.json` (the subscriptions and the day the digest last went out).
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(s, "base64url");

// ---------------------------------------------------------------- VAPID keys

/** A fresh P-256 key pair as raw base64url: public (65 bytes), private (32). */
export function generateVapidKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const jwk = privateKey.export({ format: "jwk" });
  const pub = publicKey.export({ format: "jwk" });
  return {
    publicKey: b64u(Buffer.concat([Buffer.from([4]), unb64u(pub.x), unb64u(pub.y)])),
    privateKey: jwk.d,
  };
}

function vapidPrivateKey({ publicKey, privateKey }) {
  const raw = unb64u(publicKey);
  return crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", x: b64u(raw.subarray(1, 33)), y: b64u(raw.subarray(33, 65)), d: privateKey },
    format: "jwk",
  });
}

/** The `Authorization` header value for a push to `endpoint` (RFC 8292). */
export function vapidAuthorization(endpoint, keys, subject, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64u(
    JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject })
  );
  const signature = crypto.sign("sha256", Buffer.from(`${header}.${claims}`), {
    key: vapidPrivateKey(keys),
    dsaEncoding: "ieee-p1363",
  });
  return `vapid t=${header}.${claims}.${b64u(signature)}, k=${keys.publicKey}`;
}

// ------------------------------------------------------------ encryption

const hmac = (key, data) => crypto.createHmac("sha256", key).update(data).digest();

/**
 * Encrypts `plaintext` for one subscription (RFC 8291, a single aes128gcm
 * record). `ephemeral` and `salt` are for the RFC's test vector; leave them
 * out to use fresh ones, as every real message must.
 * @param {{p256dh: string, auth: string}} subKeys the subscription's keys
 */
export function encryptPayload(plaintext, subKeys, { ephemeral, salt } = {}) {
  const uaPublic = unb64u(subKeys.p256dh);
  const authSecret = unb64u(subKeys.auth);
  const ecdh = crypto.createECDH("prime256v1");
  if (ephemeral) ecdh.setPrivateKey(unb64u(ephemeral));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const saltBytes = salt ? unb64u(salt) : crypto.randomBytes(16);

  const prkKey = hmac(authSecret, shared);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic, Buffer.from([1])]);
  const ikm = hmac(prkKey, keyInfo);
  const prk = hmac(saltBytes, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);

  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const body = Buffer.concat([
    cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([saltBytes, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// ------------------------------------------------------------ the digest

/** Today's date and the time of day ("HH:MM") in `timeZone` (or local). */
export function localNow(now = new Date(), timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(now)
      .map((p) => [p.type, p.value])
  );
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}` };
}

/** Open tasks due today or earlier: todo pages and checkbox lines. */
export function dueTasks(idx, today) {
  const pages = idx
    .rows(
      "select page, title, due from pages where (',' || tags || ',') like '%,todo,%' and (status is null or status <> 'done') and due is not null and due <> '' and due <= ?",
      [today]
    )
    .map((t) => ({ title: t.title || t.page, due: t.due }));
  const lines = idx
    .rows("select page, text, due from tasks where done = 0 and due is not null and due <> '' and due <= ?", [today])
    .map((t) => ({ title: t.text, due: t.due }));
  return [...pages, ...lines].sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
}

/**
 * The notification for one space, or null when nothing is due. Titles are
 * left out for a confidential space, or when `titles` is false.
 */
export function digest(tasks, today, { titles = true, url = "/Library/Std/Pages/Today" } = {}) {
  if (tasks.length === 0) return null;
  const dueToday = tasks.filter((t) => t.due === today).length;
  const overdue = tasks.length - dueToday;
  const counts = [dueToday ? `${dueToday} due today` : "", overdue ? `${overdue} overdue` : ""]
    .filter(Boolean)
    .join(" · ");
  const names = titles
    ? tasks
        .slice(0, 3)
        .map((t) => `• ${String(t.title).replace(/\s+/g, " ").slice(0, 80)}`)
        .join("\n")
    : "";
  return { title: counts, body: names, url, tag: "blackbullet-today" };
}

/** Whether the morning digest is due now: past `at` and not yet sent today. */
export function shouldSend(now, at, lastSent) {
  return now.time >= at && lastSent !== now.date;
}

// ------------------------------------------------------------ the store

export class PushStore {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, "push.json");
    this.keyFile = path.join(dir, "vapid.json");
  }

  async keys() {
    try {
      return JSON.parse(await fs.readFile(this.keyFile, "utf8"));
    } catch {
      const keys = generateVapidKeys();
      await fs.mkdir(this.dir, { recursive: true });
      await fs.writeFile(this.keyFile, JSON.stringify(keys), { mode: 0o600 });
      return keys;
    }
  }

  async load() {
    try {
      const state = JSON.parse(await fs.readFile(this.file, "utf8"));
      return { subscriptions: state.subscriptions ?? [], lastSent: state.lastSent ?? null };
    } catch {
      return { subscriptions: [], lastSent: null };
    }
  }

  async save(state) {
    await fs.mkdir(this.dir, { recursive: true });
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
    await fs.rename(tmp, this.file);
  }

  async subscribe(space, sub) {
    const state = await this.load();
    state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== sub.endpoint);
    state.subscriptions.push({ space, endpoint: sub.endpoint, keys: sub.keys, created: new Date().toISOString() });
    await this.save(state);
  }

  async unsubscribe(endpoint) {
    const state = await this.load();
    const before = state.subscriptions.length;
    state.subscriptions = state.subscriptions.filter((s) => s.endpoint !== endpoint);
    await this.save(state);
    return before !== state.subscriptions.length;
  }
}

/** A subscription as the browser's PushSubscription.toJSON() gives it. */
export function validSubscription(sub) {
  if (!sub || typeof sub !== "object") return false;
  let url;
  try {
    url = new URL(sub.endpoint);
  } catch {
    return false;
  }
  return (
    url.protocol === "https:" &&
    typeof sub.keys?.p256dh === "string" &&
    unb64u(sub.keys.p256dh).length === 65 &&
    typeof sub.keys?.auth === "string" &&
    unb64u(sub.keys.auth).length === 16
  );
}

// ------------------------------------------------------------ sending

/**
 * Sends one message. Resolves to "sent", "gone" (the subscription is dead and
 * should be dropped: 404/410) or "failed".
 */
export async function sendPush(sub, message, keys, subject, fetchImpl = fetch) {
  const body = encryptPayload(JSON.stringify(message), sub.keys);
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers: {
        Authorization: vapidAuthorization(sub.endpoint, keys, subject),
        "Content-Encoding": "aes128gcm",
        "Content-Type": "application/octet-stream",
        TTL: "43200",
        Urgency: "normal",
      },
      body,
    });
    if (res.status === 404 || res.status === 410) return "gone";
    return res.ok ? "sent" : "failed";
  } catch {
    return "failed";
  }
}

/**
 * Sends `messageFor(space)` to every subscription; drops the dead ones.
 * Returns how many were sent.
 */
export async function sendToAll(store, messageFor, { subject, fetchImpl = fetch, only } = {}) {
  const keys = await store.keys();
  const state = await store.load();
  let sent = 0;
  const gone = new Set();
  for (const sub of state.subscriptions) {
    if (only && sub.endpoint !== only) continue;
    const message = await messageFor(sub.space);
    if (!message) continue;
    const result = await sendPush(sub, message, keys, subject, fetchImpl);
    if (result === "sent") sent++;
    if (result === "gone") gone.add(sub.endpoint);
  }
  if (gone.size) {
    const fresh = await store.load();
    fresh.subscriptions = fresh.subscriptions.filter((s) => !gone.has(s.endpoint));
    await store.save(fresh);
  }
  return sent;
}

// ------------------------------------------------------------ wiring

const DEFAULT_SUBJECT = "https://github.com/HayatoShimada/blackbullet";

/**
 * Push for the HTTP server: the REST routes and the morning timer. Off (null)
 * without MEMO_STATE_DIR.
 */
export function createPush({ spaces, indexes, env = process.env, fetchImpl = fetch, clock = () => new Date() }) {
  const dir = env.MEMO_STATE_DIR;
  if (!dir) return null;
  const store = new PushStore(dir);
  const at = env.MEMO_PUSH_AT || "08:00";
  const timeZone = env.MEMO_TZ || undefined;
  const titlesOn = env.MEMO_PUSH_TITLES !== "off";
  const subject = env.MEMO_PUSH_SUBJECT || DEFAULT_SUBJECT;

  const messageFor = async (space) => {
    if (!spaces[space]) return null;
    const today = localNow(clock(), timeZone).date;
    const tasks = dueTasks(await indexes.get(space), today);
    return digest(tasks, today, { titles: titlesOn && !spaces[space].confidential });
  };

  const tick = async () => {
    const now = localNow(clock(), timeZone);
    const state = await store.load();
    if (!state.subscriptions.length || !shouldSend(now, at, state.lastSent)) return 0;
    // Recorded first: a crash mid-way must not send the digest twice.
    await store.save({ ...state, lastSent: now.date });
    return sendToAll(store, messageFor, { subject, fetchImpl });
  };

  /** /api/push/* — authenticated by the caller like every /api route. */
  const handle = async (req, url, readJson) => {
    const route = url.pathname.slice("/api/push/".length);
    const known = ["key", "subscribe", "unsubscribe", "test"];
    if (!known.includes(route)) return { status: 404, body: { error: "Not found" } };
    const method = route === "key" ? "GET" : "POST";
    if (req.method !== method) return { status: 405, body: { error: `${method} のみ対応しています` } };
    if (route === "key") return { status: 200, body: { publicKey: (await store.keys()).publicKey } };
    const json = await readJson();
    if (route === "subscribe") {
      if (typeof json.space !== "string" || !spaces[json.space]) return { status: 404, body: { error: "未知のスペース" } };
      if (!validSubscription(json.subscription)) return { status: 400, body: { error: "subscription が不正です" } };
      await store.subscribe(json.space, json.subscription);
      return { status: 200, body: { ok: true, at } };
    }
    if (route === "unsubscribe") {
      if (typeof json.endpoint !== "string") return { status: 400, body: { error: "endpoint が必要です" } };
      return { status: 200, body: { ok: true, removed: await store.unsubscribe(json.endpoint) } };
    }
    if (route === "test") {
      // One message now, to this subscription only: whether it arrives.
      if (typeof json.endpoint !== "string") return { status: 400, body: { error: "endpoint が必要です" } };
      const sent = await sendToAll(
        store,
        async (space) =>
          (await messageFor(space)) ?? { title: "Notifications are on", body: "Nothing is due today.", url: "/Library/Std/Pages/Today", tag: "blackbullet-today" },
        { subject, fetchImpl, only: json.endpoint }
      );
      return { status: 200, body: { sent } };
    }
  };

  return { store, tick, handle, messageFor };
}
