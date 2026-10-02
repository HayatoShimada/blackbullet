# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
# memo-mcp: MCP server + REST sidecar. Build context: packages/memo-mcp
FROM node:24-bookworm-slim
# PDF / Office 文書のテキスト抽出に使う外部コマンド（src/extract.mjs）
RUN apt-get update \
  && apt-get install -y --no-install-recommends poppler-utils unzip \
  && rm -rf /var/lib/apt/lists/*
# OCR（MEMO_OCR=on）は任意。イメージを細く保つため既定では入れない:
#   docker build --build-arg WITH_OCR=1 ...  で tesseract（日本語・英語）を足す。
ARG WITH_OCR=0
RUN if [ "$WITH_OCR" = "1" ]; then \
    apt-get update \
    && apt-get install -y --no-install-recommends tesseract-ocr tesseract-ocr-jpn tesseract-ocr-eng \
    && rm -rf /var/lib/apt/lists/*; \
  fi
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV MEMO_MCP_HOST=0.0.0.0 MEMO_MCP_PORT=3010 MEMO_INDEX_DIR=/cache HOME=/tmp
EXPOSE 3010
CMD ["node", "src/http.mjs"]
