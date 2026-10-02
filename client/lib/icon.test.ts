import { describe, expect, test } from "vitest";
import {
  emojiMarkup,
  isEmojiIcon,
  parseIcon,
  resolveIconMarkup,
} from "./icon.ts";

describe("emoji icons", () => {
  test.each(["📚", "🚀", "❤️", "👨‍👩‍👧", "🇯🇵", "👍🏽", "  📚  "])(
    "%s is an emoji",
    (icon) => {
      expect(isEmojiIcon(icon)).toBe(true);
      expect(parseIcon(icon).kind).toBe("emoji");
    },
  );

  test.each([
    "star",
    "feather:star",
    "book-open",
    "",
    "a📚",
    "<svg></svg>",
    "1",
  ])("%j is not an emoji", (icon) => {
    expect(isEmojiIcon(icon)).toBe(false);
    expect(parseIcon(icon).kind).not.toBe("emoji");
  });

  test("an emoji keeps its place in the other parse kinds", () => {
    expect(parseIcon("feather:star")).toEqual({
      kind: "feather",
      name: "star",
    });
    expect(parseIcon("other:x")).toEqual({ kind: "unknown", prefix: "other" });
    expect(parseIcon(5)).toEqual({ kind: "invalid" });
  });

  test("renders as SVG text, escaped", () => {
    const markup = emojiMarkup("📚");
    expect(markup.startsWith("<svg")).toBe(true);
    expect(markup).toContain(">📚</text>");
    expect(emojiMarkup("<")).not.toContain("<<");
  });

  test("resolves to markup without a DOM", () => {
    expect(resolveIconMarkup("📚")).toContain("📚");
  });
});
