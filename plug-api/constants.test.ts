// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { describe, expect, it } from "vitest";
import { exceedsDocumentLimit, maximumDocumentSize } from "./constants.ts";

describe("exceedsDocumentLimit", () => {
  it("treats 0 or a negative limit as no limit", () => {
    expect(exceedsDocumentLimit(5 * 1024 ** 3, 0)).toBe(false);
    expect(exceedsDocumentLimit(5 * 1024 ** 3, -1)).toBe(false);
  });
  it("compares bytes against a limit in MiB", () => {
    expect(exceedsDocumentLimit(10 * 1024 * 1024, 10)).toBe(false);
    expect(exceedsDocumentLimit(10 * 1024 * 1024 + 1, 10)).toBe(true);
  });
  it("defaults to no limit", () => {
    expect(maximumDocumentSize).toBe(0);
    expect(exceedsDocumentLimit(1024 ** 4, maximumDocumentSize)).toBe(false);
  });
});
