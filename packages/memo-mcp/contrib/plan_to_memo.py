#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
"""Claude Code PostToolUse hook for ExitPlanMode: record each approved plan in memo.

The plan becomes a child page `<project>/Plans/<YYYY-MM-DD> <title>` (frontmatter
`tags: plan`, `project`, `status: approved`, `created`, then the plan and an empty
`## 進捗`), and the project page gets a link line under `## Plans`. Approving a
revised plan in the same session swaps the plan text in that page and keeps its
frontmatter and progress.
The agent is told the page name, so it can keep `## 進捗` and `status` current.

Which project a session belongs to comes from `~/.config/memo-plans.json`:

    {"server": "memo",
     "projects": {"/home/me/src/app": {"space": "notes", "project": "Projects/App"}}}

The longest matching directory prefix of the session's cwd wins. `server` names the
MCP server in `~/.claude.json` (default `memo`); its url and headers (the bearer
token) are read from there and used only for the requests. Nothing is printed except
the note for the agent, and a failure never blocks the session.
"""

import datetime
import json
import os
import re
import sys
import urllib.error
import urllib.request

CONFIG = os.path.expanduser(os.environ.get("MEMO_PLANS_CONFIG", "~/.config/memo-plans.json"))
STATE = os.path.expanduser(os.environ.get("MEMO_PLANS_STATE", "~/.cache/plan-to-memo/state.json"))
CLAUDE_JSON = os.path.expanduser(os.environ.get("MEMO_PLANS_CLAUDE_JSON", "~/.claude.json"))
PROGRESS = "## 進捗"
PLANS = "## Plans"


def title_of(plan):
    """The plan's first `# ` heading, shaped like memo-mcp's todoTitle (about 40 chars)."""
    m = re.search(r"^#\s+(.+)$", plan, re.M)
    t = m.group(1) if m else "Plan"
    t = re.sub(r"\[\[([^\]]*)\]\]", lambda x: x.group(1).split("|")[-1].split("/")[-1], t)
    t = re.sub(r"\[[A-Za-z_]+:[^\]]*\]", "", t)
    t = re.sub(r"(^|\s)#[^\s#]+", r"\1", t)
    t = re.sub(r"[/#@|<>$`\[\]\\]", "", t)
    t = re.sub(r"\s+", " ", t).strip()
    return t[:40].strip() or "Plan"


def resolve_project(projects, cwd):
    """Longest directory prefix of cwd among the configured projects, or None."""
    cwd = os.path.realpath(cwd)
    best = None
    for prefix, target in projects.items():
        p = os.path.realpath(os.path.expanduser(prefix))
        if (cwd == p or cwd.startswith(p.rstrip(os.sep) + os.sep)) and (best is None or len(p) > len(best[0])):
            best = (p, target)
    return best[1] if best else None


def page_content(project, plan, date):
    plan = plan.strip()
    return (
        f'---\ntags: plan\nproject: "[[{project}]]"\nstatus: approved\ncreated: {date}\n---\n'
        f"{plan}\n\n{PROGRESS}\n"
    )


def mcp_server(name, cwd):
    with open(CLAUDE_JSON, encoding="utf-8") as f:
        d = json.load(f)
    s = (d.get("mcpServers") or {}).get(name)
    if not s:
        s = ((d.get("projects") or {}).get(cwd, {}).get("mcpServers") or {}).get(name)
    if not s or not s.get("url"):
        raise RuntimeError(f"MCP server {name!r} with a url is not in {CLAUDE_JSON}")
    return s["url"], s.get("headers") or {}


class Mcp:
    """Just enough of the streamable HTTP client: initialize, tools/call, close."""

    def __init__(self, url, headers):
        self.url, self.headers, self.session, self.n = url, headers, None, 0

    def _post(self, body):
        h = {"Content-Type": "application/json", "Accept": "application/json, text/event-stream", **self.headers}
        if self.session:
            h["Mcp-Session-Id"] = self.session
        req = urllib.request.Request(self.url, data=json.dumps(body).encode(), headers=h, method="POST")
        with urllib.request.urlopen(req, timeout=20) as r:
            self.session = r.headers.get("Mcp-Session-Id") or self.session
            raw = r.read().decode("utf-8")
            ctype = r.headers.get("Content-Type", "")
        if "id" not in body:
            return None
        if "text/event-stream" in ctype:
            datas = [l[5:].strip() for l in raw.splitlines() if l.startswith("data:")]
            raw = datas[-1] if datas else "{}"
        msg = json.loads(raw or "{}")
        if "error" in msg:
            raise RuntimeError(msg["error"].get("message", "MCP error"))
        return msg.get("result")

    def request(self, method, params):
        self.n += 1
        return self._post({"jsonrpc": "2.0", "id": self.n, "method": method, "params": params})

    def __enter__(self):
        self.request("initialize", {
            "protocolVersion": "2025-06-18",
            "capabilities": {},
            "clientInfo": {"name": "plan-to-memo", "version": "1.0.0"},
        })
        self._post({"jsonrpc": "2.0", "method": "notifications/initialized"})
        return self

    def __exit__(self, *exc):
        if self.session:
            h = {**self.headers, "Mcp-Session-Id": self.session}
            try:
                urllib.request.urlopen(urllib.request.Request(self.url, headers=h, method="DELETE"), timeout=5).close()
            except (urllib.error.URLError, OSError):
                pass

    def tool(self, name, args):
        """Call a tool; return its JSON result, or raise with the tool's error text."""
        r = self.request("tools/call", {"name": name, "arguments": args}) or {}
        text = (r.get("content") or [{}])[0].get("text", "")
        if r.get("isError"):
            raise RuntimeError(text)
        return json.loads(text) if text else {}


def load_state():
    try:
        with open(STATE, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return {}


def save_state(state):
    os.makedirs(os.path.dirname(STATE), exist_ok=True)
    tmp = STATE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False, indent=1)
    os.replace(tmp, STATE)


def record(data, today=None):
    """Write the plan; return the note for the agent, or None when there is nothing to do."""
    if data.get("tool_name") != "ExitPlanMode":
        return None
    ti, tr = data.get("tool_input") or {}, data.get("tool_response") or {}
    if not isinstance(tr, dict):
        tr = {}
    plan_path = tr.get("filePath") or ti.get("planFilePath") or ""
    plan = tr.get("plan") or ti.get("plan")
    if not plan and plan_path and os.path.isfile(plan_path):
        with open(plan_path, encoding="utf-8") as f:
            plan = f.read()
    if not plan or not plan.strip():
        return None
    if not os.path.isfile(CONFIG):
        return None
    with open(CONFIG, encoding="utf-8") as f:
        conf = json.load(f)
    cwd = data.get("cwd") or os.getcwd()
    target = resolve_project(conf.get("projects") or {}, cwd)
    if not target:
        return f"plan-to-memo: no project for {cwd} in {CONFIG}; this plan was not recorded."
    space, project = target["space"], target["project"]
    date = today or datetime.date.today().isoformat()
    title = title_of(plan)
    key = f"{data.get('session_id', '')}:{plan_path}"
    state = load_state()

    url, headers = mcp_server(conf.get("server", "memo"), cwd)
    with Mcp(url, headers) as mcp:
        prev = state.get(key)
        if prev:
            try:
                # Swap only the plan text, so frontmatter (status) and progress stay as they are.
                res = mcp.tool("edit_note", {"space": space, "page": prev["page"],
                                             "old_text": prev["plan"].strip(), "new_text": plan.strip()})
                state[key] = {"page": prev["page"], "plan": plan}
                save_state(state)
                return (f"plan-to-memo: updated the plan in memo page [[{prev['page']}]] (space {space}, "
                        f"modified {res['modified']}). {_progress_hint(space, prev['page'])}")
            except RuntimeError as e:
                # page deleted/renamed or its plan text edited by hand: record afresh
                if "見つかりません" not in str(e):
                    raise
        base = f"{project}/Plans/{date} {title}"
        for n in range(1, 50):
            page = base if n == 1 else f"{base} {n}"
            try:
                res = mcp.tool("write_note", {"space": space, "page": page,
                                              "content": page_content(project, plan, date)})
                break
            except RuntimeError as e:
                if "既にある" not in str(e):
                    raise
        else:
            raise RuntimeError(f"too many plan pages named {base!r}")
        state[key] = {"page": page, "plan": plan}
        save_state(state)
        link = f"- [[{page}|{date} {title}]]"
        try:
            mcp.tool("update_section", {"space": space, "page": project, "heading": PLANS,
                                        "content": link, "mode": "append"})
            linked = f"and linked it under {PLANS} in [[{project}]]"
        except RuntimeError as e:
            linked = f"but could not link it from [[{project}]] ({e})"
    return (f"plan-to-memo: recorded this plan as memo page [[{page}]] (space {space}, "
            f"modified {res['modified']}) {linked}. {_progress_hint(space, page)}")


def _progress_hint(space, page):
    return (f"As the work proceeds, append dated one-line entries to {PROGRESS} of that page with the memo "
            f"MCP tool update_section (space {space}, mode append); when done, set `status: done` with "
            f"edit_note and add a `## 結果` section. Pass the modified from read_note as expected_modified. "
            f"Never write secret values or full command output there.")


def main():
    try:
        data = json.load(sys.stdin)
        note = record(data)
    except Exception as e:  # never break the session over a note
        note = f"plan-to-memo: could not record the plan in memo ({type(e).__name__}: {e})."
    if note:
        json.dump({"hookSpecificOutput": {"hookEventName": "PostToolUse", "additionalContext": note}},
                  sys.stdout, ensure_ascii=False)
    return 0


if __name__ == "__main__":
    sys.exit(main())
