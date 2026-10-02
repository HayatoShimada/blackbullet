// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * MCP resources: memo://<space>/<page> でページを添付できるようにする。
 * ツールと同じ索引を使うので、list はディスクを読まない。
 */
import { ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { readPage } from "./space.mjs";

export function registerResources(server, spaces, indexes) {
  server.registerResource(
    "memo-page",
    new ResourceTemplate("memo://{space}/{+page}", {
      list: async () => {
        const resources = [];
        for (const idx of await indexes.all()) {
          for (const r of idx.rows("select page, summary, tags, modified from pages order by modified desc")) {
            resources.push({
              uri: `memo://${idx.space}/${r.page}`,
              name: `${idx.space}/${r.page}`,
              description: r.summary ?? (r.tags ? `tags: ${r.tags}` : undefined),
              mimeType: "text/markdown",
            });
          }
        }
        return { resources };
      },
    }),
    {
      title: "メモのページ",
      description: `SilverBullet のページ本文。スペース: ${Object.keys(spaces).join(" / ")}`,
      mimeType: "text/markdown",
    },
    async (uri, { space, page }) => {
      const p = await readPage(spaces, String(space), decodeURIComponent(String(page)));
      const head = spaces[String(space)]?.confidential ? "<!-- confidential space: do not quote in public material -->\n" : "";
      return { contents: [{ uri: uri.href, mimeType: "text/markdown", text: head + p.body }] };
    }
  );
}
