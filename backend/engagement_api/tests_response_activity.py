"""Read-only staff response context; no application DB or external I/O."""
from datetime import date, datetime, timezone
import json
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from . import feedback
from .tests import _account, _patched

MOMENT = datetime(2026, 11, 7, 10, tzinfo=timezone.utc)


def response(kind='general', **changes):
    return SimpleNamespace(**{
        'id': 1, 'form_id': 31, 'form': SimpleNamespace(form_type=kind, title='Current form title',
            anonymous_responses=False, template_key='synthetic-template', response_assignments=[]),
        'learner_id': '71', 'learner_name': 'Synthetic respondent', 'programme': 'Synthetic programme',
        'delivery_id': None, 'delivery': None, 'review_delivery_id': None, 'review_delivery': None,
        'employer_review_delivery_id': None, 'employer_review_delivery': None,
        'event_recipient_id': None, 'event_recipient': None, 'rsvp_recipient_id': None, 'rsvp_recipient': None,
        'status': 'completed', 'started_at': MOMENT, 'updated_at': MOMENT, 'submitted_at': MOMENT,
        **changes,
    })


class ResponseActivityTests(SimpleTestCase):
    def test_coach_names_are_read_once_from_only_the_lists_pinned_source_reviews(self):
        rows = []
        for index, kind in enumerate(('post_mcm_review', 'post_progress_review', 'post_epa_review',
                                      'post_progress_review_employer'), start=1):
            field = 'employer_review_delivery' if kind.endswith('_employer') else 'review_delivery'
            rows.append(response(kind, **{f'{field}_id': index, field: SimpleNamespace(source_review_id=100 + index)}))
        rows.extend([rows[0], response(), response('post_lecture'), response('post_progress_review')])
        with mock.patch.object(feedback, 'connection') as connection:
            query = connection.cursor.return_value.__enter__.return_value
            query.fetchall.return_value = [(101, ' Synthetic MCM coach '), (102, 'Synthetic PR coach'),
                                          (103, None), (104, '')]
            names = feedback._response_review_coaches(rows)
            query.execute.assert_called_once_with(
                'SELECT id, reviewer_name FROM "Learner".reviews WHERE id = ANY(%s)', [[101, 102, 103, 104]])
            self.assertEqual(names, {101: 'Synthetic MCM coach', 102: 'Synthetic PR coach', 103: '', 104: ''})
        for row in rows[:4]:
            expected = names[(row.employer_review_delivery or row.review_delivery).source_review_id]
            self.assertEqual(feedback._response_activity(row, names)['coachName'], expected)

    def test_coach_query_is_not_run_for_non_review_or_unlinked_responses(self):
        with mock.patch.object(feedback, 'connection') as connection:
            self.assertEqual(feedback._response_review_coaches([response(), response('post_progress_review')]), {})
            connection.cursor.assert_not_called()

    def test_source_coach_is_list_only_and_missing_source_name_is_explicit(self):
        row = response('post_epa_review', review_delivery_id=5,
                       review_delivery=SimpleNamespace(source_review_id=103, assigned_at=MOMENT))
        original = feedback._response_dict(row)
        data = feedback._response_dict(row, include_activity=True, review_coaches={103: 'Synthetic source coach'})
        self.assertEqual(data['activity']['coachName'], 'Synthetic source coach')
        self.assertEqual(feedback._response_activity(row, {999: 'Other review coach'})['coachName'], '')
        self.assertNotIn('activity', original)
        self.assertNotIn('Synthetic source coach', json.dumps(original))

    def test_lecture_context_keeps_saved_title_date_and_tutor(self):
        row = response('post_lecture', delivery_id=5, delivery=SimpleNamespace(
            session_title='Frozen lecture', starts_at=MOMENT, tutor_name='Original tutor'))
        self.assertEqual(feedback._response_activity(row), {
            'kind': 'lecture', 'title': 'Frozen lecture', 'date': MOMENT.isoformat(), 'tutorName': 'Original tutor',
        })
        row.delivery.tutor_name = ''
        self.assertEqual(feedback._response_activity(row)['tutorName'], '')

    def test_all_review_types_use_their_own_delivery_completion_not_submission(self):
        for kind in ('post_mcm_review', 'post_progress_review', 'post_epa_review', 'post_progress_review_employer'):
            with self.subTest(kind=kind):
                field = 'employer_review_delivery' if kind.endswith('_employer') else 'review_delivery'
                row = response(kind, **{f'{field}_id': 5, field: SimpleNamespace(
                    review_name='Frozen review', review_type='Source review type', completed_at=MOMENT,
                    learner_name='Related learner')})
                row.submitted_at = datetime(2026, 11, 8, 10, tzinfo=timezone.utc)
                activity = feedback._response_activity(row)
                self.assertEqual((activity['title'], activity['date'], activity['kind']),
                                 ('Frozen review', MOMENT.isoformat(), 'review'))
                self.assertEqual(activity['tutorName'], '')
                if kind.endswith('_employer'):
                    self.assertEqual(activity['relatedLearnerName'], 'Related learner')
                else:
                    self.assertNotIn('relatedLearnerName', activity)

    def test_anonymous_employer_does_not_expose_related_learner_identity(self):
        row = response('post_progress_review_employer', employer_review_delivery_id=5,
            employer_review_delivery=SimpleNamespace(review_name='Synthetic PR', review_type='Progress Review',
                completed_at=MOMENT, learner_name='PRIVATE learner'))
        row.form.anonymous_responses = True
        data = feedback._response_dict(row, include_activity=True)
        self.assertEqual(data['learnerName'], 'Anonymous employer')
        self.assertIsNone(data['learnerId'])
        self.assertNotIn('PRIVATE learner', json.dumps(data))

    def test_module_context_uses_saved_module_without_fabricating_lecture_metadata(self):
        for kind in ('mid_module', 'end_module'):
            with self.subTest(kind=kind):
                row = response(kind, delivery_id=5, delivery=SimpleNamespace(
                    module_name='Frozen module', starts_at=None, session_title='', tutor_name='Unused tutor'))
                self.assertEqual(feedback._response_activity(row), {
                    'kind': 'module', 'title': 'Frozen module', 'date': None, 'tutorName': '',
                })

    def test_event_and_rsvp_context_follow_their_own_recipient(self):
        event = SimpleNamespace(title='Industry workshop', event_date=date(2026, 11, 6))
        for row in (
            response('post_event', event_recipient_id=5, event_recipient=SimpleNamespace(event=event)),
            response('event_rsvp', rsvp_recipient_id=6, rsvp_recipient=SimpleNamespace(campaign=SimpleNamespace(event=event))),
        ):
            with self.subTest(kind=row.form.form_type):
                self.assertEqual(feedback._response_activity(row), {
                    'kind': 'event', 'title': 'Industry workshop', 'date': '2026-11-06', 'tutorName': '',
                })
        event.event_date = None
        event.date = '6 November 2026'
        self.assertEqual(feedback._response_activity(row)['dateText'], '6 November 2026')

    def test_general_and_missing_historical_links_are_explicit_not_guessed(self):
        self.assertEqual(feedback._response_activity(response()), {
            'kind': 'general', 'title': 'General feedback', 'date': None, 'tutorName': '',
        })
        for kind, label in (('post_lecture', 'Lecture'), ('post_progress_review', 'Review'),
                            ('mid_module', 'Module'), ('post_event', 'Event'), ('event_rsvp', 'Event')):
            with self.subTest(kind=kind):
                activity = feedback._response_activity(response(kind))
                self.assertEqual(activity['title'], f'{label} details not recorded')
                self.assertIsNone(activity['date'])
                self.assertEqual(activity['tutorName'], '')

    def test_existing_detail_pdf_payload_is_unchanged_unless_list_context_requested(self):
        row = response('post_epa_review', review_delivery_id=5, review_delivery=SimpleNamespace(
            review_name='Gateway Review', review_type='Gateway Review', completed_at=MOMENT))
        original = feedback._response_dict(row)
        enriched = feedback._response_dict(row, include_activity=True)
        self.assertNotIn('activity', original)
        self.assertEqual(enriched.pop('activity')['title'], 'Gateway Review')
        self.assertIsNone(enriched.pop('assignedAt'))
        self.assertEqual(enriched, original)

    def test_lecture_and_module_assignment_is_scoped_to_the_respondent(self):
        assigned = datetime(2026, 11, 5, 23, 30, tzinfo=timezone.utc)
        for kind in ('post_lecture', 'mid_module', 'end_module'):
            with self.subTest(kind=kind):
                row = response(kind, delivery_id=5, delivery=SimpleNamespace(response_assignment_recipients=[
                    SimpleNamespace(learner_id='OTHER', assigned_at=MOMENT),
                    SimpleNamespace(learner_id='71', assigned_at=assigned),
                ]))
                self.assertEqual(feedback._response_assigned_at(row), assigned)
                row.learner_id = 'MISSING'
                self.assertIsNone(feedback._response_assigned_at(row))

    def test_review_assignment_is_distinct_from_completion_and_response_dates(self):
        assigned = datetime(2026, 11, 6, 10, tzinfo=timezone.utc)
        for kind in ('post_mcm_review', 'post_progress_review', 'post_epa_review', 'post_progress_review_employer'):
            field = 'employer_review_delivery' if kind.endswith('_employer') else 'review_delivery'
            with self.subTest(kind=kind):
                row = response(kind, **{f'{field}_id': 5, field: SimpleNamespace(assigned_at=assigned)})
                self.assertEqual(feedback._response_dict(row, include_activity=True)['assignedAt'], assigned.isoformat())

    def test_general_uses_first_matching_assignment_and_never_another_learner_or_start_time(self):
        row = response()
        earlier = datetime(2026, 11, 5, 10, tzinfo=timezone.utc)
        row.form.response_assignments = [
            SimpleNamespace(target_type='learner', target_id='OTHER', assigned_at=earlier),
            SimpleNamespace(target_type='learner', target_id='71', assigned_at=MOMENT),
            SimpleNamespace(target_type='all_learners', target_id=None, assigned_at=earlier),
        ]
        self.assertEqual(feedback._response_assigned_at(row), earlier)
        row.form.response_assignments = row.form.response_assignments[:1]
        self.assertIsNone(feedback._response_assigned_at(row))

    def test_event_assignment_requires_both_person_and_matching_form_campaign(self):
        earlier = datetime(2026, 11, 5, 10, tzinfo=timezone.utc)
        event = SimpleNamespace(response_assignment_campaigns=[
            SimpleNamespace(form_id=99, created_at=earlier), SimpleNamespace(form_id=31, created_at=MOMENT)])
        row = response('post_event', event_recipient_id=5,
                       event_recipient=SimpleNamespace(created_at=earlier, event=event))
        self.assertEqual(feedback._response_assigned_at(row), MOMENT)
        row.event_recipient.created_at = datetime(2026, 11, 8, 10, tzinfo=timezone.utc)
        self.assertEqual(feedback._response_assigned_at(row), row.event_recipient.created_at)
        event.response_assignment_campaigns = event.response_assignment_campaigns[:1]
        self.assertIsNone(feedback._response_assigned_at(row))
        row = response('event_rsvp', rsvp_recipient_id=6, rsvp_recipient=SimpleNamespace(created_at=earlier))
        self.assertEqual(feedback._response_assigned_at(row), earlier)

    def test_collection_is_staff_only_and_keeps_existing_filters(self):
        factory = RequestFactory()
        request = factory.get('/?formId=31&status=completed&learner=Synthetic')
        for account, status in ((None, 401), (_account(), 403),
                                (_account(role='employer', subject_type='employer'), 403)):
            with self.subTest(role=getattr(account, 'role', None)), _patched(account), \
                    mock.patch.object(feedback.FeedbackResponse.objects, 'select_related') as query:
                self.assertEqual(feedback.responses_collection(request).status_code, status)
                query.assert_not_called()
        for role in ('staff', 'admin'):
            with self.subTest(role=role), _patched(_account(role=role, subject_type='staff')), \
                    mock.patch.object(feedback.FeedbackResponse.objects, 'select_related') as query:
                rows = query.return_value
                rows.prefetch_related.return_value = rows
                rows.order_by.return_value = rows
                rows.filter.return_value = rows
                rows.__iter__.return_value = iter([response()])
                result = feedback.responses_collection(request)
                self.assertEqual(result.status_code, 200)
                self.assertEqual(json.loads(result.content)['responses'][0]['activity']['kind'], 'general')
                self.assertEqual(rows.filter.call_args_list, [
                    mock.call(form_id='31'), mock.call(status='completed'), mock.call(learner_name__icontains='Synthetic'),
                ])
