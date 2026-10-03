// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { decideKey, type VimSnapshot } from "./mode_keys.ts";

const normal: VimSnapshot = {
  insertMode: false,
  visualMode: false,
  pending: false,
  busy: false,
};

function key(k: string, mods: Partial<KeyboardEvent> = {}) {
  return {
    key: k,
    ctrlKey: false,
    altKey: false,
    metaKey: false,
    isComposing: false,
    defaultPrevented: false,
    ...mods,
  };
}

test("a plain Esc in Normal is the mode's", () => {
  expect(decideKey(key("Escape"), normal, false)).toEqual({
    type: "key.escape",
  });
});

test("Esc is vim's while anything is pending, open or selected", () => {
  for (const vim of [
    { ...normal, insertMode: true },
    { ...normal, visualMode: true },
    { ...normal, pending: true },
    { ...normal, busy: true },
  ]) {
    expect(decideKey(key("Escape"), vim, false)).toBeUndefined();
    expect(decideKey(key("Escape"), vim, true)).toBeUndefined();
  }
});

test("in Preview, i a o I A O and Enter go back to Edit", () => {
  for (const k of ["i", "a", "o", "I", "A", "O", "Enter"]) {
    expect(decideKey(key(k), normal, true)).toEqual({
      type: "key.edit",
      key: k,
    });
  }
});

test("in Preview, change commands are swallowed and motions pass", () => {
  for (const k of ["c", "s", "S", "C", "R"]) {
    expect(decideKey(key(k), normal, true)).toBe("swallow");
  }
  for (const k of ["j", "k", "G", "/", "n", "y", "v", "x", "d", "u"]) {
    expect(decideKey(key(k), normal, true)).toBeUndefined();
  }
});

test("in Edit, letters are vim's", () => {
  expect(decideKey(key("i"), normal, false)).toBeUndefined();
});

test("modified, composing and handled keys are never the mode's", () => {
  for (const mods of [
    { ctrlKey: true },
    { altKey: true },
    { metaKey: true },
    { isComposing: true },
    { defaultPrevented: true },
  ]) {
    expect(decideKey(key("Escape", mods), normal, false)).toBeUndefined();
    expect(decideKey(key("i", mods), normal, true)).toBeUndefined();
  }
});
