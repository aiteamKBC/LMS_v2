import json
from contextlib import nullcontext
from copy import deepcopy
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from learner_api.reflection_ksbs import (
    KsbReviewError, checked_codes, corrected_fields, request_review, review_summary,
)

CATALOGUE = {'programme': 'Programme Six', 'sourceId': 'standard:six',
             'items': [{'code': 'K1', 'description': 'Six knowledge'}, {'code': 'B7', 'description': 'Six behaviour'}]}


def submission():
    return dict(learner_kind='commercial', learner_id='101', status='accepted',
                ksb_codes=['K1', 'B4.1'], ksb_weights={'K1': 10, 'B4.1': 20},
                ksb_explanations={'K1': 'Learner words', 'B4.1': 'Original learner explanation'},
                confidence_before={'K1': 2, 'B4.1': 3}, confidence_after={'K1': 4, 'B4.1': 5},
                coach_feedback='Accepted feedback', reviewed_by='Original coach', reviewed_at='2026-10-14',
                submitted_at='2026-10-13', actual_time_hours='1',
                full_submission={'learningReflection': 'Unchanged learner work', 'signedDeclaration': True,
                                 'actualTimeHours': '1', 'evidenceFiles': ['private-reference']})


def pending():
    row = submission()
    row['full_submission'] = request_review(row, CATALOGUE, actor='Authorised reviewer',
        requested_at='2026-11-01', revision='revision-1')
    return row


def payload(**changes):
    return {'revision': 'revision-1', 'sourceId': 'standard:six', 'ksbCodes': ['K1', 'B7'],
            'reason': 'The evidence meets the programme criteria.', **changes}


class KsbCorrectionTests(SimpleTestCase):
    def test_request_keeps_original_approval_hours_and_work(self):
        row = submission(); before = deepcopy(row)
        document = request_review(row, CATALOGUE, actor='Reviewer', requested_at='2026-11-01', revision='r1')
        self.assertEqual(row, before)
        self.assertEqual({key: document[key] for key in row['full_submission']}, row['full_submission'])
        self.assertEqual(document['ksbReview']['original']['status'], 'accepted')
        self.assertEqual(document['ksbReview']['original']['ksbExplanations'], row['ksb_explanations'])

    def test_foreign_codes_are_not_truncated_into_unrelated_programme_codes(self):
        for code in ('B4.1', 'K1.1', 'K99'):
            with self.subTest(code=code), self.assertRaises(KsbReviewError):
                checked_codes([code], CATALOGUE)
        self.assertEqual(checked_codes(['k1', 'K1', ' B7 '], CATALOGUE), ['K1', 'B7'])

    def test_only_ksb_fields_change_and_original_evidence_stays_in_audit(self):
        row = pending(); before = deepcopy(row)
        fields = corrected_fields(row, payload(), CATALOGUE, actor='Coach', reviewed_at='2026-11-02')
        self.assertEqual(row, before)
        self.assertEqual(set(fields), {'ksb_codes', 'ksb_weights', 'ksb_explanations', 'confidence_before', 'confidence_after', 'full_submission'})
        self.assertEqual(fields['ksb_codes'], ['K1', 'B7'])
        self.assertEqual(fields['ksb_explanations'], {'K1': 'Learner words'})
        self.assertNotIn('B7', fields['confidence_before'])
        self.assertEqual(fields['full_submission']['actualTimeHours'], '1')
        self.assertEqual(fields['full_submission']['ksbReview']['original'], before['full_submission']['ksbReview']['original'])
        self.assertEqual(review_summary(fields['full_submission'])['status'], 'completed')

    def test_stale_or_invalid_corrections_and_repeat_saves_are_rejected(self):
        for change in (dict(revision='old'), dict(sourceId='standard:other'), dict(ksbCodes=['B4.1']),
                       dict(ksbCodes=[]), dict(ksbCodes='K1'), dict(reason='')):
            with self.subTest(change=change), self.assertRaises(KsbReviewError):
                corrected_fields(pending(), payload(**change), CATALOGUE, actor='Coach', reviewed_at='now')
        row = pending(); row['full_submission']['ksbReview']['status'] = 'completed'
        with self.assertRaises(KsbReviewError):
            corrected_fields(row, payload(), CATALOGUE, actor='Coach', reviewed_at='now')

    def test_flag_cannot_be_added_again_or_to_an_unaccepted_submission(self):
        for row in (pending(), {**submission(), 'status': 'draft'}, {**submission(), 'ksb_codes': ['K1']}):
            with self.subTest(status=row['status']), self.assertRaises(KsbReviewError):
                request_review(row, CATALOGUE, actor='Reviewer', requested_at='now', revision='r2')

    @patch('learner_api.reflection_ksbs.programme_catalogue', return_value=CATALOGUE)
    @patch('learner_api.reflection_submissions._reflection_lineage', return_value={})
    @patch('learner_api.programme_access.submission_refusal', return_value=None)
    def test_new_foreign_programme_claim_is_rejected_before_any_write(self, _gate, _lineage, catalogue):
        from learner_api import reflection_submissions as view
        cursor = MagicMock(); cursor.fetchone.return_value = None
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        request = RequestFactory().post('/reflection', data=json.dumps(dict(learnerKind='commercial',
            learnerId='101', activityType='video', activityId='component', learningReflection='Learner text',
            ksbCodes=['B4.1'])), content_type='application/json')
        with patch.object(view, 'connections', {'enrolment': connection}), patch.object(view.transaction, 'atomic', return_value=nullcontext()):
            response = unwrap(view._submit_reflection)(request)
        self.assertEqual(response.status_code, 400)
        catalogue.assert_called_once_with('commercial', '101')
        self.assertTrue(all(call.args[0].lstrip().lower().startswith('select') for call in cursor.execute.call_args_list))


class CoachKsbReviewEndpointTests(SimpleTestCase):
    def test_pending_queue_projection_keeps_the_stored_acceptance(self):
        from coach_api.views import MARKING_QUEUE_COLUMNS, serialize_marking_submission
        row = {key.strip(): None for key in MARKING_QUEUE_COLUMNS.split(',')}
        row.update(pending(), id='synthetic-submission', learner_name='Synthetic learner',
                   activity_type='video', submitted_at=None, reviewed_at=timezone.now())
        item = serialize_marking_submission(row)
        self.assertEqual(item['status'], 'ksb_review')
        self.assertFalse(item['isOverdue'])
        self.assertEqual(item['ksbReview']['originalCodes'], ['K1', 'B4.1'])
        self.assertEqual(row['status'], 'accepted')

    def test_learners_and_employers_cannot_reach_the_coach_correction(self):
        from coach_api.views import coach_marking_queue
        for role in ('learner', 'employer'):
            request = RequestFactory().patch('/coach_api/coach/marking-queue/synthetic',
                data=json.dumps({'action': 'review_ksbs', **payload()}), content_type='application/json')
            with self.subTest(role=role), \
                 patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role=role)), \
                 patch('login.permissions._accesses_of', return_value=set()), \
                 patch('coach_api.ksb_review.save_review') as save:
                response = coach_marking_queue(request, 'synthetic')
                self.assertEqual(response.status_code, 403)
                save.assert_not_called()

    def run_save(self, *, owned=True, view_as=False):
        from coach_api import ksb_review
        row = pending()
        cursor = MagicMock(); cursor.description = [(key,) for key in row]
        cursor.fetchone.return_value = tuple(row.values()) if owned else None
        connection = MagicMock(); connection.cursor.return_value.__enter__.return_value = cursor
        request = SimpleNamespace(coach_email='coach@example.invalid', coach_view_as=view_as,
            login_account=SimpleNamespace(email='coach@example.invalid'),
            coach_view_as_admin=SimpleNamespace(username='Synthetic administrator'))
        with patch.object(ksb_review, 'connections', {'enrolment': connection}), \
             patch.object(ksb_review.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(ksb_review, 'programme_catalogue', return_value=CATALOGUE):
            response = ksb_review.save_review(request, 'submission', ['101'], payload(learnerId='999'))
        return response, cursor

    def test_correction_is_owned_and_does_not_update_acceptance_or_hours(self):
        response, cursor = self.run_save()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(cursor.execute.call_args_list[0].args[1], ['submission', ['101']])
        sql, parameters = cursor.execute.call_args.args
        self.assertNotIn('status=', sql)
        self.assertNotIn('actual_time_hours=', sql)
        self.assertEqual(parameters[-2:], ['submission', ['101']])
        self.assertEqual(json.loads(response.content)['status'], 'accepted')

    def test_another_coachs_submission_cannot_be_changed(self):
        response, cursor = self.run_save(owned=False)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(cursor.execute.call_count, 1)

    def test_admin_view_as_attributes_the_real_actor(self):
        response, _cursor = self.run_save(view_as=True)
        self.assertEqual(json.loads(response.content)['ksbReview']['reviewedBy'],
                         'Synthetic administrator (for coach@example.invalid)')
