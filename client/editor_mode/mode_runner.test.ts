// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test, vi } from "vitest";
import { createEditorModeRunner } from "./mode_runner.ts";

function deps() {
  return { setPreview: vi.fn(), armTabFocus: vi.fn(), render: vi.fn() };
}

test("a change is drawn and its effects are carried out", () => {
  const d = deps();
  const runner = createEditorModeRunner(d);
  runner.emit({ type: "sync", vim: true, preview: false, locked: false });
  runner.emit({ type: "key.escape" });
  expect(runner.state.surface).toBe("preview");
  expect(d.setPreview).toHaveBeenCalledWith(true, undefined);
  runner.emit({ type: "key.edit", key: "a" });
  expect(d.setPreview).toHaveBeenLastCalledWith(false, "a");
  runner.emit({ type: "key.escape" });
  expect(d.render).toHaveBeenCalledTimes(4);
});

test("nothing changed: nothing drawn", () => {
  const d = deps();
  const runner = createEditorModeRunner(d);
  runner.emit({ type: "sync", vim: false, preview: false, locked: false });
  runner.emit({ type: "vim.modeChanged", mode: "normal" });
  expect(d.render).not.toHaveBeenCalled();
});

test("Esc in Preview arms Tab", () => {
  const d = deps();
  const runner = createEditorModeRunner(d);
  runner.emit({ type: "toggle" });
  runner.emit({ type: "key.escape" });
  expect(d.armTabFocus).toHaveBeenCalledOnce();
});
