import json
import re

from django.db import migrations, models


def clean_str(value):
    return str(value or '').strip()


def slugify(value):
    text = re.sub(r'[^a-z0-9]+', '-', clean_str(value).lower()).strip('-')
    return text or 'staff'


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


def table_exists(cursor, connection, table):
    if connection.vendor == 'postgresql':
        cursor.execute('select to_regclass(%s)', [f'curriculum.{table}'])
        return bool(cursor.fetchone()[0])
    cursor.execute("select name from sqlite_master where type='table' and name=%s", [table])
    return bool(cursor.fetchone())


def create_staff_table(cursor, connection, table):
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    timestamp_default = 'current_timestamp'
    cursor.execute(f'''
        create table if not exists {table_name(connection, table)} (
            id varchar(128) primary key,
            name varchar(255) not null,
            email varchar(255) not null default '',
            phone varchar(64) not null default '',
            job_title varchar(255) not null default '',
            status varchar(32) not null default 'active',
            specialisms {json_type},
            assigned_module_ids {json_type},
            notes text not null default '',
            is_archived boolean not null default false,
            created_at timestamp not null default {timestamp_default},
            updated_at timestamp not null default {timestamp_default}
        )
    ''')
    if connection.vendor == 'postgresql':
        cursor.execute(f'alter table {table_name(connection, table)} add column if not exists specialisms {json_type}')
        cursor.execute(f'alter table {table_name(connection, table)} add column if not exists assigned_module_ids {json_type}')
    cursor.execute(f'create index if not exists curriculum_{table}_name_idx on {table_name(connection, table)} (name)')
    cursor.execute(f'create index if not exists curriculum_{table}_status_idx on {table_name(connection, table)} (status)')


def copy_legacy_profiles(cursor, connection, target_table, legacy_table):
    if not table_exists(cursor, connection, legacy_table):
        return
    cursor.execute(f'select * from {table_name(connection, legacy_table)}')
    columns = [col[0] for col in cursor.description]
    for source_row in cursor.fetchall():
        row = dict(zip(columns, source_row))
        name = clean_str(row.get('name') or row.get('Tutor_name') or row.get('Coach_name') or row.get('email'))
        if not name:
            continue
        profile_id = clean_str(row.get('id')) or f'{target_table[:-1]}-{slugify(name)}'
        payload = {
            'id': profile_id,
            'name': name,
            'email': clean_str(row.get('email')),
            'phone': clean_str(row.get('phone') or row.get('telephone')),
            'job_title': clean_str(row.get('job_title') or row.get('role') or row.get('title')),
            'status': clean_str(row.get('status')) or 'active',
            'specialisms': json.dumps([]),
            'assigned_module_ids': json.dumps([]),
            'notes': clean_str(row.get('notes')),
            'is_archived': False,
        }
        insert_profile(cursor, connection, target_table, payload)


def insert_profile(cursor, connection, table, payload):
    columns = list(payload)
    placeholders = ', '.join(['%s'] * len(columns))
    if connection.vendor == 'postgresql':
        assignments = ', '.join(
            f'"{column}" = excluded."{column}"'
            for column in columns
            if column != 'id'
        )
        cursor.execute(
            f'''
            insert into {table_name(connection, table)}
            ({', '.join(f'"{column}"' for column in columns)})
            values ({placeholders})
            on conflict (id) do update set {assignments}, updated_at = current_timestamp
            ''',
            [payload[column] for column in columns],
        )
    else:
        cursor.execute(
            f'''
            insert or replace into {table_name(connection, table)}
            ({', '.join(f'"{column}"' for column in columns)})
            values ({placeholders})
            ''',
            [payload[column] for column in columns],
        )


def create_staff_profile_tables(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('create schema if not exists curriculum')
        create_staff_table(cursor, connection, 'coaches')
        create_staff_table(cursor, connection, 'tutors')
        copy_legacy_profiles(cursor, connection, 'coaches', 'coach_profiles')
        copy_legacy_profiles(cursor, connection, 'tutors', 'tutor_profiles')


def drop_staff_profile_tables(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        cursor.execute(f'drop table if exists {table_name(connection, "coaches")}')
        cursor.execute(f'drop table if exists {table_name(connection, "tutors")}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0007_remove_workplace_evidence_components'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(create_staff_profile_tables, drop_staff_profile_tables),
            ],
            state_operations=[
                migrations.CreateModel(
                    name='Coach',
                    fields=[
                        ('id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('name', models.CharField(max_length=255)),
                        ('email', models.CharField(blank=True, default='', max_length=255)),
                        ('phone', models.CharField(blank=True, default='', max_length=64)),
                        ('job_title', models.CharField(blank=True, default='', max_length=255)),
                        ('status', models.CharField(default='active', max_length=32)),
                        ('specialisms', models.JSONField(blank=True, default=list)),
                        ('assigned_module_ids', models.JSONField(blank=True, default=list)),
                        ('notes', models.TextField(blank=True, default='')),
                        ('is_archived', models.BooleanField(default=False)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        'db_table': 'curriculum"."coaches',
                        'managed': False,
                    },
                ),
                migrations.CreateModel(
                    name='Tutor',
                    fields=[
                        ('id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('name', models.CharField(max_length=255)),
                        ('email', models.CharField(blank=True, default='', max_length=255)),
                        ('phone', models.CharField(blank=True, default='', max_length=64)),
                        ('job_title', models.CharField(blank=True, default='', max_length=255)),
                        ('status', models.CharField(default='active', max_length=32)),
                        ('specialisms', models.JSONField(blank=True, default=list)),
                        ('assigned_module_ids', models.JSONField(blank=True, default=list)),
                        ('notes', models.TextField(blank=True, default='')),
                        ('is_archived', models.BooleanField(default=False)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        'db_table': 'curriculum"."tutors',
                        'managed': False,
                    },
                ),
            ],
        ),
    ]
