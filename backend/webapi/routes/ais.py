from __future__ import annotations

import json
from collections.abc import AsyncIterator

from fastapi import APIRouter
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from webapi.errors import wrap_internal
from ais import service as ais_service
from ais.fetch_ais import (
    fetch_ais_stream_geojson,
    fetch_ais_stream_projections,
    fetch_ais_stream_projections_by_mmsi,
)
from ais.logger import AISSessionLogger

router = APIRouter()

# API boundary note: route/SSE handlers intentionally catch broad exceptions
# to emit controlled error payloads instead of tearing down request handling.


class AISStreamRequest(BaseModel):
    coordinates: list[list[float]]
    log: bool = False


_SSE_HEADERS = {
    "Cache-Control": "no-cache",
    "X-Accel-Buffering": "no",
}


def _format_sse(payload: object) -> str:
    return f"data: {json.dumps(payload)}\n\n"


async def _sse_generator(source: AsyncIterator) -> AsyncIterator[str]:
    try:
        async for feature in source:
            yield _format_sse(feature)
    except Exception as exc:
        yield _format_sse({"error": f"{type(exc).__name__}: {exc}"})


def _sse_response(source: AsyncIterator) -> StreamingResponse:
    return StreamingResponse(_sse_generator(source), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/api/ais")
async def get_ais_data():
    try:
        return ais_service.get_ais_data()
    except Exception as exc:
        wrap_internal("Error fetching AIS data", exc)


@router.post("/api/ais/stream")
async def stream_ais_geojson(body: AISStreamRequest):
    session_logger = AISSessionLogger() if body.log else None

    async def event_generator():
        try:
            async for feature in fetch_ais_stream_geojson(coordinates=body.coordinates):
                if session_logger:
                    session_logger.log(feature)
                yield _format_sse(feature)
        except Exception as exc:
            yield _format_sse({"error": f"{type(exc).__name__}: {exc}"})
        finally:
            if session_logger:
                metadata = session_logger.end_session()
                if not metadata.get("flush_success", False):
                    warning = {
                        "type": "error",
                        "message": "AIS logging failed",
                        "detail": metadata.get("flush_error"),
                        "total_logged": metadata.get("total_records", 0),
                        "records_written": metadata.get("total_file_size_bytes", 0),
                    }
                    yield _format_sse(warning)
                elif metadata.get("total_splits", 1) > 1:
                    info = {
                        "type": "info",
                        "message": "AIS logging completed with multiple files",
                        "detail": f"Session was split into {metadata.get('total_splits')} files due to buffer size",
                        "total_logged": metadata.get("total_records", 0),
                        "total_file_size_bytes": metadata.get("total_file_size_bytes", 0),
                        "log_files": metadata.get("log_files", []),
                    }
                    yield _format_sse(info)

    return StreamingResponse(event_generator(), media_type="text/event-stream", headers=_SSE_HEADERS)


@router.get("/api/ais/projections")
async def stream_ais_projections(
    ship_lat: float = 63.4365,
    ship_lon: float = 10.3835,
    heading: float = 90,
    offset_meters: float = 3000,
    fov_degrees: float = 120,
) -> StreamingResponse:
    return _sse_response(fetch_ais_stream_projections(
        ship_lat=ship_lat,
        ship_lon=ship_lon,
        heading=heading,
        offset_meters=offset_meters,
        fov_degrees=fov_degrees,
    ))


@router.get("/api/ais/projections/mmsi")
async def stream_ais_projections_by_mmsi(
    mmsi: str,
    offset_meters: float = 3000,
    fov_degrees: float = 120,
) -> StreamingResponse:
    return _sse_response(fetch_ais_stream_projections_by_mmsi(
        mmsi=mmsi,
        offset_meters=offset_meters,
        fov_degrees=fov_degrees,
    ))
