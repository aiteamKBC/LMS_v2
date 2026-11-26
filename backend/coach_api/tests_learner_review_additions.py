"""A coach can add an additional Review for ONE learner only, staying inside
the canonical Curriculum Review architecture the whole way:

    Review Template -> curriculum.learner_review_additions (WHO)
        -> canonical manual occurrence (occurrence_source='manual')
        -> review_instance -> CoachCalendarEvent -> Teams

Never a standalone CoachCalendarEvent, never a blank review_template_id/
review_instance_id, never a new programme-wide template. See
curriculum_api.review_instances.create_learner_review_addition and
coach_api.views.coach_review_learner_additions_create/
coach_review_learner_addition_templates.
"""
import json
from datetime import date, time
from unittest.mock import patch

from curriculum_api import review_instances, review_types, reviews

from coach_api import views as coach_views
from coach_api.models import CoachCalendarEvent

from learner_api.tests_review_scheduling_sync import (
    COACH_EMAIL,
    MIRROR_ID,
    OTHER_COACH_EMAIL,
    PROGRAMME_ID,
    ReviewSchedulingSyncTestCase,
    bookable_day,
    raw_view,
)


def raw(view):
    return raw_view(view)


class LearnerReviewAdditionTestCase(ReviewSchedulingSyncTestCase):
    """Shared fixtures/helpers. No tests of its own."""

    def get_templates(self, learner_id=MIRROR_ID, expect_status=200):
        request = self.factory.get(f'/coach_api/coach/reviews/learner-additions/templates?learnerId={learner_id}')
        response = self.run_patched(lambda: raw(coach_views.coach_review_learner_addition_templates)(request))
        self.assertEqual(response.status_code, expect_status, response.content)
        return json.loads(response.content.decode())

    def add_review(
        self, *, learner_id=MIRROR_ID, review_template_id, target_date, reason_code='', reason='',
        expect_status=201,
    ):
        request = self.factory.post(
            '/coach_api/coach/reviews/learner-additions',
            data=json.dumps({
                'learnerId': learner_id, 'reviewTemplateId': review_template_id,
                'targetDate': target_date.isoformat(), 'reasonCode': reason_code, 'reason': reason,
            }),
            content_type='application/json',
        )
        response = self.run_patched(lambda: raw(coach_views.coach_review_learner_additions_create)(request))
        self.assertEqual(response.status_code, expect_status, response.content)
        return json.loads(response.content.decode())


class TemplateSelectionTests(LearnerReviewAdditionTestCase):
    def test_3_only_programme_applicable_enabled_templates_returned(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        body = self.get_templates()
        self.assertEqual(body['programmeId'], PROGRAMME_ID)
        self.assertEqual([t['id'] for t in body['templates']], [template['id']])
        self.assertEqual(body['templates'][0]['reviewTypeCode'], 'mcm')

    def test_4_disabled_template_is_excluded_from_the_list(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        reviews.update_review(template['id'], {'enabled': False}, actor='test')
        body = self.get_templates()
        self.assertEqual(body['templates'], [])

    def test_no_programme_mapping_returns_empty_list(self):
        self.mirror.programme = 'No Such Programme'
        body = self.get_templates()
        self.assertIsNone(body['programmeId'])
        self.assertEqual(body['templates'], [])


class AddReviewTests(LearnerReviewAdditionTestCase):
    def test_1_6_coach_can_add_one_review_for_one_learner_target_date_stored(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        target = date(2026, 10, 30)

        body = self.add_review(review_template_id=template['id'], target_date=target, reason_code='additional-coaching')

        self.assertEqual(body['reviewTemplateId'], template['id'])
        self.assertEqual(body['targetDate'], '2026-10-30')
        self.assertTrue(body['reviewInstanceId'])
        instance = review_instances.get_review_instance(body['reviewInstanceId'])
        self.assertEqual(str(instance['target_date']), '2026-10-30')

    def test_3_4_wrong_or_disabled_template_rejected_server_side(self):
        # Wrong programme: a template that belongs to a DIFFERENT programme.
        other_review_id, errors = reviews.create_review('PROG-OTHER-999', {
            'name': 'Someone Else\'s Review', 'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(review_types.REVIEW_TYPE_CODE_MCM)['id'],
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False}, 'sections': [],
        }, actor='test')
        self.assertIsNone(errors, errors)
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)

        body = self.add_review(review_template_id=other_review_id, target_date=date(2026, 10, 30), expect_status=404)
        self.assertIn('not enabled for this learner', body['detail'])
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)

    def test_5_disabled_template_rejected(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        reviews.update_review(template['id'], {'enabled': False}, actor='test')

        body = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30), expect_status=404)
        self.assertIn('not enabled', body['detail'])

    def test_9_occurrence_source_is_manual(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        body = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        instance = review_instances.get_review_instance(body['reviewInstanceId'])
        self.assertEqual(instance['occurrence_source'], 'manual')
        self.assertIsNone(instance['occurrence_number'])

    def test_10_11_occurrence_ref_is_stable_unique_and_not_from_generated_sequence(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')  # a real GENERATED occurrence #1
        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        generated_instance_id = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey']).review_instance_id

        body = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))

        self.assertTrue(body['occurrenceRef'].startswith('manual:'))
        self.assertNotEqual(body['reviewInstanceId'], generated_instance_id)
        manual_instance = review_instances.get_review_instance(body['reviewInstanceId'])
        self.assertEqual(manual_instance['occurrence_ref'], body['occurrenceRef'])

    def test_14_15_add_review_creates_no_teams_meeting_status_not_scheduled(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        body = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))

        self.assertEqual(body['status'], 'not-scheduled')
        self.assertEqual(CoachCalendarEvent.objects.count(), 0)  # no calendar row until scheduled
        self.assertEqual(self.graph_calls, [])

    def test_20_23_reason_and_audit_captured(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        body = self.add_review(
            review_template_id=template['id'], target_date=date(2026, 10, 30),
            reason_code='safeguarding-follow-up', reason='Flagged by employer.',
        )
        addition = review_instances.get_learner_review_addition(body['additionId'])
        self.assertEqual(addition['learner_id'], MIRROR_ID)
        self.assertEqual(addition['review_template_id'], template['id'])
        self.assertEqual(addition['reason_code'], 'safeguarding-follow-up')
        self.assertEqual(addition['reason'], 'Flagged by employer.')
        self.assertEqual(addition['created_by'], COACH_EMAIL)
        self.assertIsNotNone(addition['created_at'])

    def test_unrecognised_reason_code_is_rejected(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        body = self.add_review(
            review_template_id=template['id'], target_date=date(2026, 10, 30),
            reason_code='not-a-real-code', expect_status=400,
        )
        self.assertIn('reasonCode', body['detail'])

    def test_missing_required_fields_rejected(self):
        request = self.factory.post(
            '/coach_api/coach/reviews/learner-additions',
            data=json.dumps({}), content_type='application/json',
        )
        response = self.run_patched(lambda: raw(coach_views.coach_review_learner_additions_create)(request))
        self.assertEqual(response.status_code, 400, response.content)

    def test_26_duplicate_request_is_idempotent(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        first = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        second = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))

        self.assertEqual(first['additionId'], second['additionId'])
        self.assertEqual(first['reviewInstanceId'], second['reviewInstanceId'])
        self.assertEqual(first['eventKey'], second['eventKey'])
        additions = review_instances.list_active_learner_review_additions(PROGRAMME_ID, MIRROR_ID)
        self.assertEqual(len(additions), 1)


class AddAndScheduleTests(LearnerReviewAdditionTestCase):
    """The 'Add & Schedule' flow: create the addition, then reuse the
    EXISTING scheduling endpoint (coach_timetable_schedule_event) with the
    returned eventKey -- no duplicated Graph logic."""

    def test_16_17_18_19_add_and_schedule_creates_canonical_calendar_event(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))

        meeting_day = bookable_day(20)
        self.coach_schedules(addition['eventKey'], meeting_day, '10:00')

        record = CoachCalendarEvent.objects.get(event_key=addition['eventKey'])
        self.assertEqual(record.target_date, date(2026, 10, 30))
        self.assertEqual(record.scheduled_date, meeting_day)
        self.assertEqual(record.scheduled_time, time(10, 0))
        self.assertEqual(record.review_template_id, template['id'])
        self.assertEqual(record.review_instance_id, addition['reviewInstanceId'])
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_SCHEDULED)
        self.assertIsNone(record.occurrence_number)
        # Teams payload uses scheduled_date/time, never target_date.
        payload = self.graph_payloads()[-1]
        self.assertIn(meeting_day.isoformat(), payload['start']['dateTime'])
        self.assertNotIn('2026-10-30', payload['start']['dateTime'])

    def test_20_manual_event_key_is_date_independent(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        self.assertEqual(addition['eventKey'], f"review:{MIRROR_ID}:{template['id']}:manual:{addition['additionId']}")
        self.assertNotIn('2026-10-30', addition['eventKey'])

    def test_32_rescheduling_a_manual_review_does_not_alter_target_date(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        self.coach_schedules(addition['eventKey'], bookable_day(20), '10:00')

        self.coach_schedules(addition['eventKey'], bookable_day(35), '15:00')

        record = CoachCalendarEvent.objects.get(event_key=addition['eventKey'])
        self.assertEqual(record.target_date, date(2026, 10, 30))
        self.assertEqual(record.scheduled_date, bookable_day(35))
        self.assertEqual(record.review_instance_id, addition['reviewInstanceId'])


class ResolverMergeTests(LearnerReviewAdditionTestCase):
    def test_8_30_manual_review_appears_chronologically_in_learner_and_coach_lists(self):
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(
            review_template_id=self.get_templates()['templates'][0]['id'], target_date=date(2026, 10, 30),
        )

        coach_dates = [e['date'] for e in self.coach_events().values() if e['source'] == 'mcr']
        learner_dates = [e['date'] for e in self.learner_events().values() if e['source'] == 'mcr']
        self.assertEqual(coach_dates, sorted(coach_dates))
        self.assertEqual(learner_dates, sorted(learner_dates))
        self.assertIn('2026-10-30', coach_dates)
        self.assertIn('2026-10-30', learner_dates)
        manual_event = self.coach_events()[addition['eventKey']]
        self.assertEqual(manual_event['occurrenceSource'], 'manual')

    def test_2_31_22_other_learner_and_normal_recurrence_are_unaffected(self):
        """Learner B (same programme) must not receive learner A's manual
        addition, and A's own generated occurrences must be unchanged."""
        self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        a_dates_before = sorted(e['date'] for e in self.learner_events().values() if e['source'] == 'mcr')

        self.add_review(review_template_id=self.get_templates()['templates'][0]['id'], target_date=date(2026, 10, 30))

        a_dates_after = sorted(e['date'] for e in self.learner_events().values() if e['source'] == 'mcr')
        self.assertEqual(a_dates_after, sorted(a_dates_before + ['2026-10-30']))

        # Learner B: a second, unrelated mirror/enrolment pair on the SAME programme.
        from types import SimpleNamespace
        learner_b = SimpleNamespace(
            id=101, pk=101, email='learner-b@example.com', username='Learner B',
            learner_type='commercial', start_date=self.learner.start_date, end_date=self.learner.end_date,
            practical_period_end_date='', apprenticeship_end_date='',
        )
        mirror_b = SimpleNamespace(
            id=999, pk=999, email='learner-b@example.com', username='Learner B', full_name='Learner B',
            start_date=self.mirror.start_date, end_date=self.mirror.end_date,
            coach_name='Coach One', coach_email=COACH_EMAIL,
            programme=PROGRAMME_ID and self.mirror.programme, programme_status='Active',
            cohort='Cohort A', group_name='Group A', learner_type='commercial', enrolment_id='101',
        )
        from learner_api.calendar import _generated_cycle_events
        b_events = _generated_cycle_events(learner_b, mirror_b, set())
        b_dates = sorted(e['date'] for e in b_events if e['source'] == 'mcr')
        self.assertNotIn('2026-10-30', b_dates)


class ReviewTypeMappingTests(LearnerReviewAdditionTestCase):
    def test_16_17_mcm_and_progress_review_map_correctly(self):
        mcm_template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        pr_template = self.template(
            name='Quarterly Progress Conversation', type_code=review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW,
            interval=8,
        )

        mcm_addition = self.add_review(review_template_id=mcm_template['id'], target_date=date(2026, 10, 30))
        pr_addition = self.add_review(review_template_id=pr_template['id'], target_date=date(2026, 11, 2))

        self.assertTrue(mcm_addition['eventKey'].startswith(f'review:{MIRROR_ID}:{mcm_template["id"]}:manual:'))
        events = self.coach_events()
        self.assertEqual(events[mcm_addition['eventKey']]['source'], 'mcr')
        self.assertEqual(events[pr_addition['eventKey']]['source'], 'progress-review')

    def test_19_custom_review_type_stays_generic(self):
        _template, type_row = self._custom_review_type_template()
        addition = self.add_review(review_template_id=_template['id'], target_date=date(2026, 10, 30))
        event = self.coach_events()[addition['eventKey']]
        self.assertEqual(event['source'], 'review')
        self.assertEqual(event['reviewTypeCode'], type_row['code'])

    def _custom_review_type_template(self):
        type_row, errors = review_types.create_review_type('Career Review', actor='test')
        self.assertIsNone(errors, errors)
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': 'Career Conversation', 'enabled': True, 'reviewTypeId': type_row['id'],
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': False, 'employer': False, 'participant': False, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False}, 'sections': [],
        }, actor='test')
        self.assertIsNone(errors, errors)
        return reviews.get_review_template_row(review_id), type_row


class SignatureAndDefinitionSnapshotTests(LearnerReviewAdditionTestCase):
    def test_24_25_definition_snapshot_and_signatures_are_inherited(self):
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': 'Monthly Learner Catch-up', 'enabled': True,
            'reviewTypeId': review_types.get_review_type_by_code(review_types.REVIEW_TYPE_CODE_MCM)['id'],
            'recurrence': {'interval': 4, 'unit': 'weeks'}, 'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {'advisor': True, 'employer': False, 'participant': True, 'referrer': False},
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': [{'title': 'General', 'fields': [
                {'title': 'How is it going?', 'fieldType': 'text_multiline', 'required': True},
            ]}],
        }, actor='test')
        self.assertIsNone(errors, errors)
        template = reviews.get_review_template_row(review_id)

        body = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        definition = review_instances.review_instance_form_definition(
            review_instances.get_review_instance(body['reviewInstanceId']),
        )
        self.assertEqual(definition['template']['signatures'], {'advisor': True, 'employer': False, 'participant': True, 'referrer': False})
        self.assertEqual(len(definition['sections']), 1)
        self.assertEqual(definition['sections'][0]['fields'][0]['title'], 'How is it going?')


class LifecycleAndAttendanceTests(LearnerReviewAdditionTestCase):
    def test_11_12_initial_status_and_scheduling_transition(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        self.assertEqual(
            review_instances.get_review_instance(addition['reviewInstanceId'])['status'],
            review_instances.STATUS_NOT_SCHEDULED,
        )

        self.coach_schedules(addition['eventKey'], bookable_day(20))

        self.assertEqual(
            review_instances.get_review_instance(addition['reviewInstanceId'])['status'],
            review_instances.STATUS_SCHEDULED,
        )

    def test_33_teams_attendance_moves_manual_review_scheduled_to_in_progress(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        self.coach_schedules(addition['eventKey'], bookable_day(20))
        instance_id = addition['reviewInstanceId']

        from datetime import datetime, timezone as dt_timezone
        started_at = datetime(2026, 10, 20, 10, 0, tzinfo=dt_timezone.utc)
        updated = review_instances.mark_review_instance_in_progress_from_attendance(instance_id, started_at=started_at)

        self.assertIsNotNone(updated)
        self.assertEqual(review_instances.get_review_instance(instance_id)['status'], review_instances.STATUS_IN_PROGRESS)

    def test_opening_the_form_does_not_mark_in_progress(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        review_instances.review_instance_form_definition(review_instances.get_review_instance(addition['reviewInstanceId']))
        self.assertEqual(
            review_instances.get_review_instance(addition['reviewInstanceId'])['status'],
            review_instances.STATUS_NOT_SCHEDULED,
        )


class PermissionTests(LearnerReviewAdditionTestCase):
    def test_27_unauthorized_coach_is_rejected(self):
        """A coach who is not this learner's coach must not be able to add a
        Review for them -- same caseload scoping every other coach write
        already enforces."""
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        body = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        self.assertTrue(body.get('additionId'))

        # A different coach's caseload (patches() only recognises COACH_EMAIL)
        # never contains this learner.
        request = self.factory.post(
            '/coach_api/coach/reviews/learner-additions',
            data=json.dumps({
                'learnerId': MIRROR_ID, 'reviewTemplateId': template['id'],
                'targetDate': '2026-11-30', 'reasonCode': '', 'reason': '',
            }),
            content_type='application/json',
        )
        response = self.run_patched(
            lambda: raw(coach_views.coach_review_learner_additions_create)(request),
            coach_email=OTHER_COACH_EMAIL,
        )
        self.assertEqual(response.status_code, 404, response.content)


class NormalReviewsUnaffectedTests(LearnerReviewAdditionTestCase):
    def test_28_29_generated_numbering_and_lookup_unchanged(self):
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        occurrence = self.coach_occurrence('mcr')
        self.coach_schedules(occurrence['eventKey'], bookable_day(20))
        generated_record = CoachCalendarEvent.objects.get(event_key=occurrence['eventKey'])

        self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))

        generated_record.refresh_from_db()
        self.assertEqual(generated_record.occurrence_number, occurrence['occurrenceNumber'])
        found = review_instances.find_review_instance(template['id'], MIRROR_ID, occurrence['occurrenceNumber'])
        self.assertEqual(found['id'], generated_record.review_instance_id)

    def test_35_existing_manual_override_lifecycle_helper_still_works(self):
        """Scope guard: the (unrelated) manual scheduled->in-progress override
        feature must keep working for a manual REVIEW addition exactly as for
        a generated one -- it is keyed by review_instance_id, not by
        occurrence_source."""
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        addition = self.add_review(review_template_id=template['id'], target_date=date(2026, 10, 30))
        self.coach_schedules(addition['eventKey'], bookable_day(20))
        instance_row = review_instances.get_review_instance(addition['reviewInstanceId'])

        ok, updated = review_instances.mark_review_instance_in_progress_manually(
            instance_row, reason_code='graph-unavailable', actor=COACH_EMAIL,
        )
        self.assertTrue(ok)
        self.assertEqual(updated['status'], review_instances.STATUS_IN_PROGRESS)

    def test_37_assignment_month_mcm_fix_is_unaffected(self):
        """Scope guard: the assignment_month canonical-linkage fix from the
        prior task must still resolve occurrences the same way -- it uses
        _resolve_direct_cycle_event_key, unaffected by the manual-addition
        merge (which only adds MORE occurrences, never removes the generated
        ones _resolve_direct_cycle_event_key looks for)."""
        from learner_api import calendar as learner_calendar
        from learner_api.tests_assignment_month_mcm_linkage import ASSIGNMENT_MONTH, _booking_day
        template = self.template(name='Monthly Learner Catch-up', type_code=review_types.REVIEW_TYPE_CODE_MCM)
        self.add_review(review_template_id=template['id'], target_date=date(2099, 1, 1))  # unrelated far-future addition

        request = self.factory.post(
            f'/learner_api/calendar/commercial/{self.learner.pk}/book/',
            data=json.dumps({
                'sessionType': 'mcr', 'assignmentMonth': ASSIGNMENT_MONTH, 'reviewId': '9',
                'scheduledDate': _booking_day().isoformat(), 'scheduledTime': '09:00', 'durationMinutes': 60,
            }),
            content_type='application/json',
        )
        with patch.object(learner_calendar, '_mark_imported_review_scheduled'):
            response = self.run_patched(
                lambda: raw(learner_calendar.learner_calendar_book)(request, 'commercial', self.learner.pk),
            )
        self.assertIn(response.status_code, (200, 201), response.content)
        record = CoachCalendarEvent.objects.get(event_type='mcr', review_template_id=template['id'])
        self.assertTrue(record.review_instance_id)
        self.assertEqual(record.occurrence_number, 1)  # the GENERATED occurrence, not the manual one
