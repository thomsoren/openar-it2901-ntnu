"""Shared test fixtures for backend tests.

Uses an in-memory SQLite database so tests run without Postgres.
Provides streaming fixtures (fake workers, fake FFmpeg) so tests
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
def fake_worker_start(monkeypatch):
    """Patch worker.start to return FakeProcess + Queue without spawning."""
    from multiprocessing import Queue
    from tests.fakes import FakeProcess

    processes: list[FakeProcess] = []

    def _fake_start(source_url: str, stream_id: str, loop: bool = True):
        proc = FakeProcess()
        processes.append(proc)
        return proc, Queue(maxsize=10)

    monkeypatch.setattr("orchestrator.orchestrator.worker.start", _fake_start)
    return processes


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
def orchestrator_factory(fake_worker_start, fake_ffmpeg):
    """Create a WorkerOrchestrator with all external deps mocked.

    Returns a factory function that accepts keyword overrides.
    Automatically shuts down all created orchestrators on teardown.
    """
    from orchestrator import WorkerOrchestrator

    created: list[WorkerOrchestrator] = []

    def _factory(**kwargs) -> WorkerOrchestrator:
        defaults = dict(max_workers=8, monitor_interval_seconds=0.02)
        defaults.update(kwargs)
        orch = WorkerOrchestrator(**defaults)
        created.append(orch)
        return orch

    yield _factory

    for orch in created:
        orch.shutdown()


@pytest.fixture()
def stream_app_client(fake_worker_start, fake_ffmpeg):
    """TestClient for the full api.app with worker + FFmpeg deps mocked."""
    import api

    with TestClient(api.app) as c:
        yield c
