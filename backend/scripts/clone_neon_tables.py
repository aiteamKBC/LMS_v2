import argparse
import os
from pathlib import Path

import psycopg
from psycopg import sql


BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE_SCHEMA = 'public'
DEFAULT_TARGET_SCHEMA = 'curriculum'
TABLES = [
    'ksb_profiles',
    'Modules',
    'Training_plan',
    'training_plan_holidays',
    'training_plan_program_configs',
    'tutor_profiles',
    'Tutors_Modules',
    'coach_profiles',
]


def load_env_file(path):
    if not path.exists():
        return

    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith('#') or '=' not in line:
            continue

        key, value = line.split('=', 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


def quote_table_literal(schema_name, table_name):
    return "'\"{}\".\"{}\"'".format(
        schema_name.replace('"', '""'),
        table_name.replace('"', '""'),
    )


def fetch_one(cur, query, params=()):
    cur.execute(query, params)
    return cur.fetchone()


def fetch_all(cur, query, params=()):
    cur.execute(query, params)
    return cur.fetchall()


def get_table_columns(cur, schema_name, table_name):
    return fetch_all(
        cur,
        """
        select
            a.attname,
            pg_catalog.format_type(a.atttypid, a.atttypmod),
            a.attnotnull,
            pg_get_expr(d.adbin, d.adrelid),
            a.attidentity
        from pg_attribute a
        join pg_class c on c.oid = a.attrelid
        join pg_namespace n on n.oid = c.relnamespace
        left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
        where n.nspname = %s
          and c.relname = %s
          and a.attnum > 0
          and not a.attisdropped
        order by a.attnum
        """,
        (schema_name, table_name),
    )


def get_constraints(cur, schema_name, table_name):
    return fetch_all(
        cur,
        """
        select conname, pg_get_constraintdef(oid)
        from pg_constraint
        where conrelid = (quote_ident(%s) || '.' || quote_ident(%s))::regclass
        order by case contype when 'p' then 0 when 'u' then 1 else 2 end, conname
        """,
        (schema_name, table_name),
    )


def get_indexes(cur, schema_name, table_name):
    return fetch_all(
        cur,
        """
        select indexname, indexdef
        from pg_indexes
        where schemaname = %s
          and tablename = %s
          and indexname not in (
              select conname
              from pg_constraint
              where conrelid = (quote_ident(%s) || '.' || quote_ident(%s))::regclass
          )
        order by indexname
        """,
        (schema_name, table_name, schema_name, table_name),
    )


def get_row_count(cur, schema_name, table_name):
    cur.execute(
        sql.SQL('select count(*) from {}').format(
            sql.Identifier(schema_name, table_name),
        )
    )
    return cur.fetchone()[0]


def table_exists(cur, schema_name, table_name):
    return bool(
        fetch_one(
            cur,
            """
            select 1
            from information_schema.tables
            where table_schema = %s
              and table_type = 'BASE TABLE'
              and table_name = %s
            """,
            (schema_name, table_name),
        )
    )


def build_create_table(columns, schema_name, table_name):
    column_sql = []
    for name, data_type, not_null, default, identity in columns:
        parts = [sql.Identifier(name), sql.SQL(data_type)]

        if identity:
            mode = 'ALWAYS' if identity == 'a' else 'BY DEFAULT'
            parts.append(sql.SQL(f'GENERATED {mode} AS IDENTITY'))
        elif default:
            parts.extend([sql.SQL('DEFAULT'), sql.SQL(default)])

        if not_null:
            parts.append(sql.SQL('NOT NULL'))

        column_sql.append(sql.SQL(' ').join(parts))

    return sql.SQL('create table {} ({})').format(
        sql.Identifier(schema_name, table_name),
        sql.SQL(', ').join(column_sql),
    )


def create_schema(source_cur, target_cur, source_schema, target_schema, table_name):
    columns = get_table_columns(source_cur, source_schema, table_name)
    if not columns:
        raise RuntimeError(f'Source table not found: {source_schema}.{table_name}')

    target_cur.execute(build_create_table(columns, target_schema, table_name))

    for constraint_name, constraint_def in get_constraints(source_cur, source_schema, table_name):
        target_cur.execute(
            sql.SQL('alter table {} add constraint {} {}').format(
                sql.Identifier(target_schema, table_name),
                sql.Identifier(constraint_name),
                sql.SQL(constraint_def),
            )
        )

    for _, index_def in get_indexes(source_cur, source_schema, table_name):
        target_cur.execute(sql.SQL(index_def.replace(f' ON {source_schema}.', f' ON {target_schema}.')))


def copy_table_data(source_cur, target_cur, source_schema, target_schema, table_name):
    columns = [row[0] for row in get_table_columns(source_cur, source_schema, table_name)]
    column_list = sql.SQL(', ').join(sql.Identifier(column) for column in columns)
    source_query = sql.SQL('copy {} ({}) to stdout').format(
        sql.Identifier(source_schema, table_name),
        column_list,
    )
    target_query = sql.SQL('copy {} ({}) from stdin').format(
        sql.Identifier(target_schema, table_name),
        column_list,
    )

    with source_cur.copy(source_query) as source_copy:
        with target_cur.copy(target_query) as target_copy:
            for data in source_copy:
                target_copy.write(data)


def sync_identity_sequences(target_cur, schema_name, table_name):
    columns = fetch_all(
        target_cur,
        """
        select column_name
        from information_schema.columns
        where table_schema = %s
          and table_name = %s
          and is_identity = 'YES'
        """,
        (schema_name, table_name),
    )

    for (column_name,) in columns:
        target_cur.execute(
            sql.SQL('select pg_get_serial_sequence({}, {})').format(
                sql.SQL(quote_table_literal(schema_name, table_name)),
                sql.Literal(column_name),
            )
        )
        sequence_name = target_cur.fetchone()[0]
        if not sequence_name:
            continue

        target_cur.execute(
            sql.SQL('select max({}) from {}').format(
                sql.Identifier(column_name),
                sql.Identifier(schema_name, table_name),
            )
        )
        max_value = target_cur.fetchone()[0]
        if max_value is not None:
            target_cur.execute('select setval(%s, %s, true)', (sequence_name, max_value))


def clone_tables(source_url, target_url, source_schema, target_schema, replace):
    with psycopg.connect(source_url) as source_conn, psycopg.connect(target_url) as target_conn:
        with source_conn.cursor() as source_cur, target_conn.cursor() as target_cur:
            target_cur.execute(
                sql.SQL('create schema if not exists {}').format(sql.Identifier(target_schema))
            )

            for table_name in TABLES:
                source_count = get_row_count(source_cur, source_schema, table_name)
                exists = table_exists(target_cur, target_schema, table_name)

                if exists and not replace:
                    raise RuntimeError(
                        f'Target table already exists: {target_schema}.{table_name}. '
                        'Run with --replace if you want to drop and recreate it.'
                    )

                if exists:
                    target_cur.execute(
                        sql.SQL('drop table {} cascade').format(
                            sql.Identifier(target_schema, table_name),
                        )
                    )

                create_schema(source_cur, target_cur, source_schema, target_schema, table_name)
                copy_table_data(source_cur, target_cur, source_schema, target_schema, table_name)
                sync_identity_sequences(target_cur, target_schema, table_name)
                target_count = get_row_count(target_cur, target_schema, table_name)
                print(f'{table_name}: {source_count} -> {target_count}')

        target_conn.commit()


def main():
    parser = argparse.ArgumentParser(
        description='Clone selected Neon PostgreSQL tables from SOURCE_DATABASE_URL to DATABASE_URL.'
    )
    parser.add_argument(
        '--replace',
        action='store_true',
        help='Drop target tables first if they already exist.',
    )
    parser.add_argument(
        '--source-schema',
        default=None,
        help='Source schema name. Defaults to SOURCE_DATABASE_SCHEMA or public.',
    )
    parser.add_argument(
        '--target-schema',
        default=None,
        help='Target schema name. Defaults to DATABASE_SCHEMA or curriculum.',
    )
    args = parser.parse_args()

    load_env_file(BASE_DIR / '.env')
    source_url = os.environ.get('SOURCE_DATABASE_URL')
    target_url = os.environ.get('DATABASE_URL')
    source_schema = args.source_schema or os.environ.get('SOURCE_DATABASE_SCHEMA') or DEFAULT_SOURCE_SCHEMA
    target_schema = args.target_schema or os.environ.get('DATABASE_SCHEMA') or DEFAULT_TARGET_SCHEMA

    if not source_url:
        raise RuntimeError('SOURCE_DATABASE_URL is missing.')
    if not target_url:
        raise RuntimeError('DATABASE_URL is missing.')

    clone_tables(source_url, target_url, source_schema, target_schema, args.replace)


if __name__ == '__main__':
    main()
