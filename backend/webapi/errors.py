from __future__ import annotations

from typing import NoReturn

from fastapi import HTTPException


def bad_request(detail: str) -> NoReturn:
    raise HTTPException(status_code=400, detail=detail)


def forbidden(detail: str) -> NoReturn:
    raise HTTPException(status_code=403, detail=detail)


def not_found(detail: str) -> NoReturn:
    raise HTTPException(status_code=404, detail=detail)


def conflict(detail: str, *, cause: Exception | None = None) -> NoReturn:
    if cause is None:
        raise HTTPException(status_code=409, detail=detail)
    raise HTTPException(status_code=409, detail=detail) from cause


def bad_gateway(detail: str) -> NoReturn:
    raise HTTPException(status_code=502, detail=detail)


def service_unavailable(detail: str) -> NoReturn:
    raise HTTPException(status_code=503, detail=detail)


def internal_error(detail: str) -> NoReturn:
    raise HTTPException(status_code=500, detail=detail)


def wrap_internal(prefix: str, exc: Exception) -> NoReturn:
    internal_error(f"{prefix}: {exc}")
