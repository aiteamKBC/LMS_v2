"""Frozen original-source parity and strict directory failure contracts."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from .catalogue.tests.parity.read_dependency_test_support import observe_export
from contextlib import ExitStack, contextmanager
from copy import deepcopy
import importlib
import json
from pathlib import Path
from types import FunctionType, SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from . import views
from .catalogue.application import staff_profiles
from .catalogue.infrastructure import staff_directory

SNAPSHOT = json.loads((Path(__file__).parent / 'catalogue/tests/fixtures/legacy_snapshots/staff_profiles_snapshot.json').read_text(encoding='utf-8'))


@contextmanager
def original_staff_profiles():
    with ExitStack() as stack:
        for name, entry in SNAPSHOT.items():
            if isinstance(getattr(views, name), Mock):
                continue
            namespace = dict(vars(views))
            exec(compile(entry['source'], '<original-staff-profiles>', 'exec'), namespace)
            fn = namespace[name]
            restored = FunctionType(fn.__code__, vars(views), name, fn.__defaults__)
            restored.__kwdefaults__ = fn.__kwdefaults__
            for decorator in reversed(entry['decorators']):
                restored = eval(decorator, vars(views))(restored)
            stack.enter_context(composition_fixture(views, name, restored))
        yield


class StaffProfileParity(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.factory = RequestFactory()
        self.people = [{'id': 'T', 'uuid': 'uuid-t', 'staffUserId': '42', 'name': 'Tutor One',
                        'email': 'tutor@example.invalid', 'status': 'active'},
                       {'id': 'OLD', 'name': 'Archived', 'email': 'old@example.invalid', 'status': 'archived', 'is_archived': True}]
        self.modules = [{'id': 'MOD-A', 'moduleId': 'alias-A', 'name': 'Alpha', 'tutor': 'Tutor One',
                         'programme': 'P', 'startDate': '2028-01-01', 'status': 'active'},
                        {'id': 'MOD-B', 'name': 'Beta', 'tutor': 'Other', 'groupId': 'G', 'status': 'draft'}]
        self.groups = [{'id': 'G', 'coach': 'Tutor One'}, {'id': 'H', 'coaches': ['Tutor One', 'Other']}]
        for name, value in [('get_training_rows', []), ('get_program_config_rows', []),
                            ('authoring_modules_as_catalogue_rows', []), ('build_modules', self.modules),
                            ('build_cohorts_and_groups', ([], self.groups))]:
            self.stack.enter_context(composition_fixture(views, name, return_value=value))

    def compare(self, name, *args, **kwargs):
        old_args, old_kwargs = deepcopy((args, kwargs))
        new_args, new_kwargs = deepcopy((args, kwargs))
        with original_staff_profiles():
            expected = getattr(views, name)(*old_args, **old_kwargs)
        owner = importlib.import_module(SNAPSHOT[name]['module'])
        with observe_export(views, owner, name, wraps=getattr(owner, name)) as called:
            actual = getattr(views, name)(*new_args, **new_kwargs)
        called.assert_called_once()
        self.assertEqual(type(actual), type(expected))
        self.assertEqual(actual, expected)
        self.assertEqual((new_args, new_kwargs), (old_args, old_kwargs))
        return actual

    def test_normalization_sentinels_and_identity_keys(self):
        for value in (None, '', '  ', 'EMPTY_STRING', 'Unassigned', '\u00a0Tutor One\t', 'Tutor-One'):
            for name in ('is_blank_staff_text', 'is_blank_staff_assignment', 'staff_assignment_key'):
                self.compare(name, value)
            self.compare('staff_profile_identity_key', value, ' Test@Example.Invalid ')

    def test_name_email_and_archive_rules(self):
        for row in (None, {}, {'name': 'EMPTY_STRING', 'Tutor_name': 'Fallback', 'email': 'a@example.invalid'},
                    {'name': 'Unassigned', 'Coach_name': 'Coach'}, {'email': ' email@example.invalid '},
                    {'is_archived': 'yes'}, {'status': 'disabled'}, {' Status': 'disabled'}):
            for name in ('staff_profile_name', 'staff_profile_email', 'staff_profile_is_archived', 'staff_user_archived'):
                self.compare(name, row)

    def test_directory_uuid_rowid_and_status_projection(self):
        for role in ('tutor', 'coach'):
            for row in ({}, {'id': 42, 'uuid': ' U ', 'Username': ' Name ', 'Email': 'e@example.invalid', ' Status': 'inactive', 'Access': role.upper()},
                        {'id': 0, 'Username': 'Name', 'status': 'active'}):
                self.compare('staff_user_profile_source', row, role)

    def test_module_identifiers_stored_aliases_and_duplicate_order(self):
        row = dict(self.modules[0], sourceId='prefix MOD-ALT suffix', delivery_row_id='delivery-1')
        self.compare('module_assignment_ids', row)
        for ident in ('MOD-A', 'alias-A', 'MOD-ALT', 'prefix MOD-ALT suffix', 'missing', ''):
            self.compare('module_matches_staff_assignment', row, ident)
        result = self.compare('clean_assignment_ids', [' alias-A ', 'MOD-A', 'MOD-A', 'prefix MOD-ALT suffix', '', None])
        self.assertEqual(result, ['alias-A', 'MOD-A', 'prefix MOD-ALT suffix', 'MOD-ALT'])

    def test_module_summary_progress_status_and_dates(self):
        for row in self.modules + [{'id': 'M', 'status': 'archived', 'startDate': '2000-01-01', 'endDate': '2001-01-01'},
                                   {'id': 'N', 'deliveryStatus': 'in-progress'}, {}]:
            self.compare('module_in_progress', row)
            self.compare('profile_module_summary', row)

    def test_assignments_by_name_stored_id_group_and_sort(self):
        for role in ('tutor', 'coach'):
            actual = self.compare('assigned_modules_for_staff', 'Tutor One', role, self.modules, ['MOD-B'], ['G'])
            self.assertEqual([x['id'] for x in actual], ['MOD-B', 'MOD-A'] if role == 'tutor' else ['MOD-B'])

    def test_tutor_serialization_legacy_stored_ids_and_metadata(self):
        row = dict(self.people[0], assigned_module_ids=['MOD-B'], notes='Synthetic', access='TUTOR')
        result = self.compare('serialize_staff_profile', row, 'tutor', self.modules, self.groups)
        self.assertEqual(result['moduleCount'], 2)
        self.assertEqual(result['inProgressCount'], 1)
        self.assertEqual(result['storedAssignedModuleIds'], ['MOD-B'])

    def test_coach_groups_stored_ids_missing_vs_empty_and_multicoach(self):
        row = dict(self.people[0], assigned_group_ids=['DELETED', 'G', 'G'])
        for groups in (None, [], self.groups):
            self.compare('serialize_staff_profile', row, 'coach', [], groups)
        self.assertEqual(views.serialize_staff_profile(row, 'coach', [], self.groups)['assignedGroupIds'], ['G', 'H'])

    def test_directory_dedup_first_wins_archived_sort_and_no_invented_profiles(self):
        rows = [self.people[1], self.people[0], dict(self.people[0], id='DUP'), {'name': 'Unassigned'}]
        result = self.compare('build_staff_profiles', rows, 'tutor', self.modules, [])
        self.assertEqual([p['id'] for p in result], ['T', 'OLD'])
        self.assertEqual(self.compare('build_staff_profiles', [], 'tutor', self.modules, []), [])

    def test_staff_collection_role_visibility_and_empty_short_circuit(self):
        with composition_fixture(views, 'get_staff_profile_rows', return_value=self.people):
            for role in ('tutor', 'coach'):
                for visibility in ('all', 'operational'):
                    self.compare('build_staff_user_profile_collection', role, visibility)
        with composition_fixture(views, 'get_staff_profile_rows', return_value=[]), composition_fixture(views, 'get_training_rows', side_effect=AssertionError('unused')):
            self.assertEqual(self.compare('build_staff_user_profile_collection', 'tutor'), [])

    def test_curriculum_tutor_source_stays_distinct(self):
        rows = [{'id': 'CT', 'name': 'Tutor One', 'email': 'curriculum@example.invalid', 'status': 'active'},
                {'id': 'ARCH', 'name': 'Gone', 'status': 'disabled'}]
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='postgresql')), composition_fixture(views, 'table_exists', return_value=True), \
                composition_fixture(views, 'fetch_all', return_value=rows), composition_fixture(views, 'get_staff_profile_rows', side_effect=AssertionError('wrong identity source')):
            for visibility in ('operational', 'all'):
                self.compare('build_curriculum_tutor_profile_collection', visibility)

    def test_lookup_exact_id_before_active_email_name_and_aliases(self):
        rows = [dict(self.people[1], name='Tutor One', email=self.people[0]['email']), self.people[0]]
        with composition_fixture(views, 'get_staff_profile_rows', return_value=rows):
            for ident in ('OLD', 'T', ' tutor@example.invalid ', 'Tutor-One', 'missing', ''):
                self.compare('find_staff_profile_row', 'tutor', ident)
            self.assertEqual(views.find_staff_profile_row('tutor', 'tutor@example.invalid')['id'], 'T')
        with composition_fixture(views, 'build_staff_user_profile_collection', return_value=self.people):
            for ident in ('T', 'uuid-t', '42', 'tutor@example.invalid', 'Tutor One', 'missing', ''):
                self.compare('find_staff_user_profile', 'tutor', ident)

    def test_workspace_assignment_ids_preserve_legacy_name_email_and_dedup(self):
        rows = [{'module_catalogue_id': 'MOD-A', 'tutor_name': 'Tutor One'},
                {'module_catalogue_id': 'MOD-B', 'tutor_email': 'TUTOR@example.invalid'},
                {'module_catalogue_id': 'MOD-C', 'tutor_name': 'Other'}]
        with composition_fixture(views, 'safe_authoring_module_rows', return_value=rows):
            result = self.compare('staff_profile_assignment_ids', 'tutor', dict(self.people[0], assigned_module_ids=['MOD-A']))
            self.assertEqual(result, ['MOD-A', 'MOD-B'])
            self.assertEqual(self.compare('staff_profile_assignment_ids', 'coach', self.people[0]), [])

    def test_staffing_get_payload_and_post_validation_unchanged(self):
        payload = {'schema': 'curriculum', 'groups': [{'id': 'G', 'name': 'Group', 'cohort': 'C', 'programme': 'P', 'tutor': 'Unassigned', 'coach': 'Unassigned'}]}
        with composition_fixture(views, 'get_cached_payload', return_value=payload):
            request = self.factory.get('/staffing/')
            with original_staff_profiles():
                expected = views.curriculum_staffing_collection(request)
            with patch.object(staff_profiles, 'staffing_assignments', wraps=staff_profiles.staffing_assignments) as called:
                actual = views.curriculum_staffing_collection(request)
            called.assert_called_once_with(payload['groups'])
            self.assertEqual(actual.content, expected.content)
        with composition_fixture(views, 'update_staffing_assignment', side_effect=AssertionError('unexpected write')):
            self.assertEqual(views.curriculum_staffing_collection(self.factory.post('/', data={}, content_type='application/json')).status_code, 400)


class StaffDirectoryFailureContracts(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def test_missing_alias_and_failed_read_are_not_empty_results(self):
        read = Mock(side_effect=RuntimeError('sensitive diagnostic'))
        deps = dict(fetch_staff_users_by_access=read, staff_user_profile_source=views.staff_user_profile_source,
                    staff_profile_is_archived=views.staff_profile_is_archived)
        with self.assertRaises(staff_profiles.StaffDirectoryUnavailable):
            staff_directory.read_staff_profile_rows('tutor', enrolment_available=False, **deps)
        read.assert_not_called()
        with self.assertRaises(staff_profiles.StaffDirectoryUnavailable):
            staff_directory.read_staff_profile_rows('tutor', enrolment_available=True, **deps)
        read.return_value = []; read.side_effect = None
        self.assertEqual(staff_directory.read_staff_profile_rows('tutor', enrolment_available=True, **deps), [])

    def test_collection_and_detail_failures_return_sanitized_503(self):
        with composition_fixture(views, 'fetch_staff_users_by_access', side_effect=RuntimeError('sensitive diagnostic')):
            for handler, args in ((views.curriculum_staff_profile_collection, ('coach',)),
                                  (views.curriculum_staff_profile_detail, ('tutor', 'T'))):
                response = handler(self.factory.get('/'), *args)
                self.assertEqual(response.status_code, 503)
                self.assertNotIn(b'sensitive', response.content)
                self.assertNotIn(b'results', response.content)

    def test_empty_success_missing_profile_and_method_contracts(self):
        with composition_fixture(views, 'fetch_staff_users_by_access', return_value=[]):
            self.assertEqual(views.curriculum_staff_profile_collection(self.factory.get('/'), 'coach').status_code, 200)
            self.assertEqual(views.curriculum_staff_profile_detail(self.factory.get('/'), 'tutor', 'missing').status_code, 404)
        with composition_fixture(views, 'fetch_staff_users_by_access', side_effect=AssertionError('no read on write verb')):
            for method in ('post', 'patch', 'delete'):
                self.assertEqual(views.curriculum_staff_profile_collection(getattr(self.factory, method)('/'), 'coach').status_code, 405)
                self.assertEqual(views.curriculum_staff_profile_detail(getattr(self.factory, method)('/'), 'tutor', 'T').status_code, 405)

    def test_curriculum_source_missing_failed_and_empty_are_distinct(self):
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='postgresql')), composition_fixture(views, 'table_exists', return_value=False):
            self.assertEqual(views.curriculum_tutors(self.factory.get('/')).status_code, 503)
            self.assertEqual(views.build_curriculum_tutor_profile_collection(), [])
        with composition_fixture(views, 'connection', SimpleNamespace(vendor='postgresql')), composition_fixture(views, 'table_exists', return_value=True):
            with composition_fixture(views, 'fetch_all', side_effect=RuntimeError('sensitive diagnostic')):
                response = views.curriculum_tutors(self.factory.get('/'))
                self.assertEqual(response.status_code, 503)
                self.assertNotIn(b'sensitive', response.content)
            with composition_fixture(views, 'fetch_all', return_value=[]):
                self.assertEqual(views.curriculum_tutors(self.factory.get('/')).status_code, 200)

    def test_directory_failure_stops_assignment_but_valid_canonical_names_remain(self):
        from curriculum_api.catalogue.application.staff_profiles import StaffDirectoryUnavailable
        with composition_fixture(views, 'fetch_staff_users_by_access', side_effect=RuntimeError('offline')):
            with self.assertRaises(StaffDirectoryUnavailable):
                views.canonical_staff_assignment_name('tutor', 'Existing Name')
        with composition_fixture(views, 'get_staff_profile_rows', return_value=[{'id': 'T', 'name': 'Tutor One', 'email': 'tutor@example.invalid'}]):
            self.assertEqual(views.canonical_staff_assignment_name('tutor', 'tutor@example.invalid'), 'Tutor One')
            self.assertEqual(views.resolve_staff_assignment_email('tutor', 'T'), 'tutor@example.invalid')

    def test_sql_contract_is_parameterized_and_alias_specific(self):
        cursor = Mock()
        db = Mock(vendor='postgresql'); db.cursor.return_value.__enter__ = Mock(return_value=cursor)
        db.cursor.return_value.__exit__ = Mock(return_value=False)
        connections = {'enrolment': db}
        result = staff_directory.fetch_staff_users_by_access(
            ' TUTOR ', connections=connections, clean_str=views.clean_str,
            STAFF_ACCESS_ROLES=views.STAFF_ACCESS_ROLES, STAFF_USER_ACCESS_COLUMNS=views.STAFF_USER_ACCESS_COLUMNS,
            staff_users_table_reference=lambda alias: 'enrolment."Staff_users"', quote_ident=views.quote_ident,
            rows_as_dicts=lambda _: [],
        )
        self.assertEqual(result, [])
        sql, params = cursor.execute.call_args.args
        self.assertEqual(params, ['tutor'])
        self.assertIn('" Status"', sql)
        self.assertIn('order by lower(trim(coalesce("Username", \'\'))), id', sql)
