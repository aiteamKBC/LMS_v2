"""Hermetic scoped read regressions: synthetic caseload, mocked evidence/Graph."""
import json
from datetime import datetime, timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from . import attendance_loading as loading
from . import bulk_attendance as bulk


def placement(learner_id='42', programme='p', group='g', cohort='Cohort A', **extra):
    return {'id': learner_id, 'name': 'Synthetic learner', 'email': 'learner@example.test',
            'programmeId': programme, 'programmeName': 'Programme', 'groupId': group,
            'groupName': 'Shared name', 'cohortName': cohort, 'enrollmentStatus': 'active', **extra}


class AttendanceLoadingTests(SimpleTestCase):
    def setUp(self):
        self.profiles = {'42': SimpleNamespace(id=42, _caseload_source=SimpleNamespace(id=942))}
        self.placements = [placement()]
        self.placement_patcher = patch.object(loading, 'attendance_placements', side_effect=lambda owner: (self.profiles, self.placements))
        self.context = self.placement_patcher.start()
        patch('coach_api.views.authenticated_coach_email', return_value='selected@example.test').start()
        self.evidence = patch('learner_api.attendance_lectures.attendance_read_contract', return_value={
            'summary': {'attendanceRate': 95, 'present': 41, 'absent': 2, 'sessions': 43},
            'recentAttendance': [{'learnerId': '42', 'sessionId': str(i), 'sessionDate': f'2026-09-{8-i:02d}',
                                  'status': 'present', 'counted': True, 'employer': 'Must not leak'} for i in range(8)],
            'history': [{'source': 'microsoft-teams', 'sourceId': 'occ', 'status': 'absent',
                         'absenceReport': {'id': 'report', 'status': 'approved'}, 'privateMetric': 99}],
        }).start()
        self.contracts = patch.object(loading, 'group_contracts', side_effect=lambda profiles: {
            str(profile.id): self.evidence.return_value for profile in profiles
            if getattr(profile, '_caseload_source', None) is not None}).start()
        self.selected = patch.object(loading, 'selected_rows', return_value={}).start()
        self.occurrences = patch.object(loading, 'delivery_occurrences', return_value=[
            (SimpleNamespace(id='occ', scheduled_start=datetime(2026, 9, 1, 9, tzinfo=timezone.utc),
                             scheduled_end=datetime(2026, 9, 1, 10, tzinfo=timezone.utc), session_number=1),
             SimpleNamespace(title='Module'))]).start()
        self.addCleanup(patch.stopall)

    def call(self, view, **query):
        request = RequestFactory().get('/coach_api/coach/attendance', query)
        response = unwrap(view)(request)
        return response, json.loads(response.content)

    def test_options_are_selected_coach_only_and_do_not_read_evidence_or_sessions(self):
        _, payload = self.call(loading.coach_attendance_options)
        self.context.assert_called_once_with('selected@example.test')
        self.assertEqual(payload, {'programmes': [{'id': 'p', 'name': 'Programme', 'groups': [
            {'id': 'g', 'name': 'Shared name', 'cohort': 'Cohort A'}]}]})
        self.evidence.assert_not_called()
        self.occurrences.assert_not_called()

    def test_dedicated_sessions_are_compact_and_use_business_timezone(self):
        from django.utils import timezone as django_timezone
        from django.urls import resolve
        self.assertEqual(resolve('/coach_api/coach/attendance/sessions').func, loading.coach_attendance_sessions)
        with django_timezone.override('Europe/London'), patch.object(
                django_timezone, 'now', return_value=datetime(2026, 9, 1, 9, 30, tzinfo=timezone.utc)):
            response, payload = self.call(loading.coach_attendance_sessions, programmeId='p', groupId='g')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload, {'sessions': [{'id': 'occ', 'date': '2026-09-01',
            'title': 'Module — Session 1', 'time': '10:00', 'status': 'scheduled'}]})
        self.occurrences.assert_called_once_with('p', 'g', profiles=[self.profiles['42']])
        self.evidence.assert_not_called()
        self.contracts.assert_not_called()

    def test_dedicated_sessions_genuinely_empty(self):
        self.occurrences.return_value = []
        response, payload = self.call(loading.coach_attendance_sessions, programmeId='p', groupId='g')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(payload, {'sessions': []})

    def test_native_timestamp_without_timezone_is_utc_in_sessions_and_detail(self):
        from django.utils import timezone as django_timezone
        occurrence = self.occurrences.return_value[0][0]
        occurrence.scheduled_start = datetime(2026, 9, 1, 9)
        occurrence.scheduled_end = datetime(2026, 9, 1, 10)
        with django_timezone.override('Europe/London'):
            response, payload = self.call(loading.coach_attendance_sessions, programmeId='p', groupId='g')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(payload['sessions'][0]['time'], '10:00')
            with patch.object(loading, 'selected_rows', return_value={}):
                response, payload = self.call(loading.coach_attendance_session,
                    programmeId='p', groupId='g', sessionId='occ')
            self.assertEqual(response.status_code, 200)
            self.assertEqual(payload['session']['startTime'], '10:00')

    def test_options_collapse_canonical_ids_but_keep_same_names_in_other_cohorts(self):
        self.placements += [placement('43'), placement('44', group='g2', cohort='Cohort B')]
        _, payload = self.call(loading.coach_attendance_options)
        groups = payload['programmes'][0]['groups']
        self.assertEqual([row['id'] for row in groups], ['g', 'g2'])
        self.assertEqual([row['cohort'] for row in groups], ['Cohort A', 'Cohort B'])

    def test_empty_caseload_returns_no_global_programmes(self):
        self.placements = []
        _, payload = self.call(loading.coach_attendance_options)
        self.assertEqual(payload, {'programmes': []})

    @patch('coach_api.views.should_include_in_attendance_page', return_value=True)
    @patch('coach_api.views.normalize_program_status', return_value='active')
    @patch('coach_api.views.get_lms_row_program_status', return_value='Active')
    @patch('coach_api.views.resolve_caseload_source_row', return_value=SimpleNamespace(aptem_id=None))
    @patch('coach_api.views.fetch_source_schedule_rows', return_value=({}, {}))
    @patch('coach_api.views.apply_curriculum_attendance_placements')
    @patch('coach_api.views.authoring_fetch_all', return_value=[])
    @patch('coach_api.views.fetch_attendance_caseload_rows')
    def test_options_placement_load_avoids_dashboard_metrics_for_both_learner_types(self, fetch, *mocks):
        # Exercise the real placement loader, rather than its endpoint double.
        fetch.return_value = [SimpleNamespace(id=i, username='Synthetic learner', email='learner@example.test',
            programme_id='p', programme='Programme', group_id='g', group_name='Group', cohort='Cohort',
            learner_type=kind) for i, kind in [(42, 'commercial'), (43, 'apprenticeship')]]
        self.placement_patcher.stop()
        _, payload = self.call(loading.coach_attendance_options)
        self.assertEqual(len(payload['programmes']), 1)
        self.evidence.assert_not_called()
        fetch.assert_called_once_with('selected@example.test', include_plan=False)

    def test_group_is_scoped_and_slim_with_bounded_visible_recent_records(self):
        self.placements.append(placement('43', programme='other', group='other'))
        _, payload = self.call(loading.coach_attendance_group, programmeId='p', groupId='g')
        self.assertEqual(payload['learners'], [{'id': '42', 'name': 'Synthetic learner',
            'email': 'learner@example.test', 'status': 'active',
            'attendance': {'rate': 95, 'present': 41, 'absent': 2, 'sessions': 43},
            'recent': [{'date': f'2026-09-{8-i:02d}', 'status': 'present'} for i in range(4)]}])
        self.assertEqual(set(payload), {'programme', 'group', 'learners'})
        self.assertTrue(all(set(row) == {'date', 'status'} for row in payload['learners'][0]['recent']))
        self.contracts.assert_called_once_with([self.profiles['42']])
        self.evidence.assert_not_called()
        self.occurrences.assert_not_called()

    def test_recent_is_bounded_for_each_learner_without_cross_learner_history(self):
        self.placements.append(placement('43'))
        self.profiles['43'] = SimpleNamespace(id=43, _caseload_source=SimpleNamespace(id=943))
        self.contracts.side_effect = None
        self.contracts.return_value = {'42': self.evidence.return_value, '43': {
            'summary': {'attendanceRate': 0, 'present': 0, 'absent': 1, 'sessions': 1},
            'recentAttendance': [{'sessionDate': '2026-09-09', 'status': 'absent'}]}}
        _, payload = self.call(loading.coach_attendance_group, programmeId='p', groupId='g')
        self.assertEqual([len(row['recent']) for row in payload['learners']], [4, 1])
        self.assertEqual(payload['learners'][1]['recent'], [{'date': '2026-09-09', 'status': 'absent'}])
        self.assertEqual(payload['learners'][1]['attendance'], {'rate': 0, 'present': 0, 'absent': 1, 'sessions': 1})

    def test_break_status_and_unavailable_evidence_do_not_fabricate_rate(self):
        self.placements[0]['enrollmentStatus'] = 'break'
        self.profiles['42']._caseload_source = None
        _, payload = self.call(loading.coach_attendance_group, programmeId='p', groupId='g')
        self.assertEqual(payload['learners'][0]['status'], 'on-break')
        self.assertIsNone(payload['learners'][0]['attendance']['rate'])

    def test_unowned_group_or_wrong_programme_is_forbidden_before_evidence(self):
        for programme, group in [('p', 'other'), ('other', 'g')]:
            for view in [loading.coach_attendance_group, loading.coach_attendance_session, loading.coach_attendance_sessions]:
                response, _ = self.call(view, programmeId=programme, groupId=group, sessionId='occ')
                self.assertEqual(response.status_code, 403)
        self.evidence.assert_not_called()
        self.occurrences.assert_not_called()

    def test_missing_selection_is_rejected(self):
        response, _ = self.call(loading.coach_attendance_group)
        self.assertEqual(response.status_code, 400)
        response, _ = self.call(loading.coach_attendance_session, programmeId='p', groupId='g')
        self.assertEqual(response.status_code, 400)

    def test_cancelled_or_wrong_group_session_is_rejected(self):
        self.occurrences.return_value = []
        response, _ = self.call(loading.coach_attendance_session, programmeId='p', groupId='g', sessionId='occ')
        self.assertEqual(response.status_code, 409)
        self.evidence.assert_not_called()

    def test_session_returns_only_selected_occurrence_with_save_version_and_report(self):
        self.selected.return_value = {'42': {'learnerId': '42', 'status': 'absent',
            'absenceReport': {'id': 'report', 'status': 'approved'}, 'version': 'version-token'}}
        _, payload = self.call(loading.coach_attendance_session, programmeId='p', groupId='g', sessionId='occ')
        self.assertEqual(set(payload), {'session', 'learners', 'warnings'})
        self.assertEqual(payload['session']['id'], 'occ')
        self.assertEqual(payload['learners'], [{'learnerId': '42', 'name': 'Synthetic learner',
            'status': 'absent', 'absenceReport': {'id': 'report', 'status': 'approved'}, 'version': 'version-token'}])
        self.occurrences.assert_called_once_with('p', 'g', 'occ', profiles=[self.profiles['42']])
        self.assertEqual(self.selected.call_args.args[:2], ([self.profiles['42']], 'occ'))

    def test_unassigned_session_learner_is_excluded(self):
        _, payload = self.call(loading.coach_attendance_session, programmeId='p', groupId='g', sessionId='occ')
        self.assertEqual(payload['learners'], [])
        self.evidence.assert_not_called()

    def test_missing_source_remains_visible_as_warning(self):
        self.profiles['42']._caseload_source = None
        _, payload = self.call(loading.coach_attendance_session, programmeId='p', groupId='g', sessionId='occ')
        self.assertEqual(payload['learners'], [])
        self.assertEqual(payload['warnings'][0]['learnerProfileId'], '42')

    @patch.object(loading.log, 'exception')
    def test_service_error_does_not_leak_details(self, log):
        self.context.side_effect = RuntimeError('private credentials')
        response, payload = self.call(loading.coach_attendance_options)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('private', str(payload))


class CanonicalPlacementTests(SimpleTestCase):
    @patch('coach_api.views.LearnerProfile.objects')
    def test_lazy_reads_skip_plan_prefetch_while_existing_callers_keep_it(self, profiles):
        from .views import fetch_attendance_caseload_rows
        query = profiles.annotate.return_value.filter.return_value
        ordered = query.only.return_value.order_by.return_value
        ordered.__iter__.return_value = []
        ordered.prefetch_related.return_value.__iter__.return_value = []
        fetch_attendance_caseload_rows(' Coach@Example.Test ', include_plan=False)
        profiles.annotate.return_value.filter.assert_called_once_with(coach_email_key='coach@example.test')
        ordered.prefetch_related.assert_not_called()
        self.assertIn('cohort_id', query.only.call_args.args)
        fetch_attendance_caseload_rows('coach@example.test')
        ordered.prefetch_related.assert_called_once_with('plan_modules__weeks__components')

    @patch('coach_api.views.authoring_fetch_all')
    def test_current_membership_excludes_archived_and_does_not_append_global_groups(self, groups):
        groups.return_value = [
            {'group_id': 'g', 'programme_id': 'new', 'programme_name': 'New programme',
             'group_name': 'Shared name', 'cohort_name': 'New cohort', 'status': 'active'},
            {'group_id': 'archived', 'status': 'archived'}, {'group_id': 'unrelated', 'programme_id': 'global'}]
        result = loading.current_placements([placement(), placement('43', group='archived')])
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]['programmeId'], 'new')
        self.assertEqual(result[0]['cohortName'], 'New cohort')

    @patch('coach_api.views.apply_curriculum_attendance_placements')
    @patch('coach_api.views.serialize_attendance_source_learner', side_effect=lambda row: placement(str(row.id)))
    @patch('coach_api.views.attach_caseload_source_rows')
    @patch('coach_api.views.fetch_attendance_caseload_rows', return_value=[SimpleNamespace(id=42)])
    @patch('coach_api.views.authoring_fetch_all', return_value=[{'group_id': 'g', 'programme_id': 'new', 'status': 'active'}])
    def test_bulk_save_context_uses_same_canonical_membership(self, *mocks):
        self.assertEqual(set(bulk.context_profiles('coach@example.test', 'new', 'g')), {'42'})
        self.assertEqual(bulk.context_profiles('coach@example.test', 'p', 'g'), {})


class AttendanceAccessTests(SimpleTestCase):
    views = (loading.coach_attendance_options, loading.coach_attendance_group, loading.coach_attendance_session, loading.coach_attendance_sessions)

    @patch('login.permissions.authenticate_request', return_value=None)
    @patch.object(loading, 'attendance_placements')
    def test_anonymous_caller_cannot_read_any_contract(self, placements, authenticate):
        for view in self.views:
            response = view(RequestFactory().get('/coach_api/coach/attendance/options'))
            self.assertEqual(response.status_code, 401)
        placements.assert_not_called()

    @patch('login.permissions.authenticate_request')
    @patch.object(loading, 'attendance_placements')
    def test_learner_employer_and_non_coach_staff_are_forbidden(self, placements, authenticate):
        for role in ['learner', 'employer', 'staff']:
            authenticate.return_value = SimpleNamespace(role=role, subject_type=role)
            with patch('login.permissions._accesses_of', return_value=frozenset({'tutor'})):
                for view in self.views:
                    response = view(RequestFactory().get('/coach_api/coach/attendance/options'))
                    self.assertEqual(response.status_code, 403)
        placements.assert_not_called()

    @patch('login.permissions.authenticate_request')
    @patch('login.permissions._accesses_of', return_value=frozenset({'coach'}))
    @patch('coach_api.auth._staff_access', return_value='coach')
    @patch('coach_api.auth.StaffUser.objects')
    @patch.object(loading, 'attendance_placements', return_value=({}, []))
    def test_coach_uses_server_identity_and_refuses_spoofed_owner(self, placements, staff, access, grants, authenticate):
        account = SimpleNamespace(role='staff', subject_type='staff', subject_id=1)
        staff.filter.return_value.only.return_value.first.return_value = SimpleNamespace(email='coach@example.test')
        def session(request):
            request.login_account = account
            return account
        authenticate.side_effect = session
        response = loading.coach_attendance_options(RequestFactory().get('/coach_api/coach/attendance/options'))
        self.assertEqual(response.status_code, 200)
        placements.assert_called_once_with('coach@example.test')
        response = loading.coach_attendance_options(RequestFactory().get('/coach_api/coach/attendance/options', {'ownerEmail': 'other@example.test'}))
        self.assertEqual(response.status_code, 403)
        self.assertEqual(placements.call_count, 1)
