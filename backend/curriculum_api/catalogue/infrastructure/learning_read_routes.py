"""Read-source selection and its shared readiness cache; no writer or API imports."""
from time import monotonic
from django.db import connection
from curriculum_api.free_course_contract import NATIVE_VIEWS
from .learning_relations import TABLES, REFERENCE_VIEWS
from .storage_context import native_only

READ_VIEWS = {**{table: pair[0] for table, pair in TABLES.items()}, **REFERENCE_VIEWS}


_ready = {}


_not_ready_until = {}


NATIVE_REQUIRED_COLUMNS = (
    ('free_courses', 'content_ref'),
    ('free_courses', 'converted_at'),
    ('free_courses', 'authoring_data'),
    ('free_courses', 'managed_by_builder'),
    ('free_courses', 'storage_version'),
    ('free_course_weeks', 'content_ref'),
    ('free_course_weeks', 'course_id'),
    ('free_course_weeks', 'authoring_data'),
    ('free_programme_components', 'content_ref'),
    ('free_programme_components', 'free_module_id'),
    ('free_programme_components', 'authoring_data'),
)


def enabled(db=connection, *, refresh=False):
    if db.vendor != 'postgresql':
        return False
    key = (db.alias, db.settings_dict.get('HOST'), db.settings_dict.get('PORT'), db.settings_dict.get('NAME'))
    if not refresh and key in _ready:
        return _ready[key]
    if not refresh and monotonic() < _not_ready_until.get(key, 0):
        return False
    required_values = ','.join(['(%s,%s)'] * len(NATIVE_REQUIRED_COLUMNS))
    required_params = [value for pair in NATIVE_REQUIRED_COLUMNS for value in pair]
    with db.cursor() as cursor:
        cursor.execute(f"""WITH required_columns(table_name,column_name) AS (
                VALUES {required_values}
            ), required_views(view_name) AS (
                SELECT unnest(%s::text[])
            )
            SELECT
                NOT EXISTS (
                    SELECT 1 FROM required_columns required
                    WHERE NOT EXISTS (
                        SELECT 1 FROM information_schema.columns actual
                        WHERE actual.table_schema='curriculum'
                          AND actual.table_name=required.table_name
                          AND actual.column_name=required.column_name
                    )
                )
                AND NOT EXISTS (
                    SELECT 1 FROM required_views required
                    WHERE to_regclass('curriculum.' || required.view_name) IS NULL
                )""", [*required_params, list(NATIVE_VIEWS.values())])
        ready = cursor.fetchone()[0]
    # A worker may have answered requests before the coordinated cutover.
    # Never keep that negative result for its entire lifetime: after migration
    # it must see the native tables without falling back to ordinary modules.
    if ready is True:
        _ready[key] = True
        _not_ready_until.pop(key, None)
    else:
        _ready.pop(key, None)
        # Keep catalogue reads inexpensive on a database awaiting cutover.
        _not_ready_until[key] = monotonic() + 5
    return ready is True


def reset():
    _ready.clear()
    _not_ready_until.clear()


def native_read_table(table):
    return f'"curriculum"."{NATIVE_VIEWS[table]}"'


def read_table(table, db=connection):
    if native_only() and table in NATIVE_VIEWS:
        return native_read_table(table)
    name = READ_VIEWS[table] if table in READ_VIEWS and enabled(db) else table
    return f'"curriculum"."{name}"' if db.vendor == 'postgresql' else db.ops.quote_name(name)
