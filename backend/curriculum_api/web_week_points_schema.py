"""Independent website navigation; migrations only, never provision on a GET."""


def table_name(connection):
    name = connection.ops.quote_name('web_week_points')
    return f'"curriculum".{name}' if connection.vendor == 'postgresql' else name


def provision(connection):
    with connection.cursor() as cursor:
        cursor.execute(f'''CREATE TABLE IF NOT EXISTS {table_name(connection)} (
            week_id text PRIMARY KEY,
            module_id text NOT NULL,
            points_json text NOT NULL,
            revision integer NOT NULL CHECK (revision > 0),
            updated_by bigint NOT NULL,
            updated_at timestamp with time zone NOT NULL
        )''')
