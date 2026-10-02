// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { h } from "preact";
import { renderToString } from "preact-render-to-string";
import { expect, test } from "vitest";
import { Confirm, splitQuestion } from "./basic_modals.tsx";

const render = (props: Record<string, unknown>) =>
  renderToString(
    h(Confirm as any, {
      message: "Move X to trash?",
      callback: () => {},
      ...props,
    }),
  );

test("a plain confirm names its button Ok and focuses it", () => {
  const html = render({});
  expect(html).toContain(">Ok<");
  // Exactly one button asks for focus: the confirm button.
  expect(html.match(/autofocus/g)).toHaveLength(1);
  expect(html.indexOf("autofocus")).toBeGreaterThan(html.indexOf("Cancel"));
});

test("okLabel names the verb on the confirm button", () => {
  const html = render({ okLabel: "Move to trash" });
  expect(html).toContain("Move to trash");
  expect(html).not.toContain(">Ok<");
});

test("a destructive confirm is red and starts on Cancel", () => {
  const html = render({ destructive: true, okLabel: "Move to trash" });
  expect(html.match(/autofocus/g)).toHaveLength(1);
  // The focused button is Cancel, which comes first.
  expect(html.indexOf("autofocus")).toBeLessThan(html.indexOf("Move to trash"));
  expect(html).toMatch(/danger/);
});

test("focusCancel false puts focus back on a destructive confirm button", () => {
  const html = render({ destructive: true, focusCancel: false });
  expect(html.indexOf("autofocus")).toBeGreaterThan(html.indexOf("Cancel"));
});

test("focusCancel focuses Cancel on a non-destructive confirm", () => {
  const html = render({ focusCancel: true });
  expect(html.indexOf("autofocus")).toBeLessThan(html.indexOf(">Ok<"));
});

test("a confirm stresses the question and keeps the consequence apart", () => {
  const html = render({
    message: "Move X to the trash? You can restore it from Trash.",
  });
  expect(html).toContain(
    '<span class="sb-prompt-question">Move X to the trash?</span> You can restore it from Trash.',
  );
});

test("splitQuestion separates the question from its consequence", () => {
  expect(
    splitQuestion("Move X to the trash? You can restore it from Trash."),
  ).toEqual({
    question: "Move X to the trash?",
    rest: "You can restore it from Trash.",
  });
  expect(splitQuestion("Xをゴミ箱へ移動しますか？元に戻せます。")).toEqual({
    question: "Xをゴミ箱へ移動しますか？",
    rest: "元に戻せます。",
  });
});

test("splitQuestion leaves a lone sentence or a URL query alone", () => {
  expect(splitQuestion("Delete page?")).toEqual({
    question: "Delete page?",
    rest: "",
  });
  expect(splitQuestion("Open /a?b=1 now")).toEqual({
    question: "Open /a?b=1 now",
    rest: "",
  });
});
