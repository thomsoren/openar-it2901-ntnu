"""Shared test fixtures for backend tests.

Uses an in-memory SQLite database so tests run without Postgres.
Provides streaming fixtures (fake decode threads, fake FFmpeg) so tests
run without GPU, FFmpeg binary, or MediaMTX.
"""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, event
from sqlalchemy.orm import Session, sessionmaker
from sqlalchemy.pool import StaticPool

from db.database import Base, get_db
from db.models import AppUser


# ---------- Database fixtures ----------

@pytest.fixture()
def db_engine():
    engine = create_engine(
        "sqlite://",
        echo=False,
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )

    # SQLite does not enforce foreign keys by default.
    @event.listens_for(engine, "connect")
    def _set_sqlite_pragma(dbapi_conn, _connection_record):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(bind=engine)
    yield engine
    Base.metadata.drop_all(bind=engine)
    engine.dispose()


@pytest.fixture()
def db_session(db_engine):
    TestSession = sessionmaker(bind=db_engine, autocommit=False, autoflush=False, class_=Session)
    session = TestSession()
    try:
        yield session
    finally:
        session.close()


# ---------- User fixtures ----------

@pytest.fixture()
def regular_user(db_session: Session) -> AppUser:
    user = AppUser(id="user-1", username="testuser", email="test@openar.local", is_admin=False)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


@pytest.fixture()
def admin_user(db_session: Session) -> AppUser:
    user = AppUser(id="admin-1", username="adminuser", email="admin@openar.local", is_admin=True)
    db_session.add(user)
    db_session.commit()
    db_session.refresh(user)
    return user


# ---------- FastAPI test client ----------

@pytest.fixture()
def client(db_session: Session):
    """TestClient that overrides get_db to use the in-memory SQLite session."""
    # Import here to avoid pulling in the full app module graph at collection time.
    from auth.routes import limiter, router
    from fastapi import FastAPI
    from slowapi import _rate_limit_exceeded_handler
    from slowapi.errors import RateLimitExceeded
    from slowapi.middleware import SlowAPIMiddleware

    app = FastAPI()
    app.state.limiter = limiter
    app.add_middleware(SlowAPIMiddleware)
    app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)
    app.include_router(router)

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass  # session lifetime managed by the db_session fixture

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as c:
        yield c


# ---------- Streaming test fixtures ----------

@pytest.fixture()
def fake_decode_thread(monkeypatch):
    """Patch DecodeThread so no real video source is opened."""
    from tests.fakes import FakeDecodeThread

    threads: list[FakeDecodeThread] = []

    def _fake_init(self, source_url: str, stream_id: str, loop: bool = True):
        fake = FakeDecodeThread()
        # Copy fake attributes onto the real instance
        self._alive = fake._alive
        self._fps = fake._fps
        self._width = fake._width
        self._height = fake._height
        self.source_url = source_url
        self.stream_id = stream_id
        self.loop = loop
        threads.append(self)

    def _fake_start(self) -> bool:
        return True

    def _fake_stop(self) -> None:
        self._alive = False

    def _fake_get_latest(self):
        import numpy as np
        return np.zeros((480, 640, 3), dtype=np.uint8), 0, 0.0

    def _fake_is_alive(self) -> bool:
        return self._alive

    monkeypatch.setattr("cv.decode_thread.DecodeThread.__init__", _fake_init)
    monkeypatch.setattr("cv.decode_thread.DecodeThread.start", _fake_start)
    monkeypatch.setattr("cv.decode_thread.DecodeThread.stop", _fake_stop)
    monkeypatch.setattr("cv.decode_thread.DecodeThread.get_latest", _fake_get_latest)
    monkeypatch.setattr(
        "cv.decode_thread.DecodeThread.is_alive",
        property(_fake_is_alive),
    )
    return threads


@pytest.fixture()
def fake_ffmpeg(monkeypatch):
    """Patch _start_ffmpeg so no real FFmpeg subprocess is spawned."""
    from tests.fakes import FakePopen

    popens: list[FakePopen] = []

    def _fake_start_ffmpeg(config):
        popen = FakePopen()
        popens.append(popen)
        return popen

    monkeypatch.setattr(
        "orchestrator.orchestrator.WorkerOrchestrator._start_ffmpeg",
        staticmethod(_fake_start_ffmpeg),
    )
    return popens


@pytest.fixture()
def fake_inference_thread(monkeypatch):
    """Inject a FakeInferenceThread so no real model is loaded."""
    from tests.fakes import FakeInferenceThread

    fake = FakeInferenceThread()
    monkeypatch.setattr(
        "orchestrator.orchestrator.get_shared_detector",
        lambda: None,  # Never called because inference_thread is injected
    )
    return fake


@pytest.fixture()
def orchestrator_factory(fake_decode_thread, fake_ffmpeg, fake_inference_thread):
    """Create a WorkerOrchestrator with all external deps mocked.

    Returns a factory function that accepts keyword overrides.
    Automatically shuts down all created orchestrators on teardown.
    """
    from orchestrator import WorkerOrchestrator

    created: list[WorkerOrchestrator] = []

    def _factory(**kwargs) -> WorkerOrchestrator:
        defaults = dict(
            max_workers=8,
            monitor_interval_seconds=0.02,
            inference_thread=fake_inference_thread,
        )
        defaults.update(kwargs)
        orch = WorkerOrchestrator(**defaults)
        created.append(orch)
        return orch

    yield _factory

    for orch in created:
        orch.shutdown()


@pytest.fixture()
def stream_app_client(fake_decode_thread, fake_ffmpeg, monkeypatch):
    """TestClient for the full api.app with decode thread + FFmpeg deps mocked."""
    from tests.fakes import FakeInferenceThread

    import api

    # Patch InferenceThread so the orchestrator created in api.py's lifespan
    # uses a no-op fake instead of a real one (which would need a real detector).
    monkeypatch.setattr(
        "orchestrator.orchestrator.InferenceThread",
        FakeInferenceThread,
    )
    monkeypatch.setattr(
        "orchestrator.orchestrator.get_shared_detector",
        lambda: None,
    )

    with TestClient(api.app) as c:
        yield c
