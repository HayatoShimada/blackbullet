# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
# memo-mcp: MCP server + REST sidecar. Build context: packages/memo-mcp
FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV MEMO_MCP_HOST=0.0.0.0 MEMO_MCP_PORT=3010 MEMO_INDEX_DIR=/cache HOME=/tmp
EXPOSE 3010
CMD ["node", "src/http.mjs"]
