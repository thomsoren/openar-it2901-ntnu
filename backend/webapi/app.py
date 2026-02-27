"""FastAPI backend application wiring."""
from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.middleware import SlowAPIMiddleware

from webapi import state
from webapi.routes.ais import router as ais_router
from webapi.routes.detections import router as detections_router
from webapi.routes.media import router as media_router
from webapi.routes.streams import router as streams_router
from webapi.routes.system import router as system_router
from auth.config import settings as auth_settings
from auth.routes import limiter, router as auth_router
from common.config import create_async_redis_client
from db.init_db import init_db
from orchestrator import (
    ResourceLimitExceededError,
    StreamAlreadyRunningError,
    StreamConfig,
    WorkerOrchestrator,
)
from services.stream_service import resolve_default_source

logger = logging.getLogger(__name__)

app = FastAPI(
    title="OpenAR Backend API",
    description="API for boat detection and AIS vessel data",
    version="0.2.0",
)

private_network_origin_regex = (
    r"^https?://(10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(1[6-9]|2\d|3[0-1])\.\d+\.\d+)(:\d+)?$"
    if auth_settings.allow_private_network_origins
    else None
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=list(auth_settings.cors_origins),
    allow_origin_regex=private_network_origin_regex,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)

app.state.limiter = limiter
app.add_middleware(SlowAPIMiddleware)
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
app.include_router(auth_router)

app.include_router(system_router)
app.include_router(media_router)
app.include_router(ais_router)
app.include_router(streams_router)
app.include_router(detections_router)


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    app.state.redis_client = create_async_redis_client()

    protected_stream_ids = {state.DEFAULT_STREAM_ID} if state.PROTECT_DEFAULT_STREAM else set()
    state.orchestrator = WorkerOrchestrator(
        max_workers=state.MAX_WORKERS,
        idle_timeout_seconds=state.STREAM_IDLE_TIMEOUT_SECONDS,
        no_viewer_timeout_seconds=state.STREAM_NO_VIEWER_TIMEOUT_SECONDS,
        protected_stream_ids=protected_stream_ids,
    )
    state.orchestrator.start_monitoring()

    source_url = resolve_default_source()
    if source_url:
        try:
            state.orchestrator.start_stream(
                StreamConfig(stream_id=state.DEFAULT_STREAM_ID, source_url=source_url, loop=True)
            )
            logger.info("Default stream '%s' started from %s", state.DEFAULT_STREAM_ID, source_url)
        except (StreamAlreadyRunningError, ResourceLimitExceededError) as exc:
            logger.warning("Default stream '%s' could not start: %s", state.DEFAULT_STREAM_ID, exc)
    else:
        logger.warning("No default video source found; skipping default stream")

    yield

    await app.state.redis_client.aclose()
    if state.orchestrator:
        state.orchestrator.shutdown()
        state.orchestrator = None


app.router.lifespan_context = lifespan
