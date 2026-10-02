// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * MCP resources: memo://<space>/<page> でページを添付できるようにする。
 * ツールと同じ索引を使うので、list はディスクを読まない。
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readPage } from "./space.mjs";
import { kindOf } from "./extract.mjs";

export function registerResources(server, spaces, indexes) {
  server.registerResource(
    "memo-page",
    new ResourceTemplate("memo://{space}/{+page}", {
      list: async () => {
        const resources = [];
        for (const idx of await indexes.all()) {
          for (const r of idx.rows("select page, kind, summary, tags, modified from pages order by modified desc")) {
            resources.push({
              uri: `memo://${idx.space}/${r.page}`,
              name: `${idx.space}/${r.page}`,
              description: r.kind !== "md" ? `kind: ${r.kind}` : (r.summary ?? (r.tags ? `tags: ${r.tags}` : undefined)),
              // 文書ページは抽出済みテキストを返すので markdown ではない
              mimeType: r.kind !== "md" ? "text/plain" : "text/markdown",
            });
          }
        }
        return { resources };
      },
    }),
    {
      title: "メモのページ",
      description: `SilverBullet のページ本文。PDF / Office 文書は索引の抽出テキスト。スペース: ${Object.keys(spaces).join(" / ")}`,
      mimeType: "text/markdown",
    },
    async (uri, { space, page }) => {
      const s = String(space);
      const name = decodeURIComponent(String(page));
      const head = spaces[s]?.confidential ? "<!-- confidential space: do not quote in public material -->\n" : "";
      // 文書ページは原本がバイナリなので、.md を付けて読みに行かず索引の抽出テキストを返す。無ければ通常ページ
      const doc = kindOf(name) ? (await indexes.get(s)).document(name) : null;
      if (doc) {
        return { contents: [{ uri: uri.href, mimeType: "text/plain", text: head + doc.body }] };
      }
      const p = await readPage(spaces, s, name);
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: head + p.body }] };
    }
  );
}
