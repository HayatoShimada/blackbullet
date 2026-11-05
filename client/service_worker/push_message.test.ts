// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { notificationTarget, parsePushMessage } from "./push_message.ts";

const data = (v: unknown) => ({
  json: () => {
    if (v instanceof Error) throw v;
    return v;
  },
});

test("a digest message is shown as sent", () => {
  expect(
    parsePushMessage(
      data({
        title: "2 due today",
        body: "• A",
        url: "/Library/Std/Pages/Today",
        tag: "t",
      }),
    ),
  ).toEqual({
    title: "2 due today",
    body: "• A",
    url: "/Library/Std/Pages/Today",
    tag: "t",
  });
});

test("a broken or empty message still shows something", () => {
  expect(parsePushMessage(data(new Error("bad json"))).title).toBe(
    "BlackBullet",
  );
  expect(parsePushMessage(null).url).toBe("/Library/Std/Pages/Today");
  expect(parsePushMessage(data({ title: "" })).title).toBe("BlackBullet");
});

test("a click only goes to a page of this app", () => {
  expect(notificationTarget("/Journal/2026-11-05")).toBe("Journal/2026-11-05");
  expect(notificationTarget("https://evil.example/")).toBe(
    "Library/Std/Pages/Today",
  );
  expect(notificationTarget("//evil.example/")).toBe("Library/Std/Pages/Today");
  expect(notificationTarget(undefined)).toBe("Library/Std/Pages/Today");
});
