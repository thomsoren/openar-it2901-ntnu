from __future__ import annotations

from contextlib import contextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy.orm import Session

from auth.deps import get_current_user
from db.database import get_db
from db.models import MediaAsset
from services.uploaded_video_analysis_service import build_detections_s3_key
from storage import s3
from webapi.routes.media import router as media_router
from webapi.routes.system import router as system_router
from cv.idun.routes import router as idun_router


class _FakeS3Client:
    def complete_multipart_upload(self, **_kwargs):
        return None

    def generate_presigned_url(self, *_args, **_kwargs):
        return "https://example.test/presigned-video.mp4"

    def put_object(self, **_kwargs):
        return None


@contextmanager
def _session_ctx(db_session: Session):
    yield db_session


def _analysis_app(db_session: Session, user) -> FastAPI:
    app = FastAPI()
    app.include_router(system_router)
    app.include_router(media_router)
    app.include_router(idun_router)
    def _override_get_db():
        yield db_session
    app.dependency_overrides[get_db] = _override_get_db
    app.dependency_overrides[get_current_user] = lambda: user
    return app


def test_analysis_upload_completion_creates_placeholder(
    db_session: Session,
    regular_user,
    monkeypatch,
):
    stored_json: dict[str, dict] = {}

    monkeypatch.setattr("storage.s3.s3_enabled", lambda: True)
    monkeypatch.setattr("storage.s3._client", lambda: _FakeS3Client())
    monkeypatch.setattr("storage.s3.SessionLocal", lambda: _session_ctx(db_session))
    monkeypatch.setattr("storage.s3.write_json", lambda key, payload: stored_json.__setitem__(key, payload))

    request = s3.PresignRequest(
        method="MULTIPART_COMPLETE",
        key="videos/private/default-group/user-1/manual/test.mp4",
        upload_id="upload-1",
        completed_parts=[{"part_number": 1, "etag": "etag-1"}],
        upload_purpose="analysis",
    )

    result = s3.presign_storage(request, owner_user_id=regular_user.id, is_admin=False)

    assert result["completed"] is True
    asset = db_session.query(MediaAsset).filter_by(s3_key=request.key).one()
    detections_s3_key = build_detections_s3_key(regular_user.id, asset.id)
    assert detections_s3_key in stored_json
    assert stored_json[detections_s3_key]["status"] == "queued"
    assert stored_json[detections_s3_key]["fps"] is None
    assert stored_json[detections_s3_key]["total_frames"] is None
    assert stored_json[detections_s3_key]["frames"] == {}


def test_media_analysis_retry_and_result_routes(
    db_session: Session,
    regular_user,
    monkeypatch,
):
    stored_json: dict[str, dict] = {}
    asset = MediaAsset(
        id="asset-1",
        s3_key="videos/private/default-group/user-1/manual/test.mp4",
        media_type="video",
        visibility="private",
        owner_user_id=regular_user.id,
        is_system=False,
    )
    db_session.add(asset)
    db_session.commit()
    detections_s3_key = build_detections_s3_key(regular_user.id, asset.id)
    stored_json[detections_s3_key] = {
        "status": "failed",
        "error_message": "boom",
        "updated_at": "2026-03-15T00:00:00+00:00",
        "completed_at": None,
        "fps": None,
        "total_frames": None,
        "video_width": None,
        "video_height": None,
        "frames": {},
    }

    monkeypatch.setattr("storage.s3.write_json", lambda key, payload: stored_json.__setitem__(key, payload))
    monkeypatch.setattr(
        "storage.s3.read_json",
        lambda key: stored_json.get(key),
    )

    app = _analysis_app(db_session, regular_user)
    with TestClient(app) as client:
        retry_response = client.post(f"/api/media/{asset.id}/analysis/retry")
        assert retry_response.status_code == 200
        assert retry_response.json()["analysis"]["status"] == "queued"
        assert stored_json[detections_s3_key]["frames"] == {}

        stored_json[detections_s3_key] = {
            "status": "completed",
            "error_message": None,
            "updated_at": "2026-03-15T00:00:00+00:00",
            "completed_at": "2026-03-15T00:00:00+00:00",
            "fps": 25.0,
            "total_frames": 100,
            "video_width": 1280,
            "video_height": 720,
            "frames": {"2": []},
        }

        result_response = client.get(f"/api/media/{asset.id}/analysis/result")
        assert result_response.status_code == 200
        assert result_response.json()["fps"] == 25.0
        assert result_response.json()["frames"]["2"] == []


def test_media_analysis_retry_requires_failed_status(
    db_session: Session,
    regular_user,
    monkeypatch,
):
    stored_json: dict[str, dict] = {}
    asset = MediaAsset(
        id="asset-retry-guard",
        s3_key="videos/private/default-group/user-1/manual/completed.mp4",
        media_type="video",
        visibility="private",
        owner_user_id=regular_user.id,
        is_system=False,
    )
    db_session.add(asset)
    db_session.commit()
    detections_s3_key = build_detections_s3_key(regular_user.id, asset.id)
    stored_json[detections_s3_key] = {
        "status": "completed",
        "error_message": None,
        "updated_at": "2026-03-15T00:00:00+00:00",
        "completed_at": "2026-03-15T00:00:00+00:00",
        "fps": 25.0,
        "total_frames": 10,
        "video_width": 1280,
        "video_height": 720,
        "frames": {"0": []},
    }

    monkeypatch.setattr("storage.s3.write_json", lambda key, payload: stored_json.__setitem__(key, payload))
    monkeypatch.setattr("storage.s3.read_json", lambda key: stored_json.get(key))

    app = _analysis_app(db_session, regular_user)
    with TestClient(app) as client:
        retry_response = client.post(f"/api/media/{asset.id}/analysis/retry")
        assert retry_response.status_code == 409
        assert stored_json[detections_s3_key]["status"] == "completed"


def test_media_analysis_requires_asset_ownership(
    db_session: Session,
    regular_user,
    admin_user,
    monkeypatch,
):
    stored_json: dict[str, dict] = {}
    asset = MediaAsset(
        id="asset-foreign",
        s3_key="videos/private/default-group/other-user/manual/owned.mp4",
        media_type="video",
        visibility="private",
        owner_user_id=admin_user.id,
        is_system=False,
    )
    db_session.add(asset)
    db_session.commit()
    detections_s3_key = build_detections_s3_key(admin_user.id, asset.id)
    stored_json[detections_s3_key] = {
        "status": "failed",
        "error_message": "boom",
        "updated_at": "2026-03-15T00:00:00+00:00",
        "completed_at": None,
        "fps": None,
        "total_frames": None,
        "video_width": None,
        "video_height": None,
        "frames": {},
    }

    monkeypatch.setattr("storage.s3.read_json", lambda key: stored_json.get(key))

    app = _analysis_app(db_session, regular_user)
    with TestClient(app) as client:
        response = client.get(f"/api/media/{asset.id}/analysis")
        assert response.status_code == 404


def test_idun_claim_and_complete_routes(
    db_session: Session,
    regular_user,
    monkeypatch,
):
    stored_json: dict[str, dict] = {}
    asset = MediaAsset(
        id="asset-2",
        s3_key="videos/private/default-group/user-1/manual/queued.mp4",
        media_type="video",
        visibility="private",
        owner_user_id=regular_user.id,
        is_system=False,
    )
    db_session.add(asset)
    db_session.commit()
    detections_s3_key = build_detections_s3_key(regular_user.id, asset.id)
    stored_json[detections_s3_key] = {
        "status": "queued",
        "error_message": None,
        "updated_at": "2026-03-15T00:00:00+00:00",
        "completed_at": None,
        "fps": None,
        "total_frames": None,
        "video_width": None,
        "video_height": None,
        "frames": {},
    }

    monkeypatch.setattr("cv.idun.routes.SessionLocal", lambda: _session_ctx(db_session))
    monkeypatch.setattr("cv.idun.routes.s3.presign_get", lambda key, expires=3600: f"https://example.test/{key}")
    monkeypatch.setattr("storage.s3.write_json", lambda key, payload: stored_json.__setitem__(key, payload))
    monkeypatch.setattr("storage.s3.read_json", lambda key: stored_json.get(key))

    app = FastAPI()
    app.include_router(idun_router)
    with TestClient(app) as client:
        headers = {"Authorization": "Bearer test-key"}
        monkeypatch.setattr("cv.idun.routes.IDUN_API_KEY", "test-key")

        claim_response = client.post("/api/idun/jobs/claim", headers=headers)
        assert claim_response.status_code == 200
        assert claim_response.json()["job"]["id"] == asset.id
        assert stored_json[detections_s3_key]["status"] == "processing"

        complete_response = client.put(
            f"/api/idun/jobs/{asset.id}/complete",
            json={
                "fps": 25.0,
                "total_frames": 2,
                "video_width": 1920,
                "video_height": 1080,
                "frames": {"1": []},
            },
            headers=headers,
        )
        assert complete_response.status_code == 200
        assert stored_json[detections_s3_key]["status"] == "completed"
        assert stored_json[detections_s3_key]["fps"] == 25.0
        assert stored_json[detections_s3_key]["total_frames"] == 2
        assert stored_json[detections_s3_key]["frames"]["1"] == []


def test_idun_claim_returns_204_when_no_queued_assets(
    db_session: Session,
    monkeypatch,
):
    monkeypatch.setattr("cv.idun.routes.SessionLocal", lambda: _session_ctx(db_session))
    monkeypatch.setattr("storage.s3.read_json", lambda key: None)

    app = FastAPI()
    app.include_router(idun_router)
    with TestClient(app) as client:
        monkeypatch.setattr("cv.idun.routes.IDUN_API_KEY", "test-key")
        response = client.post("/api/idun/jobs/claim", headers={"Authorization": "Bearer test-key"})
        assert response.status_code == 204


def test_idun_fail_route_marks_payload_failed(
    db_session: Session,
    regular_user,
    monkeypatch,
):
    stored_json: dict[str, dict] = {}
    asset = MediaAsset(
        id="asset-fail",
        s3_key="videos/private/default-group/user-1/manual/fail.mp4",
        media_type="video",
        visibility="private",
        owner_user_id=regular_user.id,
        is_system=False,
    )
    db_session.add(asset)
    db_session.commit()
    detections_s3_key = build_detections_s3_key(regular_user.id, asset.id)
    stored_json[detections_s3_key] = {
        "status": "processing",
        "error_message": None,
        "updated_at": "2026-03-15T00:00:00+00:00",
        "completed_at": None,
        "fps": None,
        "total_frames": None,
        "video_width": None,
        "video_height": None,
        "frames": {},
    }

    monkeypatch.setattr("cv.idun.routes.SessionLocal", lambda: _session_ctx(db_session))
    monkeypatch.setattr("storage.s3.write_json", lambda key, payload: stored_json.__setitem__(key, payload))
    monkeypatch.setattr("storage.s3.read_json", lambda key: stored_json.get(key))

    app = FastAPI()
    app.include_router(idun_router)
    with TestClient(app) as client:
        monkeypatch.setattr("cv.idun.routes.IDUN_API_KEY", "test-key")
        response = client.put(
            f"/api/idun/jobs/{asset.id}/fail",
            json={"error_message": "detector failed"},
            headers={"Authorization": "Bearer test-key"},
        )
        assert response.status_code == 200
        assert stored_json[detections_s3_key]["status"] == "failed"
        assert stored_json[detections_s3_key]["error_message"] == "detector failed"


def test_idun_routes_reject_invalid_api_key(
    db_session: Session,
    monkeypatch,
):
    monkeypatch.setattr("cv.idun.routes.SessionLocal", lambda: _session_ctx(db_session))

    app = FastAPI()
    app.include_router(idun_router)
    with TestClient(app) as client:
        monkeypatch.setattr("cv.idun.routes.IDUN_API_KEY", "test-key")
        response = client.post("/api/idun/jobs/claim", headers={"Authorization": "Bearer wrong-key"})
        assert response.status_code == 401
