import { config, lua } from "@silverbulletmd/silverbullet/syscalls";
import { SEMANTIC_K_MAX, SEMANTIC_THRESHOLD_MIN } from "./model.ts";
import { parseGraphResponse, type SemanticGraphResult } from "./semantic.ts";

type SidecarConfig = { url?: string; token?: string; space?: string };

const TIMEOUT_MS = 20000;

// Lua string literal using \xHH escapes only (Space Lua has no decimal
// escapes), so arbitrary config values can't break out of the expression.
export function luaString(s: string): string {
  const hex = [...new TextEncoder().encode(s)]
    .map((b) => `\\x${b.toString(16).padStart(2, "0")}`)
    .join("");
  return `"${hex}"`;
}

/**
 * net.proxyFetch answers 200 (`ok: true`) even when the sidecar itself replied
 * 401/404/5xx; the upstream status is in `status`. Returns a message for any
 * failed reply, or null when the reply is a 2xx.
 */
export function proxyFailure(
  resp: { ok?: boolean; status?: number } | null | undefined,
): string | null {
  const status = resp?.status;
  if (status === 401) {
    return "sidecar rejected the token (HTTP 401): check memoSidecar.token";
  }
  if (!resp?.ok) return `sidecar returned HTTP ${status ?? "?"}`;
  if (typeof status === "number" && (status < 200 || status >= 300)) {
    return `sidecar returned HTTP ${status}`;
  }
  return null;
}

/**
 * Fetch the page-similarity graph from the memo sidecar (/api/graph) through
 * the SilverBullet server's proxy. Fetches at the lowest threshold and widest
 * k the UI allows; the panel narrows them client-side. Never throws.
 */
export async function fetchSemanticGraph(): Promise<SemanticGraphResult> {
  const cfg = await config.get<SidecarConfig | null>("memoSidecar", null);
  if (!cfg?.url || !cfg.space) {
    return {
      status: "unconfigured",
      message: "memoSidecar is not configured",
      edges: [],
    };
  }
  try {
    // "/.proxy/host:port" is the documented form; net.proxyFetch wants
    // "host:port" because it adds the /.proxy/ prefix itself.
    const base = cfg.url
      .replace(/^https?:\/\//, "")
      .replace(/^\/?\.proxy\//, "")
      .replace(/^\/+|\/+$/g, "");
    const query = new URLSearchParams({
      space: cfg.space,
      k: String(SEMANTIC_K_MAX),
      threshold: String(SEMANTIC_THRESHOLD_MIN),
    });
    const target = `${base}/api/graph?${query}`;
    const headers = cfg.token
      ? `{Authorization=${luaString(`Bearer ${cfg.token}`)}}`
      : "{}";
    const resp = await Promise.race([
      lua.evalExpression(
        `net.proxyFetch(${luaString(target)}, {headers=${headers}})`,
      ),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timed out")), TIMEOUT_MS),
      ),
    ]);
    const failure = proxyFailure(resp);
    if (failure) {
      return { status: "error", message: failure, edges: [] };
    }
    const body =
      typeof resp.body === "string" ? JSON.parse(resp.body) : resp.body;
    return { status: "ok", edges: parseGraphResponse(body) };
  } catch (err: any) {
    return {
      status: "error",
      message: `sidecar unreachable (${err?.message ?? err})`,
      edges: [],
    };
  }
}
