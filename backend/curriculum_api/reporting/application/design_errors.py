"""Concrete reporting / application / design errors capabilities extracted from the curriculum entry point.

Existing algorithms and call contracts are preserved; dependencies have explicit owners.
No import of the legacy views module.
"""



class _ProgrammeKsbDesignUnavailable(Exception):
    """A design read failed: answered with the old fallback, never cached."""

    def __init__(self, message, exc):
        super().__init__(message)
        self.message = message
        self.exc = exc
