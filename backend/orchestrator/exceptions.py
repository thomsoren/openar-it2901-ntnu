"""Custom exceptions for worker orchestration."""


class OrchestratorError(Exception):
    """Base orchestrator exception."""


class ResourceLimitExceededError(OrchestratorError):
    """Raised when max concurrent workers is reached."""


class StreamAlreadyRunningError(OrchestratorError):
    """Raised when attempting to start an already running stream."""


class StreamNotFoundError(OrchestratorError):
    """Raised when a stream does not exist in the registry."""
