from django.db import migrations, models


SCHEMA = 'programme_audit'
TABLE = 'assets'


def quote_ident(value):
    return '"' + str(value).replace('"', '""') + '"'


def qualified(table):
    return f'{quote_ident(SCHEMA)}.{quote_ident(table)}'


def create_programme_audit_assets(apps, schema_editor):
    connection = schema_editor.connection
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    default_json_object = "'{}'::jsonb" if connection.vendor == 'postgresql' else "'{}'"
    default_json_array = "'[]'::jsonb" if connection.vendor == 'postgresql' else "'[]'"
    table = qualified(TABLE) if connection.vendor == 'postgresql' else quote_ident('programme_audit_assets')
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(f'create schema if not exists {quote_ident(SCHEMA)}')
        cursor.execute(f'''
            create table if not exists {table} (
                id varchar(64) primary key,
                programme_id varchar(255) not null,
                programme_source_id varchar(255) not null default '',
                programme_name varchar(500) not null default '',
                module_catalogue_id varchar(128) not null default '',
                module_title varchar(500) not null default '',
                week_id varchar(128) not null default '',
                week_number integer,
                week_title varchar(500) not null default '',
                component_id varchar(128) not null default '',
                component_type varchar(64) not null default '',
                content_kind varchar(64) not null default '',
                title varchar(500) not null default '',
                description text not null default '',
                source_url text not null default '',
                embed_url text not null default '',
                embed_code text not null default '',
                render_mode varchar(64) not null default '',
                file_name varchar(500) not null default '',
                content_type varchar(255) not null default '',
                file_size bigint,
                duration_minutes integer,
                expected_otjh numeric(8, 2),
                points integer,
                status varchar(64) not null default '',
                ksb_mappings {json_type} not null default {default_json_array},
                settings {json_type} not null default {default_json_object},
                raw_component {json_type} not null default {default_json_object},
                raw_payload {json_type} not null default {default_json_object},
                imported_from varchar(255) not null default '',
                source_key varchar(512) not null default '',
                imported_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp
            )
        ''')
        cursor.execute(f'create index if not exists programme_audit_assets_programme_idx on {table} (programme_id)')
        cursor.execute(f'create index if not exists programme_audit_assets_component_idx on {table} (component_id)')
        cursor.execute(f'create index if not exists programme_audit_assets_kind_idx on {table} (content_kind)')
        cursor.execute(f'create index if not exists programme_audit_assets_module_idx on {table} (module_catalogue_id)')
        if connection.vendor == 'postgresql':
            cursor.execute(f'''
                create unique index if not exists programme_audit_assets_source_key_idx
                on {table} (source_key)
                where source_key <> ''
            ''')


def drop_programme_audit_assets(apps, schema_editor):
    connection = schema_editor.connection
    table = qualified(TABLE) if connection.vendor == 'postgresql' else quote_ident('programme_audit_assets')
    with connection.cursor() as cursor:
        cursor.execute(f'drop table if exists {table}')
        if connection.vendor == 'postgresql':
            cursor.execute(f'drop schema if exists {quote_ident(SCHEMA)}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0055_recording_events_artifact_fk_cascade'),
        ('curriculum_api', '0054_component_reflection_question'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(create_programme_audit_assets, drop_programme_audit_assets),
            ],
            state_operations=[
                migrations.CreateModel(
                    name='ProgrammeAuditAsset',
                    fields=[
                        ('id', models.CharField(max_length=64, primary_key=True, serialize=False)),
                        ('programme_id', models.CharField(db_index=True, max_length=255)),
                        ('programme_source_id', models.CharField(blank=True, default='', max_length=255)),
                        ('programme_name', models.CharField(blank=True, default='', max_length=500)),
                        ('module_catalogue_id', models.CharField(blank=True, db_index=True, default='', max_length=128)),
                        ('module_title', models.CharField(blank=True, default='', max_length=500)),
                        ('week_id', models.CharField(blank=True, db_index=True, default='', max_length=128)),
                        ('week_number', models.IntegerField(blank=True, null=True)),
                        ('week_title', models.CharField(blank=True, default='', max_length=500)),
                        ('component_id', models.CharField(blank=True, db_index=True, default='', max_length=128)),
                        ('component_type', models.CharField(blank=True, default='', max_length=64)),
                        ('content_kind', models.CharField(blank=True, db_index=True, default='', max_length=64)),
                        ('title', models.CharField(blank=True, default='', max_length=500)),
                        ('description', models.TextField(blank=True, default='')),
                        ('source_url', models.TextField(blank=True, default='')),
                        ('embed_url', models.TextField(blank=True, default='')),
                        ('embed_code', models.TextField(blank=True, default='')),
                        ('render_mode', models.CharField(blank=True, default='', max_length=64)),
                        ('file_name', models.CharField(blank=True, default='', max_length=500)),
                        ('content_type', models.CharField(blank=True, default='', max_length=255)),
                        ('file_size', models.BigIntegerField(blank=True, null=True)),
                        ('duration_minutes', models.IntegerField(blank=True, null=True)),
                        ('expected_otjh', models.DecimalField(blank=True, decimal_places=2, max_digits=8, null=True)),
                        ('points', models.IntegerField(blank=True, null=True)),
                        ('status', models.CharField(blank=True, default='', max_length=64)),
                        ('ksb_mappings', models.JSONField(blank=True, default=list)),
                        ('settings', models.JSONField(blank=True, default=dict)),
                        ('raw_component', models.JSONField(blank=True, default=dict)),
                        ('raw_payload', models.JSONField(blank=True, default=dict)),
                        ('imported_from', models.CharField(blank=True, default='', max_length=255)),
                        ('source_key', models.CharField(blank=True, default='', max_length=512)),
                        ('imported_at', models.DateTimeField(blank=True, null=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'programme_audit"."assets', 'managed': False},
                ),
            ],
        ),
    ]
