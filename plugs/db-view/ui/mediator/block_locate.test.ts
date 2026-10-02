// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { blockBodyOffset } from "./block_locate.ts";

const text =
  "# T\n\n```db\nsource: tasks\n```\n\n```db\nsource: projects\n```\n";

test("points at the first line of the matching block's body", () => {
  expect(blockBodyOffset(text, "source: projects")).toBe(
    text.indexOf("source: projects"),
  );
  expect(blockBodyOffset(text, "source: tasks\n")).toBe(
    text.indexOf("source: tasks"),
  );
});

test("-1 when the block changed or is not there", () => {
  expect(blockBodyOffset(text, "source: tag:x")).toBe(-1);
  expect(blockBodyOffset("```db\nsource: tasks", "source: tasks")).toBe(-1);
});
