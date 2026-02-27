"""API package exports."""
from __future__ import annotations

from webapi.app import app


def __getattr__(name: str):
    if name == "orchestrator":
        from webapi.state import orchestrator

        return orchestrator
    raise AttributeError(name)


__all__ = ["app", "orchestrator"]
