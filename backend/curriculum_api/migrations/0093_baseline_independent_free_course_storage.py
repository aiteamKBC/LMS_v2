"""Validate independent course storage instead of installing shared-storage bridges.

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
 ('curriculum.free_courses columns',
  'SELECT a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,\n'
  '    a.attgenerated, pg_get_expr(d.adbin,d.adrelid)\n'
  'FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum\n'
  'WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped ORDER BY a.attname',
  ('curriculum.free_courses',),
  [('component_count', 'integer', True, '', '0'),
   ('course_name', 'text', True, '', None),
   ('course_type', 'character varying(16)', True, '', "'free'::character varying"),
   ('cover_image_url', 'text', False, '', None),
   ('created_at', 'timestamp without time zone', True, '', 'CURRENT_TIMESTAMP'),
   ('currency', 'character varying(3)', True, '', "'GBP'::character varying"),
   ('description', 'text', False, '', None),
   ('display_order', 'integer', True, '', '0'),
   ('id', 'character varying(128)', True, '', None),
   ('is_for_sale', 'boolean', True, '', 'false'),
   ('price', 'numeric(10,2)', False, '', None),
   ('total_otjh', 'numeric(8,2)', True, '', '0'),
   ('updated_at', 'timestamp without time zone', True, '', 'CURRENT_TIMESTAMP'),
   ('week_count', 'integer', True, '', '0')]),
 ('curriculum.free_courses constraints',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) ORDER BY conname',
  ('curriculum.free_courses',),
  [('free_courses_course_type_check',
    "CHECK (((course_type)::text = ANY ((ARRAY['free'::character varying, 'apprentices'::character "
    'varying])::text[])))',
    True),
   ('free_courses_course_type_not_null', 'NOT NULL course_type', True),
   ('free_courses_currency_check', "CHECK (((currency)::text = 'GBP'::text))", True),
   ('free_courses_currency_not_null', 'NOT NULL currency', True),
   ('free_courses_display_order_uniq', 'UNIQUE (display_order) DEFERRABLE INITIALLY DEFERRED', True),
   ('free_courses_is_for_sale_not_null', 'NOT NULL is_for_sale', True),
   ('free_courses_sale_price_check',
    'CHECK ((((is_for_sale = false) AND (price IS NULL)) OR ((is_for_sale = true) AND (price IS NOT NULL) '
    'AND (price > (0)::numeric) AND (price <= 99999999.99))))',
    True),
   ('free_courses_week_count_not_null', 'NOT NULL week_count', True),
   ('free_programme_modules_component_count_not_null', 'NOT NULL component_count', True),
   ('free_programme_modules_created_at_not_null', 'NOT NULL created_at', True),
   ('free_programme_modules_display_order_not_null', 'NOT NULL display_order', True),
   ('free_programme_modules_id_not_null', 'NOT NULL id', True),
   ('free_programme_modules_pkey', 'PRIMARY KEY (id)', True),
   ('free_programme_modules_title_not_null', 'NOT NULL course_name', True),
   ('free_programme_modules_total_otjh_not_null', 'NOT NULL total_otjh', True),
   ('free_programme_modules_updated_at_not_null', 'NOT NULL updated_at', True)]),
 ('curriculum.free_courses indexes',
  'SELECT ci.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready\n'
  'FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid\n'
  'WHERE i.indrelid=to_regclass(%s) ORDER BY ci.relname',
  ('curriculum.free_courses',),
  [('curriculum_free_courses_order_idx',
    'CREATE INDEX curriculum_free_courses_order_idx ON curriculum.free_courses USING btree (display_order, '
    'id)',
    True,
    True),
   ('free_courses_display_order_uniq',
    'CREATE UNIQUE INDEX free_courses_display_order_uniq ON curriculum.free_courses USING btree '
    '(display_order)',
    True,
    True),
   ('free_programme_modules_pkey',
    'CREATE UNIQUE INDEX free_programme_modules_pkey ON curriculum.free_courses USING btree (id)',
    True,
    True)])]


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
    replaces = [('curriculum_api', '0080_free_course_storage')]
    dependencies = [('curriculum_api', '0079_course_pricing')]
    operations = [migrations.RunPython(validate), migrations.SeparateDatabaseAndState(
        state_operations=[],
    )]
