# SPDX-License-Identifier: GPL-2.0-only
# Copyright (C) 2026 HayatoShimada
import unittest

import http.client
import threading
from http.server import ThreadingHTTPServer

from tailnet_auth import Handler, address, decide, parse_allowed

ME = "alice@example.com"


def whois_for(login: str, name: str = "Hayato"):
    return lambda addr: {"UserProfile": {"LoginName": login, "DisplayName": name}}


class DecideTests(unittest.TestCase):
    allowed = parse_allowed(ME)

    def test_an_allowed_person_is_let_in_and_named(self):
        status, headers = decide("100.64.0.7", "51234", whois_for(ME), self.allowed)
        self.assertEqual(status, 200)
        self.assertEqual(headers["Tailscale-User-Login"], ME)
        self.assertEqual(headers["Tailscale-User-Name"], "Hayato")

    def test_someone_else_is_refused(self):
        self.assertEqual(decide("100.64.0.7", "1", whois_for("x@example.com"), self.allowed)[0], 403)

    def test_the_login_is_compared_without_regard_to_case(self):
        self.assertEqual(decide("100.64.0.7", "1", whois_for("Alice@Example.com"), self.allowed)[0], 200)

    def test_a_connection_tailscale_does_not_know_is_refused(self):
        self.assertEqual(decide("203.0.113.9", "1", lambda addr: None, self.allowed)[0], 403)

    def test_a_tagged_device_has_no_person_and_is_refused(self):
        self.assertEqual(decide("100.64.0.7", "1", whois_for("tagged-devices"), self.allowed)[0], 403)
        self.assertEqual(decide("100.64.0.7", "1", whois_for(""), self.allowed)[0], 403)

    def test_nobody_is_allowed_when_the_list_is_empty(self):
        self.assertEqual(decide("100.64.0.7", "1", whois_for(ME), parse_allowed(""))[0], 403)

    def test_missing_or_bad_address_is_refused_without_asking(self):
        def boom(addr):
            raise AssertionError("must not ask")

        for host, port in [("", "1"), ("100.64.0.7", ""), ("100.64.0.7", "x"), ("", "")]:
            self.assertEqual(decide(host, port, boom, self.allowed)[0], 403)

    def test_whois_is_asked_for_the_connection_not_for_a_header_the_client_wrote(self):
        asked = []

        def whois(addr):
            asked.append(addr)
            return {"UserProfile": {"LoginName": ME}}

        decide("100.64.0.7", "4000", whois, self.allowed)
        self.assertEqual(asked, ["100.64.0.7:4000"])


class AddressTests(unittest.TestCase):
    def test_ipv4(self):
        self.assertEqual(address("100.64.0.7", "443"), "100.64.0.7:443")

    def test_ipv6_is_bracketed(self):
        self.assertEqual(address("fd7a:115c::1", "443"), "[fd7a:115c::1]:443")

    def test_whitespace_is_ignored(self):
        self.assertEqual(address(" 100.64.0.7 ", " 80 "), "100.64.0.7:80")

    def test_parse_allowed(self):
        self.assertEqual(parse_allowed(" A@x.com, b@y.com ,,"), frozenset({"a@x.com", "b@y.com"}))


class HandlerPathTests(unittest.TestCase):
    """Caddy's forward_auth sends /auth with the original request's query string."""

    def setUp(self):
        handler = type("H", (Handler,), {"allowed": parse_allowed(ME), "whois": staticmethod(whois_for(ME))})
        handler.log_message = lambda *a: None
        self.server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()

    def get(self, path):
        conn = http.client.HTTPConnection("127.0.0.1", self.server.server_address[1])
        conn.request("GET", path, headers={"Remote-Addr": "100.64.0.7", "Remote-Port": "443"})
        status = conn.getresponse().status
        conn.close()
        return status

    def test_auth_with_a_query_string_is_still_answered(self):
        self.assertEqual(self.get("/auth"), 200)
        self.assertEqual(self.get("/auth?space=notes&q=x"), 200)

    def test_other_paths_are_not_found(self):
        self.assertEqual(self.get("/other?x=1"), 404)
        self.assertEqual(self.get("/healthz?probe=1"), 200)


if __name__ == "__main__":
    unittest.main()
