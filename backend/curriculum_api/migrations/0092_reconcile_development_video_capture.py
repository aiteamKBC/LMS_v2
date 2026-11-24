"""Verify the installed status-aware video capture; never reinstall the retired function.

Frozen baseline of the approved independent architecture (2026-11-23).
SELECT-only: no repair, provisioning, historical backfill or reverse rewrite.
Requires a pre-provisioned canonical PostgreSQL schema. Empty databases fail
closed; these replacements are NOT a bootstrap for the externally owned LMS.
Run preflight explicitly even when the original migration is recorded: Django
then skips this replacement's operations. See migration_reconciliation.md.
"""
from django.db import migrations, models
import django.utils.timezone


# Catalog-only contract: no learner values. Function fingerprints deliberately
# fail on definition drift; review it instead of silently replacing a function.
CHECKS = [('public.curriculum_video_change columns',
  'SELECT a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,\n'
  '    a.attgenerated, pg_get_expr(d.adbin,d.adrelid)\n'
  'FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum\n'
  'WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname',
  ('public.curriculum_video_change',),
  [('attempts', 'integer', True, '', None),
   ('available_at', 'timestamp with time zone', True, '', None),
   ('component_id', 'character varying(128)', True, '', None),
   ('created_at', 'timestamp with time zone', True, '', None),
   ('error', 'text', True, '', None),
   ('id', 'bigint', True, '', None),
   ('previous_settings', 'jsonb', True, '', None),
   ('settings', 'jsonb', True, '', None),
   ('target_id', 'character varying(128)', True, '', None),
   ('target_kind', 'character varying(16)', True, '', None)]),
 ('public.curriculum_video_change constraints',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname',
  ('public.curriculum_video_change',),
  [('curriculum_video_change_attempts_check', 'CHECK ((attempts >= 0))', True),
   ('curriculum_video_change_attempts_not_null', 'NOT NULL attempts', True),
   ('curriculum_video_change_available_at_not_null', 'NOT NULL available_at', True),
   ('curriculum_video_change_component_id_not_null', 'NOT NULL component_id', True),
   ('curriculum_video_change_created_at_not_null', 'NOT NULL created_at', True),
   ('curriculum_video_change_error_not_null', 'NOT NULL error', True),
   ('curriculum_video_change_id_not_null', 'NOT NULL id', True),
   ('curriculum_video_change_pkey', 'PRIMARY KEY (id)', True),
   ('curriculum_video_change_previous_settings_not_null', 'NOT NULL previous_settings', True),
   ('curriculum_video_change_settings_not_null', 'NOT NULL settings', True),
   ('curriculum_video_change_target_id_not_null', 'NOT NULL target_id', True),
   ('curriculum_video_change_target_kind_not_null', 'NOT NULL target_kind', True)]),
 ('public.curriculum_video_change indexes',
  'SELECT ci.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready\n'
  'FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid\n'
  'WHERE i.indrelid=to_regclass(%s) ORDER BY ci.relname',
  ('public.curriculum_video_change',),
  [('curriculum_video_change_available_at_4be3ea4e',
    'CREATE INDEX curriculum_video_change_available_at_4be3ea4e ON public.curriculum_video_change USING '
    'btree (available_at)',
    True,
    True),
   ('curriculum_video_change_pkey',
    'CREATE UNIQUE INDEX curriculum_video_change_pkey ON public.curriculum_video_change USING btree (id)',
    True,
    True)]),
 ('components video trigger',
  'SELECT tgname,pg_get_triggerdef(oid),tgenabled FROM pg_trigger\n'
  'WHERE tgrelid=to_regclass(%s) AND NOT tgisinternal AND tgname=%s ORDER BY tgname',
  ('curriculum.components', 'bunny_video_source_changed'),
  [('bunny_video_source_changed',
    'CREATE TRIGGER bunny_video_source_changed AFTER INSERT OR UPDATE ON curriculum.components FOR EACH '
    "ROW EXECUTE FUNCTION curriculum.capture_bunny_video_change('module', 'module_catalogue_id')",
    'O')]),
 ('week_template_components video trigger',
  'SELECT tgname,pg_get_triggerdef(oid),tgenabled FROM pg_trigger\n'
  'WHERE tgrelid=to_regclass(%s) AND NOT tgisinternal AND tgname=%s ORDER BY tgname',
  ('curriculum.week_template_components', 'bunny_video_source_changed'),
  [('bunny_video_source_changed',
    'CREATE TRIGGER bunny_video_source_changed AFTER INSERT OR UPDATE ON '
    'curriculum.week_template_components FOR EACH ROW EXECUTE FUNCTION '
    "curriculum.capture_bunny_video_change('template', 'week_template_id')",
    'O')]),
 ('status-aware video function',
  'SELECT md5(pg_get_functiondef(to_regprocedure(%s)))',
  ('curriculum.capture_bunny_video_change()',),
  [('8469c91584b3830970948621ef7886ff',)])]


def validate(apps, schema_editor):
    database = schema_editor.connection
    if database.vendor != 'postgresql' or database.alias != 'default':
        raise RuntimeError('Canonical PostgreSQL default schema required; no bootstrap is provided.')
    with database.cursor() as cursor:
        for label, sql, params, expected in CHECKS:
            cursor.execute(sql, params)
            if cursor.fetchall() != expected:
                raise RuntimeError('Canonical baseline mismatch: ' + label +
                                   '. Preserve data and reconcile explicitly; do not replay the replaced migration.')


class Migration(migrations.Migration):
    replaces = [('curriculum_api', '0078_curriculum_video_changes')]
    dependencies = [('curriculum_api', '0077_curriculum_video_import')]
    operations = [migrations.RunPython(validate), migrations.SeparateDatabaseAndState(
        state_operations=[migrations.CreateModel(
            name='CurriculumVideoChange',
            fields=[
                ('id', models.BigAutoField(primary_key=True, serialize=False, auto_created=True, verbose_name='ID')),
                ('target_kind', models.CharField(max_length=16)),
                ('target_id', models.CharField(max_length=128)),
                ('component_id', models.CharField(max_length=128)),
                ('previous_settings', models.JSONField(default=dict)),
                ('settings', models.JSONField(default=dict)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('available_at', models.DateTimeField(default=django.utils.timezone.now, db_index=True)),
                ('attempts', models.PositiveIntegerField(default=0)),
                ('error', models.TextField(blank=True, default='')),
            ],
            options={'db_table': 'curriculum_video_change'},
        )],
    )]
