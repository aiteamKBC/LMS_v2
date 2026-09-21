"""View on a learner Review occurrence opens the ONE Curriculum Review form.

The learner's /learner/monthly-coaching and /learner/progress-reviews pages
used to render a hard-coded section list per Review type, read from the legacy
``coach_calendar_event.review_responses`` blob. Everything here pins the
replacement:

  * a SCHEDULED occurrence carries a ``review_instance_id`` on its calendar
    row and in the learner calendar payload, and the learner endpoint returns
    that instance's Curriculum-authored definition -- sections, fields,
    conditional fields, required rules, signatures;
  * an UNSCHEDULED occurrence carries no instance, and READING it never
    creates one (the instance lifecycle belongs to scheduling and to the
    coach's first open, not to a learner looking at a list);
  * nothing anywhere routes on a Review Template's NAME.
"""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from coach_api.models import CoachCalendarEvent
from coach_api.views import ensure_review_instance_for_calendar_record
from curriculum_api import review_instances, review_types, reviews

from .calendar import _generated_cycle_events, _serialize_event, learner_calendar_event_review, learner_progress_review_sign
from .tests_learner_review_pages import LearnerReviewPageTestCase, PROGRAMME_ID

# One section with a required text field and a conditional block, so "the form
# came from Curriculum" is provable rather than merely plausible.
CURRICULUM_SECTIONS = [{
    'title': 'Curriculum-authored section',
    'estimatedMinutes': 10,
    'fields': [
        {'title': 'What did the learner complete?', 'fieldType': 'text', 'required': True},
        {
            'title': 'Any safeguarding concerns?', 'fieldType': 'boolean_case_block', 'required': True,
            'yesFields': [{'title': 'Describe the concern', 'fieldType': 'text_multiline', 'required': True}],
            'noFields': [],
        },
    ],
}]

LEARNER_MIRROR_ID = 248


class LearnerReviewFormAccessTestCase(LearnerReviewPageTestCase):
    """Shared fixtures for both learner Review pages. No tests of its own."""

    def _authored_template(self, *, name, review_type_id, interval=4, unit='weeks'):
        """A Review the way Curriculum authors one: named, classified, and
        carrying real sections and fields."""
        review_id, errors = reviews.create_review(PROGRAMME_ID, {
            'name': name,
            'enabled': True,
            'reviewTypeId': review_type_id,
            'recurrence': {'interval': interval, 'unit': unit},
            'scheduleAnchorDate': '2026-01-01',
            'applicableStatuses': [],
            'signatures': {
                'advisor': True, 'employer': False, 'participant': True, 'referrer': False,
            },
            'visibleTo': {'advisor': True, 'employer': True, 'participant': True, 'referrer': True},
            'notifications': {'employer': False, 'participant': False},
            'sections': CURRICULUM_SECTIONS,
        }, actor='test')
        self.assertIsNone(errors, errors)
        return reviews.get_review_template_row(review_id)

    def _system_type_id(self, code):
        return review_types.get_review_type_by_code(code)['id']

    def _custom_type(self, name):
        row, errors = review_types.create_review_type(name, actor='test')
        self.assertIsNone(errors, errors)
        return row

    def _occurrence(self, source):
        """The first generated occurrence one of the pages would render."""
        events = _generated_cycle_events(self._enrolment_row(), self._profile(), set())
        rows = sorted((event for event in events if event['source'] == source), key=lambda event: event['date'])
        self.assertTrue(rows, f'no generated {source} occurrence to open')
        return rows[0]

    def _stored_row(self, occurrence, **overrides):
        fields = {
            'event_key': occurrence['eventKey'],
            'owner_email': 'coach@example.com',
            'owner_name': 'Coach One',
            'learner_id': LEARNER_MIRROR_ID,
            'learner_email': 'learner@example.com',
            'event_type': occurrence['source'],
            'sequence': occurrence['sequence'],
            'target_date': date.fromisoformat(occurrence['targetDate']),
            'status': CoachCalendarEvent.STATUS_NOT_SCHEDULED,
        }
        fields.update(overrides)
        return CoachCalendarEvent.objects.create(**fields)

    def _schedule(self, occurrence, template_row):
        """Exactly what coach_api does when an occurrence is first scheduled."""
        record = self._stored_row(
            occurrence,
            scheduled_date=date.fromisoformat(occurrence['targetDate']),
            status=CoachCalendarEvent.STATUS_SCHEDULED,
            review_template_id=template_row['id'],
            occurrence_number=occurrence['occurrenceNumber'],
        )
        ensure_review_instance_for_calendar_record(record, occurrence)
        record.refresh_from_db()
        return record

    def _view(self, record, event_key='missing'):
        """The learner's read-only Review endpoint. Ownership resolution is
        `_learner_calendar_record`'s own contract and is stubbed here."""
        request = SimpleNamespace(method='GET')
        with patch('learner_api.calendar._learner_calendar_record', return_value=record):
            response = learner_calendar_event_review.__wrapped__(
                request, 'apprenticeship', 101, record.event_key if record else event_key,
            )
        return response.status_code, json.loads(response.content.decode())


class LearnerReviewSigningTests(LearnerReviewFormAccessTestCase):
    def _finished_meeting(self):
        template = self._authored_template(
            name='Monthly Learner Catch-up',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_MCM),
        )
        record = self._schedule(self._occurrence('mcr'), template)
        instance = review_instances.get_review_instance(record.review_instance_id)
        definition = review_instances.review_instance_form_definition(instance)
        fields = definition['sections'][0]['fields']
        review_instances.save_review_instance_answers(instance, {
            fields[0]['id']: 'We reviewed this month together.', fields[1]['id']: 'no',
        }, actor=record.owner_email)
        ok, errors = review_instances.complete_review_instance(
            review_instances.get_review_instance(record.review_instance_id), actor=record.owner_email,
        )
        self.assertTrue(ok, errors)
        record.status = CoachCalendarEvent.STATUS_AWAITING_SIGNATURE
        record.save(update_fields=['status'])
        return record

    def _sign(self, record, mark):
        request = SimpleNamespace(method='POST', body=json.dumps({
            'name': 'Learner One', 'signature': mark,
        }).encode())
        with patch('learner_api.calendar._learner_calendar_record', return_value=record):
            response = learner_progress_review_sign.__wrapped__.__wrapped__(
                request, 'apprenticeship', 101, record.event_key,
            )
        return response.status_code, json.loads(response.content.decode())

    def test_final_learner_signature_completes_calendar_and_keeps_both_marks_on_reload(self):
        record = self._finished_meeting()
        coach_mark = 'data:image/png;base64,Y29hY2g='
        learner_mark = 'data:image/png;base64,bGVhcm5lcg=='
        review_instances.record_review_instance_signature(
            review_instances.get_review_instance(record.review_instance_id), 'advisor',
            signed_by=record.owner_email, signed_name='Coach One', signature=coach_mark,
        )

        status, payload = self._sign(record, learner_mark)

        self.assertEqual(status, 200, payload)
        self.assertEqual(payload['event']['status'], CoachCalendarEvent.STATUS_COMPLETED)
        self.assertEqual(payload['review']['instance']['status'], review_instances.STATUS_COMPLETED)
        record.refresh_from_db()
        self.assertEqual(record.status, CoachCalendarEvent.STATUS_COMPLETED)
        status, reloaded = self._view(record)
        self.assertEqual(status, 200)
        self.assertEqual(reloaded['signatures']['advisor']['signature'], coach_mark)
        self.assertEqual(reloaded['signatures']['participant']['signature'], learner_mark)

    def test_learner_signature_keeps_calendar_waiting_when_coach_has_not_signed(self):
        record = self._finished_meeting()

        status, payload = self._sign(record, 'data:image/png;base64,bGVhcm5lcg==')

        self.assertEqual(status, 200, payload)
        self.assertEqual(payload['event']['status'], CoachCalendarEvent.STATUS_AWAITING_SIGNATURE)
        self.assertEqual(payload['review']['instance']['status'], review_instances.STATUS_AWAITING_SIGNATURE)
        self.assertTrue(payload['review']['signatures']['participant']['signed'])
        self.assertFalse(payload['review']['signatures']['advisor']['signed'])
        self.assertIsNone(payload['review']['signatures']['advisor']['signature'])


class UnscheduledOccurrenceTests(LearnerReviewFormAccessTestCase):
    def test_a_generated_occurrence_carries_no_review_instance_id(self):
        self._authored_template(
            name='Monthly Learner Catch-up',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_MCM),
        )
        occurrence = self._occurrence('mcr')
        # A generated occurrence is a projection of the Curriculum recurrence;
        # nothing durable exists until it is scheduled.
        self.assertIsNone(occurrence['reviewInstanceId'])
        self.assertTrue(occurrence['reviewTemplateId'])
        self.assertEqual(occurrence['status'], CoachCalendarEvent.STATUS_NOT_SCHEDULED)

    def test_reading_an_unscheduled_occurrence_creates_no_instance(self):
        """The lifecycle, pinned: View before scheduling is READ-ONLY.

        An instance is created when the occurrence is scheduled, or when the
        coach opens its form to fill it in. Rendering the learner's list, or
        opening one of its rows, must write nothing at all.
        """
        template = self._authored_template(
            name='Monthly Learner Catch-up',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_MCM),
        )
        occurrence = self._occurrence('mcr')
        self.assertIsNone(
            review_instances.find_review_instance(
                template['id'], LEARNER_MIRROR_ID, occurrence['occurrenceNumber'],
            ),
        )

        # No stored row at all -- what a never-scheduled occurrence actually is.
        with patch('learner_api.calendar.SOURCE_MODELS') as models, \
                patch('learner_api.calendar.learner_profile_for_source', return_value=self._profile()):
            models.get.return_value.all_learners.filter.return_value.first.return_value = self._enrolment_row()
            status, payload = self._view(None, event_key=occurrence['eventKey'])
        self.assertEqual(status, 200)
        self.assertIsNone(payload['instance'])
        self.assertEqual(payload['sections'][0]['title'], 'Curriculum-authored section')

        # A stored row with no instance (booked before the Curriculum Review
        # architecture, say) answers "no instance", not an error.
        record = self._stored_row(occurrence)
        status, payload = self._view(record)
        self.assertEqual(status, 200)
        self.assertIsNone(payload['instance'])
        self.assertIsNone(_serialize_event(record)['reviewInstanceId'])

        self.assertIsNone(
            review_instances.find_review_instance(
                template['id'], LEARNER_MIRROR_ID, occurrence['occurrenceNumber'],
            ),
            'reading an unscheduled occurrence created a durable review_instance',
        )


class ScheduledOccurrenceTests(LearnerReviewFormAccessTestCase):
    def test_learner_finds_coach_draft_when_no_calendar_row_is_linked_yet(self):
        template = self._authored_template(
            name='Progress Review Draft',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW),
        )
        occurrence = self._occurrence('progress-review')
        instance = review_instances.ensure_review_instance(
            template,
            learner_id=LEARNER_MIRROR_ID,
            learner_kind='commercial',
            programme_id=PROGRAMME_ID,
            occurrence_number=occurrence['occurrenceNumber'],
            target_date=date.fromisoformat(occurrence['targetDate']),
            coach_email='coach@example.com',
        )
        field_id = reviews.get_review_field_rows(template['id'])[0]['id']
        review_instances.save_review_instance_answers(instance, {field_id: 'Saved by coach'}, actor='coach@example.com')

        # The coach opened a generated occurrence, so no CoachCalendarEvent
        # exists to carry review_instance_id. The learner must still resolve
        # the same durable instance by template/learner/occurrence identity.
        with patch('learner_api.calendar._learner_calendar_record', return_value=None), \
                patch('learner_api.calendar.SOURCE_MODELS') as models, \
                patch('learner_api.calendar.learner_profile_for_source', return_value=self._profile()):
            models.get.return_value.all_learners.filter.return_value.first.return_value = self._enrolment_row()
            status, payload = self._view(None, event_key=occurrence['eventKey'])

        self.assertEqual(status, 200)
        self.assertEqual(payload['instance']['id'], instance['id'])
        self.assertEqual(payload['sections'][0]['fields'][0]['answer'], 'Saved by coach')

    def test_scheduled_mcm_view_opens_the_generic_review_instance_form(self):
        template = self._authored_template(
            name='Monthly Learner Catch-up',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_MCM),
        )
        occurrence = self._occurrence('mcr')
        record = self._schedule(occurrence, template)

        # Scheduling creates the instance and links the calendar event both ways.
        self.assertTrue(record.review_instance_id)
        instance = review_instances.get_review_instance(record.review_instance_id)
        self.assertEqual(instance['calendar_event_id'], record.pk)

        # The learner calendar payload carries it -- the flag that routes View
        # to the generic form instead of the legacy detail rendering.
        self.assertEqual(_serialize_event(record)['reviewInstanceId'], record.review_instance_id)

        # And the form behind it is the Curriculum-authored one.
        status, payload = self._view(record)
        self.assertEqual(status, 200)
        self.assertEqual(payload['instance']['id'], record.review_instance_id)
        self.assertEqual([section['title'] for section in payload['sections']], ['Curriculum-authored section'])

    def test_scheduled_progress_review_view_opens_the_same_generic_form(self):
        template = self._authored_template(
            name='Quarterly Progress Conversation',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW),
        )
        occurrence = self._occurrence('progress-review')
        record = self._schedule(occurrence, template)

        self.assertTrue(record.review_instance_id)
        status, payload = self._view(record)
        self.assertEqual(status, 200)
        # Same endpoint, same payload, same Curriculum sections: there is no
        # separate hard-coded Progress Review form.
        self.assertEqual([section['title'] for section in payload['sections']], ['Curriculum-authored section'])
        self.assertEqual(payload['template']['name'], 'Quarterly Progress Conversation')

    def test_a_custom_review_type_uses_the_same_generic_form(self):
        custom = self._custom_type('Career Review')
        template = self._authored_template(name='Career Conversation', review_type_id=custom['id'])
        # A custom type routes to the generic review bucket rather than to one
        # of the two legacy pages, but opens the identical form.
        occurrence = self._occurrence('review')
        self.assertEqual(occurrence['reviewTypeCode'], custom['code'])
        record = self._schedule(occurrence, template)

        status, payload = self._view(record)
        self.assertEqual(status, 200)
        self.assertEqual([section['title'] for section in payload['sections']], ['Curriculum-authored section'])
        self.assertEqual(payload['template']['name'], 'Career Conversation')

    def test_the_form_is_the_templates_own_questions_not_a_fixed_list(self):
        """The Review Template's name is the title; the Review Type only
        classifies. The questions come from Curriculum, whole."""
        template = self._authored_template(
            name='Monthly Learner Catch-up',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_MCM),
        )
        record = self._schedule(self._occurrence('mcr'), template)

        _status, payload = self._view(record)
        fields = payload['sections'][0]['fields']
        self.assertEqual(
            [field['title'] for field in fields],
            ['What did the learner complete?', 'Any safeguarding concerns?'],
        )
        # Conditional children and required rules travel with the definition.
        conditional = fields[1]
        self.assertEqual(conditional['fieldType'], 'boolean_case_block')
        self.assertEqual([child['title'] for child in conditional['yesFields']], ['Describe the concern'])
        self.assertTrue(all(field['required'] for field in fields))
        # Signatures too -- the page never decides who has to sign.
        self.assertTrue(payload['signatures']['advisor']['required'])
        self.assertTrue(payload['signatures']['participant']['required'])
        self.assertFalse(payload['signatures']['employer']['required'])
        # The title is the template's name, never the Review Type's.
        self.assertEqual(payload['template']['name'], 'Monthly Learner Catch-up')
        self.assertNotEqual(payload['template']['name'], 'Monthly Coaching Meeting')

        # None of the legacy hard-coded MCM section ids survive on this path.
        legacy_ids = {'opening', 'presentation', 'ksb-reflection', 'next-month', 'meeting-summary'}
        self.assertFalse(legacy_ids & {section['id'] for section in payload['sections']})

    def test_renaming_the_template_renames_the_title_and_nothing_else(self):
        """No Review Template name matching anywhere on this path."""
        template = self._authored_template(
            name='Monthly Coaching Meeting',
            review_type_id=self._system_type_id(review_types.REVIEW_TYPE_CODE_MCM),
        )
        record = self._schedule(self._occurrence('mcr'), template)

        _review_id, errors = reviews.update_review(
            template['id'], {'name': 'Renamed Coaching Conversation'}, actor='test',
        )
        self.assertIsNone(errors, errors)

        _status, payload = self._view(record)
        # The displayed title follows the rename...
        self.assertEqual(payload['template']['name'], 'Renamed Coaching Conversation')
        # ...while classification and routing are untouched, so the occurrence
        # still belongs to the Monthly Coaching page.
        self.assertEqual(_serialize_event(record)['reviewTypeCode'], 'mcm')
        self.assertEqual(record.event_type, 'mcr')
        # And it is still the same instance, with the same frozen questions.
        self.assertEqual(payload['instance']['id'], record.review_instance_id)
        self.assertEqual([section['title'] for section in payload['sections']], ['Curriculum-authored section'])
