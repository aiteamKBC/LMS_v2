"""Synthetic recovery checks; no application startup, database or HTTP calls."""
from copy import deepcopy
from datetime import timezone
import unittest

from restore_legacy_material_progress import plan_restore, source_instant, summary


def fixture():
    state = {
        'owner': dict(id=1, enrolment_id=11, account_id=11, aptem_id=101, account_aptem_id='101',
                      email='work@example.test', account_email='work@example.test'),
        'identities': [dict(id=9, learner_id=1, source_system='old_lms', source_learner_id='22',
                           source_payload={'source_email': 'personal@example.test'}, deleted_at=None)],
        'catalogue': [dict(id=50, source_activity_id='material:5', source_course_ref='55',
                          historical_id='HCOMP-TEST', historical_only=True,
                          curriculum_component_ref=None, ksbs=[])],
        'progress': [], 'sources': [], 'journals': [], 'segments': [],
    }
    course = dict(user_id=22, course_id=55, email='PERSONAL@example.test', timezone='+00:00',
        materials=[dict(component_id=5, title='Reading &amp; practice', material_type='pdf',
                        completed=True, started_at='2026-09-01 09:00:00',
                        completed_at='2026-09-28 10:00:00', time_spent_seconds=2336400,
                        configured_duration_seconds=1080)])
    return state, course


def plan(state, course):
    return plan_restore(state, course, 22, 55, [5])


class RestoreMaterialTests(unittest.TestCase):
    def test_restores_completed_material_and_preserves_raw_time_without_booking_it(self):
        state, course = fixture()
        original = deepcopy((state, course))
        item = plan(state, course)[0]
        self.assertEqual(item['resolution'], 'insert')
        self.assertEqual(item['title'], 'Reading & practice')
        self.assertEqual(item['month'], '2026-09')
        raw = item['payload']['old_lms_completion']
        self.assertTrue(raw['actual_time_review_required'])
        self.assertEqual(raw['material']['time_spent_seconds'], 2336400)
        self.assertEqual(raw['material']['configured_duration_seconds'], 1080)
        self.assertEqual(summary(state, [item])['added_verified_seconds'], 0)
        self.assertEqual((state, course), original)

    def test_zero_elapsed_time_does_not_mean_zero_actual_study(self):
        state, course = fixture()
        course['materials'][0].update(time_spent_seconds=0, started_at='2026-09-28 10:00:00')
        item = plan(state, course)[0]
        self.assertTrue(item['payload']['old_lms_completion']['actual_time_review_required'])
        self.assertNotIn('actual_seconds', item)

    def test_exact_source_id_email_and_course_are_required(self):
        for field, value in [('email', 'other@example.test'), ('user_id', 23), ('course_id', 56)]:
            state, course = fixture()
            course[field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'ownership mismatch'):
                plan(state, course)

    def test_deleted_or_wrong_owner_identity_is_rejected(self):
        for field, value in [('deleted_at', '2026-01-01'), ('learner_id', 2)]:
            state, course = fixture()
            state['identities'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                plan(state, course)

    def test_enrolment_mismatch_does_not_create_progress(self):
        state, course = fixture()
        state['owner']['account_aptem_id'] = '102'
        with self.assertRaisesRegex(ValueError, 'enrolment identity'):
            plan(state, course)

    def test_uncompleted_material_is_not_marked_complete(self):
        state, course = fixture()
        course['materials'][0]['completed'] = False
        with self.assertRaisesRegex(ValueError, 'not completed'):
            plan(state, course)

    def test_duplicate_or_missing_source_material_is_rejected(self):
        for materials in ([], fixture()[1]['materials'] * 2):
            state, course = fixture()
            course['materials'] = materials
            with self.assertRaisesRegex(ValueError, 'missing or duplicated'):
                plan(state, course)

    def test_unowned_or_ambiguous_catalogue_is_rejected(self):
        for definitions in ([], fixture()[0]['catalogue'] * 2):
            state, course = fixture()
            state['catalogue'] = definitions
            with self.assertRaisesRegex(ValueError, 'owned catalogue'):
                plan(state, course)

    def test_current_curriculum_or_ksb_credit_is_not_assumed(self):
        for field, value in [('curriculum_component_ref', 'COMP-1'), ('ksbs', ['K1']),
                             ('historical_only', False), ('source_course_ref', '56')]:
            state, course = fixture()
            state['catalogue'][0][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                plan(state, course)

    def test_existing_audited_journal_is_not_duplicated(self):
        state, course = fixture()
        state['journals'] = [{'source_ref': 'la:55:5', 'deleted_at': None}]
        with self.assertRaisesRegex(ValueError, 'audit history'):
            plan(state, course)

    def test_existing_progress_even_if_deleted_is_not_recreated(self):
        state, course = fixture()
        state['progress'] = [dict(id=30, source_system='old_lms', source_activity_id='material:5',
                                 source_payload={}, deleted_at='2026-01-01')]
        with self.assertRaisesRegex(ValueError, 'already cover'):
            plan(state, course)

    def test_second_run_does_not_duplicate_completed_progress(self):
        state, course = fixture()
        state['sources'] = [dict(id=40, source_system='old_lms', source_activity_id='material:5',
            source_course_ref='55', source_catalog_activity_id=50, canonical_progress_id=30,
            completed=True, deleted_at=None)]
        state['progress'] = [dict(id=30, learner_id=1, accepted=True, deleted_at=None)]
        self.assertEqual(plan(state, course), [{'activity_id': 5, 'resolution': 'already_present'}])

    def test_existing_source_wrong_course_or_deleted_cannot_be_overwritten(self):
        for field, value in [('source_course_ref', '56'), ('deleted_at', '2026-01-01')]:
            state, course = fixture()
            state['sources'] = [dict(id=40, source_system='old_lms', source_activity_id='material:5',
                source_course_ref='55', source_catalog_activity_id=50, canonical_progress_id=30,
                completed=True, deleted_at=None)]
            state['sources'][0][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'conflicting lineage'):
                plan(state, course)

    def test_bad_or_ambiguous_timestamps_are_rejected(self):
        with self.assertRaises(ValueError):
            source_instant('2026-10-25 01:30:00', 'Europe/London')
        with self.assertRaises(ValueError):
            source_instant('', '+00:00')
        state, course = fixture()
        course['materials'][0]['completed_at'] = '2026-08-01 00:00:00'
        with self.assertRaisesRegex(ValueError, 'precedes'):
            plan(state, course)

    def test_reporting_month_uses_uk_completion_date_and_retains_utc_instant(self):
        state, course = fixture()
        course['materials'][0].update(started_at='2026-08-31 23:30:00', completed_at='2026-08-31 23:30:00')
        item = plan(state, course)[0]
        self.assertEqual(item['month'], '2026-09')
        self.assertEqual(item['ended'].tzinfo, timezone.utc)

    def test_segmented_hours_count_once_and_null_hours_are_not_fabricated(self):
        state, course = fixture()
        state['progress'] = [dict(id=30, source_system='aptem', accepted=True,
                                 actual_seconds=100, deleted_at=None),
                             dict(id=31, source_system='old_lms', accepted=True,
                                  actual_seconds=None, deleted_at=None)]
        state['segments'] = [dict(progress_id=30, actual_seconds=40), dict(progress_id=30, actual_seconds=50)]
        self.assertEqual(summary(state, [])['accepted_seconds'], 90)


if __name__ == '__main__':
    unittest.main()
