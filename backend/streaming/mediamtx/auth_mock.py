#!/usr/bin/env python3
from __future__ import annotations

import json
from http.server import BaseHTTPRequestHandler, HTTPServer

HOST = "0.0.0.0"
PORT = 10080


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if self.path != "/auth":
            self.send_response(404)
            self.end_headers()
            return

        length = int(self.headers.get("Content-Length", "0"))
        body = self.rfile.read(length) if length else b"{}"
        try:
            payload = json.loads(body.decode("utf-8"))
        except Exception:
            payload = {}
        print("[auth-mock] payload:", json.dumps(payload, separators=(",", ":")), flush=True)

        action = payload.get("action", "")
        path = payload.get("path", "")
        user = payload.get("user", "")
        password = payload.get("password", "")

        # Allow read/publish on paths that start with "open/" for a known credential.
        allowed = path.startswith("open/") and user == "student" and password == "secret"

        # Let probes without creds challenge first; RTSP clients typically retry with auth.
        if not user and not password:
            self.send_response(401)
            self.end_headers()
            return

        if allowed and action in {"publish", "read", "playback"}:
            self.send_response(200)
            self.end_headers()
            return

        self.send_response(403)
        self.end_headers()

    def log_message(self, fmt, *args):
        print("[auth-mock]", fmt % args, flush=True)


if __name__ == "__main__":
    server = HTTPServer((HOST, PORT), Handler)
    print(f"Auth mock listening on http://{HOST}:{PORT}")
    server.serve_forever()
