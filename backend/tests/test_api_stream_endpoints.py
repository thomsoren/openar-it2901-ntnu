"""Tests for HTTP stream API endpoints — status codes, payloads, validation."""
from __future__ import annotations


# ---------- Start stream ----------

class TestStartStream:
    def test_returns_201(self, stream_app_client):
        resp = stream_app_client.post(
            "/api/streams/test-1/start",
            json={"source_url": "rtsp://example.com/live", "loop": True},
        )
        assert resp.status_code == 201
        body = resp.json()
        # to_dict() merges "status":"running" over "status":"started"
        assert body["status"] in ("started", "running")

    def test_has_playback_urls(self, stream_app_client):
        resp = stream_app_client.post(
            "/api/streams/test-2/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        body = resp.json()
        assert "playback_urls" in body
        assert isinstance(body["playback_urls"].get("media_enabled"), bool)

    def test_has_stream_info(self, stream_app_client):
        resp = stream_app_client.post(
            "/api/streams/test-3/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        body = resp.json()
        assert "stream_id" in body
        assert "pid" in body
        assert body["stream_id"] == "test-3"

    def test_invalid_id_returns_400(self, stream_app_client):
        resp = stream_app_client.post(
            "/api/streams/bad..id/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        assert resp.status_code == 400

    def test_slashes_in_id_rejected(self, stream_app_client):
        resp = stream_app_client.post(
            "/api/streams/a%2Fb/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        # FastAPI may route this as /api/streams/a/b/start → 404,
        # or decode to "a/b" → 400 from our regex. Either is acceptable.
        assert resp.status_code in (400, 404, 405)

    def test_duplicate_returns_409(self, stream_app_client):
        stream_app_client.post(
            "/api/streams/dup/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        resp = stream_app_client.post(
            "/api/streams/dup/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        assert resp.status_code == 409

    def test_hyphens_and_underscores_allowed(self, stream_app_client):
        resp = stream_app_client.post(
            "/api/streams/my-stream_123/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        assert resp.status_code == 201


# ---------- Stop stream ----------

class TestStopStream:
    def test_returns_204(self, stream_app_client):
        stream_app_client.post(
            "/api/streams/to-stop/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        resp = stream_app_client.delete("/api/streams/to-stop")
        assert resp.status_code == 204

    def test_not_found_returns_404(self, stream_app_client):
        resp = stream_app_client.delete("/api/streams/never-started")
        assert resp.status_code == 404

    def test_invalid_id_returns_400(self, stream_app_client):
        resp = stream_app_client.delete("/api/streams/bad..id")
        assert resp.status_code == 400


# ---------- List streams ----------

class TestListStreams:
    def test_returns_all(self, stream_app_client):
        for i in range(3):
            stream_app_client.post(
                f"/api/streams/list-{i}/start",
                json={"source_url": "rtsp://example.com/live"},
            )
        resp = stream_app_client.get("/api/streams")
        assert resp.status_code == 200
        body = resp.json()
        ids = {s["stream_id"] for s in body["streams"]}
        assert {"list-0", "list-1", "list-2"}.issubset(ids)

    def test_includes_max_workers(self, stream_app_client):
        resp = stream_app_client.get("/api/streams")
        body = resp.json()
        assert "max_workers" in body
        assert isinstance(body["max_workers"], int)

    def test_each_item_has_playback_urls(self, stream_app_client):
        stream_app_client.post(
            "/api/streams/play-list/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        resp = stream_app_client.get("/api/streams")
        for stream in resp.json()["streams"]:
            if stream["stream_id"] == "play-list":
                assert "playback_urls" in stream


# ---------- Playback endpoint ----------

class TestPlayback:
    def test_returns_urls(self, stream_app_client):
        stream_app_client.post(
            "/api/streams/pb/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        resp = stream_app_client.get("/api/streams/pb/playback")
        assert resp.status_code == 200
        body = resp.json()
        assert body["stream_id"] == "pb"
        assert "playback_urls" in body

    def test_not_found_returns_404(self, stream_app_client):
        resp = stream_app_client.get("/api/streams/unknown/playback")
        assert resp.status_code == 404

    def test_invalid_id_returns_400(self, stream_app_client):
        resp = stream_app_client.get("/api/streams/bad..id/playback")
        assert resp.status_code == 400


# ---------- Heartbeat ----------

class TestHeartbeat:
    def test_returns_204(self, stream_app_client):
        stream_app_client.post(
            "/api/streams/hb/start",
            json={"source_url": "rtsp://example.com/live"},
        )
        resp = stream_app_client.post("/api/streams/hb/heartbeat")
        assert resp.status_code == 204

    def test_invalid_id_returns_400(self, stream_app_client):
        resp = stream_app_client.post("/api/streams/bad..id/heartbeat")
        assert resp.status_code == 400
