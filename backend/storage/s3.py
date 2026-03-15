"""S3 storage. Env: S3_ACCESS_KEY, S3_SECRET_KEY, S3_PUBLIC_BASE_URL."""
from __future__ import annotations

import os
import re
import json
from functools import lru_cache
from pathlib import Path, PurePosixPath
from urllib.parse import urlparse
from uuid import uuid4

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
    part_count: int | None = None
    upload_id: str | None = None
    completed_parts: list[dict] | None = None
    upload_purpose: str | None = None


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


def coerce_s3_key(raw: str) -> str | None:
    """Extract S3 key from s3:// URL or raw key. Returns None if invalid."""
    if not raw or not isinstance(raw, str):
        return None
    s = raw.strip()
    if s.startswith("s3://"):
        s = s[5:].strip().lstrip("/")
    elif "://" in s:
        return None  # http/https/rtsp/etc — not an S3 key
    elif len(s) >= 2 and s[0].isalpha() and s[1] == ":":
        return None  # Windows absolute path (e.g. C:\...) — not an S3 key
    else:
        s = s.strip().lstrip("/")
    return s if s else None


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
        return key, key[len(S3_PREFIX) + 1:]
    return f"{S3_PREFIX}/{key}", key


def head_object(raw_key: str) -> dict | None:
    full_key, _ = _normalize_key(raw_key)
    try:
        return _client().head_object(Bucket=S3_BUCKET, Key=full_key)
    except ClientError as exc:
        if exc.response.get("Error", {}).get("Code") in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def read_text_from_sources(s3_key: str | None) -> str | None:
    if not s3_key or not s3_enabled():
        return None
    try:
        full_key, _ = _normalize_key(s3_key)
        return _client().get_object(Bucket=S3_BUCKET, Key=full_key)["Body"].read().decode("utf-8", errors="ignore")
    except Exception:
        return None


def write_text(raw_key: str, text: str, content_type: str = "text/plain; charset=utf-8") -> None:
    full_key, _ = _normalize_key(raw_key)
    _client().put_object(
        Bucket=S3_BUCKET,
        Key=full_key,
        Body=text.encode("utf-8"),
        ContentType=content_type,
    )


def write_json(raw_key: str, payload: dict) -> None:
    write_text(raw_key, json.dumps(payload), content_type="application/json")


def read_json(raw_key: str) -> dict | None:
    text = read_text_from_sources(raw_key)
    if not text:
        return None
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        return None


def presign_get(raw_key: str, expires: int = 900) -> str:
    full_key, _ = _normalize_key(raw_key)
    return _client().generate_presigned_url(
        "get_object", Params={"Bucket": S3_BUCKET, "Key": full_key}, ExpiresIn=expires
    )


def presign_put(raw_key: str, content_type: str | None = None, expires: int = 900) -> tuple[str, dict]:
    full_key, _ = _normalize_key(raw_key)
    params: dict = {"Bucket": S3_BUCKET, "Key": full_key}
    if content_type:
        params["ContentType"] = content_type
    url = _client().generate_presigned_url("put_object", Params=params, ExpiresIn=expires)
    return url, ({"Content-Type": content_type} if content_type else {})


def download_to_path(raw_key: str, destination: Path) -> Path:
    full_key, _ = _normalize_key(raw_key)
    destination.parent.mkdir(parents=True, exist_ok=True)
    _client().download_file(S3_BUCKET, full_key, str(destination))
    return destination


# ── Streaming response ──────────────────────────────────────────────────────

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
            start, end = max(total_size - length, 0), total_size - 1
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
    headers["Content-Disposition"] = f'inline; filename="{filename}"'
    return StreamingResponse(_stream_body(resp["Body"]), status_code=206 if range_h else 200, media_type=media_type, headers=headers)


# ── Asset resolution (DB-backed) ────────────────────────────────────────────

def resolve_system_asset_key(asset_name: str) -> str:
    with SessionLocal() as db:
        row = db.execute(select(MediaAsset).where(MediaAsset.asset_name == asset_name)).scalar_one_or_none()
        if not row:
            raise HTTPException(status_code=404, detail=f"System asset '{asset_name}' not found in media_assets")
        return row.s3_key


def resolve_first_system_asset_key(asset_names: list[str] | tuple[str, ...]) -> tuple[str, str]:
    for asset_name in asset_names:
        name = (asset_name or "").strip()
        if not name:
            continue
        try:
            return name, resolve_system_asset_key(name)
        except HTTPException:
            continue
    raise HTTPException(status_code=404, detail=f"None of the system assets exist in media_assets: {', '.join(asset_names)}")


def _find_asset_by_key(s3_key: str) -> MediaAsset | None:
    with SessionLocal() as db:
        return db.execute(select(MediaAsset).where(MediaAsset.s3_key == s3_key)).scalar_one_or_none()


def _upsert_uploaded_asset(*, s3_key: str, owner_user_id: str, visibility: str, group_id: str | None, media_type: str = "video") -> None:
    with SessionLocal() as db:
        row = db.execute(select(MediaAsset).where(MediaAsset.s3_key == s3_key)).scalar_one_or_none()
        if row:
            row.owner_user_id = owner_user_id
            row.visibility = visibility if visibility != "custom" else row.visibility
            row.group_id = group_id or row.group_id
            row.media_type = media_type
            row.is_system = False
        else:
            db.add(MediaAsset(
                s3_key=s3_key,
                owner_user_id=owner_user_id,
                visibility="private" if visibility == "custom" else visibility,
                group_id=group_id,
                media_type=media_type,
                is_system=False,
            ))
        db.commit()


def health_status() -> dict:
    def _s(k: str) -> dict:
        try:
            meta = head_object(k) if s3_enabled() else None
        except Exception:
            meta = None
        return {"source": "s3", "path": f"s3://{k}", "exists": bool(meta),
                "size_mb": round(meta["ContentLength"] / (1024 * 1024), 2) if meta else None}
    try:
        v = resolve_system_asset_key("video")
        f = resolve_system_asset_key("fusion_video")
        vs, fs = _s(v), _s(f)
    except HTTPException:
        return {"status": "degraded", "files": {"video": {"exists": False}, "fusion_video": {"exists": False}}}
    return {"status": "healthy" if vs["exists"] else "degraded", "files": {"video": vs, "fusion_video": fs}}


# ── High-level asset endpoints ───────────────────────────────────────────────

def _safe_filename(name: str) -> str:
    safe = "".join(c if c.isalnum() or c in "._-" else "_" for c in name)
    return safe[:255] or "file"


def _stream_asset(asset_name: str, request: Request | None, filename: str | None = None) -> StreamingResponse:
    key = resolve_system_asset_key(asset_name)
    return _stream_s3_response(key, request, _safe_filename(filename or key.rsplit("/", 1)[-1] or "file"))


def video_stream_response(request: Request):
    return _stream_asset("video", request, "boat-detection-video.mp4")


def fusion_video_response(request: Request):
    return _stream_asset("fusion_video", request)


def components_background_response():
    return _stream_asset("components_background", None)


def detections_response(request: Request):
    return _stream_asset("detections", request)


# ── Presign API ──────────────────────────────────────────────────────────────

_SAFE_SEGMENT_RE = re.compile(r"[^a-zA-Z0-9._-]+")


def _sanitize_segment(value: str | None, fallback: str) -> str:
    raw = (value or "").strip()
    cleaned = _SAFE_SEGMENT_RE.sub("-", raw).strip(".-")
    return cleaned or fallback


def _media_type_from_content_type(content_type: str | None) -> str:
    ct = (content_type or "").lower().split(";")[0].strip()
    if ct.startswith("video/"):
        return "video"
    if ct.startswith("image/"):
        return "image"
    if ct in {"application/json", "text/plain", "text/csv"}:
        return "data"
    return "video"


def _validate_client_key(raw_key: str) -> str:
    _, key = _normalize_key(raw_key)
    if _find_asset_by_key(key) or key.startswith("videos/"):
        return key
    raise HTTPException(status_code=403, detail="key must exist in media_assets or be under videos/ for user uploads")


def _ensure_user_can_access_key(key: str, owner_user_id: str, is_admin: bool) -> None:
    if is_admin or key.startswith("videos/public/"):
        return
    if f"/{_sanitize_segment(owner_user_id, 'unknown-user')}/" not in f"/{key}":
        raise HTTPException(status_code=403, detail="Requested key is outside caller ownership scope")


def _resolve_upload_key(request: PresignRequest, owner_user_id: str, is_admin: bool) -> tuple[str, str]:
    """Return (key, visibility) for an upload, either from explicit key or auto-built."""
    if request.key:
        key = _validate_client_key(request.key)
        _ensure_user_can_access_key(key, owner_user_id, is_admin)
        return key, "custom"
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
    stem, dot, ext = filename.rpartition(".")
    if not stem:
        stem, ext, dot = filename, "", ""
    unique = f"{stem}-{uuid4().hex[:10]}{dot}{ext}"
    owner_id = _sanitize_segment(owner_user_id, "unknown-user")
    return f"videos/{visibility}/{group_id}/{owner_id}/{stream_id}/{unique}", visibility


def presign_storage(request: PresignRequest, *, owner_user_id: str, is_admin: bool = False) -> dict:
    if not s3_enabled():
        raise HTTPException(status_code=500, detail="S3 is not configured")
    method = request.method.strip().upper()
    exp = request.expires_in or S3_PRESIGN_EXPIRES
    owner = _sanitize_segment(owner_user_id, "unknown-user")

    if method == "GET":
        if not request.key:
            raise HTTPException(status_code=400, detail="key is required for GET")
        key = _validate_client_key(request.key)
        asset = _find_asset_by_key(key)
        if asset and not (is_admin or asset.is_system or asset.visibility == "public" or asset.owner_user_id == owner_user_id):
            raise HTTPException(status_code=403, detail="Requested key is not visible for this user")
        if not asset:
            _ensure_user_can_access_key(key, owner_user_id, is_admin)
        return {"method": "GET", "key": key, "url": presign_get(key, expires=exp), "headers": {}, "expires_in": exp}

    if method == "PUT":
        key, visibility = _resolve_upload_key(request, owner_user_id, is_admin)
        url, headers = presign_put(key, content_type=request.content_type, expires=exp)
        _upsert_uploaded_asset(s3_key=key, owner_user_id=owner, visibility=visibility,
                               group_id=_sanitize_segment(request.group_id, "default-group") if request.group_id else None,
                               media_type=_media_type_from_content_type(request.content_type))
        return {"method": "PUT", "key": key, "visibility": visibility, "owner_user_id": owner,
                "url": url, "headers": headers, "expires_in": exp}

    if method == "MULTIPART_INIT":
        if not request.part_count or not (1 <= request.part_count <= 10000):
            raise HTTPException(status_code=400, detail="part_count must be between 1 and 10000")
        key, visibility = _resolve_upload_key(request, owner_user_id, is_admin)
        full_key, _ = _normalize_key(key)
        params: dict = {"Bucket": S3_BUCKET, "Key": full_key}
        if request.content_type:
            params["ContentType"] = request.content_type
        upload_id = _client().create_multipart_upload(**params).get("UploadId") or ""
        if not upload_id:
            raise RuntimeError("Failed to create multipart upload")
        part_urls = [{"part_number": n, "url": _client().generate_presigned_url(
            "upload_part", Params={"Bucket": S3_BUCKET, "Key": full_key, "UploadId": upload_id, "PartNumber": n}, ExpiresIn=exp
        ), "headers": {}} for n in range(1, request.part_count + 1)]
        return {"method": "MULTIPART_INIT", "key": key, "visibility": visibility, "owner_user_id": owner,
                "upload_id": upload_id, "part_count": request.part_count, "part_urls": part_urls, "expires_in": exp}

    if method == "MULTIPART_COMPLETE":
        if not request.key or not request.upload_id or request.completed_parts is None:
            raise HTTPException(status_code=400, detail="key, upload_id, and completed_parts are required")
        key = _validate_client_key(request.key)
        _ensure_user_can_access_key(key, owner_user_id, is_admin)
        asset = _find_asset_by_key(key)
        visibility = asset.visibility if asset else "custom"
        full_key, _ = _normalize_key(key)
        parts = []
        for part in request.completed_parts:
            try:
                n = int(part.get("part_number") or 0)
            except (TypeError, ValueError):
                raise HTTPException(status_code=400, detail="Invalid part_number in completed_parts")
            etag = str(part.get("etag", "")).strip().strip('"')
            if n <= 0 or not etag:
                raise HTTPException(status_code=400, detail="Each part requires part_number and etag")
            parts.append({"PartNumber": n, "ETag": etag})
        if not parts:
            raise HTTPException(status_code=400, detail="completed_parts must not be empty")
        _client().complete_multipart_upload(Bucket=S3_BUCKET, Key=full_key, UploadId=request.upload_id,
                                            MultipartUpload={"Parts": sorted(parts, key=lambda p: p["PartNumber"])})
        _upsert_uploaded_asset(s3_key=key, owner_user_id=owner, visibility=visibility,
                               group_id=_sanitize_segment(request.group_id, "default-group") if request.group_id else None,
                               media_type=_media_type_from_content_type(request.content_type))
        if (request.upload_purpose or "").strip().lower() == "analysis":
            from services.uploaded_video_analysis_service import (
                build_placeholder_payload,
                write_analysis_payload,
            )

            asset = _find_asset_by_key(key)
            if asset is None:
                raise HTTPException(status_code=500, detail="Uploaded media asset was not persisted")
            write_analysis_payload(asset, build_placeholder_payload(asset))
        return {"method": "MULTIPART_COMPLETE", "key": key, "completed": True}

    if method == "MULTIPART_ABORT":
        if not request.key or not request.upload_id:
            raise HTTPException(status_code=400, detail="key and upload_id are required")
        key = _validate_client_key(request.key)
        _ensure_user_can_access_key(key, owner_user_id, is_admin)
        full_key, _ = _normalize_key(key)
        try:
            _client().abort_multipart_upload(Bucket=S3_BUCKET, Key=full_key, UploadId=request.upload_id)
        except ClientError as exc:
            if exc.response.get("Error", {}).get("Code") not in {"404", "NoSuchUpload", "NotFound"}:
                raise
        return {"method": "MULTIPART_ABORT", "key": key, "aborted": True}

    raise HTTPException(status_code=400, detail="method must be GET, PUT, MULTIPART_INIT, MULTIPART_COMPLETE, or MULTIPART_ABORT")
