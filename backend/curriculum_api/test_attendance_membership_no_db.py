"""Attendance module membership reads only the normalized plan records.

No database: placement lineages and learner facts are synthetic, shaped like
``learner_status_counts.placement_lineages`` / ``learner_facts`` rows.
"""
from contextlib import nullcontext
from unittest import mock

from django.test import SimpleTestCase

from . import attendance_membership, learner_status_counts, qr_attendance


def lineage(module_id, *, programme='P1', cohort='C1', group='G1', roster='inherited'):
    return {'found': True, 'programmeId': programme, 'programmeName': '', 'cohortId': cohort, 'cohortName': '',
            'groupId': group, 'groupName': '', 'moduleCatalogueId': module_id, 'learnerRosterMode': roster}


def fact(profile_id, *, programme='P1', cohort='C1', group='G1', plan=(), explicit=None):
    return {'id': profile_id, 'programme_id': programme, 'cohort_id': cohort, 'group_id': group,
            'enrolment_id': profile_id + 1000, 'status': 'active',
            'explicit': bool(plan) if explicit is None else explicit,
            'module_ids': list(plan), 'ambiguous': False}


class AttendanceMembershipTests(SimpleTestCase):
    def membership(self, lineages, facts, profile_ids, module_ids):
        with mock.patch('curriculum_api.views.curriculum_read_scope', return_value=nullcontext()), \
             mock.patch('curriculum_api.views.scope_programme_identifier', side_effect=lambda row: row.get('programmeId')), \
             mock.patch('curriculum_api.views.programme_identity_candidates', return_value=[]), \
             mock.patch.object(learner_status_counts, 'placement_lineages', return_value=lineages) as lineage_read, \
             mock.patch.object(learner_status_counts, 'learner_facts', return_value=facts) as fact_read:
            result = attendance_membership.assigned_module_ids_by_profile(profile_ids, module_ids)
        return result, lineage_read, fact_read

    def test_learner_assigned_only_in_the_new_plan_records_is_a_member(self):
        # Placed in another group; the Module Builder assignment alone grants M1.
        result, _, facts = self.membership({'M1': lineage('M1')}, [fact(7, group='G9', plan=['M1'])], [7], ['M1'])
        self.assertEqual(result, {7: {'M1'}})
        # Only the asked learner is read, never the whole directory.
        self.assertEqual(facts.call_args.kwargs['profile_ids'], {7})

    def test_legacy_only_assignment_without_new_record_is_not_a_member(self):
        # The learner's legacy JSON plan may list M1, but the normalized records
        # carry no row for it and the placement is elsewhere: not assigned.
        result, _, _ = self.membership({'M1': lineage('M1')}, [fact(7, group='G9')], [7], ['M1'])
        self.assertEqual(result, {7: set()})

    def test_saved_rows_for_an_unrelated_module_override_the_placement(self):
        # Placed in M1's own group, but the saved plan names only M2.
        result, _, _ = self.membership({'M1': lineage('M1')}, [fact(7, plan=['M2'], explicit=True)], [7], ['M1'])
        self.assertEqual(result, {7: set()})

    def test_learner_without_rows_inherits_their_placement(self):
        result, _, _ = self.membership({'M1': lineage('M1')}, [fact(7)], [7], ['M1'])
        self.assertEqual(result, {7: {'M1'}})

    def test_manual_roster_grants_nothing_by_placement(self):
        result, _, _ = self.membership({'M1': lineage('M1', roster='manual')}, [fact(7)], [7], ['M1'])
        self.assertEqual(result, {7: set()})

    def test_other_programme_placement_inherits_nothing(self):
        result, _, _ = self.membership({'M1': lineage('M1')}, [fact(7, programme='P2')], [7], ['M1'])
        self.assertEqual(result, {7: set()})

    def test_only_requested_modules_are_answered(self):
        result, lineages, _ = self.membership(
            {'M1': lineage('M1'), 'M2': lineage('M2')}, [fact(7, plan=['M1', 'M2'])], [7], ['M2', 'M1'])
        self.assertEqual(result, {7: {'M1', 'M2'}})
        lineages.assert_called_once_with('module', ['M1', 'M2'])

    def test_unknown_module_or_no_learner_reads_nothing(self):
        result, _, facts = self.membership({'MX': {'found': False}}, [], [7], ['MX'])
        self.assertEqual(result, {7: set()})
        facts.assert_not_called()
        result, lineages, _ = self.membership({}, [], [], ['M1'])
        self.assertEqual(result, {})
        lineages.assert_not_called()


class QRAttendanceMembershipSourceTests(SimpleTestCase):
    def test_qr_asks_the_normalized_records_for_its_one_profile(self):
        student = type('Student', (), {'profile_ids': {70}})()
        eligible = {'M1': {}, 'M2': {}}
        with mock.patch.object(attendance_membership, 'assigned_module_ids_by_profile',
                               return_value={70: {'M2', 'ELSEWHERE'}}) as read:
            self.assertEqual(qr_attendance.effective_assignments(student, eligible), {'M2'})
        read.assert_called_once()
        self.assertEqual(read.call_args.args[0], [70])
        self.assertEqual(set(read.call_args.args[1]), {'M1', 'M2'})

    def test_ambiguous_or_missing_profile_assigns_nothing(self):
        for profile_ids in (set(), {70, 71}):
            student = type('Student', (), {'profile_ids': profile_ids})()
            with mock.patch.object(attendance_membership, 'assigned_module_ids_by_profile') as read:
                self.assertEqual(qr_attendance.effective_assignments(student, {'M1': {}}), set())
            read.assert_not_called()


class AttendanceModuleRosterTests(SimpleTestCase):
    def roster(self, lineages, facts, profiles):
        profile_manager = mock.MagicMock()
        profile_manager.filter.return_value.values.return_value = profiles
        with mock.patch('curriculum_api.views.curriculum_read_scope', return_value=nullcontext()), \
             mock.patch('curriculum_api.views.scope_programme_identifier', side_effect=lambda row: row.get('programmeId')), \
             mock.patch('curriculum_api.views.programme_identity_candidates', return_value=[]), \
             mock.patch.object(learner_status_counts, 'placement_lineages', return_value=lineages), \
             mock.patch.object(learner_status_counts, 'learner_facts', return_value=facts), \
             mock.patch('learner_api.models.LearnerProfile.objects', profile_manager):
            return attendance_membership.module_roster('M1'), profile_manager

    def test_roster_lists_only_new_record_members_with_legacy_shape(self):
        # 7: Module Builder row; 8: placement inherits; 9: saved rows elsewhere.
        facts = [fact(7, group='G9', plan=['M1']), fact(8), fact(9, plan=['M2'])]
        rows, profiles = self.roster({'M1': lineage('M1')}, facts, [
            {'id': 7, 'email': ' A@Example.invalid ', 'full_name': 'A'},
            {'id': 8, 'email': None, 'full_name': None}])
        self.assertEqual(set(profiles.filter.call_args.kwargs['id__in']), {7, 8})
        self.assertEqual(rows, [
            {'learner_profile_id': 7, 'learner_email': 'a@example.invalid', 'learner_name': 'A'},
            {'learner_profile_id': 8, 'learner_email': '', 'learner_name': ''}])

    def test_unknown_module_or_no_members_has_no_roster(self):
        rows, profiles = self.roster({'M1': {'found': False}}, [], [])
        self.assertEqual(rows, [])
        profiles.filter.assert_not_called()
        rows, profiles = self.roster({'M1': lineage('M1', roster='manual')}, [fact(7)], [])
        self.assertEqual(rows, [])
        profiles.filter.assert_not_called()


class SessionResultsRosterSourceTests(SimpleTestCase):
    def test_session_register_projects_the_normalized_roster(self):
        from . import session_results
        member = {'learner_profile_id': 7, 'learner_email': 'a@example.invalid', 'learner_name': 'A'}
        with mock.patch.object(attendance_membership, 'module_roster', return_value=[member]) as roster, \
             mock.patch('learner_api.attendance_assignments.module_roster') as legacy:
            rows = session_results.effective_module_register_rows('M1', [{'id': 'O', 'attendance_report_id': None}])
        roster.assert_called_once_with('M1')
        legacy.assert_not_called()
        self.assertEqual([(row['learner_profile_id'], row['occurrence_id'], row['attendance_status']) for row in rows],
                         [(7, 'O', 'pending')])
