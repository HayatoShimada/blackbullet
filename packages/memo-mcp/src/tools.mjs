// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * MCP ツール定義。stdio 版と HTTP 版で共有する。
 */
import { z } from "zod";
import {
  enabledSpaces,
  listFiles,
  listDocs,
  readPage,
  appendToPage,
  insertUnderHeading,
  completeTask,
} from "./space.mjs";
import { Indexes } from "./index.mjs";
import { searchSpace, neighbors } from "./search.mjs";
import { EMBED_ENABLED, MODEL as EMBED_MODEL } from "./embed.mjs";
import { kindOf, docIndexable } from "./extract.mjs";

const spaces = enabledSpaces();
const SPACE_NAMES = Object.keys(spaces);
const spaceEnum = z.enum(SPACE_NAMES);
const spaceDesc = SPACE_NAMES.map((n) => `${n}: ${spaces[n].description}`).join(" / ");

const json = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
// 全ツールが共有する索引。各呼び出しの冒頭で refresh() が mtime 差分だけ取り込む
const indexes = new Indexes(spaces);
const CONFIDENTIAL_NOTE =
  "Results include a confidential space: do not quote or summarize it in public material.";
const fail = (e) => ({ isError: true, content: [{ type: "text", text: `エラー: ${e.message}` }] });

/** 全スペース、または指定スペースのページを走査する。 */
async function eachSpace(space, fn) {
  const targets = space ? [space] : SPACE_NAMES;
  const out = [];
  for (const s of targets) out.push(...(await fn(s)));
  return out;
}

const today = () => new Date().toLocaleDateString("sv-SE"); // YYYY-MM-DD（ローカル時刻）

export function registerTools(server) {
  // ---------- 読み取り ----------

  server.registerTool(
    "list_spaces",
    {
      title: "スペース一覧",
      description:
        "公開されているメモスペースと、その規模を返す。最初に呼ぶと全体像がつかめる。" +
        "docs は索引対象の PDF / Office 文書（拡張子つきのページ名で検索に出る）のファイル数。index.docs は実際にテキストを取り出せた数。",
      inputSchema: {},
    },
    async () => {
      try {
        const out = [];
        for (const name of SPACE_NAMES) {
          const files = await listFiles(spaces, name);
          const docs = (await listDocs(spaces, name)).filter((d) => docIndexable(d.page, d.kind));
          const folders = {};
          for (const f of files) {
            const top = f.page.includes("/") ? f.page.split("/")[0] : "(root)";
            folders[top] = (folders[top] ?? 0) + 1;
          }
          const idx = await indexes.get(name);
          out.push({
            space: name,
            description: spaces[name].description,
            pages: files.length,
            docs: docs.length,
            folders,
            index: idx.stats(),
            confidential: Boolean(spaces[name].confidential),
          });
        }
        return json({ spaces: out, embedding: EMBED_ENABLED ? EMBED_MODEL : "off" });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "search_notes",
    {
      title: "メモ検索（ハイブリッド）",
      description:
        "見出し（節）単位で検索し、行範囲つきで返す。全文検索(FTS5)とローカル埋め込みの意味検索を統合する。" +
        "結果の page / line_start を read_section に渡すと本文が読める。" +
        `スペース: ${spaceDesc}`,
      inputSchema: {
        query: z.string().describe("検索語または自然文。空にするとフィルタ条件だけで絞り込み（更新順）"),
        space: spaceEnum.optional().describe("省略すると全スペース"),
        tag: z.string().optional().describe("frontmatter の tags で絞る（project / journal / area / archive / goal / inbox など）"),
        area: z.string().optional().describe("frontmatter の area で絞る"),
        status: z.string().optional().describe("frontmatter の status で絞る（active / done / someday）"),
        since: z.string().optional().describe("YYYY-MM-DD。この日以降に更新されたページだけ"),
        mode: z.enum(["hybrid", "lexical", "semantic"]).default("hybrid").describe("hybrid が既定。lexical は語の一致だけ、semantic は意味だけ"),
        limit: z.number().int().min(1).max(50).default(10),
      },
    },
    async ({ query, space, tag, area, status, since, mode = "hybrid", limit = 10 }) => {
      try {
        const opts = { query, tag, area, status, since, mode, limit };
        const results = [];
        let semanticUsed = false;
        for (const idx of await indexes.all(space)) {
          const hits = await searchSpace(idx, opts);
          semanticUsed ||= hits.semanticUsed;
          results.push(...hits);
        }
        results.sort((a, b) => b.score - a.score);
        const out = results.slice(0, limit);
        return json({
          count: out.length,
          mode: semanticUsed ? mode : "lexical",
          note: out.some((r) => r.confidential) ? CONFIDENTIAL_NOTE : undefined,
          results: out,
        });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "read_section",
    {
      title: "節を読む",
      description:
        "search_notes が返した page と line_start（または見出しパス）で、その節だけを行番号つきで返す。" +
        "返る modified は書き込み系ツールの expected_modified にそのまま使える。" +
        "PDF / Office 文書（kind が md 以外）は行番号を持たないので、索引に入れた抽出テキストをそのまま返す。",
      inputSchema: {
        space: spaceEnum,
        page: z.string(),
        line_start: z.number().int().min(1).optional().describe("search_notes の line_start"),
        heading_path: z.string().optional().describe('見出しパス。例 "Next actions"、"Notes > 経緯"'),
      },
    },
    async ({ space, page, line_start, heading_path }) => {
      try {
        const idx = await indexes.get(space);
        const rows = idx.rows(
          `select s.heading_path, s.line_start, s.line_end, s.text, p.modified, p.path, p.kind
           from sections s join pages p on p.page = s.page where s.page = ? order by s.n`,
          [page]
        );
        if (!rows.length) throw new Error(`ページが見つかりません: ${space}/${page}`);
        const sec =
          (line_start && rows.find((r) => r.line_start === line_start)) ||
          (heading_path && rows.find((r) => r.heading_path === heading_path)) ||
          (heading_path && rows.find((r) => r.heading_path.endsWith(heading_path))) ||
          null;
        if (!sec) {
          return json({ space, page, kind: rows[0].kind, found: false, sections: rows.map((r) => ({ heading_path: r.heading_path, line_start: r.line_start, line_end: r.line_end })) });
        }
        let body;
        if (sec.kind !== "md") {
          // PDF / Office は行番号を持たない。索引に入れた抽出済みテキストをそのまま返す。原本はバイナリなので読み直さない。
          body = sec.text;
        } else {
          const { readFile } = await import("node:fs/promises");
          const lines = (await readFile(sec.path, "utf-8")).split(/\r?\n/);
          body = lines.slice(sec.line_start - 1, sec.line_end).map((l, i) => `${sec.line_start + i}: ${l}`).join("\n");
        }
        return json({ space, page, kind: sec.kind, heading_path: sec.heading_path, line_start: sec.line_start, line_end: sec.line_end, modified: sec.modified, confidential: Boolean(spaces[space].confidential), text: body });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "related_notes",
    {
      title: "関連メモ",
      description: "あるページから辿れるもの: リンク先、被リンク（このページを参照しているページ）、意味的に近い節。",
      inputSchema: {
        space: spaceEnum,
        page: z.string(),
        limit: z.number().int().min(1).max(20).default(5),
      },
    },
    async ({ space, page, limit = 5 }) => {
      try {
        const idx = await indexes.get(space);
        if (!idx.rows("select 1 x from pages where page = ?", [page]).length) throw new Error(`ページが見つかりません: ${space}/${page}`);
        const outgoing = idx.rows("select distinct to_page as page, display from links where from_page = ?", [page]);
        const backlinks = idx.rows("select distinct from_page as page from links where to_page = ? or to_page = ?", [page, page.split("/").pop()]);
        const similar = await neighbors(idx, page, limit);
        return json({ space, page, outgoing, backlinks, similar, confidential: Boolean(spaces[space].confidential) });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "recent_changes",
    {
      title: "最近の更新",
      description: "最近更新されたページを新しい順に返す。何が動いているかの把握に使う。",
      inputSchema: {
        space: spaceEnum.optional(),
        days: z.number().int().min(1).max(365).default(7),
        limit: z.number().int().min(1).max(100).default(20),
      },
    },
    async ({ space, days = 7, limit = 20 }) => {
      try {
        const since = new Date(Date.now() - days * 86400000).toISOString();
        const rows = [];
        for (const idx of await indexes.all(space)) {
          rows.push(
            ...idx.rows(
              "select page, tags, status, due, summary, modified from pages where modified >= ? order by modified desc",
              [since]
            ).map((r) => ({ space: idx.space, ...r, tags: r.tags ? r.tags.split(",") : [] }))
          );
        }
        rows.sort((a, b) => (a.modified < b.modified ? 1 : -1));
        return json({ since, count: rows.length, pages: rows.slice(0, limit) });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "read_note",
    {
      title: "メモを読む",
      description:
        "1ページの全文を返す。書き込み系ツールに渡す modified（競合検出用）もここで得られる。" +
        "拡張子つきの文書ページ（Images/report.pdf など）は、索引に入れた抽出テキストを節ごとに連結して返す。",
      inputSchema: {
        space: spaceEnum,
        page: z.string().describe('ページ名。例 "Journal/2026-09-17" や "Projects/デモ準備_10月末"、文書なら "Images/report.pdf"'),
        raw: z
          .boolean()
          .default(false)
          .describe("true にすると SilverBullet のクエリブロックを除去せずそのまま返す"),
      },
    },
    async ({ space, page, raw = false }) => {
      try {
        // 文書ページは原本がバイナリなので、.md を付けて読みに行かず索引の抽出テキストを返す。
        // 索引に無ければ foo.txt.md のような通常ページかもしれないので readPage に回す。
        const doc = kindOf(page) ? (await indexes.get(space)).document(page) : null;
        if (doc) return json({ ...doc, confidential: Boolean(spaces[space].confidential) });
        return json(await readPage(spaces, space, page, { stripQuery: !raw }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "list_tasks",
    {
      title: "タスク一覧",
      description:
        "タスクを横断で集める。既定は未完了のみ、期限の早い順。期限なしは後ろに回る。",
      inputSchema: {
        space: spaceEnum.optional(),
        done: z.boolean().default(false).describe("true にすると完了済みを返す"),
        tag: z.string().optional().describe("タスク行のハッシュタグで絞る（next / waiting など）"),
        due_before: z.string().optional().describe("YYYY-MM-DD。この日以前が期限のものだけ"),
        limit: z.number().int().min(1).max(200).default(50),
      },
    },
    async ({ space, done = false, tag, due_before, limit = 50 }) => {
      try {
        const rows = [];
        for (const idx of await indexes.all(space)) {
          const where = ["done = ?"];
          const bind = [done ? 1 : 0];
          if (tag) { where.push("(',' || tags || ',') like ?"); bind.push(`%,${tag},%`); }
          if (due_before) { where.push("due is not null and due <= ?"); bind.push(due_before); }
          rows.push(
            ...idx.rows(`select page, line, text, due, start, completed, tags from tasks where ${where.join(" and ")}`, bind)
              .map((t) => ({ space: idx.space, page: t.page, line: t.line, text: t.text, due: t.due ?? null, start: t.start ?? null, completed: t.completed ?? null, tags: t.tags ? t.tags.split(",") : [] }))
          );
        }
        rows.sort((a, b) => {
          if (a.due && b.due) return a.due < b.due ? -1 : 1;
          if (a.due) return -1;
          if (b.due) return 1;
          return 0;
        });
        return json({ count: rows.length, tasks: rows.slice(0, limit) });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "list_projects",
    {
      title: "プロジェクト一覧",
      description:
        "tags: project のページを、期限と未完了タスク数つきで返す。既定は status: active のみ。",
      inputSchema: {
        space: spaceEnum.optional(),
        status: z
          .string()
          .optional()
          .describe('省略すると active のみ。"all" で全件。done / someday も指定できる'),
      },
    },
    async ({ space, status }) => {
      try {
        const want = status ?? "active";
        const rows = [];
        for (const idx of await indexes.all(space)) {
          const bind = [];
          let sql = `select p.page, p.status, p.due, p.area, p.goal, p.summary, p.modified,
                       (select count(*) from tasks t where t.page = p.page and t.done = 0) open_tasks,
                       (select count(*) from tasks t where t.page = p.page and t.done = 1) done_tasks
                     from pages p where (',' || p.tags || ',') like '%,project,%'`;
          if (want !== "all") { sql += " and p.status = ?"; bind.push(want); }
          rows.push(...idx.rows(sql, bind).map((r) => ({ space: idx.space, ...r })));
        }
        rows.sort((a, b) => {
          if (a.due && b.due) return a.due < b.due ? -1 : 1;
          if (a.due) return -1;
          if (b.due) return 1;
          return 0;
        });
        return json({ count: rows.length, projects: rows });
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "list_journal",
    {
      title: "日報一覧",
      description: "Journal 配下の日報を新しい順に返す。date を指定するとその日の全文を返す。",
      inputSchema: {
        space: spaceEnum.optional(),
        date: z.string().optional().describe("YYYY-MM-DD。指定するとその日の日報の全文を返す"),
        limit: z.number().int().min(1).max(100).default(14),
      },
    },
    async ({ space, date, limit = 14 }) => {
      try {
        if (date) {
          const out = [];
          for (const s of space ? [space] : SPACE_NAMES) {
            try {
              out.push(await readPage(spaces, s, `Journal/${date}`));
            } catch {
              /* その日の日報が無いスペースは飛ばす */
            }
          }
          if (out.length === 0) return json({ date, found: false, entries: [] });
          return json({ date, found: true, entries: out });
        }
        const rows = [];
        for (const idx of await indexes.all(space)) {
          rows.push(...idx.rows("select page, date, modified from pages where is_journal = 1").map((r) => ({ space: idx.space, ...r })));
        }
        rows.sort((a, b) => (a.date < b.date ? 1 : -1));
        return json({ count: rows.length, entries: rows.slice(0, limit) });
      } catch (e) {
        return fail(e);
      }
    }
  );

  // ---------- 書き込み ----------
  // SilverBullet をブラウザで開いたまま外から書くと、ブラウザ側の保存が勝って
  // 上書きされることがある。読み取り時の modified を expected_modified に渡すと
  // 変更を検出して中断する。

  server.registerTool(
    "append_journal",
    {
      title: "日報に追記",
      description:
        "日報の指定セクションに1行追記する。日報が無ければ作る。" +
        "上書き競合を避けるため、先に read_note で取得した modified を expected_modified に渡すこと。",
      inputSchema: {
        space: spaceEnum,
        date: z.string().optional().describe("YYYY-MM-DD。省略すると今日"),
        section: z
          .string()
          .default("## やったこと")
          .describe('追記先の見出し。既定 "## やったこと"。無ければ末尾に作る'),
        text: z.string().describe("追記する行。タスクにするなら '* [x] ...' の形で渡す"),
        expected_modified: z
          .string()
          .optional()
          .describe("read_note が返した modified。渡すと競合時に中断する"),
      },
    },
    async ({ space, date, section = "## やったこと", text, expected_modified }) => {
      try {
        const d = date ?? today();
        const page = `Journal/${d}`;
        const initial = `---\ntags: journal\n---\n\n# ${d}\n\n${section}\n\n`;
        try {
          return json(
            await insertUnderHeading(spaces, space, page, section, text, {
              expectedModified: expected_modified,
            })
          );
        } catch (e) {
          if (!/見つかりません|ENOENT/.test(e.message)) throw e;
          return json(await appendToPage(spaces, space, page, text, { initial }));
        }
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "add_inbox",
    {
      title: "Inbox に追加",
      description:
        "未振り分けのメモを Inbox.md にタスクとして追加する。後で本人が Projects / Areas に振り分ける。",
      inputSchema: {
        space: spaceEnum,
        text: z.string().describe("追加する内容（チェックボックスは自動で付く）"),
        due: z.string().optional().describe("YYYY-MM-DD"),
        tag: z.string().optional().describe("付けるハッシュタグ。例 next"),
        expected_modified: z.string().optional(),
      },
    },
    async ({ space, text, due, tag, expected_modified }) => {
      try {
        let line = `* [ ] ${text}`;
        if (tag) line += ` #${tag}`;
        if (due) line += ` [due: ${due}]`;
        const initial = `---\ntags: inbox\n---\n\n# Inbox\n\n未振り分けのキャプチャ。処理したら Projects か Areas へ移す。\n\n`;
        try {
          return json(
            await appendToPage(spaces, space, "Inbox", line, {
              expectedModified: expected_modified,
              initial,
            })
          );
        } catch (e) {
          throw e;
        }
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    "complete_task",
    {
      title: "タスクを完了にする",
      description:
        "指定行のタスクを [x] にし、[completed: 日付] を付ける。" +
        "行番号は list_tasks / read_note が返す line をそのまま使う。",
      inputSchema: {
        space: spaceEnum,
        page: z.string(),
        line: z.number().int().min(1).describe("list_tasks が返した行番号"),
        date: z.string().optional().describe("完了日 YYYY-MM-DD。省略すると今日"),
        expected_modified: z.string().optional(),
      },
    },
    async ({ space, page, line, date, expected_modified }) => {
      try {
        return json(
          await completeTask(spaces, space, page, line, date ?? today(), {
            expectedModified: expected_modified,
          })
        );
      } catch (e) {
        return fail(e);
      }
    }
  );
}

export { SPACE_NAMES, spaces, indexes };
