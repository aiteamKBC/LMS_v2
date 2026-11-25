"""Pure interpretation of the identifiers already carried by learner records."""

VALID_LEARNER_KINDS = frozenset({"commercial", "apprenticeship"})


def source_primary_key(source, explicit=None):
    """Preserve the legacy source-PK precedence without guessing another ID."""
    if explicit is not None:
        return explicit
    return getattr(source, "pk", None) or getattr(source, "id", None)


def source_email(source):
    """The legacy fallback's normalized input; never a canonical identifier."""
    return str(getattr(source, "email", "") or "").strip()
