"""Additive storage for module hour targets and explicitly delegated access.

Keep this schema stable: migration 0076 also uses it. Runtime reads never create
tables, and these records are independent of content/structure replacements.
"""


def table_name(connection, name):
    if name not in {'module_hours_targets', 'module_hours_access', 'module_hours_audit'}:
        raise ValueError('Unknown module hours table.')
    quoted = connection.ops.quote_name(name)
    return f'"curriculum".{quoted}' if connection.vendor == 'postgresql' else quoted


def provision(connection):
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('CREATE SCHEMA IF NOT EXISTS curriculum')
        identity = 'bigserial primary key' if connection.vendor == 'postgresql' else 'integer primary key'
        cursor.execute(f'''CREATE TABLE IF NOT EXISTS {table_name(connection, 'module_hours_targets')} (
            module_id text PRIMARY KEY,
            target_minutes integer NULL CHECK (target_minutes > 0),
            revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
            updated_by bigint NOT NULL,
            updated_at timestamp with time zone NOT NULL
        )''')
        cursor.execute(f'''CREATE TABLE IF NOT EXISTS {table_name(connection, 'module_hours_access')} (
            account_id bigint PRIMARY KEY,
            can_match boolean NOT NULL DEFAULT false,
            can_manage boolean NOT NULL DEFAULT false,
            revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
            updated_by bigint NOT NULL,
            updated_at timestamp with time zone NOT NULL
        )''')
        cursor.execute(f'''CREATE TABLE IF NOT EXISTS {table_name(connection, 'module_hours_audit')} (
            id {identity},
            kind text NOT NULL CHECK (kind IN ('target', 'access')),
            entity_id text NOT NULL,
            actor_id bigint NOT NULL,
            before_value text NOT NULL,
            after_value text NOT NULL,
            created_at timestamp with time zone NOT NULL
        )''')
