from django.db import migrations, models


def table_name(connection, table):
    return f'curriculum."{table}"' if connection.vendor == 'postgresql' else f'"{table}"'


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


def create_staff_profile_tables(apps, schema_editor):
    connection = schema_editor.connection
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('create schema if not exists curriculum')
        create_staff_table(cursor, connection, 'coaches')
        create_staff_table(cursor, connection, 'tutors')


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
