"""Reviews contribute off-the-job hours, gated by counts_towards_otjh.

``review_templates.expected_otjh`` is what ONE occurrence is worth;
``counts_towards_otjh`` is whether it is claimable as off-the-job training at
all. The two columns shipped with the Review Engine but nothing read them.
These cover the rules ``curriculum_api.review_otjh`` now enforces:

  * planned hours = expected_otjh x every occurrence the Review Engine
    projects, so scheduling a review raises the forecast before it happens;
  * completed hours = expected_otjh x every instance actually signed off;
  * a template with hours authored but the flag OFF contributes to neither --
    the flag is not a display toggle, it is the claim itself.
"""
from datetime import date

from django.db import connection
from django.test import TestCase

from . import review_instances, review_otjh, review_schedule, review_types, reviews
from . import views as curriculum_views

PROGRAMME_ID = 'PROG-OTJH'
LEARNER_ID = 4242
LEARNER_START = date(2026, 8, 10)
# One year: a monthly review produces 12 occurrences in it.
WINDOW_END = date(2027, 8, 9)


class ReviewOtjhTestCase(TestCase):
    def setUp(self):
        curriculum_views.reset_schema_ready_flags()
        curriculum_views.invalidate_curriculum_cache()
        reviews.provision_review_template_tables()
        review_types.provision_review_types_table()
        review_schedule.provision_review_schedule_tables()
        review_instances.provision_review_instance_tables()
        self._clear()

    def _clear(self):
        for table in (
            review_instances.REVIEW_INSTANCES_TABLE,
            reviews.REVIEW_FIELDS_TABLE,
            reviews.REVIEW_SECTIONS_TABLE,
            reviews.REVIEW_TEMPLATES_TABLE,
            review_types.REVIEW_TYPES_TABLE,
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {curriculum_views.authoring_table_name(table)}')
        review_types.seed_system_review_types()

    def _review(self, *, name='Monthly Coaching Meeting', expected_otjh=2.5,
                counts_towards_otjh=True, enabled=True, interval=1, unit='months'):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name,
            'enabled': enabled,
            'reviewTypeId': review_types.get_review_type_by_code(review_types.REVIEW_TYPE_CODE_MCM)['id'],
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'expectedOtjh': expected_otjh,
            'countsTowardsOtjh': counts_towards_otjh,
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'Notes', 'fieldType': 'text', 'required': False},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return reviews.get_review_template_row(review_id)

    def _planned(self):
        return review_otjh.planned_hours(
            PROGRAMME_ID, LEARNER_ID, 'Active', LEARNER_START, LEARNER_START, WINDOW_END,
        )

    def _occurrence_count(self, template):
        return len(review_instances.resolve_learner_occurrences(
            template, LEARNER_ID, 'Active', LEARNER_START, LEARNER_START, WINDOW_END,
        ))

    # --------------------------------------------------- itemised meetings

    def test_planned_meetings_itemise_the_same_hours_planned_hours_sums(self):
        """The Meetings table and the planned total must never disagree --
        they are the same projection, summed in one place."""
        self._review(name='MCM', expected_otjh=2.5)
        self._review(name='Progress Review', expected_otjh=1.5, interval=3)

        meetings = review_otjh.planned_meetings(
            PROGRAMME_ID, LEARNER_ID, 'Active', LEARNER_START, LEARNER_START, WINDOW_END,
        )
        self.assertEqual(len(meetings), 2)
        self.assertEqual(round(sum(m['hours'] for m in meetings), 2), self._planned())

        by_name = {m['name']: m for m in meetings}
        self.assertEqual(set(by_name), {'MCM', 'Progress Review'})
        for meeting in meetings:
            # hours must be the product a reader can check on the row itself.
            self.assertEqual(meeting['hours'], round(meeting['hoursEach'] * meeting['occurrences'], 2))
            self.assertGreater(meeting['occurrences'], 0)
            self.assertLessEqual(meeting['startDate'], meeting['endDate'])
            self.assertTrue(meeting['recurrenceLabel'])
        self.assertEqual(by_name['MCM']['hoursEach'], 2.5)
        self.assertEqual(by_name['Progress Review']['hoursEach'], 1.5)

    def test_planned_meetings_omit_templates_that_do_not_count(self):
        self._review(name='Counts', expected_otjh=2.5, counts_towards_otjh=True)
        self._review(name='Does not count', expected_otjh=9, counts_towards_otjh=False)
        meetings = review_otjh.planned_meetings(
            PROGRAMME_ID, LEARNER_ID, 'Active', LEARNER_START, LEARNER_START, WINDOW_END,
        )
        self.assertEqual([m['name'] for m in meetings], ['Counts'])

    def test_planned_meetings_use_the_live_template_name(self):
        """Renaming a Review in Curriculum must rename it on the plan."""
        template = self._review(name='Old Name', expected_otjh=2.5)
        _row, errors = reviews.update_review(template['id'], {'name': 'New Name'}, actor='test')
        self.assertFalse(errors, errors)
        meetings = review_otjh.planned_meetings(
            PROGRAMME_ID, LEARNER_ID, 'Active', LEARNER_START, LEARNER_START, WINDOW_END,
        )
        self.assertEqual([m['name'] for m in meetings], ['New Name'])

    def test_planned_meetings_empty_without_a_start_date(self):
        self._review(expected_otjh=2.5)
        self.assertEqual(
            review_otjh.planned_meetings(
                PROGRAMME_ID, LEARNER_ID, 'Active', None, LEARNER_START, WINDOW_END,
            ),
            [],
        )

    # ------------------------------------------------------- the hours rule

    def test_planned_hours_are_expected_otjh_times_every_occurrence(self):
        template = self._review(expected_otjh=2.5)
        occurrences = self._occurrence_count(template)
        self.assertGreater(occurrences, 0, 'the engine must produce occurrences for this window')
        self.assertEqual(self._planned(), round(2.5 * occurrences, 2))

    def test_adding_a_review_increases_planned_hours(self):
        """The behaviour asked for: a second OTJH-bearing Review raises the
        learner's planned hours by its own expected_otjh per occurrence."""
        first = self._review(name='MCM', expected_otjh=2.5)
        before = self._planned()

        second = self._review(name='Progress Review', expected_otjh=1.5, interval=3)
        after = self._planned()

        self.assertEqual(after - before, round(1.5 * self._occurrence_count(second), 2))
        self.assertGreater(after, before)
        # and the first review's contribution is untouched by the second
        self.assertEqual(before, round(2.5 * self._occurrence_count(first), 2))

    # ------------------------------------------------------------- the gate

    def test_counts_towards_otjh_false_contributes_nothing(self):
        self._review(expected_otjh=8, counts_towards_otjh=False)
        self.assertEqual(self._planned(), 0.0)

    def test_zero_expected_otjh_contributes_nothing(self):
        self._review(expected_otjh=0, counts_towards_otjh=True)
        self.assertEqual(self._planned(), 0.0)

    def test_disabled_template_contributes_nothing(self):
        self._review(expected_otjh=2.5, enabled=False)
        self.assertEqual(self._planned(), 0.0)

    def test_template_otjh_hours_gate(self):
        self.assertEqual(review_otjh.template_otjh_hours(
            {'expected_otjh': 2.5, 'counts_towards_otjh': True}), 2.5)
        self.assertEqual(review_otjh.template_otjh_hours(
            {'expected_otjh': 2.5, 'counts_towards_otjh': False}), 0.0)
        # A row from a database that predates the columns must read as zero,
        # not raise -- see otjh_template_rows' docstring.
        self.assertEqual(review_otjh.template_otjh_hours({}), 0.0)
        self.assertEqual(review_otjh.template_otjh_hours(None), 0.0)
        self.assertEqual(review_otjh.template_otjh_hours(
            {'expected_otjh': 'nonsense', 'counts_towards_otjh': True}), 0.0)

    # -------------------------------------------------------- no start date

    def test_no_learner_start_date_means_no_planned_hours(self):
        self._review(expected_otjh=2.5)
        self.assertEqual(
            review_otjh.planned_hours(PROGRAMME_ID, LEARNER_ID, 'Active', None, LEARNER_START, WINDOW_END),
            0.0,
        )

    # ------------------------------------------------------ completed hours

    def _instance(self, template, occurrence_number, target_date):
        return review_instances.ensure_review_instance(
            template,
            learner_id=LEARNER_ID,
            learner_kind='apprenticeship',
            programme_id=PROGRAMME_ID,
            occurrence_number=occurrence_number,
            target_date=target_date,
            actor='test',
        )

    def _complete_occurrence(self, template, occurrence_number, target_date):
        row = self._instance(template, occurrence_number, target_date)
        review_instances.force_review_instance_status_for_tests(
            row.get('id'), review_instances.STATUS_COMPLETED, actor='test',
        )
        return row

    def test_completed_hours_count_only_completed_instances(self):
        template = self._review(expected_otjh=2.5)
        # One scheduled-but-not-done occurrence banks nothing.
        self._instance(template, 1, date(2026, 9, 10))
        self.assertEqual(review_otjh.completed_hours(LEARNER_ID), 0.0)

        self._complete_occurrence(template, 2, date(2026, 10, 10))
        self.assertEqual(review_otjh.completed_hours(LEARNER_ID), 2.5)

        self._complete_occurrence(template, 3, date(2026, 11, 10))
        self.assertEqual(review_otjh.completed_hours(LEARNER_ID), 5.0)

    def test_completed_hours_respect_the_gate(self):
        template = self._review(expected_otjh=8, counts_towards_otjh=False)
        self._complete_occurrence(template, 1, date(2026, 9, 10))
        self.assertEqual(review_otjh.completed_hours(LEARNER_ID), 0.0)

    def test_completed_hours_are_scoped_to_the_learner(self):
        template = self._review(expected_otjh=2.5)
        self._complete_occurrence(template, 1, date(2026, 9, 10))
        self.assertEqual(review_otjh.completed_hours(LEARNER_ID + 1), 0.0)
