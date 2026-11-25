"""Synthetic parity against the actual frozen pre-extraction source bodies."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_patch
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from curriculum_api.catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType, ModuleType, SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views, learner_directory as directory, learner_directory_details as details

SNAPSHOT = json.loads((Path(__file__).parents[2] / 'directory/tests/fixtures/legacy_snapshots/boundary_snapshot.json').read_text(encoding='utf-8'))
MODULES = {'views.py': views, 'learner_directory.py': directory, 'learner_directory_details.py': details}


@contextmanager
def original_directory_workspace(*, http=False):
    """Restore original functions with real module globals and original decorators."""
    with ExitStack() as stack:
        for key, entry in SNAPSHOT.items():
            filename, name = key.split(':')
            module = MODULES[filename]
            if isinstance(getattr(module, name), Mock):
                continue
            namespace = dict(vars(module))
            exec(compile(entry['source'], '<pre-directory-workspace>', 'exec'), namespace)
            compiled = namespace[name]
            original = FunctionType(compiled.__code__, vars(module), name, compiled.__defaults__)
            original.__kwdefaults__ = compiled.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                original = eval(decorator, vars(module))(original)
            stack.enter_context(patch.object(module, name, original))
        if http:
            # URLPattern callbacks are bound objects, not live module lookups.
            # Bind the frozen handlers explicitly for real Client parity.
            from django.test import override_settings
            from django.urls import path
            urls = ModuleType('frozen_directory_workspace_urls')
            urls.urlpatterns = [
                path('curriculum/learner-directory/learners/', directory.learners),
                path('curriculum/learner-directory/counts/', directory.counts),
                path('curriculum/tutor-workspace/', views.curriculum_tutor_workspace),
            ]
            stack.enter_context(override_settings(ROOT_URLCONF=urls))
        yield


class DirectoryWorkspaceParity(SimpleTestCase):
    def setUp(self):
        self.request = RequestFactory()
        self.enterContext(composition_fixture(views, 'logger'))
        self.enterContext(patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}))
        self.enterContext(patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')))

    def compare(self, filename, name, *args, **kwargs):
        with original_directory_workspace():
            expected = getattr(MODULES[filename], name)(*deepcopy(args), **deepcopy(kwargs))
        owner = importlib.import_module(SNAPSHOT[filename + ':' + name]['owner'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(MODULES[filename], name)(*deepcopy(args), **deepcopy(kwargs))
        called.assert_called_once()
        if hasattr(actual, 'status_code'):
            self.assertEqual((actual.status_code, actual.content, dict(actual.items())),
                             (expected.status_code, expected.content, dict(expected.items())))
        else:
            self.assertEqual(actual, expected)
        return actual

    def test_programme_sql_projection_identity_nulls_and_order(self):
        fake = MagicMock(vendor='postgresql', alias='default')
        cursor = fake.cursor.return_value.__enter__.return_value
        rows = [{'id': 12, 'enrolment_id': 900, 'full_name': 'Z', 'cohort_id': ' C ', 'group_id': None},
                {'id': 2, 'enrolment_id': None, 'email': 'a@example.invalid', 'completed_hours': '1.25'},
                {'id': 3, 'enrolment_id': 0, 'full_name': 'A'}]
        with composition_fixture(views, 'connection', fake), \
             composition_fixture(views, 'learner_schema_table_exists', return_value=True), \
             composition_fixture(views, 'rows_as_dicts', return_value=rows), \
             patch('learner_api.learner_coach_columns.owner_coach_sql', return_value='NULL AS coach_name, NULL AS coach_email'):
            result = self.compare('views.py', 'assigned_learners_for_programme', ' P ', ' ACTIVE ', strict=True)
        self.assertEqual(cursor.execute.call_args_list[0], cursor.execute.call_args_list[1])
        self.assertEqual(cursor.execute.call_args.args[1], ['P', 'active'])
        self.assertEqual({row['id']: row['enrolmentId'] for row in result}, {12: 900, 2: None, 3: 0})
        self.assertEqual(next(row for row in result if row['id'] == 12)['cohortId'], 'C')
        self.assertNotIn('learningPlan', result[0])

    def test_programme_unavailable_and_strict_failure_are_not_changed(self):
        for vendor in ('sqlite', 'postgresql'):
            with self.subTest(vendor=vendor), composition_fixture(views, 'connection', Mock(vendor=vendor)), \
                 composition_fixture(views, 'learner_schema_table_exists', return_value=False):
                self.assertEqual(self.compare('views.py', 'assigned_learners_for_programme', 'P'), [])
                for old in (True, False):
                    with (original_directory_workspace() if old else ExitStack()), self.assertRaises(DatabaseError):
                        views.assigned_learners_for_programme('P', strict=True)

    def test_programme_query_error_keeps_strict_and_compatibility_modes(self):
        fake = Mock(vendor='postgresql', alias='default')
        fake.cursor.side_effect = DatabaseError('synthetic query failure')
        with composition_fixture(views, 'connection', fake), composition_fixture(views, 'learner_schema_table_exists', return_value=True), \
             patch('learner_api.learner_coach_columns.owner_coach_sql', return_value='NULL AS coach_name, NULL AS coach_email'):
            self.assertEqual(self.compare('views.py', 'assigned_learners_for_programme', 'P'), [])
            for old in (True, False):
                with (original_directory_workspace() if old else ExitStack()), self.assertRaisesRegex(DatabaseError, 'synthetic query'):
                    views.assigned_learners_for_programme('P', strict=True)

    def test_programme_memoization_is_identical_for_old_and_new_sources(self):
        for old in (True, False):
            with (original_directory_workspace() if old else ExitStack()), \
                 composition_fixture(views, 'connection', SimpleNamespace(vendor='postgresql')), \
                 composition_fixture(views, 'learner_schema_table_exists', return_value=False) as probe:
                with views.curriculum_read_scope():
                    views.assigned_learners_for_programme('P', 'active')
                    views.assigned_learners_for_programme('P', 'active')
                    views.assigned_learners_for_programme('P', '')
                    self.assertEqual(probe.call_count, 2)
                views.assigned_learners_for_programme('P', 'active')
                self.assertEqual(probe.call_count, 3)

    def test_scope_manual_inherited_and_nonmodule_port_arguments(self):
        rows = [{'id': 1, 'cohortId': ' C ', 'groupId': 'G'}, {'id': 2, 'cohortId': 'OTHER', 'groupId': 'G'}]
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='postgresql')), \
             composition_fixture(views, 'assigned_learners_for_programme', return_value=rows) as programme, \
             patch('curriculum_api.learner_assignments.module_assignment_roster', side_effect=lambda mid, placed, status: placed + [{'id': 99}]) as module:
            for scope in ('programme', 'cohort', 'group', 'module', 'week', 'component'):
                for mode in ('inherited', 'manual'):
                    with self.subTest(scope=scope, mode=mode):
                        module.reset_mock(); programme.reset_mock()
                        lineage = {'programmeId': 'P', 'cohortId': 'C', 'groupId': 'G', 'moduleCatalogueId': 'M', 'learnerRosterMode': mode}
                        result = self.compare('views.py', 'assigned_learners_for_scope', scope, 'I', 'active', lineage, strict=True)
                        if scope in {'module', 'week', 'component'}:
                            self.assertEqual(module.call_args_list[0], module.call_args_list[1])
                            self.assertEqual(module.call_args.args[1], [] if mode == 'manual' else [rows[0]])
                            self.assertIn({'id': 99}, result)
                        else:
                            module.assert_not_called()
                        if programme.called:
                            self.assertEqual(programme.call_args.kwargs, {'strict': True})

    def test_missing_scope_no_programme_and_direct_outside_placement(self):
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='postgresql')), \
             composition_fixture(views, 'scope_placement_lineage', return_value={}), \
             patch('curriculum_api.learner_assignments.module_assignment_roster', return_value=[{'id': 8}]) as module:
            self.assertEqual(self.compare('views.py', 'assigned_learners_for_scope', 'module', 'M'), [])
            module.assert_not_called()
            result = self.compare('views.py', 'assigned_learners_for_scope', 'module', 'M', lineage={'moduleCatalogueId': 'M'})
            self.assertEqual(result, [{'id': 8}])

    def test_placement_id_whitespace_case_and_missing_key_contracts(self):
        rows = [{'id': 1, 'cohortId': '\tC\u00a0'}, {'id': 2, 'cohortId': 'c'}, {'id': 3, 'cohort': 'same'}]
        for identifier, label in [('C', 'renamed'), ('', 'same'), (None, ''), ('c', '')]:
            self.compare('views.py', 'narrow_learners_to_placement', rows, 'cohortId', identifier, 'cohort', label)
        for lineage in ({}, {'programmeId': '\u3000P\t', 'programmeName': 'other'}, {'programmeName': 'Name'}):
            self.compare('views.py', 'scope_programme_identifier', lineage)

    def test_directory_roster_duplicate_profiles_status_fallback_and_bridges(self):
        rows = [{'id': 2, 'name': 'B', 'lifecycleStatus': '', 'programmeStatus': ' Active ', 'enrolmentId': 0},
                {'id': 1, 'name': 'a', 'lifecycleStatus': 'withdrawn', 'programmeStatus': 'Active', 'enrolmentId': None},
                {'id': 2, 'name': 'C', 'lifecycleStatus': 'active', 'enrolmentId': 900}]
        with composition_fixture(views, 'scope_placement_lineage', return_value={'found': True}), \
             composition_fixture(views, 'assigned_learners_for_scope', return_value=rows) as read:
            for status in ('active', 'all'):
                result = self.compare('learner_directory.py', 'roster', 'module', 'M', status)
                self.assertEqual(len(result), 1 if status == 'active' else 2)
                self.assertEqual(read.call_args.kwargs, {'lineage': {'found': True}, 'strict': True})

    def test_directory_missing_is_distinct_from_empty(self):
        with composition_fixture(views, 'scope_placement_lineage', return_value={'found': False}), \
             composition_fixture(views, 'assigned_learners_for_scope', return_value=[]) as read:
            self.assertIsNone(self.compare('learner_directory.py', 'roster', 'module', 'M', 'all'))
            read.assert_not_called()
        with composition_fixture(views, 'scope_placement_lineage', return_value={'found': True}), composition_fixture(views, 'assigned_learners_for_scope', return_value=[]):
            self.assertEqual(self.compare('learner_directory.py', 'roster', 'module', 'M', 'all'), [])

    def test_counts_limits_deduplication_and_sanitized_errors(self):
        with composition_patch('curriculum_api.learner_status_counts.status_counts', return_value={'M': {'active': 1}}) as read:
            for query in ({'scope': 'module', 'ids': ' M,M, N '}, {'scope': 'bad', 'ids': 'M'}, {'scope': 'module', 'ids': ','.join(map(str, range(101)))}):
                read.reset_mock()
                self.compare('learner_directory.py', 'counts', self.request.get('/', query))
                if read.called:
                    self.assertEqual(read.call_args_list[0], read.call_args_list[1])
            read.side_effect = DatabaseError('private')
            response = self.compare('learner_directory.py', 'counts', self.request.get('/', {'scope': 'module', 'ids': 'M'}))
            self.assertEqual(response.status_code, 503)
            self.assertNotIn(b'private', response.content)

    def test_list_lifecycle_search_pagination_and_failure_parity(self):
        rows = [{'id': str(i), 'name': f'Synthetic {i:02}', 'email': 'x@example.invalid', 'status': 'active' if i % 2 else 'withdrawn'} for i in range(60)]
        with patch.object(directory, 'roster', return_value=rows) as read:
            for extra in ({}, {'lifecycle_status': ' Active ', 'page': '2'}, {'q': '59'}, {'page': 'bad'}, {'q': 'x' * 101}):
                self.compare('learner_directory.py', 'learners', self.request.get('/', {'scope': 'module', 'id': 'M', 'status': 'all', **extra}))
            for value in (None, []):
                read.return_value = value
                self.compare('learner_directory.py', 'learners', self.request.get('/', {'scope': 'module', 'id': 'M'}))
            read.side_effect = DatabaseError('private')
            self.assertEqual(self.compare('learner_directory.py', 'learners', self.request.get('/', {'scope': 'module', 'id': 'M'})).status_code, 503)

    def test_tutor_identity_email_first_then_existing_name_match(self):
        rows = [{'id': 'A', 'email': '', 'name': 'Same'}, {'id': 'B', 'email': 'a@example.invalid', 'name': 'Same'}]
        with composition_fixture(views, 'get_staff_profile_rows', return_value=rows) as read:
            for email, name in [(' A@example.invalid ', 'same'), ('missing', ' SAME '), ('', ''), ('missing', 'missing')]:
                self.compare('views.py', 'tutor_profile_for_identity', email, name)
            self.assertEqual(read.call_args.kwargs, {'include_archived': False})

    def test_tutor_projection_nulls_and_native_dates(self):
        from datetime import date, time
        for row in ({}, {'module_catalogue_id': ' M ', 'start_date': date(2028, 1, 1), 'session_start_time': time(9), 'total_otjh': 0, 'sessions_number': None}):
            self.compare('views.py', 'tutor_workspace_module_payload', row)

    def test_tutor_unlinked_and_missing_inputs_do_not_read_assignments(self):
        with composition_fixture(views, 'tutor_profile_for_identity', return_value=(None, '')), \
             composition_fixture(views, 'staff_profile_assignment_ids') as grants, \
             composition_fixture(views, 'tutor_workspace_next_session_by_module') as sessions:
            for query in ({}, {'email': 'synthetic@example.invalid'}):
                self.compare('views.py', 'curriculum_tutor_workspace', self.request.get('/', query))
            grants.assert_not_called(); sessions.assert_not_called()
        self.assertEqual(views.curriculum_tutor_workspace(self.request.post('/')).status_code, 405)

    def test_tutor_workspace_sql_and_order_with_opaque_session_capability(self):
        fake = MagicMock(vendor='postgresql')
        cursor = fake.cursor.return_value.__enter__.return_value
        rows = [{'module_catalogue_id': 'B', 'title': 'B'}, {'module_catalogue_id': 'A', 'title': 'A'}]
        session_rows = {'A': {'scheduledStart': '2028-02-01'}, 'B': {'scheduledStart': '2028-01-01'}}
        with composition_fixture(views, 'connection', fake), \
             composition_fixture(views, 'tutor_profile_for_identity', return_value=({'id': 'T', 'name': 'Synthetic'}, 'email')), \
             composition_fixture(views, 'staff_profile_assignment_ids', return_value=['B', 'A']), \
             composition_fixture(views, 'tutor_workspace_next_session_by_module', return_value=session_rows) as sessions, \
             composition_fixture(views, 'rows_as_dicts', return_value=rows), \
             composition_fixture(views, 'module_expected_otjh_sql', return_value='0'):
            result = json.loads(self.compare('views.py', 'curriculum_tutor_workspace', self.request.get('/', {'email': 't@example.invalid'})).content)
        self.assertEqual(cursor.execute.call_args_list[0], cursor.execute.call_args_list[1])
        self.assertEqual([m['moduleCatalogueId'] for m in result['modules']], ['B', 'A'])
        self.assertEqual(result['nextSession'], session_rows['B'])
        self.assertEqual(sessions.call_args_list[0], sessions.call_args_list[1])

    def test_tutor_generic_reader_and_empty_grant_preserve_call_order(self):
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='sqlite')), \
             composition_fixture(views, 'tutor_profile_for_identity', return_value=({'id': 'T'}, 'name')), \
             composition_fixture(views, 'staff_profile_assignment_ids', return_value=['M']) as grants, \
             composition_fixture(views, 'tutor_workspace_next_session_by_module', return_value={}) as sessions, \
             composition_fixture(views, 'authoring_fetch_all', return_value=[]) as read:
            self.compare('views.py', 'curriculum_tutor_workspace', self.request.get('/', {'name': 'T'}))
            self.assertEqual(read.call_args_list[0], read.call_args_list[1])
            grants.return_value = []; read.reset_mock(); sessions.reset_mock()
            self.compare('views.py', 'curriculum_tutor_workspace', self.request.get('/', {'name': 'T'}))
            read.assert_not_called()
            self.assertEqual(sessions.call_args.args, ([],))

    def test_progress_denominators_and_invalid_dates_match_original(self):
        for items in ([], [{'completed': True, 'schedule': {'date': '2028-01-01'}}],
                      [{'completed': False, 'schedule': {'date': 'bad'}}],
                      [{'completed': True, 'schedule': {'date_source': 'introduction'}}],
                      [{'completed': False, 'schedule': {'due_timing': 'end of week', 'delivery_week': {'end': '2028-02-01'}}}]):
            self.compare('learner_directory_details.py', 'activity_summary', items, '2028-01-15')

    def test_progress_verified_identity_and_exact_import_links(self):
        source = SimpleNamespace(pk=901)
        metadata = {'current_subjects': [], 'modules': {}, 'imported_courses': {'current:M': 'legacy:1'}, 'replacement_courses': {}}
        context = ([], [], [], {}, [], [], set(), set(), {}, metadata, [])
        cards = [{'id': 'legacy:1', '_activityItems': [{'completed': True, 'schedule': {'date': '2028-01-01'}}]},
                 {'id': 'current:other', '_activityItems': [{'completed': False}]}]
        with patch('learner_api.canonical_learning.require_profile', return_value={'id': 7}) as identity, \
             patch('learner_api.my_learning.load_context', return_value=context) as load, \
             patch('learner_api.my_learning.assemble_cards', return_value=(cards, {})):
            result = self.compare('learner_directory_details.py', 'learner_progress', source, '7', {'M'}, '2028-01-15')
            self.assertEqual(result['available']['total'], 1)
            self.assertEqual(identity.call_args.args, (901,))
            identity.return_value = {'id': 8}; load.reset_mock()
            for old in (True, False):
                with (original_directory_workspace() if old else ExitStack()), self.assertRaises(details.ServiceError):
                    details.learner_progress(source, '7', {'M'}, '2028-01-15')
            load.assert_not_called()
