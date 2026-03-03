from __future__ import annotations

import asyncio
import logging
import os
import shutil
import uuid
from pathlib import Path, PurePath
from typing import Any
from urllib.parse import urlparse
from urllib.request import urlopen

from fastapi import APIRouter, Response, UploadFile
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
    orchestrator = _require_orchestrator()

    if not file.filename:
        bad_request("No file provided")

    upload_dir = BASE_DIR / "data" / "uploads"
    upload_dir.mkdir(parents=True, exist_ok=True)
    safe_name = uuid.uuid4().hex + PurePath(file.filename).suffix
    local_path = upload_dir / safe_name

    try:
        with open(local_path, "wb") as f:
            shutil.copyfileobj(file.file, f)
    except Exception as exc:
        wrap_internal("Failed to save file", exc)

    config = StreamConfig(stream_id=stream_id, source_url=str(local_path), loop=loop)
    handle = _start_orchestrator_stream(orchestrator, config)
    if stream_id == FUSION_STREAM_ID:
        try:
            await asyncio.get_event_loop().run_in_executor(None, _configure_fusion_stream_ais, stream_id)
        except Exception as exc:
            logger.warning("[fusion:%s] Failed to configure AIS enrichment after upload: %s", stream_id, exc)

    return {"status": "started", **handle.to_dict()}


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
async def heartbeat_stream(stream_id: str) -> Response:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()
    orchestrator.touch_stream(stream_id)
    return Response(status_code=204)
