/**
 * Highlights phrase tokens independently of ranking: fuzzy rankers do not
 * necessarily report the character positions they matched.
 */

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Wraps every occurrence of a phrase's whitespace-separated tokens in `<mark>`. */
export function highlightMatches(text: string, phrase?: string) {
  if (!phrase) return text;
  const tokens = [
    ...new Set(phrase.trim().toLowerCase().split(/\s+/).filter(Boolean)),
  ];
  if (tokens.length === 0) return text;
  const re = new RegExp(`(${tokens.map(escapeRegExp).join("|")})`, "gi");
  return text
    .split(re)
    .map((part, i) =>
      tokens.includes(part.toLowerCase()) ? <mark key={i}>{part}</mark> : part,
    );
}
