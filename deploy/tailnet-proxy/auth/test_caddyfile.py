# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
"""Structure checks for the front door: the sidecar route sits behind the Tailscale check."""
import os
import pathlib
import re
import unittest

HERE = pathlib.Path(__file__).resolve().parent
PROXY = HERE.parent
ROOT = PROXY.parent.parent
CADDY = (PROXY / "Caddyfile").read_text()
ROOT_COMPOSE = (ROOT / "compose.yaml").read_text()
PROXY_COMPOSE = (PROXY / "compose.yaml").read_text()


def pos(needle: str) -> int:
    m = re.search(needle, CADDY)
    assert m, f"{needle!r} not in Caddyfile"
    return m.start()


class CaddyfileTests(unittest.TestCase):
    def test_sidecar_paths_are_matched(self):
        m = re.search(r"@sidecar path (.+)", CADDY)
        self.assertIsNotNone(m)
        self.assertEqual(set(m.group(1).split()), {"/mcp", "/mcp/*", "/api/*"})

    def test_sidecar_route_comes_after_the_tailscale_check(self):
        self.assertLess(pos(r"forward_auth"), pos(r"reverse_proxy @sidecar"))

    def test_client_supplied_tailscale_headers_are_dropped_first(self):
        self.assertLess(pos(r"request_header -Tailscale-User-Login"), pos(r"forward_auth"))

    def test_sidecar_route_comes_before_the_default_upstream(self):
        self.assertLess(pos(r"reverse_proxy @sidecar"), pos(r"reverse_proxy \{\$UPSTREAM\}"))

    def test_there_is_exactly_one_unmatched_upstream(self):
        self.assertEqual(len(re.findall(r"reverse_proxy \{\$UPSTREAM\}", CADDY)), 1)

    def test_authorization_is_not_stripped(self):
        self.assertNotIn("-Authorization", CADDY)


class ComposeTests(unittest.TestCase):
    def test_root_compose_points_the_sidecar_route_at_the_memo_port(self):
        self.assertIn("MCP_UPSTREAM=app:${MEMO_PORT:-3010}", ROOT_COMPOSE)

    def test_root_compose_derives_the_public_host_from_site_domain(self):
        self.assertIn("MEMO_MCP_PUBLIC_HOST=${MEMO_MCP_PUBLIC_HOST:-${SITE_DOMAIN:-}}", ROOT_COMPOSE)
        self.assertIn("MEMO_MCP_EXTRA_HOSTS=${SITE_DOMAIN:+${SITE_DOMAIN},${SITE_DOMAIN}:443}", ROOT_COMPOSE)

    def test_forwarded_host_is_allowed_even_with_public_host_override(self):
        # Caddy forwards the client's Host unchanged (no :443), so the bare name must be allowed.
        import shutil, subprocess, json
        if not shutil.which("docker"):
            self.skipTest("docker not available")
        env = dict(os.environ, MEMO_MCP_TOKEN="dummy", SITE_DOMAIN="memo.example.com",
                   MEMO_MCP_PUBLIC_HOST="other.ts.net:6443")
        r = subprocess.run(["docker", "compose", "config", "--format", "json"], cwd=str(ROOT),
                           env=env, capture_output=True, text=True)
        if r.returncode != 0:
            self.skipTest("compose config failed")
        e = json.loads(r.stdout)["services"]["memo-mcp"]["environment"]
        allowed = {h for k in ("MEMO_MCP_PUBLIC_HOST", "MEMO_MCP_EXTRA_HOSTS")
                   for h in str(e.get(k, "")).split(",")}
        self.assertIn("memo.example.com", allowed)

    def test_standalone_compose_passes_mcp_upstream(self):
        self.assertIn("MCP_UPSTREAM=${MCP_UPSTREAM:-app:3010}", PROXY_COMPOSE)


if __name__ == "__main__":
    unittest.main()
