"""Daily assignment report tests; dummy database runner and mocked ORM only."""
import copy
import json
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from . import feedback
from .recipient_daily import assignment_range, daily_mcm_recipients
from .tests import _account, _patched


def row(key='r1', learner='1', assigned='2026-11-25T09:00:00Z', **values):
    return {'key': key, 'learnerId': learner, 'learnerName': f'Student {learner}',
            'email': f'student{learner}@example.test', 'programme': 'Example programme',
            'sourceTitle': 'Monthly review', 'sourceStartsAt': '2026-10-01T12:00:00Z',
            'assignedAt': assigned, 'formVersion': 1, 'responseStatus': 'not_started', **values}


class McmDailyTests(SimpleTestCase):
    def report(self, rows, owners=None, **params):
        return daily_mcm_recipients(rows, owners or {}, **{
            'start': date(2026, 11, 1), 'end': date(2026, 11, 25), **params,
        })

    def test_counts_unique_learners_separately_from_assignments_across_versions_and_days(self):
        rows = [row(), row('r2', formVersion=2), row('r3', '2'),
                row('r4', assigned='2026-11-24T15:00:00Z')]
        original = copy.deepcopy(rows)
        report = self.report(rows, day='2026-11-25')
        self.assertEqual(report['days'], [
            {'date': '2026-11-25', 'learnerCount': 2, 'assignmentCount': 3},
            {'date': '2026-11-24', 'learnerCount': 1, 'assignmentCount': 1},
        ])
        self.assertEqual((report['totalLearners'], report['totalAssignments']), (2, 4))
        self.assertEqual({item['formVersion'] for item in report['assignments']}, {1, 2})
        self.assertEqual(rows, original)

    def test_uk_dates_use_assignment_instant_in_summer_and_at_dst_end(self):
        summer = self.report([row(assigned='2026-07-01T23:30:00Z')],
                             start=date(2026, 7, 2), end=date(2026, 7, 2))
        self.assertEqual(summer['days'][0]['date'], '2026-07-02')
        clocks = self.report([row('r1', assigned='2026-10-25T00:30:00Z'),
                              row('r2', assigned='2026-10-25T01:30:00Z')],
                             start=date(2026, 10, 25), end=date(2026, 10, 25), day='2026-10-25')
        self.assertEqual(clocks['days'][0]['assignmentCount'], 2)
        self.assertEqual([item['key'] for item in clocks['assignments']], ['r2', 'r1'])

    def test_presets_use_uk_today_and_custom_range_is_inclusive(self):
        now = datetime(2026, 7, 1, 23, 30, tzinfo=timezone.utc)
        self.assertEqual(assignment_range({'period': 'today'}, now=now), (date(2026, 7, 2), date(2026, 7, 2)))
        self.assertEqual(assignment_range({'period': 'yesterday'}, now=now), (date(2026, 7, 1), date(2026, 7, 1)))
        self.assertEqual(assignment_range({}, now=now), (date(2026, 6, 26), date(2026, 7, 2)))
        start, end = assignment_range({'period': 'custom', 'from': '2026-11-24', 'to': '2026-11-25'})
        result = self.report([row('r1', assigned='2026-11-23T23:59:59Z'),
                              row('r2', assigned='2026-11-24T00:00:00Z'),
                              row('r3', assigned='2026-11-25T23:59:59Z'),
                              row('r4', assigned='2026-11-26T00:00:00Z')], start=start, end=end)
        self.assertEqual(result['totalAssignments'], 2)

    def test_missing_dates_are_reported_without_using_review_completion_as_fallback(self):
        result = self.report([row(assigned=None), row('r2', assigned='invalid'), row('r3', assigned='2026-11-25T12:00:00')])
        self.assertEqual((result['undatedCount'], result['days'], result['assignments']), (3, [], []))

    def test_coach_and_search_filter_before_counting_and_keep_same_named_people_separate(self):
        owners = {'1': {'coach_name': 'Same Coach', 'coach_email': ' A@example.test '},
                  '2': {'coach_name': 'Same Coach', 'coach_email': 'b@example.test'},
                  '3': {'coach_name': 'Name only'}}
        rows = [row('r1', '1'), row('r2', '2'), row('r3', '3'), row('r4', '4')]
        selected = self.report(rows, owners, coach_key='email:a@example.test', search='STUDENT1@', day='2026-11-25')
        self.assertEqual((selected['totalLearners'], selected['totalAssignments']), (1, 1))
        self.assertEqual(selected['assignments'][0]['coachEmail'], 'a@example.test')
        self.assertEqual(len(selected['coaches']), 4)
        self.assertEqual(self.report(rows, owners, coach_key='unassigned')['totalLearners'], 1)
        self.assertEqual(self.report(rows, owners, coach_key='unlinked')['totalLearners'], 1)
        self.assertEqual(self.report(rows, owners, search='not found')['days'], [])

    def test_details_and_days_paginate_without_reducing_report_totals(self):
        rows = [row(str(i), str(i)) for i in range(30)]
        rows += [row(f'other-{i}', assigned=f'2026-11-{i:02}T09:00:00Z') for i in range(1, 25)]
        report = self.report(rows, day='2026-11-25', page=2)
        self.assertEqual((report['totalDays'], report['dayPages'], len(report['days'])), (25, 2, 14))
        self.assertEqual((report['totalAssignments'], report['selectedTotal'], len(report['assignments']), report['pages']), (54, 30, 5, 2))
        older = self.report(rows, day_page=2, day='2026-11-25')
        self.assertEqual(len(older['days']), 11)
        self.assertEqual(older['assignments'], [])
        self.assertEqual(older['totalAssignments'], report['totalAssignments'])

    def test_staff_endpoint_reuses_form_scoped_rows_and_current_coach_ownership(self):
        form = SimpleNamespace(form_type='post_mcm_review')
        owners = mock.MagicMock()
        owners.values.return_value = [{'id': 1, 'coach_name': 'Coach', 'coach_email': 'coach@example.test'}]
        with (_patched(_account(role='staff')),
              mock.patch.object(feedback.FeedbackForm.objects, 'get', return_value=form) as get_form,
              mock.patch.object(feedback, '_form_recipient_rows', return_value=[row()]) as rows,
              mock.patch.object(feedback.EnrolmentUser.all_learners, 'filter', return_value=owners) as lookup):
            response = feedback.form_recipients(RequestFactory().get('/?groupBy=day&period=custom&from=2026-11-25&to=2026-11-25&day=2026-11-25'), pk=7)
        self.assertEqual(response.status_code, 200)
        get_form.assert_called_once_with(pk=7)
        rows.assert_called_once_with(form)
        lookup.assert_called_once_with(id__in={'1'})
        self.assertEqual(json.loads(response.content)['assignments'][0]['coachName'], 'Coach')

    def test_invalid_filters_and_non_mcm_forms_are_rejected_before_reading_recipients(self):
        queries = ['period=invalid', 'period=custom', 'period=custom&from=2026-11-26&to=2026-11-25',
                   'period=custom&from=2026-02-30&to=2026-03-01', 'day=bad', 'page=bad', 'dayPage=bad']
        for kind, query in [('post_mcm_review', query) for query in queries] + [('post_progress_review', '')]:
            with (self.subTest(kind=kind, query=query), _patched(_account(role='staff')),
                  mock.patch.object(feedback.FeedbackForm.objects, 'get', return_value=SimpleNamespace(form_type=kind)),
                  mock.patch.object(feedback, '_form_recipient_rows') as rows):
                response = feedback.form_recipients(RequestFactory().get('/?groupBy=day&' + query), pk=7)
                self.assertEqual(response.status_code, 400)
                rows.assert_not_called()

    def test_learner_cannot_read_daily_report_and_report_rejects_writes(self):
        with (_patched(_account(role='learner')),
              mock.patch.object(feedback.FeedbackForm.objects, 'get') as forms):
            self.assertEqual(feedback.form_recipients(RequestFactory().get('/?groupBy=day'), pk=7).status_code, 403)
            forms.assert_not_called()
        with (_patched(_account(role='staff')),
              mock.patch.object(feedback.FeedbackForm.objects, 'get') as forms):
            self.assertEqual(feedback.form_recipients(RequestFactory().post('/?groupBy=day'), pk=7).status_code, 405)
            forms.assert_not_called()
