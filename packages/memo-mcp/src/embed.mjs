// SPDX-License-Identifier: GPL-2.0-only
// Copyright (C) 2026 HayatoShimada
/**
 * ローカル埋め込み。multilingual-e5-small（ONNX, q8）を CPU で動かす。
 * 本文は一切外に出さない（confidential スペースがあるため）。
 *
 * ベクトルは節の hash 単位で <MEMO_INDEX_DIR>/<space>.embeddings.json に置く。
 * 索引はメモリ上で毎回組み直すが、埋め込みは高い（1節 ~20ms、モデルロード ~7秒）ので
 * ここだけ永続化し、変わった節だけ計算する。モデルは意味検索が初めて要求されたときに読む。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { INDEX_DIR } from "./index.mjs";

export const MODEL = process.env.MEMO_EMBED_MODEL ?? "Xenova/multilingual-e5-small";
export const EMBED_ENABLED = (process.env.MEMO_EMBED ?? "on") !== "off";
const BATCH = 16;

let pipePromise;
async function pipe() {
  if (!pipePromise) {
    pipePromise = (async () => {
      const { pipeline, env } = await import("@huggingface/transformers");
      env.cacheDir = path.join(INDEX_DIR, "models");
      // モデルの配布元（ミラーやオフライン試験用）。既定は Hugging Face Hub
      if (process.env.MEMO_EMBED_REMOTE_HOST) env.remoteHost = process.env.MEMO_EMBED_REMOTE_HOST;
      const t0 = Date.now();
      const p = await pipeline("feature-extraction", MODEL, { dtype: "q8" });
      console.error(`[memo-mcp] embedding model loaded in ${Date.now() - t0}ms (${MODEL})`);
      return p;
    })().catch((e) => {
      // 取得失敗（オフライン、途中で切断）を覚え込まず、次の呼び出しでやり直す
      pipePromise = undefined;
      throw e;
    });
  }
  return pipePromise;
}

const toB64 = (f32) => Buffer.from(f32.buffer, f32.byteOffset, f32.byteLength).toString("base64");
const fromB64 = (s) => {
  const b = Buffer.from(s, "base64");
  return new Float32Array(b.buffer, b.byteOffset, b.byteLength / 4);
};

export class Embedder {
  constructor(space) {
    this.space = space;
    this.file = path.join(INDEX_DIR, `${space}.embeddings.json`);
    this.vectors = null; // Map hash -> Float32Array
    this.dim = 0;
    this._ensuring = Promise.resolve();
  }

  async load() {
    if (this.vectors) return;
    this.vectors = new Map();
    try {
      const j = JSON.parse(await fs.readFile(this.file, "utf-8"));
      if (j.model === MODEL) {
        this.dim = j.dim;
        for (const [h, v] of Object.entries(j.vectors)) this.vectors.set(h, fromB64(v));
      }
    } catch {
      /* 初回 */
    }
  }

  async save() {
    await fs.mkdir(INDEX_DIR, { recursive: true });
    const vectors = {};
    for (const [h, v] of this.vectors) vectors[h] = toB64(v);
    const tmp = `${this.file}.tmp`;
    await fs.writeFile(tmp, JSON.stringify({ model: MODEL, dim: this.dim, vectors }));
    await fs.rename(tmp, this.file);
  }

  async embedTexts(texts) {
    const p = await pipe();
    const out = await p(texts, { pooling: "mean", normalize: true });
    const dim = out.dims[1];
    const data = out.data;
    return texts.map((_, i) => new Float32Array(data.slice(i * dim, (i + 1) * dim)));
  }

  /** 並行リクエストが同じ節を二重に計算しないよう、space ごとに直列化する。 */
  ensure(sections) {
    const run = this._ensuring.then(() => this._ensure(sections));
    this._ensuring = run.catch(() => {});
    return run;
  }

  /** 節の配列（id, hash, context_text）に対して、無いものだけ計算して保存する。 */
  async _ensure(sections) {
    await this.load();
    const missing = sections.filter((s) => !this.vectors.has(s.hash));
    let computed = 0;
    for (let i = 0; i < missing.length; i += BATCH) {
      const batch = missing.slice(i, i + BATCH);
      const vecs = await this.embedTexts(batch.map((s) => `passage: ${s.context_text}`));
      batch.forEach((s, j) => this.vectors.set(s.hash, vecs[j]));
      computed += batch.length;
      if (vecs[0]) this.dim = vecs[0].length;
    }
    // 消えた節のベクトルは捨てる（ファイルが育ち続けないように）
    const live = new Set(sections.map((s) => s.hash));
    for (const h of [...this.vectors.keys()]) if (!live.has(h)) this.vectors.delete(h);
    if (computed > 0 || live.size !== this.vectors.size) await this.save();
    return { computed, cached: sections.length - computed };
  }

  async query(text) {
    const [v] = await this.embedTexts([`query: ${text}`]);
    return v;
  }

  get(hash) {
    return this.vectors?.get(hash) ?? null;
  }
}

export function cosine(a, b) {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += a[i] * b[i];
  return s; // 正規化済みなので内積 = cos
}
