"""Shared test fixtures for backend auth tests.

Uses an in-memory SQLite database so tests run without Postgres.
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
    from auth.routes import router
    from fastapi import FastAPI

    app = FastAPI()
    app.include_router(router)

    def _override_get_db():
        try:
            yield db_session
        finally:
            pass  # session lifetime managed by the db_session fixture

    app.dependency_overrides[get_db] = _override_get_db

    with TestClient(app) as c:
        yield c
