from __future__ import annotations

import asyncio
import json
import logging
import math
import os
import subprocess
from typing import Annotated, Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Query, Response, UploadFile, status
from pydantic import BaseModel

from auth.deps import get_current_user, get_optional_user
from cv.publisher import get_fusion_publisher
from cv.utils import is_http_url
from db.models import AppUser
from sensor_fusion.ais_store import AISStore
from webapi.errors import (
    bad_gateway,
    bad_request,
    conflict,
    forbidden,
    not_found,
    service_unavailable,
    wrap_internal,
)
from webapi import state
from settings import app_settings
from common.config.mediamtx import FFPROBE_BIN
from orchestrator import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
    StreamConfig,
    StreamHandle,
    StreamNotFoundError,
    WorkerOrchestrator,
)
from services.stream_service import (
    _presign_s3_for_ffmpeg,
    augment_stream_payload,
    build_stream_playback_payload,
    resolve_stream_source,
)
from services.transcode_service import get_transcoded_key, run_transcode_task
from services.hls_service import get_hls_playback_url
from storage import s3
from webapi.constants import FUSION_STREAM_ID, SYSTEM_STREAM_IDS

router = APIRouter()
logger = logging.getLogger(__name__)
FUSION_AIS_ASSET_NAMES = ("fusion_ais_pirbadet",)
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


def _require_stream_access(
    orchestrator: WorkerOrchestrator,
    stream_id: str,
    user: AppUser,
) -> None:
    if user.is_admin:
        return
    if stream_id in SYSTEM_STREAM_IDS:
        return
    if not orchestrator.is_stream_owner(stream_id, user.id):
        forbidden("You do not have access to this stream")


def _start_orchestrator_stream(orchestrator: WorkerOrchestrator, config: StreamConfig) -> StreamHandle:
    try:
        return orchestrator.start_stream(config)
    except StreamAlreadyRunningError as exc:
        conflict(str(exc), cause=exc)
    except ResourceLimitExceededError as exc:
        service_unavailable(str(exc))


def _load_fusion_ais_text() -> tuple[str | None, str | None]:
    try:
        asset_name, s3_key = s3.resolve_first_system_asset_key(FUSION_AIS_ASSET_NAMES)
    except Exception:
        return None, None

    text = s3.read_text_from_sources(s3_key)
    if text and text.strip():
        return text, f"{asset_name} (s3://{s3_key})"
    return None, f"{asset_name} (s3://{s3_key})"


def _configure_fusion_stream_ais(stream_id: str) -> None:
    if stream_id != FUSION_STREAM_ID:
        return

    text, source_label = _load_fusion_ais_text()
    if not text:
        logger.warning("[fusion:%s] No AIS NDJSON available; fusion enrichment disabled", stream_id)
        return

    store = AISStore(ndjson_text=text, time_window_s=FUSION_AIS_TIME_WINDOW_S)
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
    try:
        result = subprocess.run(
            [
                FFPROBE_BIN,
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
    s3_key = s3.coerce_s3_key(original_source_url)
    if s3_key is None:
        return
    if not s3_key.startswith("videos/"):
        return

    meta = await asyncio.get_running_loop().run_in_executor(None, s3.head_object, s3_key)
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

    duration_s = await asyncio.get_running_loop().run_in_executor(
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
async def start_stream(
    stream_id: str,
    request: StreamStartRequest,
    background_tasks: BackgroundTasks,
    current_user: Annotated[AppUser | None, Depends(get_optional_user)],
) -> dict[str, Any]:
    _validate_stream_id(stream_id)
    if current_user is None and stream_id not in SYSTEM_STREAM_IDS:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication required for private streams",
        )
    orchestrator = _require_orchestrator()

    try:
        existing_handle = await asyncio.get_running_loop().run_in_executor(
            None, orchestrator.get_stream, stream_id
        )
    except StreamNotFoundError:
        existing_handle = None

    if existing_handle is not None:
        if current_user is not None:
            _require_stream_access(orchestrator, stream_id, current_user)
        if stream_id == FUSION_STREAM_ID:
            background_tasks.add_task(_configure_fusion_stream_ais, stream_id)
        existing_s3_key = existing_handle.config.source_s3_key
        return {
            "status": "already_running",
            **existing_handle.to_dict(),
            "playback_urls": build_stream_playback_payload(stream_id, s3_key=existing_s3_key),
        }

    if (
        stream_id not in SYSTEM_STREAM_IDS
        and current_user is not None
        and not current_user.is_admin
        and orchestrator.count_user_streams(current_user.id) >= app_settings.max_streams_per_user
    ):
        service_unavailable(
            f"You have reached the maximum of {app_settings.max_streams_per_user} concurrent streams"
        )

    try:
        source_url = await asyncio.get_running_loop().run_in_executor(
            None, resolve_stream_source, request.source_url
        )
    except RuntimeError as exc:
        bad_gateway(str(exc))
    if not source_url:
        bad_request("source_url is required for this stream")
    await _validate_s3_source_limits(request.source_url, source_url)

    # Trigger background transcode for S3 uploads that haven't been transcoded yet
    original_s3_key = s3.coerce_s3_key(request.source_url) if request.source_url else None
    is_pretranscoded = False
    if original_s3_key and original_s3_key.startswith("videos/"):
        transcoded = get_transcoded_key(original_s3_key)
        is_pretranscoded = transcoded is not None
        if not transcoded:
            background_tasks.add_task(run_transcode_task, original_s3_key)

    # Fusion stream: resolve S3 key directly so FFmpeg can use -c:v copy
    # instead of live-transcoding the HTTP API endpoint.
    fusion_s3_key: str | None = None
    if stream_id == FUSION_STREAM_ID and source_url and is_http_url(source_url):
        try:
            _, fusion_s3_key = s3.resolve_first_system_asset_key(("fusion_video_pirbadet",))
            source_url = _presign_s3_for_ffmpeg(fusion_s3_key)
            is_pretranscoded = True
        except HTTPException:
            pass

    # Resolve the canonical S3 key for this stream (used for HLS playback).
    # Priority: explicit s3:// from request > fusion system asset > default system asset
    source_s3_key = original_s3_key or fusion_s3_key
    if not source_s3_key and not request.source_url:
        # Default stream — resolve the system "video" asset key
        try:
            source_s3_key = s3.resolve_system_asset_key("video")
        except Exception:
            pass

    config = StreamConfig(
        stream_id=stream_id,
        source_url=source_url or request.source_url,
        loop=request.loop,
        owner_user_id=current_user.id if current_user else None,
        pretranscoded=is_pretranscoded,
        source_s3_key=source_s3_key,
    )
    handle = await asyncio.get_running_loop().run_in_executor(
        None, _start_orchestrator_stream, orchestrator, config
    )
    if stream_id == FUSION_STREAM_ID:
        background_tasks.add_task(_configure_fusion_stream_ais, stream_id)

    return {
        "status": "started",
        **handle.to_dict(),
        "playback_urls": build_stream_playback_payload(stream_id, s3_key=source_s3_key),
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
async def stop_stream(
    stream_id: str,
    current_user: Annotated[AppUser, Depends(get_current_user)],
) -> Response:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()
    _require_stream_access(orchestrator, stream_id, current_user)

    try:
        orchestrator.stop_stream(stream_id)
    except StreamNotFoundError as exc:
        not_found(str(exc))
    finally:
        try:
            get_fusion_publisher().fusion_svc.clear(stream_id)
        except Exception:
            pass
    return Response(status_code=204)


@router.get("/api/streams")
async def list_streams(
    current_user: Annotated[AppUser | None, Depends(get_optional_user)],
) -> dict[str, Any]:
    orchestrator = _require_orchestrator()
    if current_user is None:
        all_streams = orchestrator.list_streams()
        streams = [
            augment_stream_payload(s)
            for s in all_streams
            if s.get("stream_id") in SYSTEM_STREAM_IDS
        ]
    elif current_user.is_admin:
        streams = [augment_stream_payload(s) for s in orchestrator.list_streams()]
    else:
        streams = [augment_stream_payload(s) for s in orchestrator.list_streams(current_user.id)]
    return {"streams": streams, "max_workers": app_settings.max_workers}


@router.get("/api/streams/{stream_id}/playback")
async def get_stream_playback(
    stream_id: str,
    current_user: Annotated[AppUser, Depends(get_current_user)],
) -> dict[str, Any]:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()

    try:
        handle = orchestrator.get_stream(stream_id)
    except StreamNotFoundError as exc:
        not_found(str(exc))

    _require_stream_access(orchestrator, stream_id, current_user)
    s3_key = handle.config.source_s3_key if handle else None
    return {"stream_id": stream_id, "playback_urls": build_stream_playback_payload(stream_id, s3_key=s3_key)}



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
