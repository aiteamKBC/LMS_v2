"""Preserve installed QR provenance fields and unresolved historical Teams evidence.

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
CHECKS = [('QR provenance columns',
  'SELECT a.attname, format_type(a.atttypid,a.atttypmod), a.attnotnull,\n'
  '    a.attgenerated, pg_get_expr(d.adbin,d.adrelid)\n'
  'FROM pg_attribute a LEFT JOIN pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum\n'
  'WHERE a.attrelid=to_regclass(%s) AND a.attnum>0 AND NOT a.attisdropped AND a.attname IN '
  "('attendance_basis','teams_attendance_status','attendance_source_occurrence_id','qr_attendance_id','qr_confirmed_at') "
  'ORDER BY a.attname',
  ('curriculum.live_session_learner_attendance',),
  [('attendance_basis', 'character varying(16)', True, '', "'teams'::character varying"),
   ('attendance_source_occurrence_id', 'character varying(128)', False, '', None),
   ('qr_attendance_id', 'bigint', False, '', None),
   ('qr_confirmed_at', 'timestamp with time zone', False, '', None),
   ('teams_attendance_status', 'character varying(16)', False, '', None)]),
 ('QR provenance constraints',
  'SELECT conname,pg_get_constraintdef(oid),convalidated\n'
  'FROM pg_constraint WHERE conrelid=to_regclass(%s) AND conname IN '
  "('curriculum_live_learner_attendance_basis_valid','curriculum_live_learner_teams_status_valid','curriculum_live_learner_qr_attendance_fk') "
  'ORDER BY conname',
  ('curriculum.live_session_learner_attendance',),
  [('curriculum_live_learner_attendance_basis_valid',
    "CHECK (((attendance_basis)::text = ANY ((ARRAY['teams'::character varying, 'qr'::character varying, "
    "'teams_qr'::character varying, 'staff'::character varying, 'parallel'::character varying])::text[])))",
    True),
   ('curriculum_live_learner_qr_attendance_fk',
    'FOREIGN KEY (qr_attendance_id) REFERENCES curriculum.qr_attendance(id) ON DELETE RESTRICT',
    True),
   ('curriculum_live_learner_teams_status_valid',
    'CHECK (((teams_attendance_status IS NULL) OR ((teams_attendance_status)::text = ANY '
    "((ARRAY['present'::character varying, 'absent'::character varying])::text[]))))",
    True)]),
 ('QR provenance index',
  'SELECT ci.relname,pg_get_indexdef(i.indexrelid),i.indisvalid,i.indisready\n'
  'FROM pg_index i JOIN pg_class ci ON ci.oid=i.indexrelid\n'
  "WHERE i.indrelid=to_regclass(%s) AND ci.relname='curriculum_live_learner_attendance_qr_idx' ORDER BY "
  'ci.relname',
  ('curriculum.live_session_learner_attendance',),
  [('curriculum_live_learner_attendance_qr_idx',
    'CREATE INDEX curriculum_live_learner_attendance_qr_idx ON curriculum.live_session_learner_attendance '
    'USING btree (qr_attendance_id) WHERE (qr_attendance_id IS NOT NULL)',
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
    replaces = [('curriculum_api', '0082_qr_learner_attendance_resolution')]
    dependencies = [('curriculum_api', '0081_merge_free_courses_qr_attendance')]
    operations = [migrations.RunPython(validate), migrations.SeparateDatabaseAndState(
        state_operations=[
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='attendance_basis',
                field=models.CharField(default='teams', max_length=16),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='teams_attendance_status',
                field=models.CharField(blank=True, max_length=16, null=True),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='attendance_source_occurrence_id',
                field=models.CharField(blank=True, max_length=128, null=True),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='qr_attendance_id',
                field=models.BigIntegerField(blank=True, null=True),
            ),
            migrations.AddField(
                model_name='livesessionlearnerattendance', name='qr_confirmed_at',
                field=models.DateTimeField(blank=True, null=True),
            ),
        ],
    )]
