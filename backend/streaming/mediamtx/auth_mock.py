#!/usr/bin/env python3
from __future__ import annotations

import json
import logging
from http.server import BaseHTTPRequestHandler, HTTPServer

logger = logging.getLogger(__name__)

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
        logger.debug("payload: %s", json.dumps(payload, separators=(",", ":")))

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
        logger.info(fmt % args)


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    server = HTTPServer((HOST, PORT), Handler)
    logger.info(f"Auth mock listening on http://{HOST}:{PORT}")
    server.serve_forever()
