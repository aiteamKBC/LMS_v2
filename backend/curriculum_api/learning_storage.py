"""Resolve learning content to its physical owner.

Free courses own their rows in the three free-course tables. Ordinary modules
retain their existing tables. Shared readers use read-only projections so the
learning identities already held by progress, files and bookmarks stay valid.
"""
from .catalogue.infrastructure.storage_context import _native_only, native_only, native_authoring_scope

from django.db import connection

from .catalogue.infrastructure.learning_relations import TABLES, REFERENCE_VIEWS
from .free_course_contract import NATIVE_VIEWS

from .catalogue.infrastructure.learning_read_routes import (
    READ_VIEWS, _ready, _not_ready_until, NATIVE_REQUIRED_COLUMNS,
    enabled, reset, native_read_table, read_table,
)

from .catalogue.infrastructure.course_storage_reads import (
    _READ_NAMES, _READ_SOURCE, _SQL_PARTS, _rows, course, free_read_table, free_rows, is_free_course_payload, read_sql, with_course_storage,
)


from .catalogue.infrastructure.course_storage_writes import (
    JSON_COLUMNS, _data, _write, refresh_totals, update, upsert,
)


def creation_unavailable_response(payload):
    """Refuse public free-course creation until the storage cutover is installed.

    Historical migration/fixture writers still need to understand the old
    representation. Public creates must never silently use that representation.
    After cutover the ordinary-table CHECK also enforces the storage boundary.
    """
    if not is_free_course_payload(payload) or enabled(refresh=True):
        return None
    from django.http import JsonResponse
    response = JsonResponse({
        'error': 'Free-course creation is temporarily unavailable. Please contact an administrator. '
                 'No course has been created.',
        'code': 'free_course_storage_not_ready',
    }, status=503)
    response['Cache-Control'] = 'no-store'
    return response


def convert_to_module(reference, placement):
    """Materialise a regular module only during the explicit conversion action.

    Retain the native rows as historical targets for learner completion FKs.
    Public content IDs stay the same, so attempts and earned hours do not move.
    The caller holds the course lock in the authoring transaction.
    """
    owner = course(reference, lock=True)
    if owner is None:
        return False
    from . import views
    from django.utils import timezone
    snapshots = {table: views.authoring_fetch_all(table, 'module_catalogue_id=%s', [reference])
                 for table in TABLES}
    with connection.cursor() as cursor:
        cursor.execute('UPDATE curriculum.free_courses SET converted_at=%s WHERE id=%s',
                       [timezone.now(), owner['id']])
    for table in ('modules', 'weeks', 'components', 'module_details', 'module_completion_criteria', 'ksb_mappings'):
        key = 'id' if table in ('weeks', 'components', 'ksb_mappings') else 'module_catalogue_id'
        for row in snapshots[table]:
            if table == 'modules':
                row.update(placement, source_type='module_authoring', learner_roster_mode='inherited')
            views.authoring_upsert(table, [key], row)
    return True
