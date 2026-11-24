"""Validate the completed independent cutover without copying or deleting any history.

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
CHECKS = [('retired bridge columns absent',
  'SELECT table_name,column_name FROM information_schema.columns\n'
  "WHERE table_schema='curriculum' AND table_name IN "
  "('free_courses','free_course_weeks','free_programme_components')\n"
  'AND column_name IN '
  "('module_catalogue_id','authoring_week_id','authoring_component_id','content_ref','authoring_data','storage_version','week_title') "
  'ORDER BY 1,2',
  (),
  []),
 ('retired bridge functions/views absent',
  "SELECT 'function',p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace\n"
  "WHERE n.nspname='curriculum' AND (p.proname LIKE 'refresh_free_course%%' OR p.proname LIKE "
  "'mirror_free_course%%')\n"
  "UNION ALL SELECT 'view',table_name FROM information_schema.views\n"
  "WHERE table_schema='curriculum' AND table_name LIKE 'learning_%%' ORDER BY 1,2",
  (),
  []),
 ('curriculum.free_course_weeks columns',
  'SELECT a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,\n'
  '    a.attgenerated, pg_get_expr(d.adbin,d.adrelid)\n'
  'FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum\n'
  'WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname',
  ('curriculum.free_course_weeks',),
  [('active_display_order',
    'integer',
    False,
    's',
    '\nCASE\n    WHEN (deleted_at IS NULL) THEN display_order\n    ELSE NULL::integer\nEND'),
   ('component_count', 'integer', True, '', '0'),
   ('course_id', 'character varying(128)', True, '', None),
   ('created_at', 'timestamp without time zone', True, '', 'CURRENT_TIMESTAMP'),
   ('deleted_at', 'timestamp with time zone', False, '', None),
   ('display_order', 'integer', True, '', '0'),
   ('holiday_note', 'text', False, '', None),
   ('holiday_note_enabled', 'boolean', True, '', None),
   ('id', 'character varying(128)', True, '', None),
   ('learning_outcomes', 'jsonb', False, '', None),
   ('legacy_copied_from_week_id', 'character varying', False, '', None),
   ('status', 'character varying', True, '', None),
   ('summary', 'text', False, '', None),
   ('title', 'text', True, '', None),
   ('total_otjh', 'numeric(8,2)', True, '', '0'),
   ('updated_at', 'timestamp without time zone', True, '', 'CURRENT_TIMESTAMP'),
   ('week_number', 'integer', True, '', None)]),
 ('curriculum.free_course_weeks constraints',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname',
  ('curriculum.free_course_weeks',),
  [('free_course_weeks_component_count_not_null', 'NOT NULL component_count', True),
   ('free_course_weeks_course_display_order_uniq',
    'UNIQUE (course_id, active_display_order) DEFERRABLE INITIALLY DEFERRED',
    True),
   ('free_course_weeks_course_id_fkey',
    'FOREIGN KEY (course_id) REFERENCES curriculum.free_courses(id) ON UPDATE RESTRICT ON DELETE RESTRICT',
    True),
   ('free_course_weeks_course_id_not_null', 'NOT NULL course_id', True),
   ('free_course_weeks_created_at_not_null', 'NOT NULL created_at', True),
   ('free_course_weeks_display_order_not_null', 'NOT NULL display_order', True),
   ('free_course_weeks_holiday_note_enabled_not_null', 'NOT NULL holiday_note_enabled', True),
   ('free_course_weeks_id_course_unique', 'UNIQUE (id, course_id)', True),
   ('free_course_weeks_id_not_null', 'NOT NULL id', True),
   ('free_course_weeks_number_positive_chk', 'CHECK (((week_number IS NULL) OR (week_number >= 1)))', True),
   ('free_course_weeks_pkey', 'PRIMARY KEY (id)', True),
   ('free_course_weeks_status_chk',
    "CHECK (((status IS NULL) OR ((status)::text = ANY ((ARRAY['active'::character varying, "
    "'inactive'::character varying])::text[]))))",
    True),
   ('free_course_weeks_status_not_null', 'NOT NULL status', True),
   ('free_course_weeks_title_chk', 'CHECK (((title IS NULL) OR (length(btrim(title)) > 0)))', True),
   ('free_course_weeks_title_not_null', 'NOT NULL title', True),
   ('free_course_weeks_total_otjh_not_null', 'NOT NULL total_otjh', True),
   ('free_course_weeks_updated_at_not_null', 'NOT NULL updated_at', True),
   ('free_course_weeks_week_number_not_null', 'NOT NULL week_number', True)]),
 ('curriculum.free_course_weeks indexes',
  'SELECT ci.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready\n'
  'FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid\n'
  'WHERE i.indrelid=to_regclass(%s) ORDER BY ci.relname',
  ('curriculum.free_course_weeks',),
  [('curriculum_free_course_weeks_course_idx',
    'CREATE INDEX curriculum_free_course_weeks_course_idx ON curriculum.free_course_weeks USING btree '
    '(course_id)',
    True,
    True),
   ('free_course_weeks_course_display_order_uniq',
    'CREATE UNIQUE INDEX free_course_weeks_course_display_order_uniq ON curriculum.free_course_weeks USING '
    'btree (course_id, active_display_order)',
    True,
    True),
   ('free_course_weeks_id_course_unique',
    'CREATE UNIQUE INDEX free_course_weeks_id_course_unique ON curriculum.free_course_weeks USING btree '
    '(id, course_id)',
    True,
    True),
   ('free_course_weeks_pkey',
    'CREATE UNIQUE INDEX free_course_weeks_pkey ON curriculum.free_course_weeks USING btree (id)',
    True,
    True),
   ('idx_free_course_weeks_course_order',
    'CREATE INDEX idx_free_course_weeks_course_order ON curriculum.free_course_weeks USING btree '
    '(course_id, display_order, id)',
    True,
    True)]),
 ('curriculum.free_programme_components columns',
  'SELECT a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,\n'
  '    a.attgenerated, pg_get_expr(d.adbin,d.adrelid)\n'
  'FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum\n'
  'WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname',
  ('curriculum.free_programme_components',),
  [('active_display_order',
    'integer',
    False,
    's',
    '\nCASE\n    WHEN (deleted_at IS NULL) THEN display_order\n    ELSE NULL::integer\nEND'),
   ('created_at', 'timestamp without time zone', True, '', 'CURRENT_TIMESTAMP'),
   ('deleted_at', 'timestamp with time zone', False, '', None),
   ('description', 'text', False, '', None),
   ('display_order', 'integer', True, '', '0'),
   ('expected_otjh', 'numeric(8,2)', True, '', '2'),
   ('free_module_id', 'character varying(128)', True, '', None),
   ('id', 'character varying(128)', True, '', None),
   ('points', 'integer', True, '', '0'),
   ('programme_id', 'character varying(255)', True, '', None),
   ('reflection_required', 'boolean', True, '', 'false'),
   ('settings_json', 'jsonb', False, '', None),
   ('title', 'text', True, '', "''::character varying"),
   ('tutor_validation_required', 'boolean', True, '', 'false'),
   ('type', 'character varying(64)', True, '', None),
   ('updated_at', 'timestamp without time zone', True, '', 'CURRENT_TIMESTAMP'),
   ('workplace_evidence_required', 'boolean', True, '', 'false')]),
 ('curriculum.free_programme_components constraints',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname',
  ('curriculum.free_programme_components',),
  [('free_components_free_week_fk',
    'FOREIGN KEY (free_module_id) REFERENCES curriculum.free_course_weeks(id) ON UPDATE RESTRICT ON DELETE '
    'RESTRICT',
    True),
   ('free_components_week_display_order_uniq',
    'UNIQUE (free_module_id, active_display_order) DEFERRABLE INITIALLY DEFERRED',
    True),
   ('free_programme_components_created_at_not_null', 'NOT NULL created_at', True),
   ('free_programme_components_display_order_not_null', 'NOT NULL display_order', True),
   ('free_programme_components_expected_otjh_not_null', 'NOT NULL expected_otjh', True),
   ('free_programme_components_free_module_id_not_null', 'NOT NULL free_module_id', True),
   ('free_programme_components_id_not_null', 'NOT NULL id', True),
   ('free_programme_components_pkey', 'PRIMARY KEY (id)', True),
   ('free_programme_components_points_not_null', 'NOT NULL points', True),
   ('free_programme_components_programme_id_not_null', 'NOT NULL programme_id', True),
   ('free_programme_components_reflection_required_not_null', 'NOT NULL reflection_required', True),
   ('free_programme_components_title_not_null', 'NOT NULL title', True),
   ('free_programme_components_tutor_validation_required_not_null',
    'NOT NULL tutor_validation_required',
    True),
   ('free_programme_components_type_not_null', 'NOT NULL type', True),
   ('free_programme_components_updated_at_not_null', 'NOT NULL updated_at', True),
   ('free_programme_components_workplace_evidence_required_not_null',
    'NOT NULL workplace_evidence_required',
    True)]),
 ('curriculum.free_programme_components indexes',
  'SELECT ci.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready\n'
  'FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid\n'
  'WHERE i.indrelid=to_regclass(%s) ORDER BY ci.relname',
  ('curriculum.free_programme_components',),
  [('free_components_week_display_order_uniq',
    'CREATE UNIQUE INDEX free_components_week_display_order_uniq ON curriculum.free_programme_components '
    'USING btree (free_module_id, active_display_order)',
    True,
    True),
   ('free_programme_components_pkey',
    'CREATE UNIQUE INDEX free_programme_components_pkey ON curriculum.free_programme_components USING '
    'btree (id)',
    True,
    True),
   ('idx_free_components_free_week',
    'CREATE INDEX idx_free_components_free_week ON curriculum.free_programme_components USING btree '
    '(free_module_id)',
    True,
    True)]),
 ('"Learner".learner_free_courses constraints',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname',
  ('"Learner".learner_free_courses',),
  [('learner_free_courses_course_fk',
    'FOREIGN KEY (free_course_ref) REFERENCES curriculum.free_courses(id) ON UPDATE RESTRICT ON DELETE '
    'RESTRICT',
    True),
   ('learner_free_courses_free_course_ref_not_null', 'NOT NULL free_course_ref', True),
   ('learner_free_courses_id_not_null', 'NOT NULL id', True),
   ('learner_free_courses_learner_id_fkey',
    'FOREIGN KEY (learner_id) REFERENCES "Learner".learners(id) ON DELETE CASCADE',
    True),
   ('learner_free_courses_learner_id_not_null', 'NOT NULL learner_id', True),
   ('learner_free_courses_pkey', 'PRIMARY KEY (id)', True),
   ('learner_free_courses_position_not_null', 'NOT NULL "position"', True)]),
 ('"Learner".learner_free_course_progress constraints',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname',
  ('"Learner".learner_free_course_progress',),
  [('free_progress_activity_state_check',
    "CHECK ((activity_state = ANY (ARRAY['not_started'::text, 'reading_viewed'::text, "
    "'completed'::text])))",
    True),
   ('free_progress_status_check',
    "CHECK (((status)::text = ANY ((ARRAY['active'::character varying, 'inactive'::character "
    'varying])::text[])))',
    True),
   ('learner_free_course_progress_activity_state_not_null', 'NOT NULL activity_state', True),
   ('learner_free_course_progress_component_fk',
    'FOREIGN KEY (component_ref) REFERENCES curriculum.free_programme_components(id) ON UPDATE RESTRICT ON '
    'DELETE RESTRICT',
    True),
   ('learner_free_course_progress_component_ref_not_null', 'NOT NULL component_ref', True),
   ('learner_free_course_progress_course_fk',
    'FOREIGN KEY (free_course_ref) REFERENCES curriculum.free_courses(id) ON UPDATE RESTRICT ON DELETE '
    'RESTRICT',
    True),
   ('learner_free_course_progress_free_course_ref_not_null', 'NOT NULL free_course_ref', True),
   ('learner_free_course_progress_id_not_null', 'NOT NULL id', True),
   ('learner_free_course_progress_is_completed_not_null', 'NOT NULL is_completed', True),
   ('learner_free_course_progress_learner_fk',
    'FOREIGN KEY (learner_id) REFERENCES "Learner".learners(id) ON UPDATE RESTRICT ON DELETE RESTRICT',
    True),
   ('learner_free_course_progress_learner_id_not_null', 'NOT NULL learner_id', True),
   ('learner_free_course_progress_pkey', 'PRIMARY KEY (id)', True),
   ('learner_free_course_progress_status_not_null', 'NOT NULL status', True),
   ('learner_free_course_progress_unique', 'UNIQUE (learner_id, component_ref)', True)])]


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
    replaces = [('curriculum_api', '0082_independent_free_course_storage')]
    dependencies = [('curriculum_api', '0081_merge_free_courses_qr_attendance'),
                    ('learner_api', '0026_free_course_relations')]
    operations = [migrations.RunPython(validate), migrations.SeparateDatabaseAndState(
        state_operations=[],
    )]
