"""Curriculum's reads of the learner models on the normalised schema.

``learner_api.models.EnrolmentUser`` (``enrolment."Created_users"``) and
``LearnerProfile`` (``"Learner".learners``) still map columns the normalised
database (NEW_ENDPOINT_URL) dropped or renamed:

* placement *names* (``Programme``/``Cohort``/``Group``; ``programme``/
  ``cohort``/``group_name``) -- only ``programme_id``/``cohort_id``/``group_id``
  remain, so the name is read from the curriculum by id;
* date columns renamed to lower case (``Start_date`` -> ``start_date`` ...);
* ``coach_rag``, which has no replacement (read as '').

Agreed scope (2026-11-07): learner_api itself is not changed. Curriculum's own
read paths defer the missing fields and fill them here, from one query by id.
On the legacy schema nothing is missing and every helper is a pass-through.
Writes through these models are not covered.
"""
from __future__ import annotations

from django.db import connections

from . import curriculum_names, schema_compat

# Old column -> new column holding the same value.
RENAMED = {
    'Learner_start_date': 'learner_start_date', 'Learner_end_date': 'learner_end_date',
    'Learner_Start_date': 'learner_start_date', 'Start_date': 'start_date', 'End_date': 'end_date',
}
# Old name column -> (id column, curriculum lookup, name key).
NAME_FROM_ID = {
    'Programme': ('programme_id', 'programmes', 'name'), 'programme': ('programme_id', 'programmes', 'name'),
    'Cohort': ('cohort_id', 'cohorts', 'name'), 'cohort': ('cohort_id', 'cohorts', 'name'),
    'Group': ('group_id', 'groups', 'name'), 'group_name': ('group_id', 'groups', 'name'),
}


def _table(model):
    schema, table = [part.strip('"') for part in model._meta.db_table.split('"."')]
    return schema, table


def missing_fields(model):
    """Concrete fields of ``model`` whose column the database lacks ([] if unknown)."""
    try:
        schema, table = _table(model)
        columns = schema_compat.columns_of(schema, table)
        if not columns:
            return []
        return [field for field in model._meta.concrete_fields if field.column not in columns]
    except Exception:
        return []  # not a real schema-qualified model (e.g. a test double): nothing to adapt


def only(queryset, *names):
    """``queryset.only(*names)`` without the fields the database lacks."""
    gone = {field.name for field in missing_fields(queryset.model)}
    return queryset.only(*[name for name in names if name not in gone])


def defer_missing(queryset):
    """``queryset`` with the missing fields deferred (never selected)."""
    gone = [field.name for field in missing_fields(queryset.model)]
    return queryset.defer(*gone) if gone else queryset


def fill(objects, model=None):
    """Set the missing fields on loaded instances from what replaced them.

    Assigns into the instance ``__dict__``, so a deferred field never triggers
    the query that would fail on the missing column. Returns ``objects``.
    """
    objects = list(objects)
    if not objects:
        return objects
    model = model or type(objects[0])
    gone = missing_fields(model)
    if not gone:
        return objects
    schema, table = _table(model)
    columns = schema_compat.columns_of(schema, table)
    pk = model._meta.pk.column
    wanted_columns = sorted({
        source for field in gone
        for source in ([RENAMED[field.column]] if field.column in RENAMED else
                       [NAME_FROM_ID[field.column][0]] if field.column in NAME_FROM_ID else [])
        if source in columns
    })
    raw = {}
    if wanted_columns:
        select = ', '.join(f'"{column}"' for column in wanted_columns)
        alias = objects[0]._state.db or 'default'
        with connections[alias].cursor() as cursor:
            cursor.execute(
                f'select "{pk}", {select} from "{schema}"."{table}" where "{pk}" = any(%s)',
                [[obj.pk for obj in objects]],
            )
            raw = {row[0]: dict(zip(wanted_columns, row[1:])) for row in cursor.fetchall()}
    lookups = curriculum_names.lookups() if any(field.column in NAME_FROM_ID for field in gone) else {}
    for obj in objects:
        values = raw.get(obj.pk, {})
        for field in gone:
            if field.column in RENAMED:
                value = values.get(RENAMED[field.column])
            elif field.column in NAME_FROM_ID:
                id_column, kind, key = NAME_FROM_ID[field.column]
                value = (lookups.get(kind, {}).get(str(values.get(id_column) or '')) or {}).get(key, '')
            else:
                value = '' if not field.null else None
            obj.__dict__[field.attname] = value
    return objects


# --- attendance roster ----------------------------------------------------------
# learner_api.attendance_assignments.roster_sources() selects "Programme" and
# "Group" from enrolment."Created_users"; the normalised table keeps only
# programme_id/group_id, so Curriculum's session results and attendance
# corrections failed there (503). learner_api is owned by the Learner team and
# is not changed: on a database that still has the name columns the original
# function runs untouched; otherwise Curriculum reads the same membership keys
# by id, names resolved from the curriculum, and applies the same plan rules.

_ENROLMENT_COLUMNS = {}


def _enrolment_columns(alias):
    if alias not in _ENROLMENT_COLUMNS:
        if connections[alias].vendor != 'postgresql':
            return set()
        from .learner_assignment_counts_sql import _learner_columns
        columns = _learner_columns(alias)
        if not columns:
            return columns
        _ENROLMENT_COLUMNS[alias] = columns
    return _ENROLMENT_COLUMNS[alias]


def enrolment_placement_by_id(alias='enrolment'):
    """True when ``Created_users`` holds placement ids instead of names."""
    columns = _enrolment_columns(alias)
    return bool(columns) and 'Programme' not in columns and 'group_id' in columns


def roster_sources(alias='enrolment'):
    """``attendance_assignments.roster_sources`` for the normalised table."""
    from types import SimpleNamespace
    projections = []
    for column in ('Training_plan', 'Learning_plan'):
        projections.append(f'''CASE WHEN jsonb_typeof("{column}"::jsonb)='array'
            THEN (SELECT coalesce(jsonb_agg(jsonb_build_object(
                'moduleId',entry->'moduleId','assignmentMode',entry->'assignmentMode')), '[]'::jsonb)
                FROM jsonb_array_elements("{column}"::jsonb) entry
                WHERE jsonb_typeof(entry)='object')
            ELSE "{column}"::jsonb END''')
    with connections[alias].cursor() as cursor:
        cursor.execute(
            '''SELECT id,"Username","Email",coalesce(programme_id::text,''),coalesce(cohort_id::text,''),'''
            '''coalesce(group_id::text,''),''' + ','.join(projections) + ' FROM enrolment."Created_users"'
        )
        rows = cursor.fetchall()
    lookups = curriculum_names.lookups()
    sources = []
    for pk, username, email, programme_id, cohort_id, group_id, training_plan, learning_plan in rows:
        sources.append(SimpleNamespace(
            pk=pk, username=username, email=email,
            programme=(lookups['programmes'].get(programme_id) or {}).get('name', ''),
            group=(lookups['groups'].get(group_id) or {}).get('name', ''),
            programme_id=programme_id, cohort_id=cohort_id, group_id=group_id,
            training_plan=training_plan, learning_plan=learning_plan,
        ))
    return sources


def module_roster(module_id):
    """``attendance_assignments.module_roster`` on either schema (same result shape)."""
    from learner_api import attendance_assignments
    if not module_id or not enrolment_placement_by_id():
        return attendance_assignments.module_roster(module_id)
    from learner_api.learning_plan import _effective_plan_ids
    from learner_api.models import LearnerProfile
    from .learner_assignment_counts_sql import seed_preset_cache
    sources = roster_sources()
    # One round trip of group presets, keyed exactly as _effective_plan_ids asks
    # (by group id when the learner has one, else by programme/group name).
    presets = seed_preset_cache([
        {'programme': source.programme, 'grp': source.group, 'group_id': source.group_id} for source in sources
    ])
    members = {source.pk: source for source in sources if module_id in _effective_plan_ids(source, presets)}
    if not members:
        return []
    profiles = LearnerProfile.objects.filter(enrolment_id__in=members).values('id', 'enrolment_id', 'email', 'full_name')
    return [{
        'learner_profile_id': profile['id'],
        'learner_email': str(members[profile['enrolment_id']].email or profile['email'] or '').strip().casefold(),
        'learner_name': members[profile['enrolment_id']].username or profile['full_name'] or '',
    } for profile in profiles]
