"""Existing normalized-schema column and lifecycle read contracts."""
from datetime import datetime, timezone


LIFECYCLE_TABLES = frozenset({
    'programmes', 'cohorts', 'groups', 'modules', 'weeks', 'components',
    'ksb_mappings', 'coaches', 'tutors',
})


# Any of these present means the table still carries the legacy stamps.
LEGACY_LIFECYCLE_COLUMNS = ('deleted_at', 'is_programme_deleted', 'is_archived')


INACTIVE = 'inactive'


ACTIVE = 'active'


# Both spellings represent withdrawal; preserve historical stored values.
INACTIVE_STATUSES = ('inactive', 'archived')


_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)


# Free-course weeks own canonical fields, outside these compatibility projections.
DERIVED_COLUMNS = {
    # SQL filters and ordering need these labels before Python row projection.
    # They remain FK reads, never copied storage.
    'cohorts': ('programme_name',),
    'groups': ('programme_name', 'cohort_name'),
    'modules': ('programme_name', 'cohort_name', 'group_name'),
    # Staff names (tutor_name ...), child lists (module_ids,
    # group_ids, assigned_*_ids ...) and a cohort's holiday choices are not
    # here: curriculum_names puts them on the rows natively, by key
    # (curriculum_names.ROW_FIELDS, calendar_holidays.attach_cohort_choices).
    'ksb_mappings': ('module_catalogue_id', 'week_id', 'ksb_code', 'ksb_description'),
    'components': ('ksb_mappings', 'library_state', 'detached_at', 'origin_module_catalogue_id',
                   'origin_week_id', 'origin_module_title', 'origin_week_label'),
    'weeks': ('library_state', 'detached_at', 'origin_module_catalogue_id', 'origin_week_id',
              'origin_module_title', 'origin_week_label'),
}


RELATION_TABLES = LIFECYCLE_TABLES


def uses_status_lifecycle(table, columns):
    """True when ``table`` records withdrawal in ``status`` only."""
    columns = set(columns or ())
    return (
        table in LIFECYCLE_TABLES
        and 'status' in columns
        and not any(column in columns for column in LEGACY_LIFECYCLE_COLUMNS)
    )


def is_normalised(table, columns):
    """True when ``table`` is the normalised shape (any derived column absent).

    An empty column set means the shape is unknown (table missing, or not
    PostgreSQL): that is never treated as normalised.
    """
    columns = set(columns or ())
    if not columns:
        return False
    derived = DERIVED_COLUMNS.get(table, ())
    return uses_status_lifecycle(table, columns) or any(column not in columns for column in derived)


def inactive_condition(prefix=''):
    prefix = f'{prefix}.' if prefix and not prefix.endswith('.') else prefix
    return f"lower(coalesce({prefix}\"status\", '')) in ('inactive', 'archived')"


def active_condition(prefix=''):
    prefix = f'{prefix}.' if prefix and not prefix.endswith('.') else prefix
    return f"lower(coalesce({prefix}\"status\", '')) not in ('inactive', 'archived')"


def status_is_inactive(value):
    return str(value or '').strip().lower() in INACTIVE_STATUSES


# Exactly each table's historical fields; adding another can make joins ambiguous.
LEGACY_LIFECYCLE_BY_TABLE = {
    'programmes': ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_archived', 'is_active'),
    'cohorts': ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'),
    'groups': ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'),
    'modules': ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'),
    'weeks': ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'),
    'components': ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'),
    'ksb_mappings': ('deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted'),
    'coaches': ('is_archived',),
    'tutors': ('is_archived',),
}


def _lifecycle_select(table, columns, alias='t'):
    if not uses_status_lifecycle(table, columns):
        return []
    inactive = inactive_condition(alias)
    expressions = {
        'is_programme_deleted': f'({inactive}) as "is_programme_deleted"',
        'deleted_at': f'case when {inactive} then coalesce({alias}."updated_at", now()) end as "deleted_at"',
        'deleted_by': 'null::varchar as "deleted_by"',
        'deleted_via_parent': 'null::varchar as "deleted_via_parent"',
        'is_archived': f'({inactive}) as "is_archived"',
        'is_active': f'(not ({inactive})) as "is_active"',
    }
    return [expressions[name] for name in LEGACY_LIFECYCLE_BY_TABLE.get(table, ())]


_LINKED_FREE_WEEK_FIELDS = {
    'week_title': "coalesce(fw.title, '')::text",
    'week_number': 'coalesce(fw.week_number, 1)',
    'description': 'fw.summary',
    'course_name': "coalesce(fc.course_name, '')::text",
    'cover_image_url': 'fc.cover_image_url',
}


def _linked_free_week_shape(table, columns):
    return (table == 'free_course_weeks' and {'id', 'course_id', 'week_id'} <= set(columns)
            and 'title' not in columns and 'legacy_copied_from_week_id' not in columns)


PYTHON_DERIVED_COLUMNS = {'ksb_mappings': ('ksb_description',)}


def _lifecycle_fields(table, row):
    inactive = status_is_inactive(row.get('status'))
    fields = {
        'is_programme_deleted': inactive,
        'deleted_at': (row.get('updated_at') or row.get('created_at') or _EPOCH) if inactive else None,
        'deleted_by': None,
        'deleted_via_parent': None,
        'is_archived': inactive,
        'is_active': not inactive,
    }
    wanted = LEGACY_LIFECYCLE_BY_TABLE.get(table, ())
    return {key: value for key, value in fields.items() if key in wanted}


def _wanted(key, columns, requested, excluded):
    """Project ``key`` only when the table lacks it and the caller would have got it."""
    if key in columns:
        return False
    if requested is not None and key not in requested:
        return False
    return key not in (excluded or ())
