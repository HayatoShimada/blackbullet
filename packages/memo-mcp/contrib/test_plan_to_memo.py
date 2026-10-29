# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
# Unit tests, plus an end-to-end run against the real HTTP server on a temp space
# (never real notes). Run from this directory: python3 -m unittest
import json
import os
import shutil
import socket
import subprocess
import tempfile
import time
import unittest
import urllib.error
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
TMP = tempfile.mkdtemp(prefix="plan-to-memo-")
os.environ["MEMO_PLANS_CONFIG"] = os.path.join(TMP, "memo-plans.json")
os.environ["MEMO_PLANS_STATE"] = os.path.join(TMP, "state.json")
os.environ["MEMO_PLANS_CLAUDE_JSON"] = os.path.join(TMP, "claude.json")

import plan_to_memo as p  # noqa: E402  (reads the env above)

PLAN = "# memo MCP で任意の/ページを編集 #tag\n\n## Context\n\nwhy\n\n## 検証\n\n- run tests\n"


class Units(unittest.TestCase):
    def test_title(self):
        self.assertEqual(p.title_of(PLAN), "memo MCP で任意のページを編集")
        self.assertEqual(p.title_of("no heading"), "Plan")
        self.assertEqual(len(p.title_of("# " + "あ" * 80)), 40)

    def test_resolve_project_longest_prefix(self):
        a, b = os.path.join(TMP, "a"), os.path.join(TMP, "a", "b")
        projects = {a: {"project": "Projects/A"}, b: {"project": "Projects/B"}}
        self.assertEqual(p.resolve_project(projects, os.path.join(b, "src"))["project"], "Projects/B")
        self.assertEqual(p.resolve_project(projects, a)["project"], "Projects/A")
        self.assertIsNone(p.resolve_project(projects, a + "x"))

    def test_page_content(self):
        c = p.page_content("Projects/A", PLAN, "2026-10-29")
        self.assertTrue(c.startswith('---\ntags: plan\nproject: "[[Projects/A]]"\nstatus: approved\ncreated: 2026-10-29\n---\n# memo'))
        self.assertTrue(c.endswith("- run tests\n\n## 進捗\n"))

    def test_ignores_other_tools_and_missing_config(self):
        self.assertIsNone(p.record({"tool_name": "Bash"}))
        saved, p.CONFIG = p.CONFIG, os.path.join(TMP, "absent.json")
        try:
            self.assertIsNone(p.record({"tool_name": "ExitPlanMode", "tool_input": {"plan": "# x"}, "cwd": TMP}))
        finally:
            p.CONFIG = saved


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class EndToEnd(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.space = os.path.join(TMP, "space")
        os.makedirs(os.path.join(cls.space, "Projects"))
        with open(os.path.join(cls.space, "Projects", "App.md"), "w", encoding="utf-8") as f:
            f.write("---\ntags: project\nstatus: active\n---\n# App\n\n## Notes\n\n- n\n")
        port, token = free_port(), "test-token-not-secret"
        env = {**os.environ, "MEMO_SPACES": f"notes={cls.space}", "MEMO_MCP_TOKEN": token,
               "MEMO_MCP_PORT": str(port), "MEMO_INDEX_DIR": os.path.join(TMP, "idx"), "MEMO_EMBED": "off"}
        cls.proc = subprocess.Popen(["node", os.path.join(HERE, "..", "src", "http.mjs")], env=env,
                                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        url = f"http://127.0.0.1:{port}/mcp"
        for _ in range(100):
            try:
                urllib.request.urlopen(url, timeout=1)
            except urllib.error.HTTPError as e:
                e.close()
                break  # listening (401 / 404 without a session)
            except OSError:
                time.sleep(0.1)
        with open(os.environ["MEMO_PLANS_CLAUDE_JSON"], "w") as f:
            json.dump({"mcpServers": {"memo": {"type": "http", "url": url,
                                               "headers": {"Authorization": f"Bearer {token}"}}}}, f)
        cls.cwd = os.path.join(TMP, "repo")
        os.makedirs(cls.cwd)
        with open(os.environ["MEMO_PLANS_CONFIG"], "w") as f:
            json.dump({"projects": {cls.cwd: {"space": "notes", "project": "Projects/App"}}}, f)

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        cls.proc.wait(5)
        shutil.rmtree(TMP, ignore_errors=True)

    def read(self, page):
        with open(os.path.join(self.space, page + ".md"), encoding="utf-8") as f:
            return f.read()

    def event(self, plan, session="s1", path="/plans/a.md"):
        return {"tool_name": "ExitPlanMode", "session_id": session, "cwd": os.path.join(self.cwd, "sub"),
                "tool_input": {"plan": plan, "planFilePath": path},
                "tool_response": {"plan": plan, "filePath": path}}

    def test_flow(self):
        page = "Projects/App/Plans/2026-10-29 memo MCP で任意のページを編集"
        note = p.record(self.event(PLAN), today="2026-10-29")
        self.assertIn(f"[[{page}]]", note)
        self.assertNotIn("test-token", note)
        self.assertIn("## 進捗", self.read(page))
        app = self.read("Projects/App")
        self.assertTrue(app.endswith(f"## Plans\n\n- [[{page}|2026-10-29 memo MCP で任意のページを編集]]\n"), app)

        # progress written meanwhile survives re-approval of a revised plan in the same session
        with open(os.path.join(self.space, page + ".md"), "a", encoding="utf-8") as f:
            f.write("- 2026-10-29 started\n")
        revised = PLAN.replace("- run tests", "- run tests\n- deploy")
        note = p.record(self.event(revised), today="2026-10-29")
        self.assertIn("updated the plan", note)
        body = self.read(page)
        self.assertIn("- deploy", body)
        self.assertIn("status: approved", body)
        self.assertTrue(body.endswith("## 進捗\n- 2026-10-29 started\n"), body)
        self.assertEqual(self.read("Projects/App").count("[[Projects/App/Plans/"), 1)

        # another session with the same title the same day gets " 2"
        note = p.record(self.event(PLAN, session="s2"), today="2026-10-29")
        self.assertIn(f"[[{page} 2]]", note)
        self.assertEqual(self.read("Projects/App").count("[[Projects/App/Plans/"), 2)

    def test_unmapped_cwd_writes_nothing(self):
        e = self.event(PLAN, session="s3")
        e["cwd"] = "/"
        self.assertIn("no project", p.record(e))
        self.assertFalse(os.path.exists(os.path.join(self.space, "Projects", "App", "Plans", "Plan.md")))


if __name__ == "__main__":
    unittest.main()
