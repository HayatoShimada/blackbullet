// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
import { expect, test } from "vitest";
import { bootCommand } from "./boot_open.ts";

test("only the shortcuts' commands can be started from the URL", () => {
  expect(bootCommand("?open=journal")).toBe("Journal: Today");
  expect(bootCommand("?open=graph")).toBe("Graph: Open");
  expect(bootCommand("?open=Client%3A%20Wipe")).toBeUndefined();
  expect(bootCommand("?open=constructor")).toBeUndefined();
  expect(bootCommand("")).toBeUndefined();
});
