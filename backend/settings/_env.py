from __future__ import annotations

import os


TRUTHY = {"1", "true", "yes", "on"}


def get_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in TRUTHY


def get_int(name: str, default: int, minimum: int | None = None) -> int:
    raw = os.getenv(name)
    if raw is None:
        value = default
    else:
        try:
            value = int(raw)
        except ValueError:
            raise ValueError(
                f"Environment variable {name}={raw!r} is not a valid integer"
            ) from None
    if minimum is not None:
        return max(minimum, value)
    return value


def get_float(name: str, default: float, minimum: float | None = None) -> float:
    raw = os.getenv(name)
    if raw is None:
        value = default
    else:
        try:
            value = float(raw)
        except ValueError:
            raise ValueError(
                f"Environment variable {name}={raw!r} is not a valid float"
            ) from None
    if minimum is not None:
        return max(minimum, value)
    return value


def get_str(name: str, default: str) -> str:
    raw = os.getenv(name)
    if raw is None:
        return default
    return raw.strip()
