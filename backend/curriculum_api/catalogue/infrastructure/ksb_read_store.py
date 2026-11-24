"""Where a KSB mapping sits in the curriculum: its component's module and week.

``curriculum.ksb_mappings`` keeps ``component_id`` (foreign key, RESTRICT) and
``standard_ksb_id``. Its module and week are its component's, and its code and
description its standard KSB's. A write that scopes mappings by module or week
therefore scopes them through their component. A read that wants the
placement or the code joins them from there.
"""
from __future__ import annotations

import threading
import time

from django.db import connection

from . import database_reads, placement_reads
from .database_reads import scoped_curriculum_read

PLACEMENT_FIELDS = ('module_catalogue_id', 'week_id')

#: What a mapping read through ``relation()`` carries beyond its own columns.
READ_FIELDS = ('module_catalogue_id', 'week_id', 'ksb_code', 'ksb_description')


def _only():
    """``only`` before a table on PostgreSQL (these tables have no inheritance,
    so it reads exactly the same rows); nothing elsewhere."""
    return 'only ' if connection.vendor == 'postgresql' else ''


def where(module_ids=None, week_id=None, component_ids=None):
    from . import database_reads
    from .ksb_placement_reads import where as read
    return read(
        module_ids, week_id, component_ids, AUTHORING_COMPONENTS_TABLE=database_reads.AUTHORING_COMPONENTS_TABLE,
        authoring_table_name=database_reads.authoring_table_name, clean_str=database_reads.clean_str,
    )


def relation(*, include_description=True):
    from . import database_reads
    from .ksb_placement_reads import relation as read
    return read(
        include_description=include_description, AUTHORING_COMPONENTS_TABLE=database_reads.AUTHORING_COMPONENTS_TABLE,
        AUTHORING_KSB_MAPPINGS_TABLE=database_reads.AUTHORING_KSB_MAPPINGS_TABLE, _only=_only,
        authoring_table_name=database_reads.authoring_table_name,
    )


def read_source(table):
    """FROM text for a hand-written read of ``table``: mappings through
    ``relation()`` (placement and code by key), any other table as itself."""
    from . import database_reads
    if table == database_reads.AUTHORING_KSB_MAPPINGS_TABLE:
        return relation()
    return database_reads.authoring_table_name(table)


def read_columns(table):
    """The columns a read through ``read_source(table)`` can select."""
    from . import database_reads
    columns = set(database_reads.column_names(table))
    if table == database_reads.AUTHORING_KSB_MAPPINGS_TABLE:
        columns |= set(READ_FIELDS)
    return columns


def can_select(table, column):
    """Whether a read through ``read_source(table)`` can select ``column``."""
    from . import database_reads
    if database_reads.has_column(table, column):
        return True
    return column in READ_FIELDS and table == database_reads.AUTHORING_KSB_MAPPINGS_TABLE


# standard_ksbs ids -> (code, description), as last read. Reference data:
# changed only by a manual Skills England import, which the curriculum cache
# already lets lag by up to 60 s (views.coverage_entry), so this lags no more.
STANDARD_TEXTS_TTL_SECONDS = 60
_STANDARD_TEXTS = {'read_at': 0.0, 'rows': {}}
_STANDARD_TEXTS_LOCK = threading.Lock()


def _chunks(values, size=2000):
    values = list(values)
    for start in range(0, len(values), size):
        yield values[start:start + size]


def standard_ksb_texts(standard_ids):
    from . import database_reads
    from django.db import connection
    from .ksb_placement_reads import standard_ksb_texts as read
    return read(
        standard_ids, STANDARD_TEXTS_TTL_SECONDS=STANDARD_TEXTS_TTL_SECONDS, _STANDARD_TEXTS=_STANDARD_TEXTS,
        _STANDARD_TEXTS_LOCK=_STANDARD_TEXTS_LOCK, _chunks=_chunks, _only=_only,
        authoring_table_name=database_reads.authoring_table_name, connection=connection, time=time,
    )


def reset_standard_ksb_texts():
    with _STANDARD_TEXTS_LOCK:
        _STANDARD_TEXTS.update(read_at=0.0, rows={})


def component_items(component_ids):
    from . import database_reads
    from django.db import connection
    from .ksb_placement_reads import component_items as read
    return read(
        component_ids, AUTHORING_KSB_MAPPINGS_TABLE=database_reads.AUTHORING_KSB_MAPPINGS_TABLE, _chunks=_chunks,
        _only=_only, authoring_table_name=database_reads.authoring_table_name, connection=connection,
    )


def attach_component_items(rows):
    """Put each component's KSB items on it as ``ksb_mappings``."""
    items = component_items({row.get('id') for row in rows})
    for row in rows:
        row.setdefault('ksb_mappings', items.get(str(row.get('id')), []))
    return rows


def attach_descriptions(rows):
    """Put each mapping's standard KSB description on it (read once per standard)."""
    texts = standard_ksb_texts(row.get('standard_ksb_id') for row in rows)
    for row in rows:
        row.setdefault('ksb_description', texts.get(row.get('standard_ksb_id'), ('', None))[1])
    return rows

# Reference rows and their matching digest are replaced atomically.
_SKILLS_ENGLAND_ROWS = (None, None)


@scoped_curriculum_read
def get_skills_england_ksb_rows():
    if not database_reads.table_exists('standard_ksbs'):
        return []
    # Re-read only when the table changed: its digest rides the request's one
    # lookup round trip, so an unchanged table costs nothing.
    global _SKILLS_ENGLAND_ROWS
    digest = placement_reads.standards_digest()
    cached_digest, cached_rows = _SKILLS_ENGLAND_ROWS
    if digest and cached_digest == digest:
        return cached_rows
    rows = database_reads.fetch_all(f'''
        select *
        from {database_reads.table_name("standard_ksbs")}
        order by standard_ref, standard_version, ksb_type, ksb_code, id
    ''')
    if digest:
        _SKILLS_ENGLAND_ROWS = (digest, rows)  # one assignment: never a torn pair
    return rows
