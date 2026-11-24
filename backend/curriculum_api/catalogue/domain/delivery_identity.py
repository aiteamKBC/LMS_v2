"""Pure delivery identity and cohort/group learner-count selection rules."""

from curriculum_api.catalogue.domain.values import clean_str as _default_clean_str
from curriculum_api.catalogue.domain.values import slugify as _default_slugify


def actual_cohort_identity(row, programme_name, *, clean_str=_default_clean_str, slugify=_default_slugify):
    meta = row.get('_meta', {})
    cohort_name = clean_str(row.get('Cohort_name'))
    if not cohort_name:
        return None
    return {
        'id': clean_str(meta.get('cohort_id')) or f'{slugify(programme_name)}-{slugify(cohort_name)}',
        'name': cohort_name,
    }


def actual_group_identity(row, cohort_id, *, clean_str=_default_clean_str, slugify=_default_slugify):
    meta = row.get('_meta', {})
    group_name = clean_str(row.get('group_name') or meta.get('group_name'))
    if not group_name:
        return None
    return {
        'id': clean_str(meta.get('group_id')) or f'{cohort_id}-{slugify(group_name)}',
        'name': group_name,
    }


def delivery_learner_count(counts, record_id, name_key, *, clean_str=_default_clean_str):
    """Learners placed in one cohort/group, however their placement is recorded.

    The id bucket and the name bucket are *added*, not preferred one over the
    other: a cohort can hold both learners whose placement resolved to its id
    and older rows that only ever carried its name, and both are in it. No
    learner is counted twice -- ``active_learner_delivery_counts`` puts each row
    in exactly one of the two. Same shape as the programme card's count.
    """
    record_id = clean_str(record_id)
    by_id = counts.get(record_id, 0) if record_id else 0
    return by_id + counts.get(name_key, 0)


def detail_is_archived(detail, *, clean_str=_default_clean_str):
    return clean_str((detail or {}).get('status')).lower() == 'archived'
