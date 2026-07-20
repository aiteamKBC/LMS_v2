import json
import re
from collections import OrderedDict

from django.db import migrations, models


def clean_str(value):
    return str(value or '').strip()


def slugify(value):
    text = re.sub(r'[^a-z0-9]+', '-', clean_str(value).lower()).strip('-')
    return text or 'group'


def unique(values):
    seen = set()
    result = []
    for value in values:
        item = clean_str(value)
        if item and item not in seen:
            seen.add(item)
            result.append(item)
    return result


def group_table_name(connection):
    return 'curriculum."groups"' if connection.vendor == 'postgresql' else '"groups"'


def module_table_name(connection):
    return 'curriculum."modules"' if connection.vendor == 'postgresql' else '"modules"'


def create_groups_table(apps, schema_editor):
    connection = schema_editor.connection
    json_type = 'jsonb' if connection.vendor == 'postgresql' else 'text'
    timestamp_default = 'current_timestamp'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute('create schema if not exists curriculum')
        cursor.execute(f'''
            create table if not exists {group_table_name(connection)} (
                group_id varchar(128) primary key,
                group_name varchar(500) not null default '',
                cohort_id varchar(128) not null default '',
                cohort_name varchar(500) not null default '',
                programme_id varchar(255) not null default '',
                programme_name varchar(255) not null default '',
                module_ids {json_type},
                module_names {json_type},
                training_plan_ids {json_type},
                coach_name varchar(255),
                tutor_name varchar(255),
                start_date date,
                end_date date,
                schedule varchar(255),
                mode varchar(64) not null default 'Live',
                status varchar(32) not null default 'planned',
                notes text,
                source_type varchar(64) not null default 'training_plan',
                source_id varchar(128),
                created_at timestamp not null default {timestamp_default},
                updated_at timestamp not null default {timestamp_default}
            )
        ''')
        if connection.vendor == 'postgresql':
            cursor.execute(f'alter table {group_table_name(connection)} add column if not exists module_ids {json_type}')
            cursor.execute(f'alter table {group_table_name(connection)} add column if not exists module_names {json_type}')
            cursor.execute(f'alter table {group_table_name(connection)} add column if not exists training_plan_ids {json_type}')
            cursor.execute(f'create index if not exists curriculum_groups_programme_idx on {group_table_name(connection)} (programme_id)')
            cursor.execute(f'create index if not exists curriculum_groups_cohort_idx on {group_table_name(connection)} (cohort_id)')
            cursor.execute(f'create index if not exists curriculum_groups_programme_cohort_idx on {group_table_name(connection)} (programme_id, cohort_id)')
        else:
            cursor.execute(f'create index if not exists curriculum_groups_programme_idx on {group_table_name(connection)} (programme_id)')
            cursor.execute(f'create index if not exists curriculum_groups_cohort_idx on {group_table_name(connection)} (cohort_id)')
            cursor.execute(f'create index if not exists curriculum_groups_programme_cohort_idx on {group_table_name(connection)} (programme_id, cohort_id)')

    backfill_groups_from_modules(connection)


def backfill_groups_from_modules(connection):
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute("select to_regclass('curriculum.modules')")
            if not cursor.fetchone()[0]:
                return
        cursor.execute(f'''
            select
                module_catalogue_id,
                title,
                programme_id,
                programme_name,
                cohort_id,
                cohort_name,
                group_id,
                group_name,
                source_type,
                source_id,
                imported_from_training_plan_id,
                start_date,
                end_date
            from {module_table_name(connection)}
            where coalesce(group_id, '') <> '' or coalesce(group_name, '') <> ''
        ''')
        grouped = OrderedDict()
        for row in cursor.fetchall():
            (
                module_id,
                title,
                programme_id,
                programme_name,
                cohort_id,
                cohort_name,
                group_id,
                group_name,
                source_type,
                source_id,
                imported_from_training_plan_id,
                start_date,
                end_date,
            ) = row
            resolved_group_id = clean_str(group_id) or f'GROUP-{slugify(cohort_id)}-{slugify(group_name)}'.upper()
            group = grouped.setdefault(resolved_group_id, {
                'group_id': resolved_group_id,
                'group_name': clean_str(group_name) or resolved_group_id,
                'cohort_id': clean_str(cohort_id),
                'cohort_name': clean_str(cohort_name),
                'programme_id': clean_str(programme_id),
                'programme_name': clean_str(programme_name),
                'module_ids': [],
                'module_names': [],
                'training_plan_ids': [],
                'source_type': clean_str(source_type) or 'module_authoring',
                'source_id': clean_str(source_id or imported_from_training_plan_id),
                'start_date': start_date,
                'end_date': end_date,
            })
            group['module_ids'].append(module_id)
            group['module_names'].append(title)
            group['training_plan_ids'].append(imported_from_training_plan_id or source_id)
            if start_date and (not group['start_date'] or start_date < group['start_date']):
                group['start_date'] = start_date
            if end_date and (not group['end_date'] or end_date > group['end_date']):
                group['end_date'] = end_date

        for group in grouped.values():
            payload = {
                'group_id': group['group_id'],
                'group_name': group['group_name'],
                'cohort_id': group['cohort_id'],
                'cohort_name': group['cohort_name'],
                'programme_id': group['programme_id'],
                'programme_name': group['programme_name'],
                'module_ids': json.dumps(unique(group['module_ids'])),
                'module_names': json.dumps(unique(group['module_names'])),
                'training_plan_ids': json.dumps(unique(group['training_plan_ids'])),
                'start_date': group['start_date'],
                'end_date': group['end_date'],
                'mode': 'Live',
                'status': 'planned',
                'source_type': group['source_type'],
                'source_id': group['source_id'],
            }
            columns = list(payload)
            placeholders = ', '.join(['%s'] * len(columns))
            if connection.vendor == 'postgresql':
                assignments = ', '.join(
                    f'"{column}" = excluded."{column}"'
                    for column in columns
                    if column != 'group_id'
                )
                cursor.execute(
                    f'''
                    insert into {group_table_name(connection)}
                    ({', '.join(f'"{column}"' for column in columns)})
                    values ({placeholders})
                    on conflict (group_id) do update set {assignments}, updated_at = current_timestamp
                    ''',
                    [payload[column] for column in columns],
                )
            else:
                cursor.execute(
                    f'''
                    insert or replace into {group_table_name(connection)}
                    ({', '.join(f'"{column}"' for column in columns)})
                    values ({placeholders})
                    ''',
                    [payload[column] for column in columns],
                )


def drop_groups_table(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute(f'drop table if exists {group_table_name(schema_editor.connection)}')


class Migration(migrations.Migration):
    dependencies = [
        ('curriculum_api', '0004_rename_selected_curriculum_tables'),
    ]

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(create_groups_table, drop_groups_table),
            ],
            state_operations=[
                migrations.CreateModel(
                    name='CurriculumGroup',
                    fields=[
                        ('group_id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('group_name', models.CharField(blank=True, default='', max_length=500)),
                        ('cohort_id', models.CharField(blank=True, default='', max_length=128)),
                        ('cohort_name', models.CharField(blank=True, default='', max_length=500)),
                        ('programme_id', models.CharField(blank=True, default='', max_length=255)),
                        ('programme_name', models.CharField(blank=True, default='', max_length=255)),
                        ('module_ids', models.JSONField(blank=True, default=list)),
                        ('module_names', models.JSONField(blank=True, default=list)),
                        ('training_plan_ids', models.JSONField(blank=True, default=list)),
                        ('coach_name', models.CharField(blank=True, default='', max_length=255)),
                        ('tutor_name', models.CharField(blank=True, default='', max_length=255)),
                        ('start_date', models.DateField(blank=True, null=True)),
                        ('end_date', models.DateField(blank=True, null=True)),
                        ('schedule', models.CharField(blank=True, default='', max_length=255)),
                        ('mode', models.CharField(default='Live', max_length=64)),
                        ('status', models.CharField(default='planned', max_length=32)),
                        ('notes', models.TextField(blank=True, default='')),
                        ('source_type', models.CharField(default='training_plan', max_length=64)),
                        ('source_id', models.CharField(blank=True, default='', max_length=128)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={
                        'db_table': 'curriculum"."groups',
                        'managed': False,
                    },
                ),
            ],
        ),
    ]
