from __future__ import annotations

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://openar:openar_dev@localhost:5433/openar",
    )
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", "change-me-in-production")
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_access_ttl_min: int = int(os.getenv("JWT_ACCESS_TTL_MIN", "15"))
    better_auth_base_url: str = os.getenv("BETTER_AUTH_BASE_URL", "http://localhost:3001")
    better_auth_base_path: str = os.getenv("BETTER_AUTH_BASE_PATH", "/api/auth")
    auth_request_timeout_sec: float = float(os.getenv("AUTH_REQUEST_TIMEOUT_SEC", "10"))


settings = Settings()
