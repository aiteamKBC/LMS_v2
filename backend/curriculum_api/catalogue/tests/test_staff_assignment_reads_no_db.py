"""Staff assignment reads: original profile parity and incomplete-read refusal."""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
from contextlib import ExitStack
from copy import deepcopy
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase
from curriculum_api import views
from curriculum_api.catalogue.application import staff_assignments
from curriculum_api.catalogue.application.staff_profiles import StaffDirectoryUnavailable
from curriculum_api.catalogue.infrastructure.staff_directory import read_assignment_source
from curriculum_api.catalogue.tests.test_staff_profiles_boundary_no_db import original_staff_profiles


class StaffAssignmentReads(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.factory = RequestFactory()
        self.modules = [
            {'module_catalogue_id': 'MOD-A', 'title': 'One', 'programme_id': 'P',
             'programme_name': 'Programme', 'cohort_id': 'C', 'cohort_name': 'Cohort',
             'group_id': 'G', 'group_name': 'Group', 'tutor_name': 'Tutor',
             'status': 'active', 'sessions_number': 2},
            {'module_catalogue_id': 'MOD-ORPHAN', 'title': 'Orphan', 'programme_id': 'P',
             'cohort_id': 'C', 'group_id': 'ORPHAN', 'tutor_name': 'Tutor', 'status': 'active'},
        ]
        self.groups = [
            {'group_id': 'G', 'group_name': 'Group', 'programme_id': 'P', 'cohort_id': 'C',
             'coach_name': 'Coach, Other', 'status': 'active'},
            {'group_id': 'OLD', 'group_name': 'Old', 'coach_name': 'Coach', 'status': 'archived'},
        ]
        self.cohorts = [{'cohort_id': 'C', 'cohort_name': 'Cohort', 'programme_id': 'P', 'programme_name': 'Programme'}]
        self.programmes = [{'program_id': 'P', 'name': 'Programme', 'status': 'active'}]
        def read(table, *args, **kwargs):
            return deepcopy({views.GROUPS_TABLE: self.groups,
                             views.COHORT_AUTHORING_DETAILS_TABLE: self.cohorts}[table])
        self.raw = self.stack.enter_context(composition_fixture(views, 'authoring_fetch_all', side_effect=read))
        self.modules_read = self.stack.enter_context(composition_fixture(views, 'module_index_rows', side_effect=lambda **_: deepcopy(self.modules)))
        self.stack.enter_context(composition_fixture(views, 'get_program_config_rows', return_value=self.programmes))
        self.stack.enter_context(composition_fixture(views, 'prefetch_authoring_reads'))
        # These legacy auxiliary outputs are not exposed in a staff profile.
        self.stack.enter_context(composition_fixture(views, 'cohort_authoring_detail_rows', return_value=[]))
        self.stack.enter_context(composition_fixture(views, 'active_learner_delivery_counts', return_value=({}, {})))
        self.stack.enter_context(composition_fixture(views, 'fetch_staff_users_by_access', side_effect=lambda role: [
            {'id': 7, 'uuid': role+'-uuid', 'Username': role.title(), 'Access': role, 'Email': role+'@example.invalid'},
        ]))

    def test_tutor_and_coach_profiles_match_original_collections_for_both_visibilities(self):
        for role in ('tutor', 'coach'):
            for visibility in ('operational', 'all'):
                with self.subTest(role=role, visibility=visibility):
                    with original_staff_profiles():
                        expected = views.build_staff_user_profile_collection(role, visibility)
                    with patch.object(staff_assignments, 'assignment_readers', wraps=staff_assignments.assignment_readers) as owner:
                        actual = views._staff_user_profile_reader(strict=True)(role, visibility)
                    owner.assert_called_once()
                    self.assertEqual(actual, expected)
                    self.assertEqual(len(actual), 1)

    def test_archived_deleted_and_missing_groups_preserve_assignment_membership(self):
        for row in ({'status': 'archived'}, {'is_programme_deleted': True}, {'coach_name': 'Unassigned'}):
            with self.subTest(row=row):
                self.groups[0].update(row)
                with original_staff_profiles():
                    expected = views.build_staff_user_profile_collection('coach', 'all')
                actual = views._staff_user_profile_reader(strict=True)('coach', 'all')
                self.assertEqual(actual, expected)

    def test_required_source_is_loaded_once_without_schema_or_auxiliary_reads(self):
        with (composition_fixture(views, 'cohort_authoring_detail_rows', side_effect=AssertionError('unused calendar')),
              composition_fixture(views, 'active_learner_delivery_counts', side_effect=AssertionError('unused learners'))):
            views._staff_user_profile_reader(strict=True)('coach')
        self.modules_read.assert_called_once_with(ensure_tables=False)
        self.assertEqual(self.raw.call_count, 2)
        for call in self.raw.call_args_list:
            self.assertIs(call.kwargs['ensure_tables'], False)

    def test_empty_identity_does_not_read_assignments(self):
        with composition_fixture(views, 'fetch_staff_users_by_access', return_value=[]):
            self.assertEqual(views._staff_user_profile_reader(strict=True)('coach'), [])
        self.modules_read.assert_not_called()
        self.raw.assert_not_called()

    def test_required_source_failure_never_becomes_an_empty_assignment(self):
        for failed in ('modules', 'groups', 'cohorts', 'programmes'):
            with self.subTest(failed=failed):
                def raw(table, **kwargs):
                    if table == failed:
                        raise RuntimeError('private diagnostic')
                    return []
                with self.assertRaises(StaffDirectoryUnavailable):
                    read_assignment_source(
                        module_index_rows=Mock(side_effect=RuntimeError('private') if failed == 'modules' else None, return_value=[]),
                        authoring_fetch_all=raw,
                        get_program_config_rows=Mock(side_effect=RuntimeError('private') if failed == 'programmes' else None, return_value=[]),
                        groups_table='groups', groups_order='id', cohorts_table='cohorts', cohorts_order='id',
                    )

    def test_failed_group_read_returns_503_instead_of_a_staff_profile_with_no_groups(self):
        self.raw.side_effect = RuntimeError('private diagnostic')
        response = views.curriculum_staff_profile_collection(self.factory.get('/'), 'coach')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b'private', response.content)
        self.assertNotIn(b'results', response.content)

    def test_missing_vs_empty_assignment_records_remain_valid_success(self):
        self.modules.clear(); self.groups.clear(); self.cohorts.clear()
        profiles = views._staff_user_profile_reader(strict=True)('coach')
        self.assertEqual(profiles[0]['assignedGroupIds'], [])
        self.assertEqual(profiles[0]['groupCount'], 0)

    def test_compatibility_collection_also_refuses_unavailable_assignments(self):
        from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
        self.raw.side_effect = RuntimeError('offline')
        with self.assertRaises(CatalogueReadUnavailable):
            views.build_staff_user_profile_collection('coach')
