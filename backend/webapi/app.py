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
from webapi.routes.admin_media import router as admin_media_router
from webapi.routes.ais import router as ais_router
from webapi.routes.detections import router as detections_router
from webapi.routes.media import router as media_router
from webapi.routes.mediamtx_auth import router as mediamtx_auth_router
from webapi.routes.streams import router as streams_router
from webapi.routes.playback import router as playback_router
from webapi.routes.system import router as system_router
from settings import app_settings
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
from services.transcode_service import get_transcoded_key, retry_interrupted_transcodes
from storage import s3
from cv.idun.config import IDUN_ENABLED

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

app.include_router(admin_media_router)
app.include_router(system_router)
app.include_router(media_router)
app.include_router(mediamtx_auth_router)
app.include_router(ais_router)
app.include_router(streams_router)
app.include_router(playback_router)
app.include_router(detections_router)

if IDUN_ENABLED:
    from cv.idun.routes import router as idun_router
    app.include_router(idun_router)
    logger.info("IDUN remote inference enabled")


@asynccontextmanager
async def lifespan(_: FastAPI):
    init_db()
    app.state.redis_client = create_async_redis_client()

    protected_stream_ids = {app_settings.default_stream_id} if app_settings.protect_default_stream else set()

    # When IDUN is enabled, use a no-op inference thread (no local GPU needed)
    # and wire up the IDUN bridge for remote inference.
    inference_thread = None
    if IDUN_ENABLED:
        from cv.idun.bridge import IdunBridge
        from cv.idun.noop_inference import NoopInferenceThread
        from cv.idun.routes import init_bridge
        from cv.publisher import get_fusion_publisher

        noop = NoopInferenceThread()
        inference_thread = noop
        bridge = IdunBridge(noop, get_fusion_publisher())
        init_bridge(bridge)

    state.orchestrator = WorkerOrchestrator(
        max_workers=app_settings.max_workers,
        idle_timeout_seconds=app_settings.stream_idle_timeout_seconds,
        no_viewer_timeout_seconds=app_settings.stream_no_viewer_timeout_seconds,
        protected_stream_ids=protected_stream_ids,
        inference_thread=inference_thread,
    )
    state.orchestrator.start_monitoring()

    source_url = resolve_default_source() if not app_settings.skip_default_stream else None
    if app_settings.skip_default_stream:
        logger.info("SKIP_DEFAULT_STREAM=true; not auto-starting default stream")
    if source_url:
        s3_key = s3.coerce_s3_key(source_url)
        pretranscoded = bool(s3_key and get_transcoded_key(s3_key))
        try:
            state.orchestrator.start_stream(
                StreamConfig(
                    stream_id=app_settings.default_stream_id,
                    source_url=source_url,
                    loop=True,
                    pretranscoded=pretranscoded,
                    source_s3_key=s3_key,
                )
            )
            logger.info("Default stream '%s' started from %s", app_settings.default_stream_id, source_url)
        except (StreamAlreadyRunningError, ResourceLimitExceededError) as exc:
            logger.warning("Default stream '%s' could not start: %s", app_settings.default_stream_id, exc)
    else:
        logger.warning("No default video source found; skipping default stream")

    retry_interrupted_transcodes()

    yield

    await app.state.redis_client.aclose()
    if state.orchestrator:
        state.orchestrator.shutdown()
        state.orchestrator = None


app.router.lifespan_context = lifespan
