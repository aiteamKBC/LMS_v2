"""Existing saved-plan value interpretation, independent of application runtime.

None means unsaved; an empty list remains an explicitly cleared plan.
Legacy mapper exports share these exact implementations.
"""


def _s(value):
    """Coerce to a trimmed string ('' for None)."""
    return "" if value is None else str(value).strip()


def _maybe_json(value):
    """A TEXT column that might hold JSON. Returns parsed value or None."""
    if value is None:
        return None
    if isinstance(value, (list, dict)):
        return value
    if isinstance(value, str):
        import json

        try:
            return json.loads(value)
        except (ValueError, TypeError):
            return None
    return None

def stored_training_plan(source):
    """None means unsaved; an empty array is an explicitly cleared assignment."""
    for field in ("training_plan", "learning_plan"):
        plan = _maybe_json(getattr(source, field, None))
        if isinstance(plan, list):
            return [entry for entry in plan if isinstance(entry, dict)]
    return None


# Supported names for callers outside the domain package. The original names
# remain intact for frozen source parity and compatibility imports.
clean_text = _s
maybe_json = _maybe_json
