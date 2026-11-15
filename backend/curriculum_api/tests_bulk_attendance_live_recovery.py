"""Offline checks for projecting a guest delivery in the Bulk register."""
from django.test import SimpleTestCase

from .bulk_attendance_live_recovery import merge_target_presence, resolve_parallel_links


class BulkParallelRecoveryTests(SimpleTestCase):
    def setUp(self):
        self.absences = [
            {'learner_profile_id': 10, 'occurrence_id': 'six', 'module_catalogue_id': 'own-group', 'attendance_status': 'absent'},
            {'learner_profile_id': 20, 'occurrence_id': 'six', 'module_catalogue_id': 'own-group', 'attendance_status': 'absent'},
        ]
        self.alternatives = {'six': [{'id': 'nine', 'moduleCatalogueId': 'other-group'}]}
        self.targets = [
            {'learner_profile_id': 10, 'occurrence_id': 'nine', 'attendance_status': 'present'},
        ]
        self.assignments = {10: {'own-group'}, 20: {'own-group'}}
        self.dates = {'six': '2026-10-06'}

    def project(self, **changes):
        values = dict(originals=self.absences, alternatives=self.alternatives,
                      targets=self.targets, assignments=self.assignments, dates=self.dates)
        values.update(changes)
        return resolve_parallel_links(**values)

    def test_saved_guest_presence_covers_original_once_for_the_same_learner(self):
        covered, guests = self.project()
        self.assertEqual(covered, {(10, 'six'): {
            'effectiveAttendance': 'present', 'recoveryOccurrenceId': 'nine',
        }})
        self.assertEqual(guests, {(10, 'nine'): {
            'makeupForOccurrenceId': 'six', 'makeupForDate': '2026-10-06',
            'countsAsSession': False,
        }})
        self.assertNotIn((20, 'six'), covered)

    def test_absent_guest_does_not_credit_the_original_or_count_as_a_second_session(self):
        targets = [{**self.targets[0], 'attendance_status': 'absent'}]
        covered, guests = self.project(targets=targets)
        self.assertEqual(covered, {})
        self.assertEqual(guests[(10, 'nine')]['countsAsSession'], False)

    def test_manually_present_original_still_links_guest_without_double_counting(self):
        originals = [{**self.absences[0], 'attendance_status': 'present'}]
        covered, guests = self.project(originals=originals)
        self.assertEqual(covered, {})
        self.assertEqual(guests[(10, 'nine')], {
            'makeupForOccurrenceId': 'six', 'makeupForDate': '2026-10-06',
            'countsAsSession': False,
        })

    def test_required_second_delivery_is_not_spent_as_recovery(self):
        covered, guests = self.project(assignments={10: {'own-group', 'other-group'}})
        self.assertEqual((covered, guests), ({}, {}))

    def test_unassigned_original_is_not_treated_as_a_required_lecture(self):
        covered, guests = self.project(assignments={10: {'unrelated'}})
        self.assertEqual((covered, guests), ({}, {}))

    def test_one_guest_cannot_cover_two_originals(self):
        absences = [self.absences[0], {**self.absences[0], 'occurrence_id': 'six-again'}]
        alternatives = {**self.alternatives,
                        'six-again': [{'id': 'nine', 'moduleCatalogueId': 'other-group'}]}
        covered, guests = self.project(originals=absences, alternatives=alternatives)
        self.assertEqual((covered, guests), ({}, {}))

    def test_raw_teams_presence_materializes_a_guest_target(self):
        targets = merge_target_presence(
            [],
            [{'occurrence_id': 'nine', 'email': 'guest@example.invalid',
              'total_attendance_seconds': 120}],
            {'guest@example.invalid': 10},
        )
        self.assertEqual(targets, [{
            'learner_profile_id': 10,
            'occurrence_id': 'nine',
            'attendance_status': 'present',
        }])

    def test_zero_second_raw_teams_row_does_not_materialize_presence(self):
        self.assertEqual(merge_target_presence(
            [],
            [{'occurrence_id': 'nine', 'email': 'guest@example.invalid',
              'total_attendance_seconds': 0}],
            {'guest@example.invalid': 10},
        ), [])


class BulkParallelRecoveryMembershipSourceTests(SimpleTestCase):
    """parallel_recovery_links reads membership from the normalized plan records."""

    def test_only_learners_assigned_in_the_new_records_get_recovery(self):
        from datetime import datetime, timezone as dt_timezone
        from types import SimpleNamespace
        from unittest import mock

        from . import bulk_attendance_live_recovery as recovery

        originals = [
            # 10 is assigned to own-group in the normalized records.
            {'learner_profile_id': 10, 'occurrence_id': 'six', 'module_catalogue_id': 'own-group', 'attendance_status': 'absent'},
            # 20 may hold own-group only in a legacy JSON plan: no normalized record.
            {'learner_profile_id': 20, 'occurrence_id': 'six', 'module_catalogue_id': 'own-group', 'attendance_status': 'absent'},
        ]
        guest = [{'learner_profile_id': pid, 'occurrence_id': 'nine', 'attendance_status': 'present'} for pid in (10, 20)]
        register = mock.MagicMock()
        register.objects.using.return_value.filter.return_value.values.return_value = guest
        profiles = mock.MagicMock()
        profiles.objects.using.return_value.filter.return_value.only.return_value = [
            SimpleNamespace(id=10, enrolment_id=110, email='ten@example.invalid'),
            SimpleNamespace(id=20, enrolment_id=120, email='twenty@example.invalid'),
        ]
        raw = mock.MagicMock()
        raw.objects.using.return_value.filter.return_value.values.return_value = []
        occurrences = mock.MagicMock()
        occurrences.objects.using.return_value.filter.return_value.values.return_value = [
            {'id': 'six', 'scheduled_start': datetime(2026, 10, 6, 9, tzinfo=dt_timezone.utc)}]
        with mock.patch.object(recovery, 'LiveSessionLearnerAttendance', register), \
             mock.patch.object(recovery, 'LearnerProfile', profiles), \
             mock.patch.object(recovery, 'LiveSessionAttendance', raw), \
             mock.patch.object(recovery, 'LiveSessionOccurrence', occurrences), \
             mock.patch.object(recovery, 'completed_alternatives_by_occurrence',
                               return_value={'six': [{'id': 'nine', 'moduleCatalogueId': 'other-group'}]}), \
             mock.patch.object(recovery, 'assigned_module_ids_by_profile',
                               return_value={10: {'own-group'}, 20: set()}) as membership:
            covered, guests = recovery.parallel_recovery_links(originals, complete=True, database='default')
        self.assertEqual(covered, {(10, 'six'): {'effectiveAttendance': 'present', 'recoveryOccurrenceId': 'nine'}})
        self.assertNotIn((20, 'six'), covered)
        self.assertNotIn((20, 'nine'), guests)
        # Asked about exactly the compared modules for the possible learners.
        membership.assert_called_once_with({10, 20}, {'own-group', 'other-group'})
