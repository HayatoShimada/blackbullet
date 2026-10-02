/** Check if a tag marks a page as a meta page (exact "meta" or "meta/..." subtag) */
export function isMetaTag(tag: string): boolean {
  return tag === "meta" || tag.startsWith("meta/");
}

/** Extract the name from hashtag text, removing # prefix and <angle brackets> if necessary */
export function extractHashtag(text: string): string {
  if (text[0] !== "#") {
    console.error("extractHashtag called on already clean string", text);
    return text;
  } else if (text[1] === "<") {
    if (text.slice(-1) !== ">") {
      // this is malformed: #<name but maybe we're trying to autocomplete
      return text.slice(2);
    } else {
      return text.slice(2, -1);
    }
  } else {
    return text.slice(1);
  }
}
