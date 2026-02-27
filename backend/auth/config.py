from __future__ import annotations

import logging
import os
from dataclasses import dataclass

from settings._env import get_bool

logger = logging.getLogger(__name__)

_JWT_SECRET_DEFAULT = "change-me-in-production"

_DEFAULT_CORS_ORIGINS = [
    "http://localhost:5173",
    "http://localhost:5273",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://127.0.0.1:5273",
    "http://127.0.0.1:3000",
]


def _parse_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ORIGINS", "")
    if raw.strip():
        return [o.strip() for o in raw.split(",") if o.strip()]
    return list(_DEFAULT_CORS_ORIGINS)


def _is_production_environment() -> bool:
    env_value = os.getenv("ENV", "").strip().lower()
    node_env_value = os.getenv("NODE_ENV", "").strip().lower()
    combined = env_value or node_env_value or "development"
    return combined not in {"development", "dev", "test"}


@dataclass(frozen=True)
class Settings:
    database_url: str = os.getenv(
        "DATABASE_URL",
        "postgresql+psycopg://openar:openar_dev@localhost:5532/openar",
    )
    jwt_secret_key: str = os.getenv("JWT_SECRET_KEY", _JWT_SECRET_DEFAULT)
    jwt_algorithm: str = os.getenv("JWT_ALGORITHM", "HS256")
    jwt_access_ttl_min: int = int(os.getenv("JWT_ACCESS_TTL_MIN", "15"))
    better_auth_base_url: str = os.getenv("BETTER_AUTH_BASE_URL", "http://localhost:3001")
    better_auth_base_path: str = os.getenv("BETTER_AUTH_BASE_PATH", "/api/auth")
    auth_request_timeout_sec: float = float(os.getenv("AUTH_REQUEST_TIMEOUT_SEC", "10"))
    cors_origins: tuple[str, ...] = tuple(_parse_cors_origins())
    allow_private_network_origins: bool = get_bool("CORS_ALLOW_PRIVATE_NETWORK_ORIGINS", default=False)


settings = Settings()

_is_production = _is_production_environment()
if settings.jwt_secret_key == _JWT_SECRET_DEFAULT:
    if _is_production:
        raise RuntimeError(
            "JWT_SECRET_KEY must be set to a strong random value in production. "
            "Generate one with: python -c \"import secrets; print(secrets.token_urlsafe(64))\""
        )
    logger.warning("Using default JWT secret — set JWT_SECRET_KEY before deploying")

if _is_production and settings.better_auth_base_url == "http://localhost:3001":
    raise RuntimeError(
        "BETTER_AUTH_BASE_URL must be set to your deployed public auth base URL in production "
        "(for example: https://ar.bridgable.ai)."
    )
