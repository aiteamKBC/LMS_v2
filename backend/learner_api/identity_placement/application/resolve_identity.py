"""Identity resolution orchestration over explicit read capabilities."""

from ..domain.identifiers import source_email, source_primary_key
from ..domain.resolution import (
    has_ambiguous_email_matches,
    should_repair_enrolment_link,
)


def resolve_profile_for_source(
    source,
    source_pk=None,
    *,
    active_only=False,
    heal=True,
    fields=None,
    read_exact,
    read_unlinked_email,
    duplicate_enrolment_ids,
    repair_link,
    read_unlinked_profile_id,
    warn_ambiguous_email,
):
    """Preserve the legacy resolver while making every persistence edge explicit."""
    source_pk = source_primary_key(source, source_pk)

    if source_pk is not None:
        profile = read_exact(source_pk, active_only=active_only, fields=fields)
        if profile is not None:
            return profile

    email = source_email(source)
    if email:
        profile = read_unlinked_email(email, active_only=active_only, fields=fields)
        if profile is not None:
            twins = duplicate_enrolment_ids(email, source_pk)
            if has_ambiguous_email_matches(twins):
                warn_ambiguous_email(email, source_pk, twins)
                return None
            if should_repair_enrolment_link(profile, source_pk, heal=heal):
                try:
                    repair_link(profile, source_pk)
                except Exception:  # noqa: BLE001, S110 - preserve opportunistic legacy repair
                    pass
        return profile

    if source_pk is None:
        return None
    return read_unlinked_profile_id(source_pk, active_only=active_only, fields=fields)


def resolve_canonical_learner(kind, enrolment_id, *, valid_kinds, missing_error, read_exact_kind):
    """Resolve the exact typed bridge used by Free Course and plan consumers."""
    if kind not in valid_kinds:
        raise missing_error
    return read_exact_kind(kind, enrolment_id)
