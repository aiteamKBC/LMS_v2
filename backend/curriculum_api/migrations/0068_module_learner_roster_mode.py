from django.db import migrations


def add_learner_roster_mode(apps, schema_editor):
    connection = schema_editor.connection
    table = 'curriculum.modules' if connection.vendor == 'postgresql' else 'modules'
    with connection.cursor() as cursor:
        if connection.vendor == 'postgresql':
            cursor.execute(
                f"alter table {table} add column if not exists learner_roster_mode varchar(32) not null default 'inherited'"
            )
            cursor.execute(
                f"alter table {table} add column if not exists teams_shared_source_module_id varchar(128)"
            )
        else:
            cursor.execute(f'pragma table_info({table})')
            columns = {row[1] for row in cursor.fetchall()}
            if columns and 'learner_roster_mode' not in columns:
                cursor.execute(
                    f"alter table {table} add column learner_roster_mode varchar(32) not null default 'inherited'"
                )
            if columns and 'teams_shared_source_module_id' not in columns:
                cursor.execute(
                    f"alter table {table} add column teams_shared_source_module_id varchar(128)"
                )
        relation_table = 'curriculum.module_teams_shares' if connection.vendor == 'postgresql' else 'module_teams_shares'
        cursor.execute(
            f'''create table if not exists {relation_table} (
                module_catalogue_id varchar(128) primary key,
                source_module_catalogue_id varchar(128) not null,
                created_at timestamp not null default current_timestamp,
                updated_at timestamp not null default current_timestamp,
                foreign key (module_catalogue_id) references {table} (module_catalogue_id) on delete cascade,
                foreign key (source_module_catalogue_id) references {table} (module_catalogue_id) on delete restrict
            )'''
        )
        cursor.execute(
            f'create index if not exists curriculum_module_teams_shares_source_idx '
            f'on {relation_table} (source_module_catalogue_id)'
        )


class Migration(migrations.Migration):
    dependencies = [('curriculum_api', '0067_livesessionabsence_livesessionattendancealias_and_more')]
    operations = [migrations.RunPython(add_learner_roster_mode, migrations.RunPython.noop)]
