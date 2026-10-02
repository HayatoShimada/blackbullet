import { expect, test } from "vitest";
import { builtinPlugNames, builtinPlugPaths } from "./builtin_plugs.ts";

test("does not bundle the retired core plug", () => {
  expect(builtinPlugNames).not.toContain("core");
  expect(builtinPlugPaths).not.toContain("Library/Std/Plugs/core.plug.js");
});
