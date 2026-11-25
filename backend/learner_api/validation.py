"""Shared user-facing validation failure without feature dependencies."""


class ValidationError(Exception):
    """Raised with a user-facing message when a payload fails validation."""
