from django.db import migrations, models


def add_ksb_mapping_source_metadata(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('create schema if not exists curriculum')
        cursor.execute('alter table if exists curriculum.module_authoring_ksb_mappings add column if not exists classification varchar(32) not null default %s', ['secondary'])
        cursor.execute('alter table if exists curriculum.module_authoring_ksb_mappings add column if not exists weight numeric(5,2) not null default 0')
        cursor.execute('alter table if exists curriculum.module_authoring_ksb_mappings add column if not exists source_type varchar(32)')
        cursor.execute('alter table if exists curriculum.module_authoring_ksb_mappings add column if not exists source_id varchar(255)')
        cursor.execute("select to_regclass('curriculum.module_authoring_ksb_mappings')")
        if not cursor.fetchone()[0]:
            return
        cursor.execute('''
            create index if not exists curriculum_ksb_mapping_component_lookup_idx
            on curriculum.module_authoring_ksb_mappings (component_id, ksb_code, source_type, source_id)
        ''')
        cursor.execute('''
            create index if not exists curriculum_ksb_mapping_module_idx
            on curriculum.module_authoring_ksb_mappings (module_catalogue_id)
        ''')
        cursor.execute('''
            create index if not exists curriculum_ksb_mapping_week_idx
            on curriculum.module_authoring_ksb_mappings (week_id)
        ''')
        cursor.execute('''
            create index if not exists curriculum_ksb_mapping_component_idx
            on curriculum.module_authoring_ksb_mappings (component_id)
        ''')
        cursor.execute('''
            select component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, ''), count(*)
            from curriculum.module_authoring_ksb_mappings
            where component_id is not null and component_id <> ''
            group by component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, '')
            having count(*) > 1
            limit 1
        ''')
        duplicate = cursor.fetchone()
        if duplicate:
            raise RuntimeError(
                'Cannot create curriculum component KSB uniqueness index because legacy duplicates exist. '
                f'First duplicate key: component={duplicate[0]}, ksb_code={duplicate[1]}, source_type={duplicate[2]}, source_id={duplicate[3]}. '
                'Merge or archive the duplicate rows, then rerun migrations.'
            )
        cursor.execute('''
            create unique index if not exists curriculum_ksb_mapping_component_unique_idx
            on curriculum.module_authoring_ksb_mappings
            (component_id, upper(ksb_code), coalesce(source_type, ''), coalesce(source_id, ''))
            where component_id is not null and component_id <> ''
        ''')


def remove_ksb_mapping_source_metadata(apps, schema_editor):
    if schema_editor.connection.vendor != 'postgresql':
        return
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('drop index if exists curriculum.curriculum_ksb_mapping_component_unique_idx')
        cursor.execute('drop index if exists curriculum.curriculum_ksb_mapping_component_idx')
        cursor.execute('drop index if exists curriculum.curriculum_ksb_mapping_week_idx')
        cursor.execute('drop index if exists curriculum.curriculum_ksb_mapping_module_idx')
        cursor.execute('drop index if exists curriculum.curriculum_ksb_mapping_component_lookup_idx')


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.SeparateDatabaseAndState(
            database_operations=[
                migrations.RunPython(add_ksb_mapping_source_metadata, remove_ksb_mapping_source_metadata),
            ],
            state_operations=[
                migrations.CreateModel(
                    name='ModuleAuthoringModule',
                    fields=[
                        ('module_catalogue_id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('programme_id', models.CharField(blank=True, default='', max_length=255)),
                        ('programme_name', models.CharField(blank=True, default='', max_length=255)),
                        ('cohort_id', models.CharField(blank=True, default='', max_length=255)),
                        ('cohort_name', models.CharField(blank=True, default='', max_length=255)),
                        ('group_id', models.CharField(blank=True, default='', max_length=255)),
                        ('group_name', models.CharField(blank=True, default='', max_length=255)),
                        ('title', models.CharField(max_length=500)),
                        ('description', models.TextField(blank=True, default='')),
                        ('status', models.CharField(default='draft', max_length=32)),
                        ('total_otjh', models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                        ('quality_score', models.IntegerField(default=0)),
                        ('source_type', models.CharField(blank=True, default='', max_length=64)),
                        ('source_id', models.CharField(blank=True, default='', max_length=128)),
                        ('imported_from_training_plan_id', models.CharField(blank=True, default='', max_length=128)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'curriculum"."modules', 'managed': False},
                ),
                migrations.CreateModel(
                    name='ModuleAuthoringWeek',
                    fields=[
                        ('id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('module_catalogue_id', models.CharField(db_index=True, max_length=128)),
                        ('week_number', models.IntegerField(default=1)),
                        ('title', models.CharField(blank=True, default='', max_length=500)),
                        ('summary', models.TextField(blank=True, default='')),
                        ('learning_outcomes', models.JSONField(blank=True, default=list)),
                        ('display_order', models.IntegerField(default=0)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'curriculum"."module_authoring_weeks', 'managed': False},
                ),
                migrations.CreateModel(
                    name='ModuleAuthoringComponent',
                    fields=[
                        ('id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('week_id', models.CharField(db_index=True, max_length=128)),
                        ('module_catalogue_id', models.CharField(db_index=True, max_length=128)),
                        ('type', models.CharField(choices=[('live_session', 'Live session'), ('video', 'Video'), ('podcast', 'Podcast'), ('reading', 'Reading'), ('quiz', 'Quiz'), ('reflection', 'Reflection'), ('workplace_evidence', 'Workplace evidence'), ('assignment', 'Assignment'), ('checkpoint', 'Checkpoint')], max_length=64)),
                        ('title', models.CharField(blank=True, default='', max_length=500)),
                        ('description', models.TextField(blank=True, default='')),
                        ('expected_otjh', models.DecimalField(decimal_places=2, default=0, max_digits=8)),
                        ('points', models.IntegerField(default=0)),
                        ('reflection_required', models.BooleanField(default=False)),
                        ('workplace_evidence_required', models.BooleanField(default=False)),
                        ('tutor_validation_required', models.BooleanField(default=False)),
                        ('display_order', models.IntegerField(default=0)),
                        ('settings_json', models.JSONField(blank=True, default=dict)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'curriculum"."components', 'managed': False},
                ),
                migrations.CreateModel(
                    name='ModuleAuthoringKsbMapping',
                    fields=[
                        ('id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('module_catalogue_id', models.CharField(db_index=True, max_length=128)),
                        ('week_id', models.CharField(blank=True, db_index=True, max_length=128, null=True)),
                        ('component_id', models.CharField(blank=True, db_index=True, max_length=128, null=True)),
                        ('ksb_id', models.CharField(blank=True, max_length=255, null=True)),
                        ('ksb_code', models.CharField(max_length=64)),
                        ('ksb_description', models.TextField(blank=True, default='')),
                        ('source_type', models.CharField(blank=True, default='', max_length=32)),
                        ('source_id', models.CharField(blank=True, default='', max_length=255)),
                        ('classification', models.CharField(choices=[('main', 'Main'), ('secondary', 'Secondary'), ('possible', 'Possible'), ('practice', 'Practice (legacy)')], default='secondary', max_length=32)),
                        ('weight', models.DecimalField(decimal_places=2, default=0, max_digits=5)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'curriculum"."module_authoring_ksb_mappings', 'managed': False},
                ),
                migrations.CreateModel(
                    name='ModuleAuthoringCompletionCriteria',
                    fields=[
                        ('module_catalogue_id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('quizzes_completed_required', models.BooleanField(default=False)),
                        ('checkpoints_completed_required', models.BooleanField(default=False)),
                        ('average_score_required_enabled', models.BooleanField(default=False)),
                        ('average_score_required', models.IntegerField(default=70)),
                        ('total_score_required_enabled', models.BooleanField(default=False)),
                        ('total_score_required', models.IntegerField(default=100)),
                        ('additional_notes', models.TextField(blank=True, default='')),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'curriculum"."module_authoring_completion_criteria', 'managed': False},
                ),
                migrations.CreateModel(
                    name='ModuleAuthoringAdvancedDetails',
                    fields=[
                        ('module_catalogue_id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('background', models.TextField(blank=True, default='')),
                        ('epa_requirements', models.JSONField(blank=True, default=list)),
                        ('professional_qualification_outcomes', models.JSONField(blank=True, default=list)),
                        ('intent', models.TextField(blank=True, default='')),
                        ('learner_benefit', models.TextField(blank=True, default='')),
                        ('employer_benefit', models.TextField(blank=True, default='')),
                        ('sequence_purpose', models.TextField(blank=True, default='')),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'curriculum"."module_authoring_advanced_details', 'managed': False},
                ),
                migrations.CreateModel(
                    name='CohortAuthoringDetails',
                    fields=[
                        ('cohort_id', models.CharField(max_length=128, primary_key=True, serialize=False)),
                        ('cohort_name', models.CharField(blank=True, default='', max_length=500)),
                        ('programme_id', models.CharField(blank=True, default='', max_length=255)),
                        ('programme_name', models.CharField(blank=True, default='', max_length=255)),
                        ('start_date', models.DateField(blank=True, null=True)),
                        ('end_date', models.DateField(blank=True, null=True)),
                        ('duration_months', models.IntegerField(default=0)),
                        ('color', models.CharField(blank=True, default='', max_length=32)),
                        ('status', models.CharField(default='planned', max_length=32)),
                        ('training_plan_ids', models.JSONField(blank=True, default=list)),
                        ('group_ids', models.JSONField(blank=True, default=list)),
                        ('module_names', models.JSONField(blank=True, default=list)),
                        ('holiday_ids', models.JSONField(blank=True, default=list)),
                        ('selected_holidays', models.JSONField(blank=True, default=list)),
                        ('holidays_in_range', models.JSONField(blank=True, default=list)),
                        ('holiday_summary', models.JSONField(blank=True, default=dict)),
                        ('notes', models.TextField(blank=True, default='')),
                        ('source_type', models.CharField(default='training_plan', max_length=64)),
                        ('source_id', models.CharField(blank=True, default='', max_length=128)),
                        ('created_at', models.DateTimeField(auto_now_add=True)),
                        ('updated_at', models.DateTimeField(auto_now=True)),
                    ],
                    options={'db_table': 'curriculum"."cohort_authoring_details', 'managed': False},
                ),
            ],
        ),
    ]
