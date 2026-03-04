from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import subprocess
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen

from fastapi import APIRouter, Query, Response, UploadFile
from pydantic import BaseModel

from cv.publisher import get_fusion_publisher
from sensor_fusion.ais_store import AISStore
from webapi.errors import (
    bad_gateway,
    bad_request,
    conflict,
    not_found,
    service_unavailable,
    wrap_internal,
)
from webapi import state
from settings import app_settings
from common.config import BASE_DIR
from common.config.mediamtx import FFMPEG_BIN
from orchestrator import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
    StreamConfig,
    StreamHandle,
    StreamNotFoundError,
    WorkerOrchestrator,
)
from services.stream_service import (
    augment_stream_payload,
    build_stream_playback_payload,
    resolve_stream_source,
)
from storage import s3

router = APIRouter()
logger = logging.getLogger(__name__)

# API boundary note: handlers intentionally catch broad exceptions and map
# them to HTTP errors so failures are returned consistently.

FUSION_STREAM_ID = "fusion"
FUSION_AIS_URL_DEFAULT = (
    "https://bridgable.hel1.your-objectstorage.com/openar/ais-data/fusion-trondheim/Pirbadet.ndjson"
)
FUSION_AIS_CACHE_PATH = BASE_DIR / "data" / "cache" / "fusion" / "Pirbadet.ndjson"
FUSION_AIS_TIME_WINDOW_S = float(os.getenv("FUSION_STREAM_AIS_TIME_WINDOW_S", "900"))
STREAM_UPLOAD_MAX_DURATION_S = float(os.getenv("STREAM_UPLOAD_MAX_DURATION_S", "300"))
STREAM_UPLOAD_MAX_SIZE_MB = float(os.getenv("STREAM_UPLOAD_MAX_SIZE_MB", "300"))
STREAM_UPLOAD_MAX_SIZE_BYTES = int(STREAM_UPLOAD_MAX_SIZE_MB * 1024 * 1024)


class StreamStartRequest(BaseModel):
    source_url: str | None = None
    loop: bool = True


def _require_orchestrator() -> WorkerOrchestrator:
    if not state.orchestrator:
        service_unavailable("Orchestrator not initialized")
    return state.orchestrator


def _validate_stream_id(stream_id: str) -> None:
    if not app_settings.stream_id_pattern.fullmatch(stream_id):
        bad_request("Invalid stream_id")


def _start_orchestrator_stream(orchestrator: WorkerOrchestrator, config: StreamConfig) -> StreamHandle:
    try:
        return orchestrator.start_stream(config)
    except StreamAlreadyRunningError as exc:
        conflict(str(exc), cause=exc)
    except ResourceLimitExceededError as exc:
        service_unavailable(str(exc))


def _coerce_s3_key(raw: str | None) -> str | None:
    if not raw:
        return None
    value = raw.strip()
    if not value:
        return None
    if value.startswith("s3://"):
        return value[5:]
    if value.startswith("http://") or value.startswith("https://"):
        parsed = urlparse(value)
        path = parsed.path.strip("/")
        if path.startswith("openar/"):
            return path[len("openar/") :]
        return path
    return value


def _load_fusion_ais_text() -> tuple[str | None, str | None]:
    source = os.getenv("FUSION_STREAM_AIS_URL", FUSION_AIS_URL_DEFAULT).strip()
    if not source:
        return None, None

    s3_key = _coerce_s3_key(source)
    if s3_key:
        text = s3.read_text_from_sources(s3_key)
        if text:
            return text, f"s3://{s3_key}"

    if source.startswith(("http://", "https://")):
        try:
            with urlopen(source, timeout=20) as response:
                body = response.read()
            text = body.decode("utf-8", errors="ignore")
            if text.strip():
                return text, source
        except Exception as exc:
            logger.warning("[fusion:%s] Failed to download AIS NDJSON from URL: %s", FUSION_STREAM_ID, exc)

    fallback = BASE_DIR / "data" / "raw" / "video" / "Pirbadet.ndjson"
    try:
        if fallback.exists():
            text = fallback.read_text(encoding="utf-8")
            if text.strip():
                return text, str(fallback)
    except OSError as exc:
        logger.warning("[fusion:%s] Failed to read local fallback NDJSON: %s", FUSION_STREAM_ID, exc)

    return None, None


def _configure_fusion_stream_ais(stream_id: str) -> None:
    if stream_id != FUSION_STREAM_ID:
        return

    text, source_label = _load_fusion_ais_text()
    if not text:
        logger.warning("[fusion:%s] No AIS NDJSON available; fusion enrichment disabled", stream_id)
        return

    FUSION_AIS_CACHE_PATH.parent.mkdir(parents=True, exist_ok=True)
    FUSION_AIS_CACHE_PATH.write_text(text, encoding="utf-8")

    store = AISStore(FUSION_AIS_CACHE_PATH, time_window_s=FUSION_AIS_TIME_WINDOW_S)
    time_range = store.time_range
    if not time_range:
        logger.warning("[fusion:%s] AIS NDJSON had no usable records", stream_id)
        return

    get_fusion_publisher().fusion_svc.configure(
        stream_id=stream_id,
        ais_store=store,
        video_epoch_utc=time_range[0],
    )
    logger.info(
        "[fusion:%s] Configured AIS enrichment from %s (%d records, time_window_s=%s)",
        stream_id,
        source_label or "unknown",
        store.record_count,
        FUSION_AIS_TIME_WINDOW_S,
    )


def _probe_video_duration_seconds(source: str) -> float | None:
    ffprobe_bin = FFMPEG_BIN.replace("ffmpeg", "ffprobe")
    try:
        result = subprocess.run(
            [
                ffprobe_bin,
                "-v",
                "error",
                "-select_streams",
                "v:0",
                "-show_entries",
                "format=duration",
                "-of",
                "json",
                source,
            ],
            capture_output=True,
            text=True,
            timeout=15,
        )
        if result.returncode != 0:
            return None
        payload = json.loads(result.stdout or "{}")
        duration_raw = payload.get("format", {}).get("duration")
        if duration_raw is None:
            return None
        duration = float(duration_raw)
        if duration <= 0 or not math.isfinite(duration):
            return None
        return duration
    except (FileNotFoundError, ValueError, json.JSONDecodeError, subprocess.TimeoutExpired):
        return None


async def _validate_s3_source_limits(original_source_url: str | None, resolved_source_url: str) -> None:
    raw = (original_source_url or "").strip()
    if not raw.startswith("s3://"):
        return

    s3_key = raw[5:]
    if not s3_key.startswith("videos/"):
        return

    meta = await asyncio.get_event_loop().run_in_executor(None, s3.head_object, s3_key)
    if not meta:
        bad_request("Uploaded S3 object is not available")
    size_bytes = int(meta.get("ContentLength", 0))
    if size_bytes <= 0:
        bad_request("Uploaded S3 object is empty")
    if size_bytes > STREAM_UPLOAD_MAX_SIZE_BYTES:
        bad_request(
            f"Video file too large ({size_bytes / (1024 * 1024):.1f} MB). "
            f"Max allowed is {STREAM_UPLOAD_MAX_SIZE_MB:.0f} MB."
        )

    duration_s = await asyncio.get_event_loop().run_in_executor(
        None, _probe_video_duration_seconds, resolved_source_url
    )
    if duration_s is None:
        bad_request("Unable to read video metadata. Please upload a valid video file.")
    if duration_s > STREAM_UPLOAD_MAX_DURATION_S:
        bad_request(
            f"Video too long ({duration_s:.1f}s). Max allowed is "
            f"{STREAM_UPLOAD_MAX_DURATION_S:.0f}s (5 minutes)."
        )


@router.post("/api/streams/{stream_id}/start", status_code=201)
async def start_stream(stream_id: str, request: StreamStartRequest) -> dict[str, Any]:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()

    try:
        existing_handle = await asyncio.get_event_loop().run_in_executor(
            None, orchestrator.get_stream, stream_id
        )
    except StreamNotFoundError:
        existing_handle = None

    if existing_handle is not None:
        if stream_id == FUSION_STREAM_ID:
            try:
                await asyncio.get_event_loop().run_in_executor(
                    None, _configure_fusion_stream_ais, stream_id
                )
            except Exception as exc:
                logger.warning(
                    "[fusion:%s] Failed to refresh AIS enrichment on existing stream: %s",
                    stream_id,
                    exc,
                )
        return {
            "status": "already_running",
            **existing_handle.to_dict(),
            "playback_urls": build_stream_playback_payload(stream_id),
        }

    try:
        source_url = await asyncio.get_event_loop().run_in_executor(
            None, resolve_stream_source, request.source_url
        )
    except RuntimeError as exc:
        bad_gateway(str(exc))
    if not source_url:
        bad_request("source_url is required for this stream")
    await _validate_s3_source_limits(request.source_url, source_url)

    config = StreamConfig(stream_id=stream_id, source_url=source_url, loop=request.loop)
    handle = await asyncio.get_event_loop().run_in_executor(
        None, _start_orchestrator_stream, orchestrator, config
    )
    if stream_id == FUSION_STREAM_ID:
        try:
            await asyncio.get_event_loop().run_in_executor(None, _configure_fusion_stream_ais, stream_id)
        except Exception as exc:
            logger.warning("[fusion:%s] Failed to configure AIS enrichment: %s", stream_id, exc)

    return {
        "status": "started",
        **handle.to_dict(),
        "playback_urls": build_stream_playback_payload(stream_id),
    }


@router.post("/api/streams/{stream_id}/upload", status_code=201)
async def upload_and_start_stream(
    stream_id: str,
    file: UploadFile,
    loop: bool = True,
) -> dict[str, Any]:
    _validate_stream_id(stream_id)
    _ = file
    _ = loop
    bad_request(
        "Direct file upload endpoint is disabled. Upload to S3 via /api/storage/presign "
        "and start using source_url=s3://<key>."
    )


@router.delete("/api/streams/{stream_id}", status_code=204, response_class=Response)
async def stop_stream(stream_id: str) -> Response:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()

    try:
        orchestrator.stop_stream(stream_id)
    except StreamNotFoundError as exc:
        not_found(str(exc))
    finally:
        try:
            get_fusion_publisher().fusion_svc.clear(stream_id)
        except Exception:
            # Fusion enrichment may not be configured for this stream.
            pass
    return Response(status_code=204)


@router.get("/api/streams")
async def list_streams() -> dict[str, Any]:
    orchestrator = _require_orchestrator()
    streams = [augment_stream_payload(stream) for stream in orchestrator.list_streams()]
    return {"streams": streams, "max_workers": app_settings.max_workers}


@router.get("/api/streams/{stream_id}/playback")
async def get_stream_playback(stream_id: str) -> dict[str, Any]:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()

    try:
        orchestrator.get_stream(stream_id)
    except StreamNotFoundError as exc:
        not_found(str(exc))

    return {"stream_id": stream_id, "playback_urls": build_stream_playback_payload(stream_id)}



@router.post("/api/streams/{stream_id}/heartbeat", status_code=204, response_class=Response)
async def heartbeat_stream(
    stream_id: str,
    keep_warm_s: float | None = Query(default=None, ge=0.0),
) -> Response:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()
    warm_lease_s = (
        app_settings.stream_warm_lease_seconds if keep_warm_s is None else keep_warm_s
    )
    orchestrator.touch_stream(stream_id, keep_warm_s=warm_lease_s)
    return Response(status_code=204)
