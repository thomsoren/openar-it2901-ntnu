"""
S3 helpers for OpenAR asset storage (Hetzner-compatible).
"""
from __future__ import annotations

from functools import lru_cache
from pathlib import Path, PurePosixPath

import boto3
from botocore.client import Config
from botocore.exceptions import ClientError
from fastapi import HTTPException, Request
from fastapi.responses import FileResponse, RedirectResponse, StreamingResponse
from pydantic import BaseModel

from common import settings


class PresignRequest(BaseModel):
    key: str
    method: str = "GET"
    content_type: str | None = None
    expires_in: int | None = None


def s3_enabled() -> bool:
    return bool(
        settings.S3_ENDPOINT
        and settings.S3_BUCKET
        and settings.S3_ACCESS_KEY
        and settings.S3_SECRET_KEY
    )


def _normalize_key(raw_key: str) -> tuple[str, str]:
    key = raw_key.strip().lstrip("/")
    if not key:
        raise ValueError("S3 key is required")

    parts = PurePosixPath(key).parts
    if ".." in parts:
        raise ValueError("S3 key must not contain '..'")

    if settings.S3_PREFIX:
        if key == settings.S3_PREFIX:
            raise ValueError("S3 key resolves to prefix root")
        if key.startswith(f"{settings.S3_PREFIX}/"):
            full_key = key
            relative_key = key[len(settings.S3_PREFIX) + 1 :]
        else:
            full_key = f"{settings.S3_PREFIX}/{key}"
            relative_key = key
    else:
        full_key = key
        relative_key = key

    return full_key, relative_key


@lru_cache(maxsize=1)
def _client():
    if not s3_enabled():
        raise RuntimeError("S3 is not configured")
    return boto3.client(
        "s3",
        endpoint_url=settings.S3_ENDPOINT,
        region_name=settings.S3_REGION,
        aws_access_key_id=settings.S3_ACCESS_KEY,
        aws_secret_access_key=settings.S3_SECRET_KEY,
        config=Config(signature_version="s3v4"),
    )


def head_object(raw_key: str) -> dict | None:
    full_key, _ = _normalize_key(raw_key)
    try:
        return _client().head_object(Bucket=settings.S3_BUCKET, Key=full_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"404", "NoSuchKey", "NotFound"}:
            return None
        raise


def public_url(raw_key: str) -> str | None:
    if not settings.S3_PUBLIC_BASE_URL:
        return None
    full_key, relative_key = _normalize_key(raw_key)
    base = settings.S3_PUBLIC_BASE_URL.rstrip("/")
    if settings.S3_PREFIX and base.endswith(f"/{settings.S3_PREFIX}"):
        suffix = relative_key
    else:
        suffix = full_key
    return f"{base}/{suffix}"


def presign_get(raw_key: str, expires: int = 900) -> str:
    full_key, _ = _normalize_key(raw_key)
    return _client().generate_presigned_url(
        "get_object",
        Params={"Bucket": settings.S3_BUCKET, "Key": full_key},
        ExpiresIn=expires,
    )


def presign_put(
    raw_key: str,
    content_type: str | None = None,
    expires: int = 900,
) -> tuple[str, dict]:
    full_key, _ = _normalize_key(raw_key)
    params = {"Bucket": settings.S3_BUCKET, "Key": full_key}
    headers: dict[str, str] = {}
    if content_type:
        params["ContentType"] = content_type
        headers["Content-Type"] = content_type

    url = _client().generate_presigned_url(
        "put_object",
        Params=params,
        ExpiresIn=expires,
    )
    return url, headers


def get_download_url(raw_key: str, expires: int = 900) -> str:
    if s3_enabled():
        return presign_get(raw_key, expires=expires)
    public = public_url(raw_key)
    if public:
        return public
    raise RuntimeError("S3 is not configured")


def _stream_s3_body(body, chunk_size: int = 1024 * 1024):
    try:
        for chunk in body.iter_chunks(chunk_size=chunk_size):
            if chunk:
                yield chunk
    finally:
        body.close()


def _parse_range(range_header: str, total_size: int) -> tuple[int, int]:
    if not range_header.startswith("bytes="):
        raise HTTPException(status_code=416, detail="Invalid range header")
    raw_range = range_header.replace("bytes=", "", 1).strip()
    if "," in raw_range:
        raise HTTPException(status_code=416, detail="Multiple ranges not supported")

    start_str, end_str = raw_range.split("-", 1)
    if start_str == "":
        # Suffix range: bytes=-N (last N bytes)
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

    end = min(end, total_size - 1)
    return start, end


def _stream_s3_response(raw_key: str, request: Request, filename: str) -> StreamingResponse:
    if not s3_enabled():
        raise HTTPException(status_code=500, detail="S3 is not configured")

    full_key, _ = _normalize_key(raw_key)
    try:
        meta = _client().head_object(Bucket=settings.S3_BUCKET, Key=full_key)
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code")
        if code in {"404", "NoSuchKey", "NotFound"}:
            raise HTTPException(status_code=404, detail="S3 object not found")
        raise HTTPException(status_code=500, detail=str(exc))

    total_size = int(meta.get("ContentLength", 0))
    content_type = meta.get("ContentType") or "application/octet-stream"
    range_header = request.headers.get("range")

    if range_header:
        start, end = _parse_range(range_header, total_size)
        byte_range = f"bytes={start}-{end}"
        response = _client().get_object(
            Bucket=settings.S3_BUCKET,
            Key=full_key,
            Range=byte_range,
        )
        length = end - start + 1
        headers = {
            "Accept-Ranges": "bytes",
            "Content-Range": f"bytes {start}-{end}/{total_size}",
            "Content-Length": str(length),
            "Content-Disposition": f"inline; filename={filename}",
        }
        return StreamingResponse(
            _stream_s3_body(response["Body"]),
            status_code=206,
            media_type=content_type,
            headers=headers,
        )

    response = _client().get_object(Bucket=settings.S3_BUCKET, Key=full_key)
    headers = {
        "Accept-Ranges": "bytes",
        "Content-Length": str(total_size),
        "Content-Disposition": f"inline; filename={filename}",
    }
    return StreamingResponse(
        _stream_s3_body(response["Body"]),
        media_type=content_type,
        headers=headers,
    )


def read_text(raw_key: str, encoding: str = "utf-8") -> str:
    full_key, _ = _normalize_key(raw_key)
    response = _client().get_object(Bucket=settings.S3_BUCKET, Key=full_key)
    body = response["Body"].read()
    return body.decode(encoding, errors="ignore")


def read_text_from_sources(
    label: str,
    s3_key: str | None,
    local_path,
) -> str | None:
    print(f"[DEBUG] read_text_from_sources for {label}:")
    print(f"  - s3_key: {s3_key}")
    print(f"  - local_path: {local_path}")
    print(f"  - S3 enabled: {s3_enabled()}")
    
    if s3_key:
        if s3_enabled():
            try:
                print(f"[DEBUG] Attempting to check if S3 object exists: {s3_key}")
                head_result = head_object(s3_key)
                print(f"[DEBUG] head_object result: {head_result}")
                if head_result is not None:
                    print(f"[DEBUG] Reading text from S3: {s3_key}")
                    text = read_text(s3_key)
                    print(f"[DEBUG] Successfully read {len(text)} chars from S3")
                    return text
                else:
                    print(f"[DEBUG] S3 object does not exist: {s3_key}")
            except Exception as exc:
                print(f"[ERROR] Failed to load {label} data from S3: {exc}")
                import traceback
                traceback.print_exc()
        else:
            print(f"[DEBUG] {label} S3 key is set but S3 is not configured; ignoring.")

    if local_path:
        print(f"[DEBUG] Checking local path: {local_path} (exists: {local_path.exists() if local_path else 'N/A'})")
        if local_path.exists():
            text = local_path.read_text(encoding="utf-8", errors="ignore")
            print(f"[DEBUG] Successfully read {len(text)} chars from local path")
            return text
    else:
        print(f"[DEBUG] No local path provided")

    print(f"[ERROR] No data found for {label} from either S3 or local path")
    return None


def list_objects(prefix: str | None = None) -> list[str]:
    search_prefix = ""
    if prefix:
        full_key, _ = _normalize_key(prefix)
        search_prefix = full_key
    elif settings.S3_PREFIX:
        search_prefix = f"{settings.S3_PREFIX}/"

    results: list[str] = []
    paginator = _client().get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=settings.S3_BUCKET, Prefix=search_prefix):
        for item in page.get("Contents", []):
            key = item.get("Key")
            if key:
                results.append(key)
    return results


def _maybe_redirect_to_s3(s3_key: str | None) -> RedirectResponse | None:
    if not s3_key:
        return None
    if not s3_enabled():
        if settings.S3_PUBLIC_BASE_URL:
            try:
                url = public_url(s3_key)
            except ValueError as exc:
                raise HTTPException(status_code=400, detail=str(exc))
            if url:
                return RedirectResponse(url, status_code=307)
        raise HTTPException(status_code=500, detail="S3 is not configured")
    try:
        if head_object(s3_key) is None:
            return None
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    try:
        url = get_download_url(s3_key, expires=settings.S3_PRESIGN_EXPIRES)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return RedirectResponse(url, status_code=307)


def asset_status(path: Path | None, s3_key: str | None) -> dict:
    if s3_key:
        if not s3_enabled():
            return {
                "source": "s3",
                "path": f"s3://{s3_key}",
                "exists": False,
                "size_mb": None,
                "error": "S3 not configured",
            }
        try:
            meta = head_object(s3_key)
        except Exception as exc:
            return {
                "source": "s3",
                "path": f"s3://{s3_key}",
                "exists": False,
                "size_mb": None,
                "error": str(exc),
            }
        size_mb = (
            round(meta["ContentLength"] / (1024 * 1024), 2)
            if meta and "ContentLength" in meta
            else None
        )
        return {
            "source": "s3",
            "path": f"s3://{s3_key}",
            "exists": bool(meta),
            "size_mb": size_mb,
        }

    if not path:
        return {"source": "local", "path": None, "exists": False, "size_mb": None}

    exists = path.exists()
    return {
        "source": "local",
        "path": str(path),
        "exists": exists,
        "size_mb": round(path.stat().st_size / (1024 * 1024), 2) if exists else None,
    }


def health_status() -> dict:
    video_status = asset_status(settings.VIDEO_PATH, settings.VIDEO_S3_KEY)
    fusion_video_status = asset_status(
        settings.FUSION_VIDEO_PATH, settings.FUSION_VIDEO_S3_KEY
    )
    return {
        "status": "healthy" if video_status["exists"] else "degraded",
        "files": {
            "video": video_status,
            "fusion_video": fusion_video_status,
        },
    }


def video_response(request: Request):
    # Try S3 first if configured
    if s3_enabled():
        return _stream_s3_response(
            settings.VIDEO_S3_KEY,
            request,
            filename="boat-detection-video.mp4",
        )
    # Fall back to local file
    path = settings.VIDEO_PATH
    if path and path.exists():
        return FileResponse(
            path=path,
            media_type="video/mp4",
            filename="boat-detection-video.mp4",
            headers={
                "Accept-Ranges": "bytes",
                "Content-Disposition": "inline",
            },
        )
    raise HTTPException(
        status_code=404,
        detail=f"Video file not found at {path}",
    )


def video_stream_response(request: Request):
    if s3_enabled():
        return _stream_s3_response(
            settings.VIDEO_S3_KEY,
            request,
            filename="boat-detection-video.mp4",
        )
    redirect = _maybe_redirect_to_s3(settings.VIDEO_S3_KEY)
    if redirect:
        return redirect
    path = settings.VIDEO_PATH
    if not path or not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Video file not found at {path}",
        )
    return FileResponse(
        path=path,
        media_type="video/mp4",
        filename="boat-detection-video.mp4",
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": "inline; filename=boat-detection-video.mp4",
        },
    )


def fusion_video_response(request: Request):
    if s3_enabled():
        return _stream_s3_response(
            settings.FUSION_VIDEO_S3_KEY,
            request,
            filename=settings.FUSION_VIDEO_S3_KEY.rsplit("/", 1)[-1],
        )
    redirect = _maybe_redirect_to_s3(settings.FUSION_VIDEO_S3_KEY)
    if redirect:
        return redirect
    path = settings.FUSION_VIDEO_PATH
    if not path or not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Fusion video file not found at {path}",
        )
    return FileResponse(
        path=path,
        media_type="video/mp4",
        filename=path.name,
        headers={
            "Accept-Ranges": "bytes",
            "Content-Disposition": "inline",
        },
    )


def components_background_response():
    redirect = _maybe_redirect_to_s3(settings.COMPONENTS_BG_S3_KEY)
    if redirect:
        return redirect
    path = settings.COMPONENTS_BG_PATH
    if not path or not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Background image not found at {path}",
        )
    return FileResponse(
        path=path,
        media_type="image/png",
        filename=path.name,
        headers={"Content-Disposition": "inline"},
    )


def detections_response(request: Request):
    if s3_enabled():
        return _stream_s3_response(
            settings.DETECTIONS_S3_KEY,
            request,
            filename=settings.DETECTIONS_S3_KEY.rsplit("/", 1)[-1],
        )
    path = settings.DETECTIONS_PATH
    if not path or not path.exists():
        raise HTTPException(
            status_code=404,
            detail=f"Detections file not found at {path}",
        )
    return FileResponse(
        path=path,
        media_type="application/json",
        filename=path.name,
        headers={"Content-Disposition": "inline"},
    )


def _validate_client_key(raw_key: str) -> str:
    key = raw_key.strip().lstrip("/")
    if not key:
        raise HTTPException(status_code=400, detail="key is required")

    parts = PurePosixPath(key).parts
    if ".." in parts:
        raise HTTPException(status_code=400, detail="key must not contain '..'")

    if settings.S3_ALLOWED_PREFIXES:
        allowed = any(
            key == prefix or key.startswith(f"{prefix}/")
            for prefix in settings.S3_ALLOWED_PREFIXES
        )
        if not allowed:
            allowed_list = ", ".join(settings.S3_ALLOWED_PREFIXES)
            raise HTTPException(
                status_code=403,
                detail=f"key must start with one of: {allowed_list}",
            )

    return key


def presign_storage(request: PresignRequest) -> dict:
    if not s3_enabled():
        raise HTTPException(status_code=500, detail="S3 is not configured")

    key = _validate_client_key(request.key)
    method = request.method.strip().upper()
    expires_in = request.expires_in or settings.S3_PRESIGN_EXPIRES

    if method == "GET":
        url = get_download_url(key, expires=expires_in)
        return {
            "method": "GET",
            "key": key,
            "url": url,
            "headers": {},
            "expires_in": expires_in,
        }

    if method == "PUT":
        url, headers = presign_put(
            key,
            content_type=request.content_type,
            expires=expires_in,
        )
        return {
            "method": "PUT",
            "key": key,
            "url": url,
            "headers": headers,
            "expires_in": expires_in,
        }

    raise HTTPException(status_code=400, detail="method must be GET or PUT")
