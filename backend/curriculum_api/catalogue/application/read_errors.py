"""Required catalogue data could not be read; an empty result is not a substitute."""


class CatalogueReadUnavailable(RuntimeError):
    """Carry a public, non-sensitive failure message to the HTTP boundary."""

    def __init__(self, message, *, code='curriculum_read_unavailable'):
        super().__init__(message)
        self.code = code
