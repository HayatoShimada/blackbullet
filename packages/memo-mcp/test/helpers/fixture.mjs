// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
// Builds a small generic fixture space pair in a temp dir: `notes` (normal) and `work` (confidential).
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const page = (tags, body, extra = "") => `---\ntags: ${tags}\n${extra}---\n\n${body}\n`;

export const FILES = {
  "Projects/Demo.md": page(
    "project",
    "# Demo\n\n## Outcome\n\nShip the demo launch campaign by the end of September. Uses the newsletter and [[Areas/Operations]].\n\n## Next actions\n\n* [ ] Prepare the images #next [due: 2026-09-20]\n* [ ] Draft the announcement [due: 2026-09-25]\n* [x] Pick a date [completed: 2026-09-01]",
    "status: active\n"
  ),
  "Projects/在庫システム.md": page(
    "project",
    "# 在庫システム\n\n## Outcome\n\n倉庫の在庫数を自動で集計するシステムを作る。[[Areas/Operations]] に関連する。\n\n## 経緯\n\nバーコードで入出庫を記録する。",
    "status: active\n"
  ),
  "Areas/Operations.md": page(
    "area",
    "# Operations\n\n## Policy\n\nKeep the newsletter and social channels in sync. See [[Demo]] and [[Projects/在庫システム]].\n\n* [ ] Review the weekly checklist [due: 2026-09-30]"
  ),
  "Resources/Reading List.md": page(
    "resource",
    "# Reading List\n\n## Papers\n\nA survey of retrieval techniques. Related to [[Areas/Operations]]."
  ),
  "Journal/2026-09-20.md": page("journal", "# 2026-09-20\n\n## Done\n\nWrote the newsletter for the demo launch."),
  "Tasks/Buy stamps.md": "---\ntags: [todo]\nstatus: inbox\ndue:\nproject:\narea:\ncompleted:\n---\n# Buy stamps\nbuy stamps at the post office\n",
  "Tasks/Book venue.md": '---\ntags: [todo, event]\nstatus: next\ndue: 2026-09-18\nproject: "[[Projects/Demo]]"\narea: "[[Areas/Operations]]"\ncompleted:\n---\n# Book venue\nbook the venue for the demo\n',
  "Tasks/Send invoice.md": '---\ntags: [todo]\nstatus: done\ndue: 2026-09-10\nproject: "[[Projects/Demo]]"\narea:\ncompleted: 2026-09-09\n---\n# Send invoice\ninvoice sent\n',
  "CONFIG.md": '# Config\n\n```space-lua\nconfig.set("memoSidecar", {token="SECRET-TOKEN-XYZ"})\n```\n',
  // DB ビューで「削除」されたページ（Trash/ へ移動）。検索・Ask に出てはいけない
  "Trash/Old Plan.md": "---\ntrashedFrom: Projects/Old Plan\n---\n# Old Plan\n\n## Notes\nTRASHED-MARKER discarded idea\n",
};

export const WORK_FILES = {
  "Areas/Team.md": page("area", "# Team\n\n## 会議\n\n週次の会議メモ。議題は在庫と進捗。"),
};

export async function createFixture(prefix = "memo-fixture-") {
  const tmp = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  const notes = path.join(tmp, "notes");
  const work = path.join(tmp, "work");
  for (const [root, files] of [[notes, FILES], [work, WORK_FILES]]) {
    for (const [rel, text] of Object.entries(files)) {
      await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
      await fs.writeFile(path.join(root, rel), text);
    }
  }
  const idx = path.join(tmp, "idx");
  await fs.mkdir(idx);
  return {
    tmp,
    notes,
    work,
    idx,
    spacesEnv: `notes=${notes},work=${work}:confidential`,
    env: { MEMO_SPACES: `notes=${notes},work=${work}:confidential`, MEMO_INDEX_DIR: idx, MEMO_EMBED: "off" },
    cleanup: () => fs.rm(tmp, { recursive: true, force: true }),
  };
}
