"""Canonical Cohort/Group row reads through the existing authoring reader."""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str


def fetch_cohort_row(
    cohort_id,
    *,
    clean_str=_default_clean_str,
    authoring_fetch_all,
    COHORT_AUTHORING_DETAILS_TABLE,
):
    """Return the raw normalized ``curriculum.cohorts`` row for a canonical id."""
    ident = clean_str(cohort_id)
    if not ident:
        return None
    rows = authoring_fetch_all(COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [ident])
    return rows[0] if rows else None


def fetch_group_row(group_id, *, clean_str=_default_clean_str, authoring_fetch_all, GROUPS_TABLE):
    """Return the raw normalized ``curriculum.groups`` row for a canonical id."""
    ident = clean_str(group_id)
    if not ident:
        return None
    rows = authoring_fetch_all(GROUPS_TABLE, 'group_id = %s', [ident])
    return rows[0] if rows else None
