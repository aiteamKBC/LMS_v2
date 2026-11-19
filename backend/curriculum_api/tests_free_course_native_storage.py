"""Independent storage cutover, on a verified disposable PostgreSQL database."""
from django.db import connection, transaction, IntegrityError
from django.utils import timezone
from types import SimpleNamespace
from unittest.mock import patch
import json
from django.test import RequestFactory, override_settings
from . import free_course_native_schema as schema, learning_storage as store, views as v
from .free_course_storage_schema import provision
from .free_course_contract import COLUMNS
from psycopg import sql
from .tests import CurriculumPersistenceHarness


def prepare_native_authoring_fixture():
    """Match the migration contract on the small isolated authoring fixture."""
    store.reset()
    provision(connection)
    with connection.cursor() as cursor:
        for table, columns in COLUMNS.items():
            for name, kind in columns:
                cursor.execute(sql.SQL('ALTER TABLE curriculum.{} ADD COLUMN IF NOT EXISTS {} {}').format(
                    sql.Identifier(table), sql.Identifier(name), sql.SQL(kind)))
        cursor.execute('ALTER TABLE curriculum.programmes ADD COLUMN IF NOT EXISTS deleted_at timestamptz')
        cursor.execute('ALTER TABLE curriculum.cohorts ADD COLUMN IF NOT EXISTS is_programme_deleted boolean DEFAULT false')
    v._TABLE_COLUMNS_CACHE.clear()


class IndependentFreeCourseStorageTests(CurriculumPersistenceHarness):
    databases = {'default', 'enrolment'}

    def setUp(self):
        self.maxDiff = None
        store.reset()
        super().setUp()
        # Surface the original SQL error before a reader retries another alias
        # in the same TestCase transaction and obscures it as an aborted query.
        def sql_errors(execute, query, params, many, context):
            try:
                return execute(query, params, many, context)
            except Exception as exc:
                if not isinstance(exc, IntegrityError):
                    raise AssertionError(str(exc)) from exc
                raise
        self.enterContext(connection.execute_wrapper(sql_errors))
        self.assertEqual(connection.vendor, 'postgresql')
        prepare_native_authoring_fixture()
        self.reference = 'MOD-FREE-INDEPENDENT'
        v.save_module_authoring_structure(self.reference, {
            'isFreeCourse': True, 'title': 'Independent course', 'isForSale': True,
            'price': '12.50', 'currency': 'GBP',
            'weekStructure': [{'id': 'WEEK-INDEPENDENT', 'title': 'Study', 'components': [
                {'id': 'COMP-INDEPENDENT', 'type': 'reading', 'title': 'Read',
                 'expectedOtjh': 1, 'settings': {'readingContent': '<p>Keep this</p>'}},
            ]}],
        }, repair_links=False)
        self.before = {table: v.authoring_fetch_all(table, 'module_catalogue_id=%s', [self.reference])
                       for table in schema.TABLES}

    def tearDown(self):
        store.reset()
        super().tearDown()

    def learner_fixture(self):
        from learner_api import models
        for model in (models.LearnerFreeCourse, models.LearnerFreeCourseProgress):
            with connection.cursor() as cursor:
                cursor.execute('SELECT to_regclass(%s)', ['"' + model._meta.db_table + '"'])
                exists = cursor.fetchone()[0]
            if not exists:
                with connection.schema_editor() as editor:
                    editor.create_model(model)
        source = models.EnrolmentUser.all_learners.using('default').create(
            id=90101, username='native-synthetic', email='native@example.invalid', learner_type='apprenticeship')
        profile = models.LearnerProfile.objects.using('default').create(id=90201, enrolment_id=source.pk,
            email=source.email, full_name='Synthetic learner', learner_type='apprenticeship', lifecycle_status='active')
        with connection.cursor() as cursor:
            cursor.execute('SELECT id FROM curriculum.free_courses WHERE module_catalogue_id=%s', [self.reference])
            course_id = cursor.fetchone()[0]
            cursor.execute('SELECT id FROM curriculum.free_programme_components WHERE authoring_component_id=%s', ['COMP-INDEPENDENT'])
            component_id = cursor.fetchone()[0]
        return models, source, profile, course_id, component_id

    def install_relations(self):
        from importlib import import_module
        migration = import_module('learner_api.migrations.0026_free_course_relations')
        migration.install(None, SimpleNamespace(connection=connection))

    def test_relations_remap_legacy_identity_preserving_completion_and_reject_orphans(self):
        models, source, profile, course_id, component_id = self.learner_fixture()
        at = timezone.now()
        old = models.LearnerFreeCourseProgress.objects.using('default').create(
            learner_id=source.pk, free_course_ref=course_id, component_ref=component_id, completed_at=at)
        self.install_relations()
        self.install_relations()  # Applying verified relations again must not remap a profile ID.
        old.refresh_from_db(using='default')
        self.assertEqual((old.learner_id, old.completed_at), (profile.pk, at))
        with self.assertRaises(IntegrityError), transaction.atomic():
            models.LearnerFreeCourse.objects.using('default').create(
                learner_id=profile.pk, position=1, free_course_ref='MISSING', free_course_title='Missing')
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM pg_constraint WHERE conname IN (%s,%s,%s,%s) AND convalidated", [
                'learner_free_courses_course_fk', 'learner_free_course_progress_component_fk',
                'learner_free_course_progress_course_fk', 'learner_free_course_progress_learner_fk'])
            self.assertEqual(cursor.fetchone()[0], 4)

    def test_native_assignments_and_completion_index_preserve_ids_and_hours(self):
        from learner_api import free_course_records as records
        models, source, profile, course_id, component_id = self.learner_fixture()
        self.install_relations()
        schema.detach(connection)
        assignments = models.LearnerFreeCourse.objects.using('default')
        completions = models.LearnerFreeCourseProgress.objects.using('default')
        at = timezone.now()
        progress = SimpleNamespace(kind='quiz', passed=False, component_ref='COMP-INDEPENDENT',
                                  submitted_at=at, declared_completed_at=None)
        with patch.object(records, 'connections', {'enrolment': connection}), \
                patch.object(records.LearnerFreeCourse, 'objects', assignments), \
                patch.object(records.LearnerFreeCourseProgress, 'objects', completions):
            records.replace_assignments(profile, [], plan=[{'moduleId': self.reference}])
            assignment_id = assignments.get(learner=profile).pk
            records.replace_assignments(profile, [], plan=[{'moduleId': self.reference}])
            self.assertEqual(assignments.get(learner=profile).pk, assignment_id)
            self.assertEqual(assignments.get(learner=profile).free_course_ref, course_id)
            records.record_completion(profile, progress)
            self.assertEqual(completions.count(), 0)
            progress.passed = True
            records.record_completion(profile, progress)
            records.record_completion(profile, progress)
            saved = completions.get(learner_id=profile.pk)
            self.assertEqual((saved.component_ref, saved.free_course_ref, saved.completed_at), (component_id, course_id, at))
            self.assertEqual(models.LearnerProgressEntry.objects.using('default').filter(learner=profile).count(), 0)

    def test_cutover_indexes_existing_commercial_completion_without_changing_hours(self):
        models, source, profile, course_id, component_id = self.learner_fixture()
        models.LearnerProfile.objects.using('default').filter(pk=profile.pk).update(learner_type='commercial')
        at = timezone.now()
        entry = models.LearnerProgressEntry.objects.using('default').create(
            learner_id=profile.pk, entry_order=1, kind='component', component_ref='COMP-INDEPENDENT',
            module_ref=self.reference, submitted_at=at, verified_seconds=900, expected_otjh=1)
        original = models.LearnerProgressEntry.objects.using('default').filter(pk=entry.pk).values().get()
        self.install_relations()
        schema.detach(connection)
        completion = models.LearnerFreeCourseProgress.objects.using('default').get(learner_id=profile.pk)
        self.assertEqual((completion.component_ref, completion.free_course_ref, completion.completed_at),
                         (component_id, course_id, at))
        self.assertEqual(models.LearnerProgressEntry.objects.using('default').filter(pk=entry.pk).values().get(), original)

    def test_conversion_keeps_content_and_native_history_targets(self):
        schema.detach(connection)
        self.assertTrue(store.convert_to_module(self.reference, {'tutor_name': 'Synthetic tutor'}))
        self.assertIsNone(store.course(self.reference))
        module = v.authoring_module_exists(self.reference)
        self.assertEqual((module['source_type'], module['tutor_name']), ('module_authoring', 'Synthetic tutor'))
        self.assertEqual(v.authoring_fetch_all('components', 'module_catalogue_id=%s', [self.reference])[0]['id'], 'COMP-INDEPENDENT')
        with connection.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM curriculum.free_programme_components WHERE content_ref=%s', ['COMP-INDEPENDENT'])
            self.assertEqual(cursor.fetchone()[0], 1)

    @override_settings(CURRICULUM_COLLABORATION_ENABLED=True, CURRICULUM_COLLABORATION_MODULES=(),
                       CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
    def test_native_tool_edit_rejects_stale_revision_without_losing_builder_content(self):
        from . import free_course_authoring as api, module_collaboration as collaboration
        from .module_collaboration_store import MemoryRoomStore
        schema.detach(connection)
        course_id = store.course(self.reference)['id']
        with connection.cursor() as cursor:
            for table in schema.TABLES:
                cursor.execute(f'DROP TABLE curriculum.{table} CASCADE')
        store.reset()
        actor = SimpleNamespace(role='staff', pk=100)
        with patch('login.permissions.authenticate_request', return_value=actor), \
                patch('login.sessions.authenticate_request', return_value=actor), \
                patch('curriculum_api.video_imports.enabled', return_value=False), \
                patch.object(collaboration, 'get_store', return_value=MemoryRoomStore()):
            response = api.authoring(RequestFactory().get('/'), course_id)
            self.assertEqual(response.status_code, 200, response.content)
            revision = json.loads(response.content)['structureRevision']
            def edit(title):
                request = RequestFactory().patch('/', json.dumps({'expectedRevision': revision, 'title': title}),
                                                 content_type='application/json')
                request._dont_enforce_csrf_checks = True
                return api.authoring(request, course_id, kind='component', item_id='COMP-INDEPENDENT')
            self.assertEqual(edit('Saved by first editor').status_code, 200)
            self.assertEqual(edit('Stale overwrite').status_code, 409)
            saved = v.get_authoring_structure_payload(self.reference)['weekStructure'][0]['components'][0]
            self.assertEqual(saved['title'], 'Saved by first editor')
            self.assertEqual(saved['settings']['readingContent'], '<p>Keep this</p>')

    def test_history_reference_moves_to_free_storage_and_keeps_read_identity(self):
        with connection.cursor() as cursor:
            cursor.execute('''CREATE TABLE curriculum.source_courses
                (id text PRIMARY KEY, curriculum_module_ref varchar(128)
                 REFERENCES curriculum.modules(module_catalogue_id) ON DELETE SET NULL)''')
            cursor.execute('INSERT INTO curriculum.source_courses VALUES (%s,%s)', ['SYNTHETIC-HISTORY', self.reference])
        schema.detach(connection)
        with connection.cursor() as cursor:
            cursor.execute('SELECT curriculum_module_ref,free_course_ref FROM curriculum.source_courses WHERE id=%s', ['SYNTHETIC-HISTORY'])
            self.assertEqual(cursor.fetchone(), (None, self.reference))
            cursor.execute(store.read_sql('SELECT curriculum_module_ref FROM curriculum.source_courses WHERE id=%s'), ['SYNTHETIC-HISTORY'])
            self.assertEqual(cursor.fetchone()[0], self.reference)

    def test_unresolved_assignment_aborts_relation_migration_without_rewriting_history(self):
        models, source, profile, course_id, component_id = self.learner_fixture()
        old = models.LearnerFreeCourseProgress.objects.using('default').create(
            learner_id=source.pk, free_course_ref=course_id, component_ref=component_id, completed_at=timezone.now())
        models.LearnerFreeCourse.objects.using('default').create(learner_id=profile.pk,
            position=1, free_course_ref='UNRESOLVED', free_course_title='Retained assignment')
        with self.assertRaisesRegex(RuntimeError, 'Unresolved'), transaction.atomic():
            self.install_relations()
        old.refresh_from_db(using='default')
        self.assertEqual(old.learner_id, source.pk)

    def test_preparation_does_not_activate_or_remove_originals(self):
        schema.prepare(connection)
        self.assertFalse(store.enabled())
        self.assertEqual(v.authoring_fetch_all('modules', 'module_catalogue_id=%s', [self.reference]),
                         self.before['modules'])

    def test_imported_progress_placeholder_completes_once_without_rewriting_its_id(self):
        from datetime import timedelta
        from importlib import import_module
        from learner_api.free_course_progress import completed_component_refs, save_completion
        models, source, profile, course_id, component_id = self.learner_fixture()
        self.install_relations()
        with connection.schema_editor() as editor:
            import_module('learner_api.migrations.0027_free_course_progress_state').install(None, editor)
        progress = models.LearnerFreeCourseProgress.objects.using('default')
        placeholder = progress.create(learner_id=profile.pk, free_course_ref=course_id,
                                      component_ref=component_id, completed_at=None)
        at = timezone.now()
        with patch.object(models.LearnerFreeCourseProgress, 'objects', progress):
            self.assertEqual(completed_component_refs(profile.pk), set())
            self.assertTrue(save_completion(profile.pk, component_id, course_id, at))
            self.assertTrue(save_completion(profile.pk, component_id, course_id, at + timedelta(days=1)))
            self.assertEqual(completed_component_refs(profile.pk), {component_id})
            self.assertEqual(completed_component_refs(profile.pk + 1), set())
        placeholder.refresh_from_db(using='default')
        self.assertEqual(placeholder.completed_at, at)
        self.assertEqual(progress.filter(learner_id=profile.pk, component_ref=component_id).count(), 1)

    def test_compatible_week_fields_follow_edits_and_keep_archived_positions(self):
        from importlib import import_module
        schema.detach(connection)
        with connection.schema_editor() as editor:
            import_module('curriculum_api.migrations.0087_free_course_compatible_fields').install(None, editor)
        store.upsert('weeks', {'id': 'WEEK-INDEPENDENT', 'module_catalogue_id': self.reference,
            'title': 'Edited title', 'summary': 'Retained summary', 'display_order': 1,
            'holiday_note_enabled': True, 'holiday_note': 'Break', 'learning_outcomes': ['Outcome']})
        with connection.cursor() as cursor:
            cursor.execute('''SELECT title,summary,learning_outcomes,holiday_note_enabled,holiday_note
                FROM curriculum.free_course_weeks WHERE content_ref=%s''', ['WEEK-INDEPENDENT'])
            title, summary, outcomes, enabled, note = cursor.fetchone()
            if isinstance(outcomes, str):
                outcomes = json.loads(outcomes)
            self.assertEqual((title,summary,outcomes,enabled,note),
                             ('Edited title','Retained summary',['Outcome'],True,'Break'))
        store.upsert('weeks', {'id': 'WEEK-INDEPENDENT', 'module_catalogue_id': self.reference,
                              'deleted_at': timezone.now()})
        store.upsert('weeks', {'id': 'WEEK-REPLACEMENT', 'module_catalogue_id': self.reference,
                              'title': 'Replacement', 'week_number': 1, 'display_order': 1})
        with connection.cursor() as cursor:
            cursor.execute('SELECT status,count(*) FROM curriculum.free_course_weeks GROUP BY status')
            self.assertEqual(dict(cursor.fetchall()), {'active': 1, 'inactive': 1})

    def test_archived_progress_remains_archived_and_is_not_reported_as_completed(self):
        from importlib import import_module
        from learner_api.free_course_progress import completed_component_refs, save_completion
        models, source, profile, course_id, component_id = self.learner_fixture()
        self.install_relations()
        with connection.schema_editor() as editor:
            import_module('learner_api.migrations.0027_free_course_progress_state').install(None, editor)
        progress = models.LearnerFreeCourseProgress.objects.using('default')
        at = timezone.now()
        row = progress.create(learner_id=profile.pk, free_course_ref=course_id,
                              component_ref=component_id, completed_at=at)
        with connection.cursor() as cursor:
            cursor.execute('UPDATE "Learner".learner_free_course_progress '
                           "SET status='inactive', deleted_at=%s WHERE id=%s", [at, row.pk])
            cursor.execute('SELECT to_jsonb(p) FROM "Learner".learner_free_course_progress p WHERE id=%s', [row.pk])
            before = cursor.fetchone()[0]
        with patch.object(models.LearnerFreeCourseProgress, 'objects', progress):
            self.assertEqual(completed_component_refs(profile.pk), set())
            self.assertFalse(save_completion(profile.pk, component_id, course_id, timezone.now()))
        with connection.cursor() as cursor:
            cursor.execute('SELECT to_jsonb(p) FROM "Learner".learner_free_course_progress p WHERE id=%s', [row.pk])
            self.assertEqual(cursor.fetchone()[0], before)

    def test_alignment_batch_preserves_existing_rows_and_only_appends_assignments(self):
        from importlib import import_module
        from .free_course_alignment import TABLES, Plan, apply_plan, rows
        models, source, profile, course_id, component_id = self.learner_fixture()
        self.install_relations()
        schema.detach(connection)
        with connection.schema_editor() as editor:
            import_module('learner_api.migrations.0027_free_course_progress_state').install(None, editor)
        before = {table: rows(connection, sql.SQL('SELECT * FROM {} ORDER BY id').format(
            sql.Identifier(namespace,table))) for table,namespace in TABLES.items()}
        inserts = {table: [] for table in TABLES}
        inserts['free_courses'] = [dict(id='FC-ALIGN',course_name='Imported synthetic course',
            storage_version=2,content_ref='MOD-ALIGN',managed_by_builder=True)]
        inserts['free_course_weeks'] = [dict(id='FW-ALIGN',course_id='FC-ALIGN',week_number=1,
            week_title='Imported week',content_ref='WEEK-ALIGN',week_id='WEEK-ALIGN')]
        inserts['free_programme_components'] = [dict(id='CP-ALIGN',free_module_id='FW-ALIGN',
            content_ref='COMP-ALIGN',week_id='WEEK-ALIGN',programme_id='FREE-COURSES',type='reading',title='Imported reading')]
        inserts['learner_free_courses'] = [dict(learner_id=profile.pk,free_course_ref='FC-ALIGN',
            free_course_title='Imported synthetic course',position=1)]
        inserts['learner_free_course_progress'] = [dict(learner_id=profile.pk,free_course_ref='FC-ALIGN',
            component_ref='CP-ALIGN',completed_at=None,status='active',deleted_at=None)]
        addition = dict(freeCourseId='FC-ALIGN',courseName='Imported synthetic course',addedAt='')
        apply_plan(connection,Plan(inserts,{source.pk:[addition]},'synthetic',0),before)
        source.refresh_from_db(using='default')
        self.assertEqual(source.free_courses,[addition])
        self.assertIsNone(models.LearnerFreeCourseProgress.objects.using('default').get(component_ref='CP-ALIGN').completed_at)
        self.assertEqual(models.LearnerProgressEntry.objects.using('default').filter(learner=profile).count(),0)
        for table in TABLES:
            self.assertEqual(len(rows(connection,sql.SQL('SELECT id FROM {}').format(sql.Identifier(TABLES[table],table)))),
                             len(before[table])+1)

    def test_unknown_cascade_relationship_aborts_cutover_and_preserves_content(self):
        with connection.cursor() as cursor:
            cursor.execute('''CREATE TABLE curriculum.synthetic_course_history
                (id text PRIMARY KEY, course_ref varchar(128)
                 REFERENCES curriculum.modules(module_catalogue_id) ON DELETE CASCADE)''')
            cursor.execute('INSERT INTO curriculum.synthetic_course_history VALUES (%s,%s)', ['HISTORY-1', self.reference])
        with self.assertRaisesRegex(RuntimeError, 'Unmigrated free-course relationship'), transaction.atomic():
            schema.detach(connection)
        self.assertFalse(store.enabled())
        self.assertEqual(v.authoring_fetch_all('modules', 'module_catalogue_id=%s', [self.reference]), self.before['modules'])
        with connection.cursor() as cursor:
            cursor.execute('SELECT course_ref FROM curriculum.synthetic_course_history WHERE id=%s', ['HISTORY-1'])
            self.assertEqual(cursor.fetchone()[0], self.reference)

    def test_native_authoring_survives_without_ordinary_content_tables(self):
        original = v.get_authoring_structure_payload(self.reference)
        schema.detach(connection)
        # This deliberately removes the mixed catalogue views too. A native
        # course must keep its own schema, read path and writer without them.
        with connection.cursor() as cursor:
            for table in schema.TABLES:
                cursor.execute(f'DROP TABLE curriculum.{table} CASCADE')
        store.reset()
        self.assertTrue(store.enabled())
        current = v.get_authoring_structure_payload(self.reference)
        self.assertEqual(current, original)
        current['weekStructure'][0]['components'][0]['title'] = 'Independent edit'
        saved = v.save_module_authoring_structure(self.reference, current, repair_links=False)
        self.assertEqual(saved['weekStructure'][0]['components'][0]['title'], 'Independent edit')
        v._TABLE_COLUMNS_CACHE.clear()
        v.authoring_upsert('modules', ['module_catalogue_id'], {
            'module_catalogue_id': self.reference, 'description': 'Native metadata',
        })
        from learner_api.free_course_catalogue import builder_free_courses
        catalogue = builder_free_courses([self.reference])[0]
        self.assertEqual(catalogue['courseName'], 'Independent course')
        self.assertEqual(catalogue['description'], 'Native metadata')
        v.authoring_bulk_upsert('weeks', ['id'], (row for row in [{
            'id': 'WEEK-INDEPENDENT', 'module_catalogue_id': self.reference, 'title': 'Independent week',
        }]))
        self.assertEqual(v.get_authoring_structure_payload(self.reference)['weekStructure'][0]['title'], 'Independent week')
        v.save_module_authoring_structure('MOD-FREE-ISOLATED', {
            'isFreeCourse': True, 'title': 'Created independently', 'weekStructure': [],
        }, repair_links=False)
        self.assertIsNotNone(store.course('MOD-FREE-ISOLATED'))
        v.delete_module_authoring_structure(self.reference)
        self.assertIsNotNone(store.course(self.reference)['deleted_at'])
        response = v.curriculum_module_restore(RequestFactory().post('/'), self.reference)
        self.assertEqual(response.status_code, 200, response.content)
        restored = v.get_authoring_structure_payload(self.reference)
        self.assertEqual(restored['weekStructure'][0]['components'][0]['title'], 'Independent edit')
        self.assertIsNone(store.course(self.reference)['deleted_at'])

    def test_native_and_mixed_catalogue_reads_do_not_share_cached_rows(self):
        schema.detach(connection)
        v.authoring_upsert('modules', ['module_catalogue_id'], {
            'module_catalogue_id': 'MOD-REGULAR-CACHE', 'title': 'Ordinary module',
            'source_type': 'module_authoring',
        })
        def identities():
            return {row['module_catalogue_id'] for row in v.authoring_fetch_all('modules')}
        with v.curriculum_read_scope():
            mixed = identities()
            self.assertIn('MOD-REGULAR-CACHE', mixed)
            with store.native_authoring_scope():
                self.assertEqual(identities(), {self.reference})
            self.assertEqual(identities(), mixed)

    def test_cutover_keeps_all_learning_rows_without_ordinary_storage(self):
        schema.detach(connection)
        self.assertTrue(store.enabled())
        with connection.cursor() as cursor:
            for table in schema.TABLES:
                cursor.execute(f'SELECT count(*) FROM curriculum.{table} WHERE module_catalogue_id=%s', [self.reference])
                self.assertEqual(cursor.fetchone()[0], 0, table)
                cursor.execute(f'SELECT * FROM {store.read_table(table)} WHERE module_catalogue_id=%s', [self.reference])
                names = [c[0] for c in cursor.description]
                self.assertEqual([dict(zip(names, r)) for r in cursor.fetchall()], self.before[table], table)
            for table, old in [('free_courses', 'module_catalogue_id'), ('free_course_weeks', 'authoring_week_id'),
                               ('free_programme_components', 'authoring_component_id')]:
                cursor.execute('SELECT count(*) FROM information_schema.columns WHERE table_schema=%s AND table_name=%s AND column_name=%s',
                               ['curriculum', table, old])
                self.assertEqual(cursor.fetchone()[0], 0)

    def test_independent_edits_preserve_unnamed_fields(self):
        schema.detach(connection)
        previous = self.before['components'][0]
        saved = store.upsert('components', {**previous, 'title': 'Revised', 'expected_otjh': 2})
        self.assertEqual(saved['title'], 'Revised')
        self.assertEqual(saved['settings_json'], previous['settings_json'])
        store.upsert('modules', {'module_catalogue_id': 'NEW-FREE', 'source_type': 'free_course', 'title': 'New course'})
        self.assertIsNotNone(store.course('NEW-FREE'))
        with connection.cursor() as cursor:
            cursor.execute("SELECT count(*) FROM curriculum.modules WHERE source_type='free_course'")
            self.assertEqual(cursor.fetchone()[0], 0)

    def test_builder_round_trip_uses_only_independent_storage(self):
        original = v.get_authoring_structure_payload(self.reference)
        schema.detach(connection)
        current = v.get_authoring_structure_payload(self.reference)
        self.assertEqual(current, original)
        current['weekStructure'][0]['components'][0]['title'] = 'Updated in Builder'
        saved = v.save_module_authoring_structure(self.reference, current, repair_links=False)
        self.assertEqual(saved['weekStructure'][0]['components'][0]['title'], 'Updated in Builder')
        self.assertTrue(saved['isFreeCourse'])
        self.assertEqual(saved['price'], '12.50')
        with connection.cursor() as cursor:
            for table in ('modules', 'weeks', 'components'):
                cursor.execute(f'SELECT count(*) FROM curriculum.{table} WHERE module_catalogue_id=%s', [self.reference])
                self.assertEqual(cursor.fetchone()[0], 0)

    def test_builder_creates_new_course_and_children_without_module_rows(self):
        schema.detach(connection)
        reference = 'MOD-FREE-NEW-NATIVE'
        saved = v.save_module_authoring_structure(reference, {
            'isFreeCourse': True, 'title': 'New independent course',
            'weekStructure': [{'id': 'WEEK-NEW-NATIVE', 'title': 'Study', 'components': [
                {'id': 'COMP-NEW-NATIVE', 'type': 'reading', 'title': 'New reading',
                 'expectedOtjh': 2, 'settings': {'readingContent': '<p>New content</p>'}},
            ]}],
        }, repair_links=False)
        self.assertTrue(saved['isFreeCourse'])
        self.assertEqual(saved['weekStructure'][0]['components'][0]['title'], 'New reading')
        self.assertIsNotNone(store.course(reference))
        with connection.cursor() as cursor:
            cursor.execute('SELECT count(*) FROM curriculum.free_programme_components WHERE content_ref=%s', ['COMP-NEW-NATIVE'])
            self.assertEqual(cursor.fetchone()[0], 1)
            for table in ('modules', 'weeks', 'components'):
                cursor.execute(f'SELECT count(*) FROM curriculum.{table} WHERE module_catalogue_id=%s', [reference])
                self.assertEqual(cursor.fetchone()[0], 0)

    def test_learner_catalogue_plan_and_completion_metadata_survive_cutover(self):
        from learner_api.free_course_catalogue import builder_free_courses
        from learner_api.learning_plan import _modules_by_id
        from learner_api.components import _component_meta
        from learner_api.my_learning import catalogue_module_rows
        from learner_api.training_plan_dashboard import plan_planned_hours
        with patch('learner_api.components.connections', {'enrolment': connection}):
            self.assertEqual(_component_meta('COMP-INDEPENDENT'), ('reading', 'Read'))
        from learner_api.personal_learning import module_row
        with patch('learner_api.personal_learning.connections', {'enrolment': connection}):
            self.assertEqual(module_row(self.reference)['source_type'], 'free_course')
        catalogue = builder_free_courses([self.reference])
        plan = _modules_by_id([self.reference])
        with connection.cursor() as cursor:
            metadata = {}
            cards = catalogue_module_rows(cursor, [self.reference], identity_metadata=metadata)
        schema.detach(connection)
        self.assertEqual(builder_free_courses([self.reference]), catalogue)
        self.assertEqual(builder_free_courses(['UNASSIGNED-OTHER']), [])
        self.assertEqual(_modules_by_id([self.reference]), plan)
        # TestCase's uncommitted schema/data is visible on its transaction,
        # while an independent enrolment connection cannot see that fixture.
        with patch('learner_api.components.connections', {'enrolment': connection}):
            self.assertEqual(_component_meta('COMP-INDEPENDENT'), ('reading', 'Read'))
        with connection.cursor() as cursor:
            native_metadata = {}
            self.assertEqual(catalogue_module_rows(cursor, [self.reference], identity_metadata=native_metadata), cards)
        with patch('learner_api.personal_learning.connections', {'enrolment': connection}):
            self.assertEqual(module_row(self.reference)['source_type'], 'free_course')
        self.assertEqual(native_metadata, metadata)
        with patch('learner_api.training_plan_dashboard.connections', {'enrolment': connection}):
            self.assertEqual(plan_planned_hours(SimpleNamespace(learner_type='apprenticeship'), {}, ids=[self.reference]), 0)
            self.assertEqual(plan_planned_hours(SimpleNamespace(learner_type='commercial'), {}, ids=[self.reference]), 1)
        from learner_api.active_users import component_reference_exists, component_reference_state
        with patch('learner_api.active_users.connections', {'default': connection, 'enrolment': connection}):
            self.assertTrue(component_reference_exists('COMP-INDEPENDENT'))
            self.assertEqual(component_reference_state('COMP-INDEPENDENT'), ('active', ''))
