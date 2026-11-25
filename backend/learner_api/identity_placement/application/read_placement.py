"""Canonical placement orchestration over exact enrolment-bridge readers."""

from ..domain.placement import CACHE, ids_from_profile, payload_from_ids


def placement_profile(source, *, is_enrolment_source, read_profile):
    """Follow the explicit bridge once per source instance."""
    if not is_enrolment_source(source):
        return source
    if CACHE not in source.__dict__:
        profile = None
        if source.pk is not None:
            profile = read_profile(source.pk, using=source._state.db or "default")
        source.__dict__[CACHE] = profile
    return source.__dict__[CACHE]


def with_placements(sources, *, read_profiles, ambiguous_error):
    """Batch exact bridges by database alias while preserving source order."""
    sources = list(sources)
    by_alias = {}
    for source in sources:
        by_alias.setdefault(source._state.db or "default", []).append(source)
    for alias, records in by_alias.items():
        linked = {}
        for profile in read_profiles([record.pk for record in records], using=alias):
            if profile.enrolment_id in linked:
                raise ambiguous_error("Ambiguous learner enrolment link.")
            linked[profile.enrolment_id] = profile
        for record in records:
            record.__dict__[CACHE] = linked.get(record.pk)
            record.__dict__.pop("_placement_names", None)
    return sources


def placement_ids(source, *, read_placement_profile):
    return ids_from_profile(read_placement_profile(source))


def placement_payload(source, *, read_placement_ids):
    return payload_from_ids(read_placement_ids(source))
