// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// Web Push: the RFC 8291 test vector, the VAPID signature, the digest, the
// subscriptions and the morning timer. Push services are faked; nothing
// leaves the machine.
import { test, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { createFixture } from "./helpers/fixture.mjs";

const fx = await createFixture("memo-push-");
process.env.MEMO_INDEX_DIR = fx.idx;
process.env.MEMO_EMBED = "off";
const { parseSpaces } = await import("../src/space.mjs");
const { Indexes } = await import("../src/index.mjs");
const push = await import("../src/push.mjs");
const spaces = parseSpaces(fx.spacesEnv);
const indexes = new Indexes(spaces);
after(() => fs.rm(fx.tmp, { recursive: true, force: true }));

test("RFC 8291 Appendix A: the same bytes as the example", () => {
  const out = push.encryptPayload(
    "When I grow up, I want to be a watermelon",
    {
      p256dh: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
      auth: "BTBZMqHH6r4Tts7J_aSIgg",
    },
    { ephemeral: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", salt: "DGv6ra1nlYgDCS1FRnbzlw" }
  );
  assert.equal(
    out.toString("base64url"),
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
  );
});

test("the VAPID token is an ES256 JWT for the push service, verifiable with the public key", () => {
  const keys = push.generateVapidKeys();
  const header = push.vapidAuthorization("https://push.example.test/send/abc", keys, "https://example.test", 1_000_000);
  const [, t, k] = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.equal(k, keys.publicKey);
  const [h, c, sig] = t.split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url"));
  assert.equal(claims.aud, "https://push.example.test");
  assert.equal(claims.exp, 1000 + 12 * 3600);
  const raw = Buffer.from(keys.publicKey, "base64url");
  const pub = crypto.createPublicKey({
    key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") },
    format: "jwk",
  });
  assert.ok(crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
});

test("the digest counts what is due today and overdue, with up to three titles", () => {
  const today = "2026-09-20";
  const tasks = [
    { title: "A", due: "2026-09-18" },
    { title: "B", due: "2026-09-20" },
    { title: "C\nwith a line", due: "2026-09-20" },
    { title: "D", due: "2026-09-19" },
  ];
  const d = push.digest(tasks, today);
  assert.equal(d.title, "2 due today · 2 overdue");
  assert.equal(d.body, "• A\n• B\n• C with a line");
  assert.equal(push.digest(tasks, today, { titles: false }).body, "");
  assert.equal(push.digest([], today), null);
});

test("sent once a day, after the hour; dates and times in the given zone", () => {
  const at = new Date("2026-09-19T23:30:00Z");
  assert.deepEqual(push.localNow(at, "Asia/Tokyo"), { date: "2026-09-20", time: "08:30" });
  assert.deepEqual(push.localNow(at, "UTC"), { date: "2026-09-19", time: "23:30" });
  assert.equal(push.shouldSend({ date: "2026-09-20", time: "07:59" }, "08:00", null), false);
  assert.equal(push.shouldSend({ date: "2026-09-20", time: "08:00" }, "08:00", null), true);
  assert.equal(push.shouldSend({ date: "2026-09-20", time: "21:00" }, "08:00", "2026-09-20"), false);
});

test("open tasks due by today come from todo pages and checkbox lines", async () => {
  const tasks = push.dueTasks(await indexes.get("notes"), "2026-09-20");
  const titles = tasks.map((t) => t.title);
  assert.ok(titles.includes("Book venue"), titles.join(", "));
  assert.ok(titles.some((t) => t.includes("Prepare the images")));
  assert.ok(!titles.some((t) => t.includes("Draft the announcement")), "due later");
  assert.ok(!titles.includes("Send invoice"), "done");
});

/** A browser's subscription with real keys, and a fake push service. */
function subscriber() {
  const ecdh = crypto.createECDH("prime256v1");
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  return {
    sub: {
      endpoint: `https://push.example.test/${crypto.randomUUID()}`,
      keys: { p256dh: ecdh.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    },
    ecdh,
    auth,
  };
}

/** Decrypts what the fake push service received, as the browser would. */
function decrypt(body, { ecdh, auth }) {
  const salt = body.subarray(0, 16);
  const idlen = body[20];
  const asPublic = body.subarray(21, 21 + idlen);
  const ct = body.subarray(21 + idlen);
  const hmac = (k, d) => crypto.createHmac("sha256", k).update(d).digest();
  const shared = ecdh.computeSecret(asPublic);
  const ikm = hmac(hmac(auth, shared), Buffer.concat([Buffer.from("WebPush: info\0"), ecdh.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "binary")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "binary")).subarray(0, 12);
  const d = crypto.createDecipheriv("aes-128-gcm", cek, nonce);
  d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

function setup({ titles, clockAt = "2026-09-20T09:00:00+09:00" } = {}) {
  const sent = [];
  let status = 201;
  const dir = path.join(fx.tmp, `state-${crypto.randomUUID()}`);
  const p = push.createPush({
    spaces,
    indexes,
    env: { MEMO_STATE_DIR: dir, MEMO_TZ: "Asia/Tokyo", ...(titles === false ? { MEMO_PUSH_TITLES: "off" } : {}) },
    fetchImpl: async (url, init) => {
      sent.push({ url, init });
      return { status, ok: status < 300 };
    },
    clock: () => new Date(clockAt),
  });
  const call = (route, method, json) =>
    p.handle({ method }, new URL(`http://x/api/push/${route}`), async () => json ?? {});
  return { p, sent, call, dir, failWith: (s) => (status = s) };
}

test("subscribe, the morning digest once, encrypted for the subscriber", async () => {
  const s = setup();
  const browser = subscriber();
  const key = await s.call("key", "GET");
  assert.equal(Buffer.from(key.body.publicKey, "base64url").length, 65);
  assert.equal((await s.call("subscribe", "POST", { space: "nope", subscription: browser.sub })).status, 404);
  assert.equal((await s.call("subscribe", "POST", { space: "notes", subscription: { endpoint: "http://x" } })).status, 400);
  assert.equal((await s.call("subscribe", "POST", { space: "notes", subscription: browser.sub })).status, 200);

  assert.equal(await s.p.tick(), 1);
  assert.equal(await s.p.tick(), 0, "once a day");
  const [{ url, init }] = s.sent;
  assert.equal(url, browser.sub.endpoint);
  assert.equal(init.headers["Content-Encoding"], "aes128gcm");
  assert.match(init.headers.Authorization, /^vapid t=.+, k=/);
  const message = decrypt(init.body, browser);
  assert.match(message.title, /overdue/);
  assert.match(message.body, /Book venue/);
  assert.equal(message.url, "/Library/Std/Pages/Today");
  const stat = await fs.stat(path.join(s.dir, "vapid.json"));
  assert.equal(stat.mode & 0o777, 0o600);
});

test("before the hour nothing goes; titles can be left out; a confidential space never shows them", async () => {
  const early = setup({ clockAt: "2026-09-20T07:00:00+09:00" });
  await early.call("subscribe", "POST", { space: "notes", subscription: subscriber().sub });
  assert.equal(await early.p.tick(), 0);

  const quiet = setup({ titles: false });
  const b = subscriber();
  await quiet.call("subscribe", "POST", { space: "notes", subscription: b.sub });
  await quiet.p.tick();
  assert.equal(decrypt(quiet.sent[0].init.body, b).body, "");

  const work = setup();
  assert.equal(await work.p.messageFor("work"), null, "nothing due in the work fixture");
});

test("a subscription the push service no longer knows is dropped", async () => {
  const s = setup();
  const b = subscriber();
  await s.call("subscribe", "POST", { space: "notes", subscription: b.sub });
  s.failWith(410);
  assert.equal(await s.p.tick(), 0);
  assert.deepEqual((await s.p.store.load()).subscriptions, []);
});

test("a test message goes to the one subscription asked for; unsubscribe removes it", async () => {
  const s = setup();
  const a = subscriber();
  const b = subscriber();
  await s.call("subscribe", "POST", { space: "notes", subscription: a.sub });
  await s.call("subscribe", "POST", { space: "notes", subscription: b.sub });
  assert.deepEqual((await s.call("test", "POST", { endpoint: b.sub.endpoint })).body, { sent: 1 });
  assert.equal(s.sent.length, 1);
  assert.equal(s.sent[0].url, b.sub.endpoint);
  assert.equal((await s.call("unsubscribe", "POST", { endpoint: a.sub.endpoint })).body.removed, true);
  assert.equal((await s.p.store.load()).subscriptions.length, 1);
  assert.equal((await s.call("key", "POST")).status, 405);
});
