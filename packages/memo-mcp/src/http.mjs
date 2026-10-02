#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * Streamable HTTP トランスポート。
 *
 * 既定では 127.0.0.1 のみで待ち受ける（MEMO_MCP_HOST で変更可。Docker では 0.0.0.0 にして
 * compose 側で 127.0.0.1 に公開する）。外部へ出すときは必ずリバースプロキシ / VPN の内側に置く。
 * Bearer トークン必須。トークンは MEMO_MCP_TOKEN で渡す。
 *
 * 注意: MCP SDK 1.30.0 が実装しているのは protocol 2025-11-25 までで、
 * 2026-07-28 仕様（セッション廃止・Mcp-Method/Mcp-Name ヘッダー検証）には未対応。
 * クライアント側は仕様の後方互換規定に従って 2025-11-25 で話すことになる。
 */
import http from "node:http";
import crypto from "node:crypto";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { registerTools, spaces, indexes } from "./tools.mjs";
import { registerResources } from "./resources.mjs";
import { handleRest } from "./rest.mjs";

const PORT = Number(process.env.MEMO_MCP_PORT ?? 3010);
const HOST = process.env.MEMO_MCP_HOST ?? "127.0.0.1";
const TOKEN = process.env.MEMO_MCP_TOKEN;
// Optional: the host[:port] clients use to reach this server through a proxy (e.g. "memo.example.net:443").
// Unset = only loopback Host headers are accepted.
const PUBLIC_HOST = process.env.MEMO_MCP_PUBLIC_HOST || null;
const MCP_PATH = "/mcp";
const MAX_BODY = 4 * 1024 * 1024;

if (!TOKEN) {
  console.error("[memo-mcp] MEMO_MCP_TOKEN が未設定です。認証なしでは起動しません。");
  process.exit(1);
}

/** タイミング攻撃を避けて比較する。 */
function tokenOk(header) {
  if (!header?.startsWith("Bearer ")) return false;
  const given = Buffer.from(header.slice(7));
  const want = Buffer.from(TOKEN);
  if (given.length !== want.length) return false;
  return crypto.timingSafeEqual(given, want);
}

/**
 * Origin 検証（第2層）。第1層は SDK の enableDnsRebindingProtection。
 * ブラウザ以外のクライアントは Origin を送らないので、無い場合は許可する。
 */
// MEMO_MCP_EXTRA_HOSTS（カンマ区切り）で、コンテナ経由の host.docker.internal:3010 などを許可できる
const EXTRA_HOSTS = (process.env.MEMO_MCP_EXTRA_HOSTS ?? "").split(",").map((h) => h.trim()).filter(Boolean);
const ALLOWED_HOSTS = [`127.0.0.1:${PORT}`, `localhost:${PORT}`, ...(PUBLIC_HOST ? [PUBLIC_HOST] : []), ...EXTRA_HOSTS];
const ALLOWED_ORIGINS = ALLOWED_HOSTS.flatMap((h) => [`http://${h}`, `https://${h}`]);

function originOk(origin) {
  if (!origin) return true;
  return ALLOWED_ORIGINS.includes(origin);
}

function deny(res, status, message, code = -32000) {
  if (res.headersSent) return;
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ jsonrpc: "2.0", error: { code, message }, id: null }));
}

/** body を自前で読む。initialize かどうかの判定に中身が要るため。 */
async function readBody(req) {
  const chunks = [];
  let n = 0;
  for await (const c of req) {
    n += c.length;
    if (n > MAX_BODY) throw new Error("body too large");
    chunks.push(c);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// セッションごとにトランスポートを保持する（2025-11-25 のセッション方式）
const transports = new Map();

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host ?? "localhost"}`);

  if (url.pathname === "/healthz") {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("ok\n");
    return;
  }
  if (url.pathname.startsWith("/api/")) {
    // REST。/mcp と同じ Host / Origin / Bearer 検証を通す
    const json = (status, error) => {
      res.writeHead(status, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error }));
    };
    if (!ALLOWED_HOSTS.includes(req.headers.host ?? "")) return json(403, "Host not allowed");
    if (!originOk(req.headers.origin)) return json(403, "Origin not allowed");
    if (!tokenOk(req.headers.authorization)) {
      res.setHeader("WWW-Authenticate", "Bearer");
      return json(401, "Unauthorized");
    }
    await handleRest(req, res, url, { spaces, indexes });
    return;
  }
  if (url.pathname !== MCP_PATH) {
    deny(res, 404, "Not found");
    return;
  }
  if (!originOk(req.headers.origin)) {
    deny(res, 403, "Origin not allowed");
    return;
  }
  if (!tokenOk(req.headers.authorization)) {
    if (!res.headersSent) {
      res.writeHead(401, { "Content-Type": "application/json", "WWW-Authenticate": "Bearer" });
      res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32001, message: "Unauthorized" }, id: null }));
    }
    return;
  }

  try {
    const sessionId = req.headers["mcp-session-id"];
    let transport = sessionId ? transports.get(sessionId) : undefined;

    if (req.method === "POST") {
      let body;
      try {
        body = JSON.parse((await readBody(req)) || "null");
      } catch (e) {
        deny(res, 400, `Parse error: ${e.message}`, -32700);
        return;
      }

      // セッションが無い場合、initialize 以外では何も構築しない。
      // ここで毎回 McpServer を作ると、再接続の繰り返しでリークする。
      if (!transport) {
        if (sessionId) {
          deny(res, 404, "Session not found");
          return;
        }
        if (!isInitializeRequest(body)) {
          deny(res, 400, "Bad Request: Mcp-Session-Id header is required");
          return;
        }
        transport = new StreamableHTTPServerTransport({
          sessionIdGenerator: () => crypto.randomUUID(),
          // ツールは全て単純な request/response。SSE にする理由がない。
          enableJsonResponse: true,
          enableDnsRebindingProtection: true,
          allowedHosts: ALLOWED_HOSTS,
          allowedOrigins: ALLOWED_ORIGINS,
          onsessioninitialized: (id) => transports.set(id, transport),
        });
        transport.onclose = () => {
          if (transport.sessionId) transports.delete(transport.sessionId);
        };
        const server = new McpServer({ name: "memo-mcp", version: "0.1.0" });
        registerTools(server);
        registerResources(server, spaces, indexes);
        await server.connect(transport);
      }
      // stream は読み切ってあるので parsedBody として渡す
      await transport.handleRequest(req, res, body);
      return;
    }

    if (req.method === "GET" || req.method === "DELETE") {
      if (!transport) {
        deny(res, 404, "Session not found");
        return;
      }
      await transport.handleRequest(req, res);
      return;
    }

    res.writeHead(405, { Allow: "GET, POST, DELETE", "Content-Type": "application/json" });
    res.end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null }));
  } catch (e) {
    console.error("[memo-mcp] request failed:", e);
    deny(res, 500, "Internal error");
  }
});

httpServer.listen(PORT, HOST, () => {
  console.error(`[memo-mcp] streamable http on http://${HOST}:${PORT}${MCP_PATH}`);
  console.error(`[memo-mcp] allowed hosts: ${ALLOWED_HOSTS.join(", ")}`);
});

// SSE ストリームがイベントループを掴んだままにならないよう、明示的に閉じる
let shuttingDown = false;
for (const sig of ["SIGTERM", "SIGINT"]) {
  process.on(sig, async () => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.error(`[memo-mcp] ${sig} 受信。終了します。`);
    httpServer.close();
    for (const t of transports.values()) {
      try {
        await t.close();
      } catch {
        /* 閉じられないものは諦める */
      }
    }
    process.exit(0);
  });
}
