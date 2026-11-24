"""MCM coach grouping and staff transport tests. ORM is mocked; no database I/O."""
import copy
import json
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from .recipient_coaches import group_mcm_recipients
from . import feedback
from .tests import _account, _patched


def row(learner_id='1', key='review-1', status='not_started', date='2026-11-01T12:00:00Z', **changes):
    return {'key': key, 'learnerId': learner_id, 'learnerName': f'Student {learner_id}',
            'email': f'student{learner_id}@example.test', 'programme': 'Example programme',
            'responseStatus': status, 'sourceStartsAt': date, **changes}


class McmCoachGroupingTests(SimpleTestCase):
    def test_current_owner_moves_all_historical_reviews_without_rewriting_rows(self):
        rows = [row(status='completed'), row(key='review-2', date='2026-11-20T12:00:00Z')]
        original = copy.deepcopy(rows)
        first = group_mcm_recipients(rows, {'1': {'coach_name': 'Previous Coach', 'coach_email': 'old@example.test'}})
        changed = group_mcm_recipients(rows, {'1': {'coach_name': 'Current Coach', 'coach_email': ' CURRENT@example.test '}}, coach_key='email:current@example.test')
        self.assertEqual(first['coaches'][0]['name'], 'Previous Coach')
        self.assertEqual([coach['key'] for coach in changed['coaches']], ['email:current@example.test'])
        self.assertEqual((changed['totalLearners'], changed['totalReviews'], changed['totalCompleted']), (1, 2, 1))
        self.assertEqual([item['key'] for item in changed['learners'][0]['reviews']], ['review-2', 'review-1'])
        self.assertEqual(rows, original)

    def test_same_named_coaches_and_learners_are_distinct_and_email_is_normalized(self):
        owners = {'1': {'coach_name': 'Alex', 'coach_email': 'A@example.test'},
                  '2': {'coach_name': 'Alex', 'coach_email': 'b@example.test'},
                  '3': {'coach_name': 'Alex', 'coach_email': ' a@example.test '}}
        report = group_mcm_recipients([row(str(i), key=str(i), learnerName='Same name') for i in range(1, 4)], owners, coach_key='email:a@example.test')
        self.assertEqual(len(report['coaches']), 2)
        self.assertEqual(report['totalLearners'], 3)
        self.assertEqual([item['learnerId'] for item in report['learners']], ['1', '3'])

    def test_missing_and_unlinked_coaches_remain_visible(self):
        report = group_mcm_recipients([row('1'), row('2'), row('3')], {'2': {'coach_name': 'Name only'}})
        self.assertEqual({item['key']: item['learnerCount'] for item in report['coaches']}, {'unassigned': 2, 'unlinked': 1})

    def test_search_selects_learners_and_retains_their_whole_review_history(self):
        rows = [row(), row(key='second', status='completed'), row('2', key='third')]
        owners = {'1': {'coach_name': 'Example Coach', 'coach_email': 'coach@example.test'}}
        for query in ('Student 1', 'COACH@EXAMPLE.TEST', 'Example Coach'):
            report = group_mcm_recipients(rows, owners, search=query, coach_key='email:coach@example.test')
            self.assertEqual((report['totalLearners'], report['totalReviews']), (1, 2))
            self.assertEqual(len(report['learners'][0]['reviews']), 2)
        self.assertEqual(group_mcm_recipients(rows, owners, search='no match')['coaches'], [])

    def test_pagination_counts_students_and_never_splits_their_reviews(self):
        rows = [row(str(i), key=f'{i}-{j}') for i in range(1, 28) for j in range(2)]
        owners = {str(i): {'coach_email': 'coach@example.test'} for i in range(1, 28)}
        first = group_mcm_recipients(rows, owners, coach_key='email:coach@example.test')
        last = group_mcm_recipients(rows, owners, coach_key='email:coach@example.test', page=100)
        self.assertEqual((first['totalLearners'], first['totalReviews'], first['pages']), (27, 54, 2))
        self.assertEqual((len(first['learners']), len(last['learners']), last['page']), (25, 2, 2))
        self.assertTrue(all(len(learner['reviews']) == 2 for learner in first['learners'] + last['learners']))
        self.assertFalse({x['learnerId'] for x in first['learners']} & {x['learnerId'] for x in last['learners']})
        self.assertEqual(group_mcm_recipients(rows, owners, coach_key='email:other@example.test')['learners'], [])

    def test_staff_request_reads_only_current_owners_of_assigned_learners(self):
        owner_query = mock.MagicMock()
        owner_query.values.return_value = [{'id': 1, 'coach_name': 'Current Coach', 'coach_email': 'coach@example.test'}]
        with (_patched(_account(role='staff')),
              mock.patch.object(feedback.FeedbackForm.objects, 'get', return_value=SimpleNamespace(form_type='post_mcm_review')),
              mock.patch.object(feedback, '_form_recipient_rows', return_value=[row()]),
              mock.patch.object(feedback.EnrolmentUser.all_learners, 'filter', return_value=owner_query) as lookup):
            response = feedback.form_recipients(RequestFactory().get('/?groupBy=coach&coach=email%3Acoach%40example.test'), pk=7)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['learners'][0]['learnerId'], '1')
        lookup.assert_called_once_with(id__in={'1'})
        owner_query.values.assert_called_once_with('id', 'coach_name', 'coach_email')

    def test_other_forms_and_invalid_pagination_do_not_run_grouping(self):
        for kind, query in [('post_lecture', '?groupBy=coach'), ('post_mcm_review', '?groupBy=coach&page=no')]:
            with (_patched(_account(role='staff')),
                  mock.patch.object(feedback.FeedbackForm.objects, 'get', return_value=SimpleNamespace(form_type=kind)),
                  mock.patch.object(feedback, '_form_recipient_rows') as rows):
                self.assertEqual(feedback.form_recipients(RequestFactory().get('/' + query), pk=7).status_code, 400)
                rows.assert_not_called()

    def test_learner_is_forbidden_before_any_coach_data_is_read(self):
        with (_patched(_account(role='learner')), mock.patch.object(feedback, '_form_recipient_rows') as rows):
            self.assertEqual(feedback.form_recipients(RequestFactory().get('/?groupBy=coach'), pk=7).status_code, 403)
            rows.assert_not_called()
