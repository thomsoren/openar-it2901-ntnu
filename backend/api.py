"""Compatibility entrypoint — delegates to webapi package."""
from __future__ import annotations

from webapi.app import app  # noqa: F401

import webapi as _webapi


def __getattr__(name: str):
    return getattr(_webapi, name)


__all__ = _webapi.__all__
