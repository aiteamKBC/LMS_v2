"""Storage links, imports and price ownership on the isolated PostgreSQL runner."""
from copy import deepcopy
from decimal import Decimal
from unittest.mock import patch
import hashlib
import json
from io import StringIO
from pathlib import Path
from tempfile import TemporaryDirectory

from django.core.management import call_command, CommandError
from django.db import connection, transaction, IntegrityError, DatabaseError
from django.db.migrations.loader import MigrationLoader
from django.conf import settings
from django.test import override_settings
from django.utils import timezone

from . import views as v
from .free_course_import import import_content, import_plan
from .legacy_free_course_adoption import adopted_courses
from .legacy_free_course_migration import adopted_id
from .tests import CurriculumPersistenceHarness, CurriculumPersistenceTransactionHarness
from . import tests_standalone_courses as standalone


class FreeCourseStorageTests(CurriculumPersistenceHarness):
    def save(self):
        return v.save_module_authoring_structure('MOD-FREE', {
            **standalone.StandaloneCourseTests.payload(self), 'isForSale': True, 'price': '49.95',
        }, repair_links=False)

    def root(self):
        return v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'module_catalogue_id = %s', ['MOD-FREE'])[0]

    def test_new_course_is_linked_and_edits_update_all_three_tables(self):
        self.save()
        root = self.root()
        self.assertEqual(root['price'], Decimal('49.95'))
        self.assertEqual((root['week_count'], root['component_count']), (1, 2))
        self.assertEqual(adopted_courses()[root['id']], 'MOD-FREE')
        self.assertEqual(v.get_free_programme_modules_payload('FREE-COURSES'), [])
        v.update_authoring_rows(v.AUTHORING_WEEKS_TABLE, 'id = %s', ['WEEK-FREE'], {'title': 'Edited week'})
        v.update_authoring_rows(v.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-FREE-A'], {'title': 'Edited reading'})
        week = v.free_programme_fetch_all(v.FREE_PROGRAMME_MODULES_TABLE, 'authoring_week_id = %s', ['WEEK-FREE'])[0]
        activity = v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE, 'authoring_component_id = %s', ['COMP-FREE-A'])[0]
        self.assertEqual(week['week_title'], 'Edited week')
        self.assertEqual(activity['title'], 'Edited reading')
        self.assertEqual(activity['free_module_id'], week['id'])

    def test_price_in_free_courses_reaches_catalogue_and_survives_partial_edit(self):
        self.save()
        with connection.cursor() as cursor:
            cursor.execute('UPDATE curriculum.free_courses SET price = 75.50 WHERE module_catalogue_id = %s', ['MOD-FREE'])
        self.assertEqual(v.get_authoring_structure_payload('MOD-FREE')['price'], '75.50')
        v.save_module_authoring_structure('MOD-FREE', {'title': 'Renamed'}, repair_links=False)
        self.assertEqual(self.root()['price'], Decimal('75.50'))
        self.assertEqual(v.authoring_catalogue_summaries()['MOD-FREE']['price'], '75.50')
        for update in ("currency = 'USD'", 'price = 0', 'is_for_sale = false'):
            with self.subTest(update=update), self.assertRaises(IntegrityError), transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute(f'UPDATE curriculum.free_courses SET {update} WHERE module_catalogue_id = %s', ['MOD-FREE'])

    def test_archive_restore_and_conversion_keep_links_and_price(self):
        self.save()
        before = self.root()
        v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-FREE'], {'deleted_at': timezone.now()})
        self.assertIsNotNone(self.root()['deleted_at'])
        v.update_authoring_rows(v.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-FREE'],
                                {'deleted_at': None, 'source_type': 'module_authoring'})
        after = self.root()
        self.assertEqual(after['id'], before['id'])
        self.assertIsNone(after['deleted_at'])
        self.assertIsNotNone(after['converted_at'])
        self.assertEqual(after['price'], before['price'])
        self.assertEqual(adopted_courses()[after['id']], 'MOD-FREE')

    def test_normal_module_does_not_create_a_free_course(self):
        v.save_module_authoring_structure('MOD-ORDINARY', {'title': 'Ordinary'}, repair_links=False)
        self.assertFalse(v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'module_catalogue_id = %s', ['MOD-ORDINARY']))

    def export(self):
        return {
            'courses': [{'id': 'FC-IMPORT', 'course_name': 'Imported study', 'course_type': 'free'}],
            'weeks': [{'id': 'SOURCE-WEEK', 'free_course_id': 'FC-IMPORT', 'week_number': 1,
                       'title': 'Original week', 'summary': 'Keep the summary'}],
            'week_links': [{'id': 'SOURCE-LINK', 'course_id': 'FC-IMPORT', 'week_id': 'SOURCE-WEEK'}],
            'components': [{'id': 'SOURCE-COMP', 'free_module_id': 'SOURCE-LINK', 'week_id': 'SOURCE-WEEK',
                            'type': 'reading', 'title': 'Original activity', 'expected_otjh': 0,
                            'settings_json': {'readingContent': '<p>Keep this content</p>'}}],
        }

    def test_import_retry_preserves_edited_content_hours_and_source_identity(self):
        export = self.export()
        with patch.object(v, 'stored_module_cover_image', wraps=v.stored_module_cover_image) as cover, \
                patch.object(v, 'link_live_session_series_to_module') as teams:
            result = import_content(export)
        self.assertEqual(result['coursesToImport'], 1)
        teams.assert_not_called()
        self.assertFalse(any(str(call.args[1]).startswith('data:') for call in cover.call_args_list))
        module_id = adopted_id('MOD', 'FC-IMPORT', 'FC-IMPORT')
        payload = v.get_authoring_structure_payload(module_id)
        self.assertEqual(payload['weekStructure'][0]['summary'], 'Keep the summary')
        payload['weekStructure'][0]['components'][0]['expectedOtjh'] = 2
        payload['title'] = 'Edited locally'
        v.save_module_authoring_structure(module_id, payload, repair_links=False)
        self.assertEqual(import_content(export)['coursesToImport'], 0)
        after = v.get_authoring_structure_payload(module_id)
        self.assertEqual(after['title'], 'Edited locally')
        self.assertEqual(after['totalOtjh'], 2)
        rows = v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE, 'id = %s', ['SOURCE-COMP'])
        self.assertTrue(rows, str({
            'roots': v.free_programme_fetch_all(v.FREE_COURSES_TABLE, columns=['id', 'module_catalogue_id']),
            'components': v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE,
                columns=['id', 'authoring_component_id', 'settings_json'])}))
        component = rows[0]
        self.assertEqual(component['authoring_component_id'], adopted_id('COMP', 'FC-IMPORT', 'SOURCE-COMP'))

    def test_import_failure_rolls_back_root_and_runtime_content(self):
        original = v.save_module_authoring_structure
        def fail_after_write(*args, **kwargs):
            original(*args, **kwargs)
            raise ValueError('Simulated interruption')
        with patch.object(v, 'save_module_authoring_structure', side_effect=fail_after_write), self.assertRaises(ValueError):
            import_content(self.export())
        self.assertFalse(v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'id = %s', ['FC-IMPORT']))
        self.assertFalse(v.authoring_module_exists(adopted_id('MOD', 'FC-IMPORT', 'FC-IMPORT')))

    def test_import_rejects_cross_course_week_before_writes(self):
        export = self.export()
        export['weeks'][0]['free_course_id'] = 'ANOTHER-COURSE'
        with self.assertRaises(ValueError):
            import_plan(export)

    def test_import_keeps_inactive_weeks_archived_without_hours(self):
        export = self.export()
        export['weeks'][0]['status'] = 'inactive'
        export['components'][0]['expected_otjh'] = 3
        import_content(export)
        module_id = adopted_id('MOD', 'FC-IMPORT', 'FC-IMPORT')
        self.assertEqual(v.get_authoring_structure_payload(module_id)['weekStructure'], [])
        self.assertEqual(float(v.authoring_module_exists(module_id)['total_otjh']), 0)
        component = v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE, 'id = %s', ['SOURCE-COMP'])[0]
        self.assertIsNotNone(component['deleted_at'])
        self.assertEqual(float(component['expected_otjh']), 3)

    def test_import_refuses_existing_component_identity_in_another_course(self):
        import_content(self.export())
        export = self.export()
        export['courses'][0]['id'] = 'FC-SECOND'
        export['week_links'][0].update(id='SECOND-LINK', course_id='FC-SECOND')
        export['weeks'][0]['free_course_id'] = 'FC-SECOND'
        export['components'][0]['free_module_id'] = 'SECOND-LINK'
        with self.assertRaises(ValueError):
            import_content(export)
        self.assertFalse(v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'id = %s', ['FC-SECOND']))

    def test_database_rejects_linking_a_week_to_another_course(self):
        self.save()
        v.save_module_authoring_structure('MOD-OTHER', {'title': 'Other', 'isFreeCourse': True}, repair_links=False)
        other = v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'module_catalogue_id = %s', ['MOD-OTHER'])[0]
        with self.assertRaises(DatabaseError), transaction.atomic():
            with connection.cursor() as cursor:
                cursor.execute('UPDATE curriculum.free_course_weeks SET course_id = %s WHERE authoring_week_id = %s',
                               [other['id'], 'WEEK-FREE'])

    def test_migration_backfills_old_ids_without_rewriting_runtime_rows(self):
        from .free_course_storage_schema import provision
        from .free_course_import import import_payloads
        export = self.export()
        course, payload = import_payloads(export)[0]
        v.free_programme_upsert(v.FREE_COURSES_TABLE, ['id'], {'id': course['id'], 'course_name': 'Old title'})
        v.free_programme_upsert(v.FREE_PROGRAMME_MODULES_TABLE, ['id'], {
            'id': 'SOURCE-LINK', 'course_id': course['id'], 'course_name': 'Old title'})
        v.free_programme_upsert(v.FREE_PROGRAMME_COMPONENTS_TABLE, ['id'], {
            'id': 'SOURCE-COMP', 'free_module_id': 'SOURCE-LINK', 'programme_id': 'FREE-COURSES',
            'type': 'reading', 'title': 'Old activity'})
        with connection.cursor() as cursor:
            for table in ('modules', 'weeks', 'components'):
                cursor.execute(f'ALTER TABLE curriculum.{table} DISABLE TRIGGER free_course_storage_sync')
        payload.update(isForSale=True, price='17.25')
        v.save_module_authoring_structure(payload['catalogueId'], payload, repair_links=False)
        before = v.module_structure_source_rows(payload['catalogueId'])
        provision(connection)
        self.assertEqual(v.module_structure_source_rows(payload['catalogueId']), before)

        root = v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'id = %s', [course['id']])[0]
        self.assertEqual(root['module_catalogue_id'], payload['catalogueId'])
        self.assertEqual(root['price'], Decimal('17.25'))
        linked = v.free_programme_fetch_all(v.FREE_PROGRAMME_MODULES_TABLE, 'course_id = %s', [course['id']])
        self.assertEqual([row['id'] for row in linked], ['SOURCE-LINK'])
        activity = v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE, 'id = %s', ['SOURCE-COMP'])[0]
        self.assertEqual(activity['authoring_component_id'], adopted_id('COMP', course['id'], 'SOURCE-COMP'))
        provision(connection)
        self.assertEqual(v.module_structure_source_rows(payload['catalogueId']), before)

    def test_migration_graph_has_one_leaf_without_renaming_applied_migrations(self):
        modules = {key: value for key, value in settings.MIGRATION_MODULES.items() if key != 'curriculum_api'}
        with override_settings(MIGRATION_MODULES=modules):
            loader = MigrationLoader(None)
        self.assertEqual(loader.graph.leaf_nodes('curriculum_api'),
                         [('curriculum_api', '0081_merge_free_courses_qr_attendance')])

    def test_duplicating_imported_content_does_not_reuse_original_component_identity(self):
        import_content(self.export())
        payload = v.get_authoring_structure_payload(adopted_id('MOD', 'FC-IMPORT', 'FC-IMPORT'))
        copied = deepcopy(payload)
        copied['weekStructure'][0]['id'] = 'WEEK-COPY'
        copied['weekStructure'][0]['components'][0]['id'] = 'COMP-COPY'
        v.save_module_authoring_structure('MOD-COPY', copied, repair_links=False)
        original = v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE, 'id = %s', ['SOURCE-COMP'])[0]
        duplicate = v.free_programme_fetch_all(v.FREE_PROGRAMME_COMPONENTS_TABLE, 'authoring_component_id = %s', ['COMP-COPY'])[0]
        self.assertNotEqual(original['id'], duplicate['id'])


class FreeCourseImportCommandTests(CurriculumPersistenceTransactionHarness):
    databases = {'default', 'enrolment'}

    def test_preview_target_guard_backup_and_apply(self):
        from config.management_safety import reconciliation_command
        with patch('sys.argv', ['manage.py', 'import_free_course_content']):
            self.assertTrue(reconciliation_command())
        with TemporaryDirectory() as directory:
            source = Path(directory) / 'source.json'
            backup = Path(directory) / 'backup.json'
            source.write_text(json.dumps(FreeCourseStorageTests.export(self)))
            output = StringIO()
            call_command('import_free_course_content', export=str(source), stdout=output)
            self.assertFalse(json.loads(output.getvalue())['applied'])
            with self.assertRaises(CommandError):
                call_command('import_free_course_content', export=str(source), apply=True,
                             expected_target='wrong-target', backup=str(backup), stdout=StringIO())
            self.assertFalse(backup.exists())
            target = hashlib.sha256((connection.settings_dict['HOST'] + '/' + connection.settings_dict['NAME']).encode()).hexdigest()
            call_command('import_free_course_content', export=str(source), apply=True,
                         expected_target=target, backup=str(backup), stdout=StringIO())
            self.assertTrue(backup.exists())
            self.assertTrue(v.authoring_module_exists(adopted_id('MOD', 'FC-IMPORT', 'FC-IMPORT')))
            with self.assertRaises(CommandError):
                call_command('import_free_course_content', export=str(source), apply=True,
                             expected_target=target, backup=str(backup), stdout=StringIO())

    def test_preview_database_transaction_forbids_accidental_writes(self):
        with TemporaryDirectory() as directory:
            source = Path(directory) / 'source.json'
            source.write_text('{}')
            def unsafe_plan(_export):
                with connection.cursor() as cursor:
                    cursor.execute("INSERT INTO curriculum.free_courses (id, course_name) VALUES ('FORBIDDEN', 'No write')")
            with patch('curriculum_api.management.commands.import_free_course_content.import_plan', side_effect=unsafe_plan), \
                    self.assertRaises(DatabaseError):
                call_command('import_free_course_content', export=str(source), stdout=StringIO())
            self.assertFalse(v.free_programme_fetch_all(v.FREE_COURSES_TABLE, 'id = %s', ['FORBIDDEN']))
