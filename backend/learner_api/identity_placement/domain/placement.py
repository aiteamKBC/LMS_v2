"""Pure canonical placement projections."""

FIELDS = ("programme_id", "cohort_id", "group_id")
RELATIONS = ("programme_record", "cohort_record", "group_record")
CACHE = "_educational_placement"


def ids_from_profile(profile):
    """Return the established scalar-ID shape for one canonical profile."""
    return {field: (getattr(profile, field, None) or "") for field in FIELDS}


def payload_from_ids(ids):
    """Project canonical snake-case IDs onto the existing API payload keys."""
    return {kind + "Id": ids[kind + "_id"] for kind in ("programme", "cohort", "group")}
