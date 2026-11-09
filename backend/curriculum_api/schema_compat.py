"""Bridge between the curriculum code and the normalised curriculum schema.

The cleaned database branch (``NEW_ENDPOINT_URL``) normalised ``curriculum``:

* soft-delete stamps (``deleted_at``, ``deleted_by``, ``deleted_via_parent``,
  ``is_programme_deleted``, ``is_archived``, ``is_active``) collapsed into one
  ``status`` column -- ``active`` / ``inactive`` (cohorts also ``planned``);
* copied names and id lists (``programme_name``, ``cohort_name``,
  ``group_name``, ``tutor_name``/``tutor_email``, ``coach_name``,
  ``module_ids``, ``group_ids``, ``assigned_*_ids`` ...) were dropped in favour
  of keys: ``modules.tutor_id -> tutors``, ``group_coaches -> groups, coaches`` (a group may have several);
* ``ksb_mappings`` keeps ``component_id`` + ``ksb_id`` and points at
  ``standard_ksbs`` (``standard_ksb_id``) for the code and description; its
  module and week come from the component, and ``components.ksb_mappings``
  (the JSON copy) is gone;
* cohort holiday choices live in ``cohort_calendar_holidays``.

Agreed behaviour (2026-11-07): archive/delete == ``status = 'inactive'``,
restore == ``'active'``. Who/when and "archived along with its parent" are no
longer recorded, so a restore cannot tell a cascade from a standalone archive.

Everything here is conditional on the table's actual columns: on a database
that still has the legacy columns nothing is projected or translated, so the
old schema keeps behaving exactly as before.

What the curriculum now does natively, and so is no longer here:
``curriculum_names`` (names, child lists and a cohort's holiday choices put on
rows by key; the chosen tutor/coach written as its id), ``calendar_holidays``
(the holiday calendar, the GOV.UK mirror and cohort choices) and
``ksb_mapping_placement`` (mappings scoped and read through their component).
Placement labels are also projected by FK for SQL filtering and ordering.
What remains: the lifecycle columns derived from ``status``, the KSB mapping /
component / free-course-week read shapes, and ``adapt_sql`` -- which hand-written
statements still need, chiefly the Learner team's code curriculum calls.
"""
from __future__ import annotations

import re
from datetime import datetime, timezone

from django.db import connection

LIFECYCLE_TABLES = frozenset({
    'programmes', 'cohorts', 'groups', 'modules', 'weeks', 'components',
    'ksb_mappings', 'coaches', 'tutors',
})
# Any of these present means the table still carries the legacy stamps.
LEGACY_LIFECYCLE_COLUMNS = ('deleted_at', 'is_programme_deleted', 'is_archived')
INACTIVE = 'inactive'
ACTIVE = 'active'
# 'archived' is what the legacy code writes for programmes/cohorts; both read
# as withdrawn so a value written by an older process is never shown as live.
INACTIVE_STATUSES = ('inactive', 'archived')
# Lifecycle tables whose status is CHECKed to ('active', 'inactive') on the
# normalised schema. Programmes and cohorts keep a free status (cohorts
# 'planned' ...), so they are not in it.
BINARY_STATUS_TABLES = frozenset({
    'groups', 'modules', 'weeks', 'components', 'ksb_mappings', 'coaches', 'tutors',
})
# Foreign-key columns on the normalised schema, by nullability (see
# translate_write: '' is "none", which a key column cannot hold).
NULLABLE_FOREIGN_KEYS = {
    'cohorts': ('programme_id',),
    'groups': ('coach_id',),
    'modules': ('programme_id', 'cohort_id', 'group_id', 'tutor_id'),
    'weeks': ('module_catalogue_id', 'free_course_id'),
    'ksb_mappings': ('component_id',),
}
REQUIRED_FOREIGN_KEYS = {
    'groups': ('programme_id', 'cohort_id'),
    'components': ('week_id', 'module_catalogue_id'),
    'ksb_mappings': ('standard_ksb_id',),
}
_EPOCH = datetime(1970, 1, 1, tzinfo=timezone.utc)

# Columns the normalised schema derives instead of storing, per table.
# Tables the read relation covers: the lifecycle tables plus free-course
# weeks, whose title/number/description now live on the week itself.
DERIVED_COLUMNS = {
    # SQL filters and ordering need these labels before Python row projection.
    # They remain FK reads, never copied storage.
    'cohorts': ('programme_name',),
    'groups': ('programme_name', 'cohort_name'),
    'modules': ('programme_name', 'cohort_name', 'group_name'),
    'free_course_weeks': ('week_title', 'week_number', 'description', 'course_name', 'cover_image_url'),
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


RELATION_TABLES = LIFECYCLE_TABLES | {'free_course_weeks'}


class UnsupportedOnNormalisedSchema(ValueError):
    """A legacy-only operation was asked of the normalised schema."""


def _qualified(table):
    if connection.vendor != 'postgresql':
        return f'"{table}"'
    return f'"curriculum"."{table}"'


def _internal(table):
    """A table reference adapt_sql never rewrites (``ONLY`` -- these tables have
    no inheritance, so it reads exactly the same rows). Used inside the read
    relation and this module's own queries, so a statement is adapted once."""
    if connection.vendor != 'postgresql':
        return f'"{table}"'
    return f'only "curriculum"."{table}"'


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


# --- read relation ------------------------------------------------------------
# For reads, a normalised table is selected through a derived relation that
# carries the legacy columns as SQL expressions, aliased with the table's own
# name. Every caller's where/order/column list that names a legacy column then
# keeps working unchanged. Writes never use it (a derived table is not
# updatable); they go through translate_write() against the real table.

# Exactly the withdrawal columns each table had before normalisation. Adding
# one a table never had would make an unqualified reference in a join
# ambiguous (programmes never had is_programme_deleted, for instance).
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


def legacy_read_columns(table, columns):
    """Legacy column names the read relation adds for ``table`` (absent from ``columns``)."""
    columns = set(columns or ())
    if connection.vendor != 'postgresql' or table not in RELATION_TABLES or not is_normalised(table, columns):
        return []
    keep = []
    for expression in _lifecycle_select(table, columns):
        name = expression.rsplit(' as ', 1)[-1].strip('"')
        if name not in columns:
            keep.append(name)
    keep += [key for key in DERIVED_COLUMNS.get(table, ()) if key not in columns and key != 'ksb_mappings']
    return keep


_COLUMNS_CACHE = {}


def columns_of(schema, table):
    """Column names of ``schema.table`` (cached per process; empty off PostgreSQL)."""
    key = (schema, table)
    if key in _COLUMNS_CACHE:
        return _COLUMNS_CACHE[key]
    if connection.vendor != 'postgresql':
        return set()
    if schema == 'curriculum':
        # One answer per table: views.column_names keeps the curriculum cache
        # (cleared with the curriculum caches), so the two never both ask.
        from . import views
        return set(views.column_names(table))
    with connection.cursor() as cursor:
        cursor.execute(
            'select column_name from information_schema.columns where table_schema = %s and table_name = %s',
            [schema, table],
        )
        names = {row[0] for row in cursor.fetchall()}
    if names:
        _COLUMNS_CACHE[key] = names
    return names


def relation_sql(table):
    """FROM-clause text for hand-written curriculum reads: the legacy-shaped
    read relation on the normalised schema, else the plain table. The caller
    adds its own alias: ``f'from {relation_sql("modules")} m'``."""
    relation = read_relation(table, columns_of('curriculum', table), alias=False)
    return relation or _qualified(table)


_TABLE_REF = re.compile(
    r'(?P<kw>\b(?:from|join)\s+)(?P<ref>(?:"curriculum"|curriculum)\s*\.\s*(?:"(?P<qt>[a-z_]+)"|(?P<t>[a-z_]+)\b))',
    re.IGNORECASE,
)
_LOCKING = re.compile(r'\bfor\s+(?:no\s+key\s+)?(?:update|share)\b', re.IGNORECASE)
_ADAPTED = {}


def adapt_sql(sql):
    """Point hand-written curriculum reads at the legacy-shaped read relation.

    Kept for the Learner team's code that curriculum calls (learner_api reads
    ``curriculum.*`` naming columns the current schema dropped: programme_name,
    deleted_at, module_ids ...). Curriculum's own statements no longer need it
    (agreed 2026-11-08); a curriculum read that is rewritten here is a defect
    to fix at its source, not a feature. Remove once learner_api reads the
    current schema.

    Only ``FROM``/``JOIN`` references to a normalised lifecycle table, and only
    when the statement names one of that table's legacy columns, are replaced;
    ``DELETE FROM`` targets, row-locking statements and every statement on the
    legacy schema pass through untouched.
    """
    if connection.vendor != 'postgresql' or not isinstance(sql, str) or 'curriculum' not in sql.lower():
        return sql
    cached = _ADAPTED.get(sql)
    if cached is not None:
        return cached
    if _LOCKING.search(sql):
        _ADAPTED[sql] = sql
        return sql
    lowered = sql.lower()

    def replace(match):
        table = (match.group('qt') or match.group('t') or '').lower()
        if table not in RELATION_TABLES:
            return match.group(0)
        if re.search(r'\bdelete\s+$', lowered[max(0, match.start() - 12):match.start()]):
            return match.group(0)
        columns = columns_of('curriculum', table)
        legacy = legacy_read_columns(table, columns)
        if not legacy or not any(re.search(rf'\b{re.escape(name)}\b', lowered) for name in legacy):
            return match.group(0)
        relation = read_relation(table, columns, alias=False)
        if not relation:
            return match.group(0)
        # Unaliased reference (``from curriculum.modules where ...``): keep the
        # table's own name addressable, as ``modules.title`` may follow.
        following = _NEXT_WORD.match(sql, match.end())
        word = (following.group(1) or '').lower() if following else ''
        if not word or word in _CLAUSE_WORDS:
            relation += f' as "{table}"'
            requalify.add(table)
        return match.group('kw') + relation

    requalify = set()
    adapted = _TABLE_REF.sub(replace, sql)
    for table in requalify:
        # The ORM names columns by schema and table ("curriculum"."modules"."title");
        # once the table is the relation aliased "modules" that reference is
        # invalid, so it is re-pointed at the alias.
        adapted = re.sub(
            rf'(?:"curriculum"|\bcurriculum)\s*\.\s*(?:"{table}"|\b{table}\b)\s*\.',
            f'"{table}".', adapted, flags=re.IGNORECASE,
        )
    _ADAPTED[sql] = adapted
    return adapted


_NEXT_WORD = re.compile(r'\s*(?:as\s+)?("?[A-Za-z_][A-Za-z0-9_]*"?)?')
_CLAUSE_WORDS = {
    'where', 'join', 'left', 'right', 'inner', 'full', 'cross', 'natural', 'on', 'using', 'order', 'group',
    'limit', 'offset', 'union', 'intersect', 'except', 'having', 'window', 'fetch', 'for', 'returning', 'set',
}


PRIMARY_KEYS = {
    'programmes': 'programme_id', 'cohorts': 'cohort_id', 'groups': 'group_id',
    'modules': 'module_catalogue_id', 'weeks': 'id', 'components': 'id', 'ksb_mappings': 'id',
    'coaches': 'id', 'tutors': 'id',
}


def _mentions_legacy(table, sql, columns):
    lowered = (sql or '').lower()
    return any(re.search(rf'\b{re.escape(name)}\b', lowered) for name in legacy_read_columns(table, columns))


def write_where(table, where_sql, columns):
    """A write's WHERE that names a legacy column, re-expressed by primary key.

    ``update/delete ... where programme_name = %s`` cannot run against the
    normalised table; the same rows are found through the read relation and
    matched by key. The condition (and its parameters) is unchanged.
    """
    columns = set(columns or ())
    key = PRIMARY_KEYS.get(table)
    if not where_sql or not key or not _mentions_legacy(table, where_sql, columns):
        return where_sql
    relation = read_relation(table, columns, alias=True)
    if not relation:
        return where_sql
    return f'"{key}" in (select "{key}" from {relation} where {where_sql})'


def only_derived_copy(table, payload, columns):
    """True when a write's payload sets nothing the normalised table stores.

    e.g. ``{'programme_name': ..., 'updated_at': ...}``: the name is now read
    by id, so there is no copy to refresh -- and stamping ``updated_at`` alone
    would reorder catalogues for no change.
    """
    columns = set(columns or ())
    if not is_normalised(table, columns) or not payload:
        return False
    if table == 'cohorts' and ({'holiday_ids', 'excluded_holiday_ids'} & set(payload)):
        return False  # stored, in cohort_calendar_holidays (see after_write)
    if table == 'groups' and 'coach_name' in payload:
        from . import group_coaches
        if group_coaches.in_use():
            return False  # stored, in group_coaches (see group_coaches.store)
    from .curriculum_names import ROW_FIELDS
    legacy = (set(DERIVED_COLUMNS.get(table, ())) | set(ROW_FIELDS.get(table, ())) | set(LEGACY_LIFECYCLE_COLUMNS)
              | {'deleted_by', 'deleted_via_parent'})
    stored = [key for key in payload if key in columns and key not in {'updated_at'}]
    return not stored and any(key in legacy and key not in columns for key in payload)


def _sql_adapter(execute, sql, params, many, context):
    return execute(adapt_sql(sql), params, many, context)


class adapted_reads:
    """``with adapted_reads(): ...`` -- ``adapt_sql`` for work outside a request
    (background workers, management commands) on ``default`` and ``enrolment``."""

    def __enter__(self):
        from contextlib import ExitStack
        self._stack = ExitStack()
        try:
            from django.db import connections
            databases = connections.databases
        except Exception:
            return self  # no real connection handler (e.g. a test double): no-op
        if not isinstance(databases, dict):
            return self
        for alias in ('default', 'enrolment'):
            if alias in databases:
                self._stack.enter_context(connections[alias].execute_wrapper(_sql_adapter))
        return self

    def __exit__(self, *exc):
        return self._stack.__exit__(*exc)


class CurriculumSchemaCompatMiddleware:
    """Route hand-written reads of ``/curriculum_api/`` requests through ``adapt_sql``.

    Temporary, for the Learner team's code called inside a curriculum request
    (see ``adapt_sql``).

    Scoped to curriculum requests and to the two aliases curriculum reads
    (``default``, ``enrolment``). A no-op on the legacy schema, where no table
    is normalised and ``adapt_sql`` returns every statement unchanged.
    """

    PREFIX = '/curriculum_api/'

    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        if not request.path_info.startswith(self.PREFIX):
            return self.get_response(request)
        from contextlib import ExitStack
        from django.db import connections
        with ExitStack() as stack:
            for alias in ('default', 'enrolment'):
                if alias in connections.databases:
                    stack.enter_context(connections[alias].execute_wrapper(_sql_adapter))
            return self.get_response(request)


def read_relation(table, columns, alias=True):
    """``(select ...) as "<table>"`` exposing legacy columns, or None on the legacy shape."""
    columns = set(columns or ())
    if connection.vendor != 'postgresql' or table not in RELATION_TABLES or not is_normalised(table, columns):
        return None
    q = _internal
    t = 't'
    extra = [expr for expr in _lifecycle_select(table, columns, t)
             if expr.rsplit(' as ', 1)[-1].strip('"') not in columns]
    joins = []

    def add(name, expression):
        if name not in columns:
            extra.append(f'{expression} as "{name}"')

    for output, source, key, label in (
        ('programme_name', 'programmes', 'programme_id', 'name'),
        ('cohort_name', 'cohorts', 'cohort_id', 'cohort_name'),
        ('group_name', 'groups', 'group_id', 'group_name'),
    ):
        if output in DERIVED_COLUMNS.get(table, ()) and key in columns:
            add(output, f"coalesce((select placement.{label} from {q(source)} placement "
                        f"where placement.{key} = {t}.{key}), '')::varchar")

    if table == 'ksb_mappings':
        joins.append(f'left join {q("components")} cc on cc.id = {t}.component_id')
        joins.append(f'left join {q("standard_ksbs")} sk on sk.id = {t}.standard_ksb_id')
        add('module_catalogue_id', "coalesce(cc.module_catalogue_id, '')::varchar")
        add('week_id', 'cc.week_id')
        add('ksb_code', "coalesce(sk.ksb_code, '')::varchar")
        add('ksb_description', 'sk.ksb_description')
    elif table == 'free_course_weeks':
        joins.append(f'left join {q("weeks")} fw on fw.id = {t}.week_id')
        joins.append(f'left join {q("free_courses")} fc on fc.id = {t}.course_id')
        add('week_title', "coalesce(fw.title, '')::text")
        add('week_number', 'coalesce(fw.week_number, 1)')
        add('description', 'fw.summary')
        add('course_name', "coalesce(fc.course_name, '')::text")
        add('cover_image_url', 'fc.cover_image_url')
    elif table in {'weeks', 'components'}:
        if table == 'weeks':
            add('library_state', f"(case when coalesce({t}.module_catalogue_id, '') = '' and {t}.free_course_id is not null "
                                 f"then 'library' else '' end)::varchar")
        else:
            add('library_state', "''::varchar")
        add('detached_at', 'null::timestamptz')
        add('origin_module_catalogue_id', "''::varchar")
        add('origin_week_id', "''::varchar")
        add('origin_module_title', "''::text")
        add('origin_week_label', "''::text")
    if not extra:
        return None
    body = f'(select {t}.*, ' + ', '.join(extra) + f' from {q(table)} {t} ' + ' '.join(joins) + ')'
    return f'{body} as "{table}"' if alias else body


def invalidate():
    from . import curriculum_names
    curriculum_names.invalidate()


# --- read projection ----------------------------------------------------------

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


def project_rows(table, rows, columns, *, requested=None, excluded=None):
    """Add the legacy keys the code still reads to rows of the normalised schema.

    ``columns`` is the table's real column set; ``requested`` the caller's
    narrowed column list (None for ``select *``); ``excluded`` its exclusions.
    Mutates and returns ``rows``. A no-op on the legacy schema.
    """
    if not rows or table not in RELATION_TABLES:
        return rows
    columns = set(columns or ())
    if not is_normalised(table, columns):
        return rows
    requested = set(requested) if requested else None
    # Keys the read relation already supplied are left alone: only what is
    # still missing (components' ksb_mappings JSON, rows read another way) is derived.
    present = set(rows[0])
    want = lambda key: key not in present and _wanted(key, columns, requested, excluded)  # noqa: E731

    if uses_status_lifecycle(table, columns) and 'status' in rows[0]:
        lifecycle_keys = [key for key in ('is_programme_deleted', 'deleted_at', 'deleted_by',
                                          'deleted_via_parent', 'is_archived', 'is_active') if want(key)]
        if lifecycle_keys:
            for row in rows:
                for key, value in _lifecycle_fields(table, row).items():
                    if key in lifecycle_keys:
                        row.setdefault(key, value)

    derived = [key for key in DERIVED_COLUMNS.get(table, ()) if want(key)]
    if not derived:
        return rows
    if table == 'ksb_mappings':
        _project_ksb_mappings(rows, derived)
    elif table == 'components':
        _project_components(rows, derived)
    elif table == 'weeks':
        for row in rows:
            for key in derived:
                if key == 'library_state':
                    # Former library weeks became free-course weeks: no module.
                    row.setdefault(key, 'library' if not row.get('module_catalogue_id') and row.get('free_course_id') else '')
                else:
                    row.setdefault(key, None if key == 'detached_at' else '')
    return rows


def _chunks(values, size=2000):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def _project_ksb_mappings(rows, derived):
    component_ids = {str(row.get('component_id')) for row in rows if row.get('component_id')}
    standard_ids = {row.get('standard_ksb_id') for row in rows if row.get('standard_ksb_id') is not None}
    placements, standards = {}, {}
    with connection.cursor() as cursor:
        for chunk in _chunks(component_ids):
            cursor.execute(f'select id, module_catalogue_id, week_id from {_internal("components")} where id = any(%s)', [chunk])
            placements.update({cid: (module_id, week_id) for cid, module_id, week_id in cursor.fetchall()})
        for chunk in _chunks(standard_ids):
            cursor.execute(f'select id, ksb_code, ksb_description from {_internal("standard_ksbs")} where id = any(%s)', [chunk])
            standards.update({sid: (code, description) for sid, code, description in cursor.fetchall()})
    for row in rows:
        module_id, week_id = placements.get(str(row.get('component_id')), (None, None))
        code, description = standards.get(row.get('standard_ksb_id'), ('', ''))
        values = {'module_catalogue_id': module_id or '', 'week_id': week_id,
                  'ksb_code': code or '', 'ksb_description': description}
        for key in derived:
            row.setdefault(key, values[key])


def component_mapping_items(component_ids):
    """``{component_id: [mapping item, ...]}`` in the shape of the old JSON copy."""
    items = {}
    ids = [str(value) for value in component_ids if value]
    if not ids:
        return items
    with connection.cursor() as cursor:
        for chunk in _chunks(ids):
            cursor.execute(
                f'''
                select m.component_id, m.id, m.ksb_id, m.weight, m.classification, m.source_type,
                       m.source_id, m.weight_class, s.ksb_code, s.ksb_description
                from {_internal("ksb_mappings")} m
                left join {_internal("standard_ksbs")} s on s.id = m.standard_ksb_id
                where m.component_id = any(%s) and {active_condition("m")}
                order by m.component_id, s.ksb_code, m.id
                ''',
                [chunk],
            )
            for (component_id, mapping_id, ksb_id, weight, classification, source_type,
                 source_id, weight_class, code, description) in cursor.fetchall():
                items.setdefault(component_id, []).append({
                    'id': mapping_id, 'ksb_id': ksb_id or '',
                    'weight': float(weight) if weight is not None else None,
                    'ksb_code': code or '', 'source_id': source_id or '',
                    'description': description or '', 'source_type': source_type or '',
                    'weight_class': weight_class or '', 'classification': classification or '',
                })
    return items


def _project_components(rows, derived):
    if 'ksb_mappings' in derived:
        items = component_mapping_items({row.get('id') for row in rows})
        for row in rows:
            row.setdefault('ksb_mappings', items.get(str(row.get('id')), []))
    for row in rows:
        for key in derived:
            if key == 'ksb_mappings':
                continue
            row.setdefault(key, None if key == 'detached_at' else '')


# --- write translation --------------------------------------------------------

def standard_ksb_id_for(ksb_id='', ksb_code='', programme_id='', module_catalogue_id=''):
    """``standard_ksbs.id`` for a mapping being written, or None when unknown."""
    with connection.cursor() as cursor:
        if ksb_id:
            cursor.execute(f'select standard_ksb_id from {_qualified("ksb_mappings")} where ksb_id = %s limit 1', [ksb_id])
            found = cursor.fetchone()
            if found:
                return found[0]
        code = (ksb_code or '').strip()
        if not code and ksb_id:
            return None
        # The module's (else the programme's) KSB profile names the standard,
        # e.g. 'standard:st0845-v1-1' -> ST0845.
        profile = ''
        if module_catalogue_id:
            cursor.execute(
                f'''
                select coalesce(nullif(m.ksb_profile_source_id, ''), p.ksb_profile_source_id), m.programme_id
                from {_qualified("modules")} m
                left join {_qualified("programmes")} p on p.programme_id = m.programme_id
                where m.module_catalogue_id = %s
                ''',
                [module_catalogue_id],
            )
            found = cursor.fetchone()
            if found:
                profile, programme_id = found[0] or '', programme_id or found[1] or ''
        if not profile and programme_id:
            cursor.execute(f'select ksb_profile_source_id from {_qualified("programmes")} where programme_id = %s',
                           [programme_id])
            found = cursor.fetchone()
            profile = (found[0] if found else '') or ''
        reference = profile.split(':', 1)[-1].split('-v', 1)[0].upper() if profile else ''
        if not reference:
            return None
        cursor.execute(
            f'select id from {_qualified("standard_ksbs")} where upper(standard_ref) = %s and upper(ksb_code) = upper(%s) '
            f'order by date_updated desc nulls last, id desc limit 1',
            [reference, code],
        )
        found = cursor.fetchone()
        return found[0] if found else None


def translate_write(table, payload, columns):
    """Rewrite a legacy-shaped write payload for the normalised schema.

    Returns ``(payload, extra_nullable)``. Values for columns the table no
    longer has are converted into what it stores instead; anything with no
    normalised home is left for ``filtered_payload`` to drop, exactly as it
    already drops unknown keys. A no-op on the legacy schema.
    """
    columns = set(columns or ())
    if table not in LIFECYCLE_TABLES or not payload or not is_normalised(table, columns):
        return payload, set()
    payload = dict(payload)
    nullable = set()

    if uses_status_lifecycle(table, columns):
        status = payload.get('status')
        if isinstance(status, str) and status.strip().lower() == 'archived':
            payload['status'] = INACTIVE
        elif 'status' not in payload or payload.get('status') is None:
            withdrawn = None
            if payload.get('is_programme_deleted') is True or payload.get('is_archived') is True:
                withdrawn = True
            elif 'deleted_at' in payload:
                withdrawn = payload.get('deleted_at') is not None
            elif payload.get('is_programme_deleted') is False:
                withdrawn = False
            if withdrawn is True:
                payload['status'] = INACTIVE
            elif withdrawn is False:
                payload['status'] = ACTIVE
        if table == 'programmes' and payload.get('is_active') is False and 'status' not in payload:
            payload['status'] = INACTIVE
        if table in BINARY_STATUS_TABLES and 'status' in payload:
            # These tables CHECK status in ('active', 'inactive'): it is only
            # the archive flag. Writers still send display states -- a group
            # 'planned' from its cohort, a module 'draft'/'published' -- which
            # the database refuses (groups_status_check ...). Those are not a
            # lifecycle change, so they are dropped: an insert takes the column
            # default ('active') and an update leaves archive state alone (a
            # coerced 'active' would restore an archived row).
            value = str(payload.get('status') or '').strip().lower()
            if value in INACTIVE_STATUSES:
                payload['status'] = INACTIVE
            elif value == ACTIVE:
                payload['status'] = ACTIVE
            else:
                payload.pop('status')

    # Placement and parent links are foreign keys here. Writers still send ''
    # for "none" (a module saved without a group, a group without a coach),
    # which the key refuses (modules_group_id_fkey ...). A nullable key stores
    # it as NULL -- the same "none", cleared on update as '' always cleared it;
    # a NOT NULL key keeps what it has (the update leaves it alone).
    for column in NULLABLE_FOREIGN_KEYS.get(table, ()):
        if column in payload and column in columns and isinstance(payload[column], str) and not payload[column].strip():
            payload[column] = None
            nullable.add(column)
    for column in REQUIRED_FOREIGN_KEYS.get(table, ()):
        if column in payload and isinstance(payload[column], str) and not payload[column].strip():
            payload.pop(column)

    if table in {'weeks', 'components'} and payload.get('library_state') == 'library' and 'library_state' not in columns:
        raise UnsupportedOnNormalisedSchema(
            'Keeping a week or component in the reuse library is not supported by the current curriculum '
            'database: every week belongs to a module or a free course, and every component to a week.'
        )

    # The chosen tutor / coach (tutor_name/tutor_email, coach_name) is written
    # as its id natively: curriculum_names.store_staff.
    if table == 'ksb_mappings' and 'standard_ksb_id' in columns and not payload.get('standard_ksb_id'):
        if payload.get('ksb_id') or payload.get('ksb_code'):
            resolved = standard_ksb_id_for(
                payload.get('ksb_id') or '', payload.get('ksb_code') or '',
                module_catalogue_id=payload.get('module_catalogue_id') or '',
            )
            if resolved is not None:
                payload['standard_ksb_id'] = resolved
    return payload, nullable
