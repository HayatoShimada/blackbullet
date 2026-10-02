# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
"""Says who is on the other end of a connection, by asking Tailscale.

Caddy asks this (forward_auth) before it lets a request through to the app behind it.
The connection's address is looked up with tailscaled's LocalAPI `whois`, so
the answer is Tailscale's, not something the client wrote in a header. Only
the logins listed in ALLOWED_LOGINS are let in; everything else, including a
connection that is not from the tailnet at all, is refused.

Standard library only.
"""
from __future__ import annotations

import http.client
import http.server
import json
import os
import socket
import sys
import urllib.parse
from typing import Callable, Optional
from urllib.parse import quote

SOCKET = os.environ.get("TS_SOCKET", "/var/run/tailscale/tailscaled.sock")
PORT = int(os.environ.get("AUTH_PORT", "9180"))

Whois = Callable[[str], Optional[dict]]


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str):
        super().__init__("local-tailscaled.sock", timeout=3)
        self._path = path

    def connect(self) -> None:
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(3)
        self.sock.connect(self._path)


def tailscale_whois(addr: str, path: str = SOCKET) -> Optional[dict]:
    """The LocalAPI's answer for `ip:port`, or None if it does not know."""
    try:
        conn = _UnixConnection(path)
        conn.request("GET", f"/localapi/v0/whois?addr={quote(addr)}")
        response = conn.getresponse()
        body = response.read()
        conn.close()
    except OSError:
        return None
    if response.status != 200:
        return None
    try:
        return json.loads(body)
    except ValueError:
        return None


def parse_allowed(text: str) -> frozenset[str]:
    return frozenset(s.strip().lower() for s in text.split(",") if s.strip())


def address(host: str, port: str) -> Optional[str]:
    """`ip:port`, the form whois asks for (an IPv6 address in brackets)."""
    host, port = (host or "").strip(), (port or "").strip()
    if not host or not port.isdigit():
        return None
    return f"[{host}]:{port}" if ":" in host else f"{host}:{port}"


def decide(
    remote_addr: str,
    remote_port: str,
    whois: Whois,
    allowed: frozenset[str],
) -> tuple[int, dict[str, str]]:
    """(status, headers to pass on). 200 only for an allowed person."""
    addr = address(remote_addr, remote_port)
    if addr is None or not allowed:
        return 403, {}
    info = whois(addr)
    if not info:
        return 403, {}
    profile = info.get("UserProfile") or {}
    login = str(profile.get("LoginName") or "")
    # A tagged device (a server, say) has no person behind it: not let in here.
    if not login or login.lower() not in allowed:
        return 403, {}
    return 200, {
        "Tailscale-User-Login": login,
        "Tailscale-User-Name": str(profile.get("DisplayName") or ""),
    }


class Handler(http.server.BaseHTTPRequestHandler):
    allowed: frozenset[str] = frozenset()
    whois: Whois = staticmethod(tailscale_whois)  # type: ignore[assignment]

    def do_GET(self) -> None:  # noqa: N802
        # Caddy's forward_auth keeps the original query string (/auth?q=...), so compare the path only.
        path = urllib.parse.urlsplit(self.path).path
        if path == "/healthz":
            self._reply(200, {})
            return
        if path != "/auth":
            self._reply(404, {})
            return
        status, headers = decide(
            self.headers.get("Remote-Addr", ""),
            self.headers.get("Remote-Port", ""),
            self.whois,
            self.allowed,
        )
        self._reply(status, headers)

    def _reply(self, status: int, headers: dict[str, str]) -> None:
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Length", "0")
        self.end_headers()

    def log_message(self, fmt: str, *args) -> None:  # noqa: A003
        sys.stderr.write("auth: " + fmt % args + "\n")


def main() -> None:
    Handler.allowed = parse_allowed(os.environ.get("ALLOWED_LOGINS", ""))
    if not Handler.allowed:
        sys.stderr.write("auth: ALLOWED_LOGINS is empty: everyone will be refused\n")
    server = http.server.ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    server.serve_forever()


if __name__ == "__main__":
    main()
