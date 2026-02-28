"""S3 storage. Env: S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_BASE_URL."""
from __future__ import annotations

import os
import re
from pathlib import Path
from dotenv import load_dotenv
load_dotenv(Path(__file__).resolve().parents[1] / ".env")
from functools import lru_cache
from pathlib import PurePosixPath
from urllib.parse import urlparse

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select

from db.database import SessionLocal
from db.models import MediaAsset

S3_ACCESS_KEY = os.getenv("S3_ACCESS_KEY", "").strip()
S3_SECRET_KEY = os.getenv("S3_SECRET_KEY", "").strip()
S3_PRESIGN_EXPIRES = int(os.getenv("S3_PRESIGN_EXPIRES", "900"))
_url = os.getenv("S3_PUBLIC_BASE_URL", "").strip()
if _url:
    p = urlparse(_url.rstrip("/"))
    S3_ENDPOINT = f"{p.scheme}://{p.netloc}"
    parts = [x for x in p.path.strip("/").split("/") if x]
    S3_BUCKET = parts[0] if parts else ""
    S3_PREFIX = "/".join(parts[1:]) if len(parts) > 1 else ""
else:
    S3_ENDPOINT = S3_BUCKET = S3_PREFIX = ""
S3_REGION = os.getenv("S3_REGION", "hel1").strip()


class PresignRequest(BaseModel):
    key: str | None = None
    method: str = "GET"
    content_type: str | None = None
    expires_in: int | None = None
    filename: str | None = None
    group_id: str | None = None
    stream_id: str | None = None
    visibility: str = "private"


def s3_enabled() -> bool:
    return bool(S3_ENDPOINT and S3_BUCKET and S3_ACCESS_KEY and S3_SECRET_KEY)


@lru_cache(maxsize=1)
def _client():
    if not s3_enabled():
        raise RuntimeError("S3 is not configured")
    return boto3.client(
        "s3",
        endpoint_url=S3_ENDPOINT,
        region_name=S3_REGION,
        aws_access_key_id=S3_ACCESS_KEY,
        aws_secret_access_key=S3_SECRET_KEY,
        config=Config(signature_version="s3v4"),
    )


def _normalize_key(raw_key: str) -> tuple[str, str]:
    key = raw_key.strip().lstrip("/")
    if not key:
        raise ValueError("S3 key is required")
    if ".." in PurePosixPath(key).parts:
        raise ValueError("S3 key must not contain '..'")
    if not S3_PREFIX:
        return key, key
    if key == S3_PREFIX:
        raise ValueError("S3 key resolves to prefix root")
    if key.startswith(f"{S3_PREFIX}/"):
        return key, key[len(S3_PREFIX) + 1 :]
    return f"{S3_PREFIX}/{key}", key


def head_object(raw_key: str) -> dict | None:
    full_key, _ = _normalize_key(raw_key)
    try:
        return _client().head_object(Bucket=S3_BUCKET, Key=full_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def read_text_from_sources(s3_key: str | None) -> str | None:
    if not s3_key or not s3_enabled():
        return None
    try:
        if head_object(s3_key) is None:
            return None
        full_key, _ = _normalize_key(s3_key)
        return _client().get_object(Bucket=S3_BUCKET, Key=full_key)["Body"].read().decode("utf-8", errors="ignore")
    except Exception:
        return None


def _presign(method: str, raw_key: str, content_type: str | None = None, expires: int = 900):
    full_key, _ = _normalize_key(raw_key)
    params = {"Bucket": S3_BUCKET, "Key": full_key}
    if content_type:
        params["ContentType"] = content_type
    url = _client().generate_presigned_url(method, Params=params, ExpiresIn=expires)
    return (url, {"Content-Type": content_type}) if method == "put_object" and content_type else url


def presign_get(raw_key: str, expires: int = 900) -> str:
    return _presign("get_object", raw_key, expires=expires)


def presign_put(raw_key: str, content_type: str | None = None, expires: int = 900) -> tuple[str, dict]:
    result = _presign("put_object", raw_key, content_type, expires)
    return result if isinstance(result, tuple) else (result, {})


def _stream_body(body, chunk_size: int = 1024 * 1024):
    try:
        for chunk in body.iter_chunks(chunk_size=chunk_size):
            if chunk:
                yield chunk
    finally:
        body.close()


def _parse_range(range_header: str, total_size: int) -> tuple[int, int]:
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid range header")
    try:
        start_str, end_str = range_header.replace("bytes=", "", 1).strip().split("-", 1)
        if start_str == "":
            length = int(end_str) if end_str else 0
            if length <= 0:
                raise HTTPException(status_code=416, detail="Invalid range header")
            start = max(total_size - length, 0)
            end = total_size - 1
        else:
            start = int(start_str)
            end = int(end_str) if end_str else total_size - 1
        if start < 0 or end < start or start >= total_size:
            raise HTTPException(status_code=416, detail="Requested range not satisfiable")
        return start, min(end, total_size - 1)
    except ValueError:
        raise HTTPException(status_code=416, detail="Invalid range header")


def _stream_s3_response(raw_key: str, request: Request | None, filename: str) -> StreamingResponse:
    if not s3_enabled():
        raise HTTPException(status_code=500, detail="S3 is not configured")
    full_key, _ = _normalize_key(raw_key)
    meta = head_object(raw_key)
    if meta is None:
        raise HTTPException(status_code=404, detail="S3 object not found")
    total_size = int(meta.get("ContentLength", 0))
    media_type = meta.get("ContentType") or "application/octet-stream"
    range_h = request.headers.get("range") if request else None

    if range_h:
        start, end = _parse_range(range_h, total_size)
        resp = _client().get_object(Bucket=S3_BUCKET, Key=full_key, Range=f"bytes={start}-{end}")
        headers = {"Accept-Ranges": "bytes", "Content-Range": f"bytes {start}-{end}/{total_size}", "Content-Length": str(end - start + 1)}
    else:
        resp = _client().get_object(Bucket=S3_BUCKET, Key=full_key)
        headers = {"Accept-Ranges": "bytes", "Content-Length": str(total_size)}
    headers["Content-Disposition"] = f"inline; filename={filename}"
    return StreamingResponse(_stream_body(resp["Body"]), status_code=206 if range_h else 200, media_type=media_type, headers=headers)


def resolve_system_asset_key(asset_name: str, media_type: str = "file") -> str:
    with SessionLocal() as db:
        row = db.execute(select(MediaAsset).where(MediaAsset.asset_name == asset_name)).scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail=f"System asset '{asset_name}' not found in media_assets")
        return row.s3_key


def _find_asset_by_key(s3_key: str) -> MediaAsset | None:
    with SessionLocal() as db:
        return db.execute(select(MediaAsset).where(MediaAsset.s3_key == s3_key)).scalar_one_or_none()


def _upsert_uploaded_asset(
    *,
    s3_key: str,
    owner_user_id: str,
    visibility: str,
    group_id: str | None,
) -> None:
    with SessionLocal() as db:
        row = db.execute(select(MediaAsset).where(MediaAsset.s3_key == s3_key)).scalar_one_or_none()
        if row:
            row.owner_user_id = owner_user_id
            row.visibility = visibility if visibility != "custom" else row.visibility
            row.group_id = group_id or row.group_id
            row.media_type = "video"
            row.is_system = False
        else:
            db.add(
                MediaAsset(
                    s3_key=s3_key,
                    owner_user_id=owner_user_id,
                    visibility="private" if visibility == "custom" else visibility,
                    group_id=group_id,
                    media_type="video",
                    is_system=False,
                )
            )
        db.commit()


def health_status() -> dict:
    def _status(k):
        try:
            meta = head_object(k) if s3_enabled() else None
        except Exception:
            meta = None
        return {"source": "s3", "path": f"s3://{k}", "exists": bool(meta), "size_mb": round(meta["ContentLength"] / (1024 * 1024), 2) if meta else None}
    try:
        v, f = resolve_system_asset_key("video", "video"), resolve_system_asset_key("fusion_video", "video")
        vs, fs = _status(v), _status(f)
    except HTTPException:
        return {"status": "degraded", "files": {"video": {"exists": False}, "fusion_video": {"exists": False}}}
    return {"status": "healthy" if vs["exists"] else "degraded", "files": {"video": vs, "fusion_video": fs}}


def _safe_filename(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    return safe[:255] or "file"


def _stream_asset(asset_name: str, media_type: str, request: Request | None, filename: str = "") -> StreamingResponse:
    key = resolve_system_asset_key(asset_name, media_type)
    fn = _safe_filename(filename or key.rsplit("/", 1)[-1])
    return _stream_s3_response(key, request, fn)


def video_stream_response(request: Request):
    return _stream_asset("video", "video", request, "boat-detection-video.mp4")


def fusion_video_response(request: Request):
    return _stream_asset("fusion_video", "video", request)


def components_background_response():
    return _stream_asset("components_background", "image", None)


def detections_response(request: Request):
    return _stream_asset("detections", "json", request)


def _validate_client_key(raw_key: str) -> str:
    _, key = _normalize_key(raw_key)
    if _find_asset_by_key(key):
        return key
    if not key.startswith("videos/"):
        raise HTTPException(
            status_code=403,
            detail="key must exist in media_assets or be under videos/ for user uploads",
        )
    return key


_SAFE_SEGMENT_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _sanitize_segment(value: str | None, fallback: str) -> str:
    raw = (value or "").strip()
    if not raw:
        return fallback
    cleaned = _SAFE_SEGMENT_RE.sub("-", raw).strip(".-")
    return cleaned or fallback


def _build_owned_upload_key(request: PresignRequest, *, owner_user_id: str, is_admin: bool) -> tuple[str, str]:
    visibility = (request.visibility or "private").strip().lower()
    if visibility not in {"private", "group", "public"}:
        raise HTTPException(status_code=400, detail="visibility must be private, group, or public")
    if visibility == "public" and not is_admin:
        raise HTTPException(status_code=403, detail="Public uploads require explicit publish permissions")
    group_id = _sanitize_segment(request.group_id, "default-group")
    stream_id = _sanitize_segment(request.stream_id, "manual")
    filename = _sanitize_segment(request.filename, "")
    if not filename:
        raise HTTPException(status_code=400, detail="filename is required for PUT when key is not provided")
    owner_id = _sanitize_segment(owner_user_id, "unknown-user")
    return f"videos/{visibility}/{group_id}/{owner_id}/{stream_id}/{filename}", visibility


def _ensure_user_can_access_key(key: str, owner_user_id: str, is_admin: bool) -> None:
    if is_admin or key.startswith("videos/public/"):
        return
    owner_marker = f"/{_sanitize_segment(owner_user_id, 'unknown-user')}/"
    if owner_marker not in f"/{key}":
        raise HTTPException(status_code=403, detail="Requested key is outside caller ownership scope")


def presign_storage(request: PresignRequest, *, owner_user_id: str, is_admin: bool = False) -> dict:
    if not s3_enabled():
        raise HTTPException(status_code=500, detail="S3 is not configured")
    method = request.method.strip().upper()
    expires_in = request.expires_in or S3_PRESIGN_EXPIRES

    if method == "GET":
        if not request.key:
            raise HTTPException(status_code=400, detail="key is required for GET")
        key = _validate_client_key(request.key)
        asset = _find_asset_by_key(key)
        if asset:
            if not (is_admin or asset.is_system or asset.visibility == "public" or asset.owner_user_id == owner_user_id):
                raise HTTPException(status_code=403, detail="Requested key is not visible for this user")
        else:
            _ensure_user_can_access_key(key, owner_user_id, is_admin)
        return {"method": "GET", "key": key, "url": presign_get(key, expires=expires_in), "headers": {}, "expires_in": expires_in}

    if method == "PUT":
        if request.key:
            key = _validate_client_key(request.key)
            _ensure_user_can_access_key(key, owner_user_id, is_admin)
            visibility = "custom"
        else:
            key, visibility = _build_owned_upload_key(request, owner_user_id=owner_user_id, is_admin=is_admin)
        url, headers = presign_put(key, content_type=request.content_type, expires=expires_in)
        _upsert_uploaded_asset(
            s3_key=key,
            owner_user_id=_sanitize_segment(owner_user_id, "unknown-user"),
            visibility=visibility,
            group_id=_sanitize_segment(request.group_id, "default-group") if request.group_id else None,
        )
        return {
            "method": "PUT",
            "key": key,
            "visibility": visibility,
            "owner_user_id": _sanitize_segment(owner_user_id, "unknown-user"),
            "url": url,
            "headers": headers,
            "expires_in": expires_in,
        }

    raise HTTPException(status_code=400, detail="method must be GET or PUT")