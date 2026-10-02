#!/usr/bin/env node
// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * stdio トランスポート。
 * MCP クライアントがこのプロセスを起動して標準入出力で話す。
 * 他のマシンからは SSH 越しに起動する:
 *   ssh user@your-host /path/to/memo-mcp/src/stdio.mjs
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerTools, spaces, indexes } from "./tools.mjs";
import { registerResources } from "./resources.mjs";

const server = new McpServer({ name: "memo-mcp", version: "0.1.0" });
registerTools(server);
registerResources(server, spaces, indexes);

// stdout は JSON-RPC 専用。ログは必ず stderr へ出す。
const transport = new StdioServerTransport();
await server.connect(transport);
console.error("[memo-mcp] stdio transport ready");
