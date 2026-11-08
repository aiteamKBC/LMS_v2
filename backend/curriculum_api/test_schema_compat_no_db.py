"""No-database tests for the normalised-schema bridge and the curriculum OpenAPI.

Column sets below mirror the two real shapes: LEGACY (deleted_at, programme_name,
...) and NORMALISED (status, tutor_id, coach_id, standard_ksb_id). Nothing here
opens a connection: the PostgreSQL vendor and column lookups are patched.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import schema_compat as sc

LEGACY_MODULES = {'module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'title', 'status',
                  'deleted_at', 'deleted_by', 'deleted_via_parent', 'is_programme_deleted',
                  'programme_name', 'cohort_name', 'group_name', 'tutor_name', 'tutor_email', 'coach_name',
                  'updated_at', 'created_at'}
NORMALISED_MODULES = {'module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'title', 'status',
                      'tutor_id', 'updated_at', 'created_at'}
NORMALISED_KSB = {'id', 'component_id', 'ksb_id', 'standard_ksb_id', 'status', 'weight', 'updated_at'}
NORMALISED = {
    'modules': NORMALISED_MODULES,
    'groups': {'group_id', 'group_name', 'cohort_id', 'programme_id', 'coach_id', 'status', 'updated_at'},
    'weeks': {'id', 'module_catalogue_id', 'free_course_id', 'status', 'updated_at'},
    'components': {'id', 'week_id', 'module_catalogue_id', 'status', 'updated_at'},
    'ksb_mappings': NORMALISED_KSB,
}


class PostgresVendor:
    """Patch the module's connection to look like PostgreSQL without connecting."""

    def __enter__(self):
        self._patch = mock.patch.object(sc, 'connection', mock.Mock(vendor='postgresql'))
        self._patch.start()
        self._columns = mock.patch.object(sc, 'columns_of', side_effect=lambda schema, table: NORMALISED.get(table, set()))
        self._columns.start()
        sc._ADAPTED.clear()
        return self

    def __exit__(self, *exc):
        self._columns.stop()
        self._patch.stop()
        sc._ADAPTED.clear()


class LifecycleShapeTests(SimpleTestCase):
    def test_legacy_shape_is_not_status_lifecycle(self):
        self.assertFalse(sc.uses_status_lifecycle('modules', LEGACY_MODULES))
        self.assertFalse(sc.is_normalised('modules', LEGACY_MODULES))

    def test_normalised_shape_is_status_lifecycle(self):
        self.assertTrue(sc.uses_status_lifecycle('modules', NORMALISED_MODULES))
        self.assertTrue(sc.is_normalised('modules', NORMALISED_MODULES))

    def test_non_curriculum_table_is_never_translated(self):
        self.assertFalse(sc.uses_status_lifecycle('live_sessions', {'status'}))

    def test_inactive_and_archived_both_read_as_withdrawn(self):
        self.assertTrue(sc.status_is_inactive('inactive'))
        self.assertTrue(sc.status_is_inactive(' Archived '))
        self.assertFalse(sc.status_is_inactive('planned'))
        self.assertFalse(sc.status_is_inactive('active'))


class TranslateWriteTests(SimpleTestCase):
    def test_legacy_shape_payload_passes_through_unchanged(self):
        payload = {'deleted_at': None, 'programme_name': 'X', 'status': 'archived'}
        self.assertEqual(sc.translate_write('modules', payload, LEGACY_MODULES), (payload, set()))

    def test_archived_status_becomes_inactive(self):
        translated, _ = sc.translate_write('modules', {'status': 'archived'}, NORMALISED_MODULES)
        self.assertEqual(translated['status'], 'inactive')

    def test_soft_delete_stamps_become_status(self):
        stamped, _ = sc.translate_write('modules', {'deleted_at': '2026-01-01', 'is_programme_deleted': True},
                                        NORMALISED_MODULES)
        self.assertEqual(stamped['status'], 'inactive')
        restored, _ = sc.translate_write('modules', {'deleted_at': None, 'is_programme_deleted': False},
                                         NORMALISED_MODULES)
        self.assertEqual(restored['status'], 'active')

    def test_an_ordinary_save_does_not_invent_a_status(self):
        translated, _ = sc.translate_write('modules', {'title': 'Module A'}, NORMALISED_MODULES)
        self.assertNotIn('status', translated)

    def test_staff_names_are_left_for_curriculum_names(self):
        # The chosen tutor/coach is written as its id by curriculum_names.store_staff
        # (test_curriculum_names_no_db); the bridge no longer touches it.
        translated, nullable = sc.translate_write('modules', {'tutor_name': 'Tutor'}, NORMALISED_MODULES)
        self.assertNotIn('tutor_id', translated)
        self.assertEqual(nullable, set())

    def test_library_detach_is_refused_not_half_applied(self):
        with self.assertRaises(sc.UnsupportedOnNormalisedSchema):
            sc.translate_write('weeks', {'library_state': 'library', 'module_catalogue_id': ''}, NORMALISED['weeks'])

    def test_ksb_mapping_resolves_standard_ksb_id(self):
        with mock.patch.object(sc, 'standard_ksb_id_for', return_value=42) as resolve:
            translated, _ = sc.translate_write('ksb_mappings', {'ksb_id': 'st0845-v1-1-181', 'ksb_code': 'K2',
                                                                'module_catalogue_id': 'MOD-1'}, NORMALISED_KSB)
        resolve.assert_called_once_with('st0845-v1-1-181', 'K2', module_catalogue_id='MOD-1')
        self.assertEqual(translated['standard_ksb_id'], 42)

    def test_only_derived_copy_detects_name_refresh(self):
        self.assertTrue(sc.only_derived_copy('modules', {'programme_name': 'New', 'updated_at': 'now'}, NORMALISED_MODULES))
        self.assertFalse(sc.only_derived_copy('modules', {'programme_name': 'New', 'title': 'T'}, NORMALISED_MODULES))
        self.assertFalse(sc.only_derived_copy('modules', {'programme_name': 'New'}, LEGACY_MODULES))


class ReadRelationTests(SimpleTestCase):
    def test_modules_relation_exposes_legacy_columns(self):
        with PostgresVendor():
            relation = sc.read_relation('modules', NORMALISED_MODULES)
        for column in ('is_programme_deleted', 'deleted_at'):
            self.assertIn(f'as "{column}"', relation)
        self.assertTrue(relation.endswith(') as "modules"'))

    def test_names_are_never_joined_into_the_relation(self):
        # Names are put on rows after the read (curriculum_names.attach): the
        # relation joins no programme / cohort / group / tutor / coach table.
        with PostgresVendor():
            relation = sc.read_relation('modules', NORMALISED_MODULES)
        for column in ('programme_name', 'cohort_name', 'group_name', 'tutor_name', 'tutor_email', 'coach_name'):
            self.assertNotIn(f'"{column}"', relation)
        self.assertNotIn(' join ', relation)

    def test_legacy_shape_has_no_relation(self):
        with PostgresVendor():
            self.assertIsNone(sc.read_relation('modules', LEGACY_MODULES))

    def test_ksb_mapping_placement_comes_from_its_component(self):
        with PostgresVendor():
            relation = sc.read_relation('ksb_mappings', NORMALISED_KSB)
        self.assertIn('cc.id = t.component_id', relation)
        self.assertIn('as "module_catalogue_id"', relation)
        self.assertIn('as "ksb_code"', relation)


class AdaptSqlTests(SimpleTestCase):
    def test_read_naming_a_legacy_column_uses_the_relation(self):
        with PostgresVendor():
            sql = sc.adapt_sql('select m.title from curriculum.modules m where m.deleted_at is null')
        self.assertIn('from (select t.*', sql)
        self.assertTrue(sql.endswith(') m where m.deleted_at is null'))

    def test_adapting_is_idempotent(self):
        # The read relation names its tables with ONLY, so an already adapted
        # statement (authoring_select_sql's) is never rewritten a second time --
        # a second pass duplicated the derived columns and made them ambiguous.
        with PostgresVendor():
            once = sc.adapt_sql('select m.title from curriculum.modules m where m.deleted_at is null')
            sc._ADAPTED.clear()
            self.assertEqual(sc.adapt_sql(once), once)
            self.assertIn('only "curriculum"."modules" t', once)

    def test_read_without_legacy_columns_is_untouched(self):
        statement = 'select m.title from curriculum.modules m where m.status = %s'
        with PostgresVendor():
            self.assertEqual(sc.adapt_sql(statement), statement)

    def test_delete_and_locking_statements_are_untouched(self):
        with PostgresVendor():
            for statement in ('delete from curriculum.modules where deleted_at is not null',
                              'select id from curriculum.modules where deleted_at is null for update'):
                self.assertEqual(sc.adapt_sql(statement), statement)

    def test_update_target_is_untouched_but_its_from_source_is_adapted(self):
        statement = 'update curriculum.components set title = %s from curriculum.weeks w where w.deleted_at is null'
        with PostgresVendor():
            sql = sc.adapt_sql(statement)
        self.assertTrue(sql.startswith('update curriculum.components set title = %s from (select'))

    def test_unaliased_reference_keeps_the_table_name(self):
        with PostgresVendor():
            sql = sc.adapt_sql('select * from "curriculum"."modules" where deleted_at is null')
        self.assertIn(') as "modules" where deleted_at is null', sql)

    def test_orm_qualified_columns_follow_the_relation_alias(self):
        # The ORM writes "curriculum"."modules"."col"; inside the relation aliased
        # "modules" that reference is invalid unless it is re-pointed at the alias.
        statement = ('SELECT "curriculum"."modules"."module_catalogue_id", "curriculum"."modules"."programme_name" '
                     'FROM "curriculum"."modules" WHERE ("curriculum"."modules"."deleted_at" IS NULL '
                     'AND "curriculum"."modules"."module_catalogue_id" = %s) LIMIT 1')
        with PostgresVendor():
            sql = sc.adapt_sql(statement)
            sc._ADAPTED.clear()
            again = sc.adapt_sql(sql)
        self.assertNotIn('"curriculum"."modules".', sql)
        self.assertIn('SELECT "modules"."module_catalogue_id", "modules"."programme_name" FROM (select', sql)
        self.assertIn(') as "modules" WHERE ("modules"."deleted_at" IS NULL', sql)
        self.assertIn('only "curriculum"."modules" t', sql)
        self.assertEqual(again, sql)

    def test_legacy_schema_and_other_vendors_pass_through(self):
        statement = 'select * from curriculum.modules m where m.deleted_at is null'
        self.assertEqual(sc.adapt_sql(statement), statement)  # SQLite test connection

    def test_write_where_rekeys_a_legacy_condition(self):
        with PostgresVendor():
            where = sc.write_where('modules', 'programme_id = %s and deleted_at is null', NORMALISED_MODULES)
        self.assertTrue(where.startswith('"module_catalogue_id" in (select "module_catalogue_id" from (select'))
        with PostgresVendor():
            self.assertEqual(sc.write_where('modules', 'programme_id = %s', NORMALISED_MODULES), 'programme_id = %s')


class ProjectionTests(SimpleTestCase):
    def test_lifecycle_keys_are_derived_from_status(self):
        rows = [{'module_catalogue_id': 'A', 'status': 'inactive', 'updated_at': 'then'},
                {'module_catalogue_id': 'B', 'status': 'active', 'updated_at': 'now'}]
        sc.project_rows('modules', rows, NORMALISED_MODULES)
        self.assertTrue(rows[0]['is_programme_deleted'])
        self.assertEqual(rows[0]['deleted_at'], 'then')
        self.assertFalse(rows[1]['is_programme_deleted'])
        self.assertIsNone(rows[1]['deleted_at'])

    def test_keys_already_supplied_by_the_relation_are_kept(self):
        rows = [{'module_catalogue_id': 'A', 'status': 'active', 'deleted_at': None, 'is_programme_deleted': False,
                 'deleted_by': None, 'deleted_via_parent': None, 'programme_name': 'From SQL', 'cohort_name': '',
                 'group_name': '', 'tutor_name': '', 'tutor_email': '', 'coach_name': ''}]
        # Nothing is read: a module row's derived keys are all lifecycle ones,
        # and names are curriculum_names' (not this projection's).
        with mock.patch.object(sc, 'connection') as db:
            db.vendor = 'postgresql'
            sc.project_rows('modules', rows, NORMALISED_MODULES)
        db.cursor.assert_not_called()
        self.assertEqual(rows[0]['programme_name'], 'From SQL')

    def test_legacy_rows_are_untouched(self):
        rows = [{'module_catalogue_id': 'A', 'deleted_at': None}]
        sc.project_rows('modules', rows, LEGACY_MODULES)
        self.assertEqual(rows, [{'module_catalogue_id': 'A', 'deleted_at': None}])


class OpenApiTests(SimpleTestCase):
    def test_document_is_valid_openapi_and_marks_writes(self):
        from drf_spectacular.validation import validate_schema
        import json

        from curriculum_api.openapi_docs import build_curriculum_openapi

        spec = build_curriculum_openapi()
        validate_schema(json.loads(json.dumps(spec)))
        operations = [(method, op) for item in spec['paths'].values() for method, op in item.items()]
        self.assertGreater(len(operations), 200)
        for method, op in operations:
            self.assertIn(op['x-contract-completeness'], {'complete', 'partial'})
            self.assertEqual(op['x-state-changing'], method in {'post', 'put', 'patch', 'delete'})
            if op['x-state-changing']:
                self.assertTrue(op['summary'].startswith('⚠️'))
                self.assertIn('requestBody', op)
        self.assertNotIn('/curriculum_api/docs/', spec['paths'])

    def test_observed_shape_never_publishes_data_keys(self):
        from curriculum_api.openapi_contracts import shape_to_schema

        schema = shape_to_schema({'results': [{'id': 'str', 'name': 'str'}],
                                  'byLearner': {'someone@example.invalid': {'count': 'int'}},
                                  'PROG-20260827123438706373': {'x': 'int'}})
        self.assertNotIn('PROG-20260827123438706373', str(schema))
        self.assertNotIn('someone@example.invalid', str(schema))
        self.assertEqual(schema['type'], 'object')

    def test_docs_endpoints_are_404_without_debug(self):
        from django.http import Http404
        from django.test import RequestFactory, override_settings

        from curriculum_api.openapi_docs import curriculum_openapi_json, curriculum_swagger_ui

        request = RequestFactory().get('/curriculum_api/docs/')
        with override_settings(DEBUG=False):
            for view in (curriculum_swagger_ui, curriculum_openapi_json):
                with self.assertRaises(Http404):
                    view(request)
