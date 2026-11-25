"""Preconditions for state reconciliation of externally installed canonical KSBs.

No DDL or backfill: the migration refuses an unprepared database. Historical
migrations remain unchanged; a fresh database must receive the reviewed baseline
before this state-only reconciliation can be applied.
"""


def verify_schema(apps, schema_editor):
    required = {
        ('curriculum', 'ksb_standard_versions'): {'standard_ref', 'standard_version'},
        ('curriculum', 'ksb_standard_definitions'): {'id', 'standard_ref', 'standard_version', 'ksb_code'},
        ('curriculum', 'ksb_source_activity_mappings'): {'id', 'source_activity_id', 'standard_ksb_id', 'mapping_status'},
        ('Learner', 'ksb_learner_activity_mappings'): {'learner_id', 'source_kind', 'activity_id', 'source_metadata'},
        ('Learner', 'ksb_learner_progress'): {'progress_id', 'position', 'standard_ksb_id', 'is_excluded', 'legacy_definition_snapshot'},
        ('Learner', 'learners'): {'id', 'standard_ref', 'standard_version'},
    }
    with schema_editor.connection.cursor() as cursor:
        for (schema, table), names in required.items():
            cursor.execute('''SELECT column_name FROM information_schema.columns
                WHERE table_schema=%s AND table_name=%s''', [schema, table])
            if not names <= {row[0] for row in cursor.fetchall()}:
                raise RuntimeError(f'Canonical KSB baseline not installed: {schema}.{table}')


def verify_template_ownership(apps, schema_editor):
    with schema_editor.connection.cursor() as cursor:
        cursor.execute('''SELECT conname FROM pg_constraint
            WHERE conrelid='curriculum.ksb_component_mappings'::regclass AND convalidated
              AND conname=ANY(%s)''', [[
                'chk_ksb_mapping_owner', 'fk_ksb_template_component',
                'uq_template_component_standard_ksb',
                'ksb_mappings_component_id_fkey', 'ksb_mappings_component_standard_unique']])
        if len(cursor.fetchall()) != 5:
            raise RuntimeError('Approved dual-owner KSB constraints must be installed and validated first.')
