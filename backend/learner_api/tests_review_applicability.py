"""Curriculum applicability, lifecycle and identity agree on both calendars."""
from unittest.mock import patch

from coach_api import views as coach_views
from coach_api.models import CoachCalendarEvent
from curriculum_api import review_instances, reviews
from curriculum_api import views as curriculum_views

from .tests_review_scheduling_sync import ReviewSchedulingSyncTestCase, bookable_day


class ReviewApplicabilityTests(ReviewSchedulingSyncTestCase):
    def patches(self, **kwargs):
        # Exercise the real persisted-event query, including records whose
        # templates have since been disabled, archived or reclassified.
        return [p for p in super().patches(**kwargs) if p.attribute != 'fetch_standalone_event_records']

    def restrict(self, template, scope, identifiers):
        with patch.object(curriculum_views, 'authoring_fetch_all', return_value=[
            {f'{scope}_id': identifier} for identifier in identifiers
        ]):
            _, errors = reviews.update_review(template['id'], {
                'applicability': {'scope': scope, 'ids': identifiers},
            })
        self.assertIsNone(errors)

    def test_group_placement_controls_both_calendars(self):
        template = self.template(name='Group coaching', type_code='mcm')
        self.restrict(template, 'group', ['GROUP-A'])
        self.mirror.group_id = 'GROUP-B'
        self.assertEqual(self.coach_events(), {})
        self.assertEqual(self.learner_events(), {})
        self.mirror.group_id = 'GROUP-A'
        self.assertTrue(self.coach_events())
        self.assertEqual(set(self.coach_events()), set(self.learner_events()))

    def test_cohort_placement_and_status_are_both_required(self):
        template = self.template(name='Cohort progress', type_code='progress_review')
        self.restrict(template, 'cohort', ['COHORT-A'])
        self.mirror.cohort_id = 'COHORT-A'
        reviews.update_review(template['id'], {'applicableStatuses': ['Completed']})
        self.assertEqual(self.coach_events(), {})
        self.assertEqual(self.learner_events(), {})
        reviews.update_review(template['id'], {'applicableStatuses': ['Active']})
        self.assertEqual(set(self.coach_events()), set(self.learner_events()))
        self.assertTrue(self.coach_events())

    def test_names_resolve_only_within_the_learners_cohort(self):
        template = {'programme_id': 'P', 'applicability': {'scope': 'group', 'ids': ['G-A']}}
        rows = [
            {'group_id': 'G-A', 'group_name': 'Group 1', 'cohort_name': 'Cohort A'},
            {'group_id': 'G-B', 'group_name': 'Group 1', 'cohort_name': 'Cohort B'},
        ]
        with patch.object(curriculum_views, 'authoring_fetch_all', return_value=rows):
            self.assertTrue(review_instances.review_applies_to_placement(template, {'cohort': 'Cohort A', 'group': 'Group 1'}))
            self.assertFalse(review_instances.review_applies_to_placement(template, {'cohort': 'Cohort B', 'group': 'Group 1'}))
            self.assertFalse(review_instances.review_applies_to_placement(template, {'group': 'Group 1'}))
            self.assertFalse(review_instances.review_applies_to_placement(template, {'group_id': 'G-B', 'cohort': 'Cohort A', 'group': 'Group 1'}))

    def test_foreign_placement_and_empty_selection_are_rejected(self):
        template = self.template(name='Coaching', type_code='mcm')
        with patch.object(curriculum_views, 'authoring_fetch_all', return_value=[{'group_id': 'G-OWN'}]) as fetch:
            _, errors = reviews.update_review(template['id'], {'applicability': {'scope': 'group', 'ids': ['G-FOREIGN']}})
            self.assertIn('applicability', errors)
            self.assertEqual(fetch.call_args.args[2], [template['programme_id']])
        _, errors = reviews.update_review(template['id'], {'applicability': {'scope': 'group', 'ids': []}})
        self.assertIn('applicability', errors)

    def test_two_reviews_with_identical_type_and_dates_remain_distinct(self):
        first = self.template(name='Coaching A', type_code='mcm')
        second = self.template(name='Coaching B', type_code='mcm')
        events = self.coach_events()
        first_dates = [event['targetDate'] for event in events.values() if event['reviewTemplateId'] == first['id']]
        second_dates = [event['targetDate'] for event in events.values() if event['reviewTemplateId'] == second['id']]
        self.assertEqual(first_dates, second_dates)
        self.assertEqual(len(events), len(first_dates) + len(second_dates))
        self.assertEqual(set(events), set(self.learner_events()))

    def test_reclassification_and_schedule_edits_preserve_the_booking(self):
        template = self.template(name='Original', type_code='mcm')
        event = self.coach_occurrence('mcr')
        self.learner_schedules(event['eventKey'], 'mcr', bookable_day(20))
        record = CoachCalendarEvent.objects.get(event_key=event['eventKey'])
        instance_id = record.review_instance_id
        from curriculum_api import review_types
        reviews.update_review(template['id'], {
            'name': 'Renamed', 'recurrence': {'interval': 6, 'unit': 'weeks'},
            'reviewTypeId': review_types.get_review_type_by_code('progress_review')['id'],
        })
        for events in (self.coach_events(), self.learner_events()):
            self.assertIn(event['eventKey'], events)
            self.assertEqual(events[event['eventKey']]['source'], 'progress-review')
            self.assertEqual(events[event['eventKey']]['title'], 'Renamed')
            self.assertEqual(events[event['eventKey']]['status'], 'scheduled')
        record.refresh_from_db()
        self.assertEqual(record.review_instance_id, instance_id)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)

    def test_two_configured_reviews_can_be_booked_in_the_same_week_without_overlap(self):
        self.template(name='Coaching A', type_code='mcm')
        self.template(name='Coaching B', type_code='mcm')
        events = [event for event in self.coach_events().values() if event['sequence'] == 1]
        day = bookable_day(20)
        self.learner_schedules(events[0]['eventKey'], 'mcr', day, '10:00')
        self.learner_schedules(events[1]['eventKey'], 'mcr', day, '11:00')
        self.assertEqual(CoachCalendarEvent.objects.filter(status='scheduled').count(), 2)
        self.learner_schedules(events[1]['eventKey'], 'mcr', day, '10:00', expect_status=409)

    def test_disabled_or_archived_review_stops_new_slots_but_preserves_booking(self):
        template = self.template(name='Coaching', type_code='mcm')
        event = self.coach_occurrence('mcr')
        self.learner_schedules(event['eventKey'], 'mcr', bookable_day(20))
        reviews.update_review(template['id'], {'enabled': False})
        for events in (self.coach_events(), self.learner_events()):
            self.assertEqual(list(events), [event['eventKey']])
            self.assertEqual(events[event['eventKey']]['status'], 'scheduled')
        reviews.archive_review(template['id'])
        for events in (self.coach_events(), self.learner_events()):
            self.assertEqual(list(events), [event['eventKey']])
            self.assertEqual(events[event['eventKey']]['title'], 'Coaching')

    def test_legacy_booking_key_survives_without_a_duplicate_occurrence(self):
        template = self.template(name='Coaching', type_code='mcm')
        event = self.coach_occurrence('mcr')
        from datetime import date
        target = date.fromisoformat(event['targetDate'])
        old_key = coach_views.build_timetable_event_key(self.mirror.id, 'mcr', 1, target)
        CoachCalendarEvent.objects.create(
            event_key=old_key, owner_email=self.mirror.coach_email, learner_id=self.mirror.id,
            learner_email=self.mirror.email, event_type='mcr', sequence=1,
            target_date=target, scheduled_date=target, status='scheduled',
        )
        for events in (self.coach_events(), self.learner_events()):
            self.assertIn(old_key, events)
            self.assertNotIn(event['eventKey'], events)
            self.assertEqual(events[old_key]['reviewTemplateId'], template['id'])

    def test_unused_legacy_placeholder_does_not_restore_disabled_review(self):
        template = self.template(name='Coaching', type_code='mcm')
        event = self.coach_occurrence('mcr')
        from datetime import date
        target = date.fromisoformat(event['targetDate'])
        CoachCalendarEvent.objects.create(
            event_key=coach_views.build_timetable_event_key(self.mirror.id, 'mcr', 1, target),
            owner_email=self.mirror.coach_email, learner_id=self.mirror.id,
            learner_email=self.mirror.email, event_type='mcr', sequence=1,
            target_date=target, status='not-scheduled',
        )
        reviews.update_review(template['id'], {'enabled': False})
        self.assertEqual(self.coach_events(), {})
        self.assertEqual(self.learner_events(), {})
