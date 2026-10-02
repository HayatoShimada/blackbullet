/** The pure part of "+ New": where a row goes, and what it starts with. */
import type { YamlPatch } from "../../../plug-api/lib/yaml.ts";
import type { DatabaseSpec } from "./model.ts";

const MAX_TITLE = 100;

/**
 * The page a new row is written to: the database's folder, then the title
 * with what a page name cannot carry taken out: `/` (it would make a folder),
 * control characters, and `# @ | < > $ [ ]` (ref syntax); leading dots (a
 * hidden file) and a trailing `.<letters or digits>` (it would read as a
 * file extension, so the name would open as a document) are removed too.
 * Null when nothing usable is left.
 */
export function rowPageName(folder: string, title: string): string | null {
  let name = title
    // biome-ignore lint/suspicious/noControlCharactersInRegex: that is the point
    .replace(/[\u0000-\u001f\u007f/#@|<>$[\]]/g, "")
    .trim()
    .slice(0, MAX_TITLE);
  for (;;) {
    const next = name
      .replace(/^\.+/, "")
      .replace(/\.[A-Za-z0-9]*$/, "")
      .trim();
    if (next === name) break;
    name = next;
  }
  if (name === "") return null;
  return `${folder}${name}`;
}

/** The frontmatter a new row starts with: its tag, and every default. */
export function rowPatches(database: DatabaseSpec): YamlPatch[] {
  const patches: YamlPatch[] = [
    { op: "set-key", path: "tags", value: [database.tag] },
  ];
  for (const p of database.properties) {
    if (p.default !== undefined) {
      patches.push({ op: "set-key", path: p.key, value: p.default });
    }
  }
  return patches;
}
