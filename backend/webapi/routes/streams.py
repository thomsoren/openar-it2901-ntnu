from __future__ import annotations

import shutil
import uuid
from pathlib import PurePath
from typing import Any

from fastapi import APIRouter, Response, UploadFile
from pydantic import BaseModel

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

router = APIRouter()

# API boundary note: handlers intentionally catch broad exceptions and map
# them to HTTP errors so failures are returned consistently.


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


@router.post("/api/streams/{stream_id}/start", status_code=201)
async def start_stream(stream_id: str, request: StreamStartRequest) -> dict[str, Any]:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()

    try:
        source_url = resolve_stream_source(request.source_url)
    except RuntimeError as exc:
        bad_gateway(str(exc))
    if not source_url:
        bad_request("source_url is required for this stream")

    config = StreamConfig(stream_id=stream_id, source_url=source_url, loop=request.loop)
    handle = _start_orchestrator_stream(orchestrator, config)

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

    return {"status": "started", **handle.to_dict()}


@router.delete("/api/streams/{stream_id}", status_code=204, response_class=Response)
async def stop_stream(stream_id: str) -> Response:
    _validate_stream_id(stream_id)
    orchestrator = _require_orchestrator()

    try:
        orchestrator.stop_stream(stream_id)
    except StreamNotFoundError as exc:
        not_found(str(exc))
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
