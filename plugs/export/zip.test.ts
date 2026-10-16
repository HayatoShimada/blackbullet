// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { crc32, createZip } from "./zip.ts";

const enc = new TextEncoder();

test("crc32 matches the reference value", () => {
  expect(crc32(enc.encode("123456789"))).toBe(0xcbf43926);
});

test("entries are stored with UTF-8 names and an end record", () => {
  const zip = createZip(
    [
      { name: "メモ.md", data: enc.encode("# 見出し\n") },
      { name: "images/a.png", data: new Uint8Array([1, 2, 3]) },
    ],
    new Date(2026, 9, 15, 12, 0, 0),
  );
  const view = new DataView(zip.buffer);
  expect(view.getUint32(0, true)).toBe(0x04034b50);
  expect(view.getUint16(6, true) & 0x0800).toBe(0x0800);
  const end = zip.length - 22;
  expect(view.getUint32(end, true)).toBe(0x06054b50);
  expect(view.getUint16(end + 10, true)).toBe(2);
  const centralAt = view.getUint32(end + 16, true);
  expect(view.getUint32(centralAt, true)).toBe(0x02014b50);
  const nameLen = view.getUint16(centralAt + 28, true);
  expect(
    new TextDecoder().decode(
      zip.subarray(centralAt + 46, centralAt + 46 + nameLen),
    ),
  ).toBe("メモ.md");
  // the first entry's data follows its local header
  const localNameLen = view.getUint16(26, true);
  const size = view.getUint32(18, true);
  expect(size).toBe(enc.encode("# 見出し\n").length);
  expect(
    new TextDecoder().decode(
      zip.subarray(30 + localNameLen, 30 + localNameLen + size),
    ),
  ).toBe("# 見出し\n");
});
