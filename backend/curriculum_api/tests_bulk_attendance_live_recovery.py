"""Offline checks for projecting a guest delivery in the Bulk register."""
from django.test import SimpleTestCase

from .bulk_attendance_live_recovery import resolve_parallel_links


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
