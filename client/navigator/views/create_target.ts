// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
//
// Where a page typed into the picker is made: in the folder the tree has
// selected, else the folder of the page being edited. A name that already
// carries a path says where it goes, and a `^` meta name is its own.

/** The folder a page name lives in (`""` for the root). */
export function folderOf(name: string): string {
  const slash = name.lastIndexOf("/");
  return slash === -1 ? "" : name.slice(0, slash);
}

/** The name `phrase` becomes in `folder` (`""`/undefined: the root). */
export function createTarget(phrase: string, folder?: string): string {
  const name = phrase.trim();
  if (!folder || name === "" || name.includes("/") || name.startsWith("^")) {
    return name;
  }
  return `${folder}/${name}`;
}
