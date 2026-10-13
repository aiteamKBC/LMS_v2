"""Database/network-free review transport and ownership regression tests."""
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from .case_file_reviews import compact_row, project_reviews, CALENDAR_FIELDS


def event(key='review:1', **changes):
    return {'id': key, 'eventKey': key, 'type': 'review', 'source': 'progress-review',
            'reviewTypeName': 'Progress Review', 'learnerId': '101',
            'targetDate': '2026-09-12', 'date': '2026-10-12', 'scheduledDate': '2026-10-12',
            'scheduledTime': '09:30:00', 'status': 'scheduled', 'ownerName': 'Coach', **changes}


class CompactReviewsTests(SimpleTestCase):
    def test_exact_contract_without_aliases_or_detail(self):
        row = compact_row(event(reviewResponses={'private': True}, notes='private', reviewInstanceId='I1'))
        self.assertEqual(set(row), {'id', 'type', 'title', 'plannedDate', 'scheduledDate', 'scheduledTime',
                                   'completedDate', 'status', 'reviewer'})
        self.assertEqual(row['plannedDate'], '2026-09-12')
        self.assertEqual(row['scheduledDate'], '2026-10-12')
        self.assertEqual(row['scheduledTime'], '09:30')
        self.assertIsNone(row['completedDate'])
        for field in ('canView', 'canViewForm', 'hasReviewForm', 'reviewInstanceId', 'reviewTemplateId'):
            self.assertNotIn(field, row)
        self.assertEqual(set(project_reviews([])), {'summary', 'reviews'})

    def test_summary_uses_old_filters_and_excludes_cancelled_history(self):
        payload = project_reviews([event(status='completed'), event('2', source='mcr', reviewTypeName='Monthly Coaching Meeting'),
            event('3', source='review', reviewTypeName='Career Review', reviewTypeCode='career'),
            event('4', status='cancelled')])
        self.assertEqual(payload['summary'], {'total': 3, 'progressReviews': 1, 'monthlyCoachingMeetings': 1,
                                             'completed': 1, 'upcoming': 2})

    def test_completed_date_precedence_and_unscheduled_nulls(self):
        self.assertEqual(compact_row(event(status='completed', reviewCompletedAt='2026-10-15T09:30:00Z'))['completedDate'], '2026-10-15')
        self.assertEqual(compact_row(event(status='completed'))['completedDate'], '2026-10-12')
        row = compact_row(event(scheduledDate=None, scheduledTime=None, status='not-scheduled'))
        self.assertIsNone(row['scheduledDate'])
        self.assertIsNone(row['scheduledTime'])
        self.assertIsNone(row['completedDate'])
        self.assertEqual(row['plannedDate'], '2026-09-12')

    def test_type_metadata_precedence_title_never_classifies(self):
        self.assertEqual(compact_row(event(reviewTypeCode='mcm'))['type'], 'progress-review')
        self.assertEqual(compact_row(event(source='review', reviewTypeName='Career Review', reviewTypeCode='career', title='Progress Review'))['type'], 'review')
        self.assertEqual(compact_row(event(source='mcr', reviewTypeName=None))['type'], 'mcr')

    def test_status_is_not_collapsed_to_summary_buckets(self):
        for status in ('not-scheduled', 'scheduled', 'in-progress', 'awaiting-signature', 'completed', 'confirmed', 'pending', 'failed'):
            with self.subTest(status=status):
                self.assertEqual(compact_row(event(status=status))['status'], status)

    def test_occurrence_order_kept_without_returning_occurrence_fields(self):
        rows = project_reviews([event('later', occurrenceNumber=2), event('earlier', occurrenceNumber=1)])['reviews']
        self.assertEqual([row['id'] for row in rows], ['earlier', 'later'])
        self.assertNotIn('occurrenceNumber', rows[0])

    def test_rendered_warnings_are_conditional_code_only(self):
        self.assertNotIn('reviewGenerationIssues', project_reviews([]))
        self.assertEqual(project_reviews([], [{'learnerId': '101', 'code': 'missing_learner_start_date'}])['reviewGenerationIssues'], [{'code': 'missing_learner_start_date'}])

    def test_calendar_projection_excludes_heavy_fields(self):
        for name in ('review_responses', 'notes', 'meeting_provider', 'manager_signed_by', 'last_graph_sync_error'):
            self.assertNotIn(name, CALENDAR_FIELDS)

class ReviewListReaderTests(SimpleTestCase):
    def test_standalone_rows_match_old_visible_semantics_without_per_row_template_or_form_reads(self):
        from datetime import date, time, datetime, timezone
        from . import views
        from .case_file_reviews import review_events
        from .models import CoachCalendarEvent
        profile = SimpleNamespace(id=101, enrolment_id=201, username='Synthetic learner', email='learner@example.test', programme='Programme', cohort='Cohort', learner_type='apprenticeship')
        context = SimpleNamespace(profile=profile, coach='coach@example.test')
        records = [CoachCalendarEvent(id=index, event_key=f'review:{index}', owner_email=context.coach, learner_id=101,
                    event_type='review', sequence=index, target_date=date(2026, 9, 1), scheduled_date=date(2026, 10, 1),
                    scheduled_time=time(9, 30), status='completed', review_template_id='T1', review_instance_id=f'I{index}',
                    review_completed_at=datetime(2026, 10, 2, tzinfo=timezone.utc)) for index in (1, 2)]
        metadata = {'reviewTypeCode': 'career', 'reviewTypeName': 'Career Review'}
        with patch('coach_api.views._case_file_owner_name', return_value='Coach'), patch('coach_api.views.resolve_coach_review_events', return_value={'events': [], 'reviewGenerationIssues': [], 'aptemProfileIds': set()}), patch('coach_api.case_file_reviews.CoachCalendarEvent.objects.filter') as query, patch('coach_api.views.review_type_fields_by_template', return_value={'T1': metadata}) as types, patch('coach_api.views.resolve_review_display_title', return_value='Career Review') as titles, patch('coach_api.views.curriculum_review_instances.review_instance_form_definition') as forms:
            query.return_value.values.return_value = [{name: getattr(record, name) for name in CALENDAR_FIELDS} for record in records]
            actual, issues = review_events(context)
            types.assert_called_once()
            self.assertEqual(list(types.call_args.args[0]), ['T1', 'T1'])
            titles.assert_not_called()
            forms.assert_not_called()
            query.return_value.values.assert_called_once_with(*CALENDAR_FIELDS)
            old = [views.build_catchup_calendar_event(record, owner_name='Coach', learner=profile, review_type_fields={'T1': metadata}) for record in records]
        self.assertEqual(project_reviews(actual), project_reviews(old))
        self.assertEqual(issues, [])
        # Preserve the old standalone fallback date, rather than silently
        # replacing it with a previously unrendered stored completion timestamp.
        self.assertEqual(compact_row(actual[0])['completedDate'], '2026-10-01')
