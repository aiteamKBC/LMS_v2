"""Placement names for the paginated coach caseload query.

``LearnerProfile.programme``/``cohort``/``group_name`` are read-only properties
resolved from the profile's own ``programme_id``/``cohort_id``/``group_id``
through ``curriculum.programmes``/``cohorts``/``groups``
(``learner_api.models._learner_placement_names``). They are not columns, so a
queryset cannot filter, sort or ``values_list`` on them.

This module reads the same names, through the same ids and the same curriculum
tables, once for a coach's caseload, and exposes them to the ORM as ``Case``
annotations. The profile's own placement is used; enrolment placement is never
substituted. Unknown or unnamed ids read as '' exactly as the properties do.
"""
from django.db import connections
from django.db.models import Case, TextField, Value, When

KINDS = (
    # (label annotation, id field, curriculum table, id column, name column)
    ('programme_label', 'programme_id', 'curriculum.programmes', 'programme_id', 'name'),
    ('cohort_label', 'cohort_id', 'curriculum.cohorts', 'cohort_id', 'cohort_name'),
    ('group_label', 'group_id', 'curriculum.groups', 'group_id', 'group_name'),
)


def _clean(value):
    return str(value).strip() if value is not None else ''


def placement_names(queryset):
    """``{'programme_id': {id: name}, 'cohort_id': {...}, 'group_id': {...}}`` for a caseload.

    Two read-only queries: the distinct placement ids of ``queryset``, then one
    UNION over the three curriculum tables restricted to those ids.
    """
    ids = {field: set() for _, field, *_ in KINDS}
    for row in queryset.order_by().values_list('programme_id', 'cohort_id', 'group_id').distinct():
        for (_, field, *_), value in zip(KINDS, row):
            if _clean(value):
                ids[field].add(_clean(value))
    names = {field: {} for field in ids}
    if not any(ids.values()):
        return names
    parts, params = [], []
    for _, field, table, id_column, name_column in KINDS:
        parts.append(f"SELECT %s, {id_column}::text, {name_column}::text FROM {table} "
                     f"WHERE {id_column}::text = ANY(%s)")
        params += [field, sorted(ids[field])]
    with connections[queryset.db].cursor() as cursor:
        cursor.execute(' UNION ALL '.join(parts), params)
        for field, key, name in cursor.fetchall():
            if _clean(name):
                names[field][_clean(key)] = _clean(name)
    return names


def placement_ids_named(field, name, using):
    """Ids whose curriculum name equals ``name`` case-insensitively (``__iexact``).

    Replaces ``filter(programme__iexact=name)``/``filter(cohort__iexact=name)``
    on the name properties: the caller filters the profile's own id column by
    the result, so an unmatched name still yields no learners.
    """
    _, _, table, id_column, name_column = next(kind for kind in KINDS if kind[1] == field)
    with connections[using].cursor() as cursor:
        cursor.execute(f"SELECT {id_column}::text FROM {table} WHERE upper({name_column}::text) = upper(%s)", [name])
        return sorted({_clean(row[0]) for row in cursor.fetchall() if _clean(row[0])})


def annotate_placement_labels(queryset, names):
    """Annotate ``programme_label``/``cohort_label``/``group_label`` (default '')."""
    return queryset.annotate(**{
        label: Case(*[When(**{field: key}, then=Value(name)) for key, name in sorted(names[field].items())],
                    default=Value(''), output_field=TextField())
        for label, field, *_ in KINDS
    })


def filter_options(names, field):
    """``[{value, label}]`` for named placements, ordered by label as before."""
    pairs = {(key, name) for key, name in names[field].items() if name}
    return [{'value': key, 'label': name} for key, name in sorted(pairs, key=lambda pair: (pair[1].casefold(), pair[1], pair[0]))]
