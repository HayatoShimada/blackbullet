// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada

import { PlusIcon } from "./chrome_icons.tsx";

/**
 * What an empty tree says: a sentence and the one thing to do about it, with
 * the button inline where the sentence points at it. A passive row -- it has
 * no selection and no Enter.
 */
export function EmptyTree({
  onNew,
  text,
}: {
  onNew: () => void;
  /** A plain sentence instead, where a new page would not show up (no button). */
  text?: string;
}) {
  if (text) {
    return (
      <div className="sb-nav-empty-folder" role="status">
        <span>{text}</span>
      </div>
    );
  }
  return (
    <div className="sb-nav-empty-folder" role="status">
      <span>Empty.</span>
      <button
        type="button"
        className="sb-nav-new sb-button-icon"
        aria-label="New page here"
        title="New page here"
        onClick={onNew}
      >
        <PlusIcon />
      </button>
      <span>makes a page here.</span>
    </div>
  );
}
