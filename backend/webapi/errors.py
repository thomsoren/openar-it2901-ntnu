from __future__ import annotations

from fastapi import HTTPException


def bad_request(detail: str) -> HTTPException:
    return HTTPException(status_code=400, detail=detail)


def not_found(detail: str) -> HTTPException:
    return HTTPException(status_code=404, detail=detail)


def conflict(detail: str) -> HTTPException:
    return HTTPException(status_code=409, detail=detail)


def bad_gateway(detail: str) -> HTTPException:
    return HTTPException(status_code=502, detail=detail)


def service_unavailable(detail: str) -> HTTPException:
    return HTTPException(status_code=503, detail=detail)


def internal_error(detail: str) -> HTTPException:
    return HTTPException(status_code=500, detail=detail)


def wrap_internal(prefix: str, exc: Exception) -> HTTPException:
    return internal_error(f"{prefix}: {exc}")
