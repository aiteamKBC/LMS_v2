"""Pure interpretation and ordered validation rules for placement IDs."""

from .placement import FIELDS


class PlacementInputError(ValueError):
    """A preserved user-facing placement input failure."""


def placement_input(payload):
    """Interpret established camel/snake ID inputs without consulting storage."""
    result = {}
    for kind in ("programme", "cohort", "group"):
        key, column = kind + "Id", kind + "_id"
        if key in payload and column in payload and payload[key] != payload[column]:
            raise PlacementInputError(f"Conflicting {key} values.")
        if key in payload or column in payload:
            value = payload[key] if key in payload else payload[column]
            if value is not None and not isinstance(value, str):
                raise PlacementInputError(f"{key} must be a string ID or null.")
            result[column] = value.strip() or None if value is not None else None
        elif kind in payload and payload[kind]:  # noqa: RUF019 - preserve lookup semantics
            raise PlacementInputError(
                f"Use {key} to change placement; names are display-only."
            )
    return result


def requested_placement(fields):
    return {key: value for key, value in fields.items() if key in FIELDS}


def effective_placement(requested, current=None):
    values = {
        key: getattr(current, key, None) if current is not None else None
        for key in FIELDS
    }
    values.update(requested)
    return tuple(values[key] for key in FIELDS)
