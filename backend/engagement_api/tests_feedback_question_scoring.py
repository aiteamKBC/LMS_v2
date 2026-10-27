"""Synthetic scoring/coverage contracts; no database, mail, or scheduling writes."""
from copy import deepcopy
from datetime import datetime, timezone
from pathlib import Path
import json
from types import SimpleNamespace as Row
from unittest import mock

from django.test import RequestFactory, SimpleTestCase
from django.db.models.query import ModelIterable

from . import feedback, feedback_analytics as reporting
from .feedback_scoring import (
    answer_score, has_answer, overall_metrics, question_metrics, response_key,
    validate_analytics_settings,
    score_classification,
)
from .feedback_classification import response_classifications
from .feedback_insights import answer_in_period, report_insights, submission_period


def question(identifier=1, kind='rating', config=None, version=1, form_id=4):
    return Row(id=identifier, question_type=kind, question_text='Question?',
               config={} if config is None else config,
               section=Row(form_id=form_id, form=Row(title='Feedback', version=version),
                           title='Teaching', questions_per_delivery=1), submitted_answers=[])


def answer(value, learner='1', delivery=30, form_id=4, status='completed', **extra):
    return Row(answer=value, response=Row(learner_id=learner, delivery_id=delivery,
               form_id=form_id, status=status, **extra))


def queryset(rows=()):
    query = mock.MagicMock()
    query._iterable_class = ModelIterable
    query.filter.return_value = query
    query.exclude.return_value = query
    query.select_related.return_value = query
    query.prefetch_related.return_value = query
    query.distinct.return_value = query
    query.values.return_value = rows
    query.values_list.return_value = rows
    query.__iter__.return_value = iter(rows)
    return query


class QuestionScoreTests(SimpleTestCase):
    def test_shared_staff_preview_cases_match_authoritative_backend_scores(self):
        fixture = Path(__file__).resolve().parents[2] / 'frontend/src/features/feedback/__fixtures__/scorePreview.json'
        for example in json.loads(fixture.read_text(encoding='utf-8')):
            with self.subTest(example=example['name']):
                actual = answer_score(example['type'], example['config'], example['value'])
                if example['expected'] is None:
                    self.assertIsNone(actual)
                else:
                    self.assertAlmostEqual(actual, example['expected'], places=10)
                if 'expectedClassification' in example:
                    self.assertEqual(score_classification(actual), example['expectedClassification'])

    def test_stars_map_endpoints_and_intermediate_values_to_percentages(self):
        self.assertEqual([answer_score('rating', {}, value) for value in range(1, 6)], [0, 25, 50, 75, 100])
        self.assertAlmostEqual(answer_score('rating', {}, 4.3), 82.5)
        self.assertEqual(answer_score('rating', {'min': 1, 'max': 10}, 10), 100)

    def test_reverse_scale_and_unscored_settings(self):
        config = {'analytics': {'scoring': 'lower'}}
        self.assertEqual(answer_score('rating', config, 1), 100)
        self.assertEqual(answer_score('rating', config, 5), 0)
        self.assertIsNone(answer_score('rating', {'analytics': {'scoring': 'none'}}, 5))

    def test_invalid_values_do_not_fabricate_zero_scores(self):
        for value in [None, '', False, True, float('nan'), float('inf'), 0, 6, '5']:
            with self.subTest(value=value):
                self.assertIsNone(answer_score('rating', {}, value))

    def test_yes_no_needs_explicit_scoring_and_can_reverse_the_positive_answer(self):
        self.assertIsNone(answer_score('yes_no', {}, True))
        config = {'analytics': {'scoring': 'options', 'optionScores': {'yes': 0, 'no': 100}}}
        self.assertEqual(answer_score('yes_no', config, True), 0)
        self.assertEqual(answer_score('yes_no', config, False), 100)

    def test_single_choice_scores_are_not_inferred_from_option_order(self):
        self.assertIsNone(answer_score('single_choice', {'options': ['Good', 'Poor']}, 'Good'))
        config = {'options': ['Good', 'Poor'], 'analytics': {'scoring': 'options', 'optionScores': {'Good': 75, 'Poor': 0}}}
        self.assertEqual(answer_score('single_choice', config, 'Poor'), 0)
        self.assertEqual(answer_score('single_choice', config, 'Good'), 75)
        self.assertIsNone(answer_score('single_choice', config, 'Unknown'))

    def test_text_and_multi_select_are_not_scored(self):
        for kind, value in [('long_text', 'Great'), ('multiple_choice', ['Good']), ('number', 8), ('photo_upload', {'uploadId': 'x'})]:
            self.assertIsNone(answer_score(kind, {}, value))

    def test_zero_and_false_count_as_answers_but_empty_values_do_not(self):
        self.assertTrue(has_answer(False))
        self.assertTrue(has_answer(0))
        for value in [None, '', '  ', [], {}, {'firstName': '', 'lastName': ''}]:
            self.assertFalse(has_answer(value))

    def test_importance_does_not_change_an_individual_score(self):
        for importance in ['critical', 'high', 'medium', 'low']:
            self.assertEqual(answer_score('rating', {'analytics': {'importance': importance}}, 4), 75)

    def test_configuration_validation_preserves_legacy_and_unrelated_config(self):
        config = {'min': 1, 'max': 5, 'labels': ['A', 'B', 'C', 'D', 'E'],
                  'analytics': {'importance': 'high', 'scoring': 'lower'}}
        original = deepcopy(config)
        validate_analytics_settings('rating', config)
        self.assertEqual(config, original)
        validate_analytics_settings('rating', {'legacy': 'untouched'})

    def test_rejects_invalid_or_ambiguous_configuration(self):
        cases = [
            ('rating', {'analytics': 'bad'}),
            ('rating', {'analytics': {'importance': 'urgent'}}),
            ('rating', {'analytics': {'importance': []}}),
            ('rating', {'analytics': {'scoring': []}}),
            ('rating', {'analytics': {'scoring': 'options'}}),
            ('rating', {'analytics': {'includeInOverall': 'yes'}}),
            ('multiple_choice', {'options': ['A', 'B'], 'analytics': {'scoring': 'options', 'optionScores': {'A': 100}}}),
            ('yes_no', {'analytics': {'scoring': 'options', 'optionScores': {'yes': 100}}}),
            ('yes_no', {'analytics': {'optionScores': {'yes': True}}}),
            ('yes_no', {'analytics': {'optionScores': {'yes': float('nan')}}}),
            ('single_choice', {'options': ['A', 'B'], 'analytics': {'scoring': 'options', 'optionScores': {'A': 101, 'B': 0}}}),
            ('single_choice', {'options': ['A', 'A'], 'analytics': {'scoring': 'options', 'optionScores': {'A': 50}}}),
        ]
        for kind, config in cases:
            with self.subTest(kind=kind, config=config), self.assertRaises(ValueError):
                validate_analytics_settings(kind, config)

    def test_form_validation_round_trips_new_settings_without_changing_bank_quota(self):
        raw = [{'title': 'Teaching', 'questionsPerDelivery': 1, 'questions': [
            {'type': 'rating', 'text': 'Clarity?', 'config': {'analytics': {'importance': 'critical', 'scoring': 'lower'}}},
            {'type': 'yes_no', 'text': 'Supported?', 'config': {'analytics': {'scoring': 'options', 'optionScores': {'yes': 100, 'no': 0}}}},
        ]}]
        cleaned = feedback._validated_sections(raw, form_type='post_lecture')
        self.assertEqual(cleaned[0]['questionsPerDelivery'], 1)
        self.assertEqual(cleaned[0]['questions'][0]['config']['analytics'], raw[0]['questions'][0]['config']['analytics'])


class QuestionMetricTests(SimpleTestCase):
    def test_score_and_answer_rate_have_different_denominators(self):
        q = question(kind='yes_no', config={'analytics': {'scoring': 'options', 'optionScores': {'yes': 100, 'no': 0}}})
        answers = [answer(index < 24, str(index)) for index in range(30)]
        opportunities = {('delivery', 30, str(index)) for index in range(40)}
        row = question_metrics(q, opportunities, answers=answers)
        self.assertEqual((row['answeredCount'], row['assignedCount'], row['answerRate'], row['score']), (30, 40, 75, 80))
        self.assertEqual(row['distribution'], [{'label': 'Yes', 'count': 24}, {'label': 'No', 'count': 6}])

    def test_draft_answers_are_excluded_and_optional_empty_answers_are_not_zero(self):
        row = question_metrics(question(), {('delivery', 30, '1'), ('delivery', 30, '2')},
                               answers=[answer(5, status='in_progress'), answer('', learner='2')])
        self.assertEqual(row['answerRate'], 0)
        self.assertIsNone(row['score'])
        self.assertEqual(row['status'], 'no_data')

    def test_historical_submissions_are_counted_once_after_recipient_revocation(self):
        row = question_metrics(question(), set(), answers=[answer(5), answer(5)])
        self.assertEqual((row['answeredCount'], row['assignedCount'], row['answerRate']), (1, 1, 100))

    def test_multiple_lectures_count_as_distinct_answer_opportunities(self):
        row = question_metrics(question(), set(), answers=[answer(5, delivery=30), answer(1, delivery=31)])
        self.assertEqual((row['answeredCount'], row['score']), (2, 50))

    def test_zero_score_is_real_data_and_status_boundaries_use_unrounded_scores(self):
        for value, expected in [(1, 'needs_attention'), (3, 'watch'), (4, 'good'), (3.9999, 'watch'), (2.9999, 'needs_attention')]:
            with self.subTest(value=value):
                row = question_metrics(question(), set(), answers=[answer(value)])
                self.assertEqual(row['status'], expected)
                self.assertIsNotNone(row['score'])

    def test_qualitative_multi_select_and_unknown_denominators(self):
        row = question_metrics(question(kind='long_text'), set(), answers=[answer('Helpful')], denominator_known=False)
        self.assertEqual(row['status'], 'not_scored')
        self.assertIsNone(row['score'])
        self.assertIsNone(row['answerRate'])
        self.assertIsNone(row['assignedCount'])
        multi = question_metrics(question(kind='multiple_choice'), set(), answers=[answer(['Slides', 'Workbook', 'Slides'])])
        self.assertEqual(multi['distribution'], [{'label': 'Slides', 'count': 1}, {'label': 'Workbook', 'count': 1}])

    def test_weighted_overall_excludes_missing_unscored_and_explicitly_excluded_questions(self):
        rows = [question_metrics(question(config={'analytics': {'importance': 'critical'}}), set(), answers=[answer(5)]),
                question_metrics(question(2, config={'analytics': {'importance': 'low'}}), set(), answers=[answer(1)]),
                question_metrics(question(3), set(), answers=[]),
                question_metrics(question(4, 'long_text'), set(), answers=[answer('Fine')]),
                question_metrics(question(5, config={'analytics': {'includeInOverall': False}}), set(), answers=[answer(1)])]
        self.assertEqual(overall_metrics(rows), {'score': 80, 'scoredQuestions': 2, 'includedQuestions': 3})
        self.assertIsNone(overall_metrics([])['score'])

    def test_versions_keep_their_own_scores_and_importance(self):
        first = question_metrics(question(config={'analytics': {'scoring': 'higher', 'importance': 'low'}}), set(), answers=[answer(5)])
        second = question_metrics(question(2, config={'analytics': {'scoring': 'lower', 'importance': 'critical'}}, version=2), set(), answers=[answer(5)])
        self.assertEqual((first['version'], first['score'], first['weight']), (1, 100, 1))
        self.assertEqual((second['version'], second['score'], second['weight']), (2, 0, 4))

    def test_guest_and_review_response_keys_do_not_collapse_empty_learner_ids(self):
        first = answer(True, learner='', delivery=None, event_recipient_id=1).response
        second = answer(True, learner='', delivery=None, event_recipient_id=2).response
        self.assertNotEqual(response_key(first), response_key(second))
        self.assertEqual(response_key(answer(True, delivery=None, review_delivery_id=10).response), ('review', 10))


class QuestionCoverageTests(SimpleTestCase):
    def report(self, questions, *, deliveries=(), recipients=(), pins=(), started=(), assignments=(), reviews=(), campaigns=(), events=(), rsvp=(), delivery_ids=None, completed=(), all_completed=None, **period):
        patches = [
            mock.patch.object(reporting, 'completed_report_responses', side_effect=[completed, all_completed] if all_completed is not None else None, return_value=completed),
            mock.patch.object(reporting.FeedbackQuestion.objects, 'select_related', return_value=queryset(questions)),
            mock.patch.object(reporting.FeedbackAnswer.objects, 'filter', return_value=queryset()),
            mock.patch.object(reporting.FeedbackAssignment.objects, 'filter', return_value=queryset(assignments)),
            mock.patch.object(reporting.FeedbackReviewDelivery.objects, 'filter', return_value=queryset(reviews)),
            mock.patch.object(reporting.FeedbackEventCampaign.objects, 'filter', return_value=queryset(campaigns)),
            mock.patch.object(reporting.FeedbackEventRecipient.objects, 'filter', return_value=queryset(events)),
            mock.patch.object(reporting.EventRsvpRecipient.objects, 'filter', return_value=queryset(rsvp)),
            mock.patch.object(reporting.FeedbackDelivery.objects, 'filter', return_value=queryset(deliveries)),
            mock.patch.object(reporting.FeedbackDeliveryRecipient.objects, 'filter', return_value=queryset(recipients)),
            mock.patch.object(reporting.FeedbackDeliveryQuestion.objects, 'filter', return_value=queryset(pins)),
            mock.patch.object(reporting.FeedbackResponse.objects, 'filter', return_value=queryset(started)),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)
        return reporting.question_analytics([4], delivery_ids=delivery_ids, **period)

    def test_lecture_filter_uses_only_its_saved_questions_and_responses(self):
        first, second = question(), question(2)
        first.submitted_answers = [answer(1, delivery=30), answer(5, delivery=31)]
        result = self.report([first, second], delivery_ids=[30],
                             deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': True}],
                             recipients=[(30, '1'), (30, '2'), (31, '1')], pins=[(30, 1), (31, 2)],
                             assignments=[(4, 'learner', 'manual')], reviews=[(4, 50)])
        self.assertEqual([row['questionId'] for row in result['questionMetrics']], [1])
        row = result['questionMetrics'][0]
        self.assertEqual((row['score'], row['answeredCount'], row['assignedCount'], row['answerRate']), (0, 1, 2, 50))
        self.assertEqual(result['overallScore']['score'], 0)
        self.assertFalse(result['selectionPending'])

    def test_module_scope_combines_only_the_given_lectures_without_drawing_again(self):
        first, second, undrawn = question(), question(2), question(3)
        first.submitted_answers = [answer(1, delivery=30), answer(5, delivery=31), answer(5, delivery=99)]
        result = self.report([first, second, undrawn], delivery_ids=[30, 31],
                             deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': True}, {'id': 31, 'form_id': 4, 'question_set_pinned': True}],
                             recipients=[(30, '1'), (31, '1')], pins=[(30, 1), (31, 1), (31, 2)])
        self.assertEqual([row['questionId'] for row in result['questionMetrics']], [1, 2])
        self.assertEqual(result['questionMetrics'][0]['score'], 50)
        self.assertEqual(result['overallScore']['scoredQuestions'], 1)

    def test_uninitialized_lecture_filter_never_exposes_the_whole_bank(self):
        result = self.report([question(), question(2)], delivery_ids=[30],
                             deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': False}], recipients=[(30, '1')])
        self.assertEqual(result['questionMetrics'], [])
        self.assertTrue(result['selectionPending'])
        self.assertIsNone(result['overallScore']['score'])

    def test_only_recipients_of_a_pinned_question_enter_its_denominator(self):
        first, second = question(), question(2)
        first.submitted_answers = [answer(5)]
        result = self.report([first, second], deliveries=[
            {'id': 30, 'form_id': 4, 'question_set_pinned': True},
            {'id': 31, 'form_id': 4, 'question_set_pinned': True}],
            recipients=[(30, '1'), (30, '2'), (31, '1')], pins=[(30, 1), (31, 2)])
        rows = result['questionMetrics']
        self.assertEqual((rows[0]['assignedCount'], rows[0]['answerRate']), (2, 50))
        self.assertEqual((rows[1]['assignedCount'], rows[1]['answerRate']), (1, 0))
        self.assertNotIn('_score', rows[0])

    def test_legacy_uninitialized_bank_is_reported_unknown_without_pinning_or_writes(self):
        with mock.patch.object(feedback, 'ensure_delivery_questions') as ensure, mock.patch.object(feedback, 'sync_module_feedback') as sync:
            result = self.report([question()], deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': False}], recipients=[(30, '1')])
        self.assertIsNone(result['questionMetrics'][0]['answerRate'])
        ensure.assert_not_called()
        sync.assert_not_called()

    def test_started_legacy_delivery_keeps_its_full_historical_set(self):
        rows = self.report([question(), question(2)], deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': False}],
                           recipients=[(30, '1')], started=[30])['questionMetrics']
        self.assertEqual([row['assignedCount'] for row in rows], [1, 1])

    def test_manual_review_and_guest_opportunities_are_scoped_without_guest_collisions(self):
        rows = self.report([question()], assignments=[(4, 'learner', '7'), (4, 'learner', '7')],
                           reviews=[(4, 50)], campaigns=[(4, 8)], events=[(8, 9), (8, 10)], rsvp=[(4, 60)])['questionMetrics']
        self.assertEqual(rows[0]['assignedCount'], 5)

    def test_empty_scope_returns_no_fabricated_overall(self):
        result = self.report([])
        self.assertEqual(result['questionMetrics'], [])
        self.assertEqual(result['overallScore'], {'score': None, 'scoredQuestions': 0, 'includedQuestions': 0})
        self.assertEqual(result['insights']['classification']['total'], 0)
        self.assertEqual(result['insights']['classification']['responses'], [])

    def test_submission_period_filters_answers_but_retains_all_historical_assignment_coverage(self):
        q = question(config={'display': 'stars'})
        q.submitted_answers = [
            answer(5, learner='revoked', submitted_at=datetime(2026, 9, 1, tzinfo=timezone.utc)),
            answer(1, learner='current', submitted_at=datetime(2026, 10, 1, tzinfo=timezone.utc)),
            answer(4, learner='undated', submitted_at=None),
            answer(5, learner='draft', status='in_progress', submitted_at=datetime(2026, 10, 1, tzinfo=timezone.utc)),
        ]
        result = self.report([q], delivery_ids=[30], deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': True}],
                             pins=[(30, 1)], recipients=[(30, 'current')], **submission_period('2026-10-01', '2026-10-01'))
        row = result['questionMetrics'][0]
        self.assertEqual((row['answeredCount'], row['assignedCount'], row['answerRate'], row['score']), (1, 3, 33.3, 0))
        self.assertEqual(result['insights']['stars']['average'], 1)
        self.assertEqual(result['insights']['trend'][0]['month'], '2026-10')

    def test_endpoint_retains_legacy_contract_and_applies_the_same_scope_to_new_metrics(self):
        forms = queryset()
        forms.values_list.return_value = ['template-1']
        responses = queryset()
        responses.count.return_value = 0
        with (
            mock.patch.object(feedback, 'sync_module_feedback') as sync,
            mock.patch.object(feedback, '_forms_queryset', return_value=forms),
            mock.patch.object(feedback.FeedbackForm.objects, 'filter', return_value=queryset([4])),
            mock.patch.object(feedback.FeedbackResponse.objects, 'all', return_value=responses),
            mock.patch.object(feedback.FeedbackQuestion.objects, 'filter', return_value=queryset()),
            mock.patch.object(feedback, 'question_analytics', return_value={'questionMetrics': [], 'overallScore': {'score': None}}) as metrics,
            mock.patch.object(feedback, 'lecture_analytics_options', return_value=[]),
        ):
            response = feedback.analytics.__wrapped__(RequestFactory().get('/?formType=post_lecture'))
        data = json.loads(response.content)['analytics']
        self.assertEqual(data['ratingAverages'], [])
        self.assertEqual(data['completionRate'], 0)
        self.assertIn('questionMetrics', data)
        metrics.assert_called_once_with([4])
        sync.assert_called_once_with()  # Existing endpoint behavior, not an added sync.

    def test_learner_still_cannot_read_staff_analytics(self):
        with mock.patch('engagement_api.permissions.authenticate_request', return_value=Row(role='learner')):
            response = feedback.analytics(RequestFactory().get('/'))
        self.assertEqual(response.status_code, 403)


class LectureReportFilterTests(SimpleTestCase):
    lectures = [
        {'deliveryId': 30, 'moduleId': 'M1'}, {'deliveryId': 31, 'moduleId': 'M1'},
        {'deliveryId': 40, 'moduleId': 'M2'},
    ]

    def test_submission_dates_are_validated_before_queries_and_forwarded_without_writes(self):
        for query in ['submittedFrom=bad', 'submittedFrom=2026-02-30', 'submittedTo=9999-12-31', 'submittedFrom=2026-10-02&submittedTo=2026-10-01', 'submittedFrom=20261001']:
            with self.subTest(query=query), mock.patch.object(feedback, '_forms_queryset') as forms:
                self.assertEqual(feedback.question_analytics_detail.__wrapped__(RequestFactory().get('/?' + query)).status_code, 400)
                forms.assert_not_called()
        with mock.patch.object(feedback, '_forms_queryset'), mock.patch.object(feedback, 'lecture_analytics_options', return_value=self.lectures), mock.patch.object(feedback, 'question_analytics', return_value={}) as report, mock.patch.object(feedback, 'sync_module_feedback') as sync:
            response = feedback.question_analytics_detail.__wrapped__(RequestFactory().get('/?deliveryId=30&submittedFrom=2026-10-01&submittedTo=2026-10-31'))
            self.assertEqual(response.status_code, 200)
            report.assert_called_once_with(None, delivery_ids=[30], **submission_period('2026-10-01', '2026-10-31'))
            sync.assert_not_called()

    def test_filter_endpoint_preserves_parent_scope_and_never_calls_sync_or_pinning(self):
        form = Row(id=4, form_type='post_lecture', template_key='family')
        forms = queryset()
        forms.first.return_value = form
        with (
            mock.patch.object(feedback, '_forms_queryset', return_value=forms),
            mock.patch.object(feedback.FeedbackForm.objects, 'filter', return_value=queryset([3, 4])),
            mock.patch.object(feedback, 'lecture_analytics_options', return_value=self.lectures) as options,
            mock.patch.object(feedback, 'question_analytics', return_value={'questionMetrics': [], 'overallScore': {'score': 0}}) as metrics,
            mock.patch.object(feedback, 'sync_module_feedback') as sync,
            mock.patch.object(feedback, 'ensure_delivery_questions') as draw,
        ):
            response = feedback.question_analytics_detail.__wrapped__(RequestFactory().get('/?formId=4&formType=post_lecture&moduleId=M1&deliveryId=30'))
        self.assertEqual(response.status_code, 200)
        forms.filter.assert_any_call(form_type='post_lecture')
        forms.filter.assert_any_call(pk=4)
        options.assert_called_once_with([3, 4])
        metrics.assert_called_once_with([3, 4], delivery_ids=[30])
        sync.assert_not_called()
        draw.assert_not_called()
        self.assertNotIn('totalAssigned', json.loads(response.content)['analytics'])

    def test_module_only_filter_is_exact_and_unknown_modules_do_not_fall_back_to_all_data(self):
        for module_id, expected in [('M1', [30, 31]), ('missing', [])]:
            with self.subTest(module=module_id), mock.patch.object(feedback, '_forms_queryset'), mock.patch.object(feedback, 'lecture_analytics_options', return_value=self.lectures), mock.patch.object(feedback, 'question_analytics', return_value={}) as report:
                response = feedback.question_analytics_detail.__wrapped__(RequestFactory().get('/?moduleId=' + module_id))
                self.assertEqual(response.status_code, 200)
                report.assert_called_once_with(None, delivery_ids=expected)

    def test_lecture_outside_selected_scope_or_module_is_not_reported(self):
        for query in ['?deliveryId=99', '?moduleId=M2&deliveryId=30']:
            with self.subTest(query=query), mock.patch.object(feedback, '_forms_queryset'), mock.patch.object(feedback, 'lecture_analytics_options', return_value=self.lectures), mock.patch.object(feedback, 'question_analytics') as report:
                response = feedback.question_analytics_detail.__wrapped__(RequestFactory().get('/' + query))
                self.assertEqual(response.status_code, 404)
                report.assert_not_called()

    def test_filter_ids_are_validated_before_reading_data(self):
        for query in ['?deliveryId=-1', '?deliveryId=0', '?deliveryId=abc', '?deliveryId=99999999999999999999', '?formId=bad', '?formType=bad']:
            with self.subTest(query=query), mock.patch.object(feedback, '_forms_queryset') as forms:
                response = feedback.question_analytics_detail.__wrapped__(RequestFactory().get('/' + query))
                self.assertEqual(response.status_code, 400)
                forms.assert_not_called()

    def test_staff_gate_and_read_only_method_are_retained(self):
        for role, expected in [('learner', 403), ('employer', 403), ('staff', 200), ('admin', 200)]:
            with self.subTest(role=role), mock.patch('engagement_api.permissions.authenticate_request', return_value=Row(role=role)), mock.patch.object(feedback, '_forms_queryset'), mock.patch.object(feedback, 'lecture_analytics_options', return_value=[]), mock.patch.object(feedback, 'question_analytics', return_value={}):
                self.assertEqual(feedback.question_analytics_detail(RequestFactory().get('/')).status_code, expected)
        with mock.patch('engagement_api.permissions.authenticate_request', return_value=None):
            self.assertEqual(feedback.question_analytics_detail(RequestFactory().get('/')).status_code, 401)
        self.assertEqual(feedback.question_analytics_detail.__wrapped__(RequestFactory().post('/')).status_code, 405)

    def test_lecture_options_keep_occurrence_identity_and_dates_without_writing(self):
        from datetime import datetime, timezone
        moment = datetime(2026, 10, 20, 9, tzinfo=timezone.utc)
        delivery = Row(id=30, module_catalogue_id='M1', module_name='Marketing', session_title='Session 1',
                       occurrence_key='occurrence-30', starts_at=moment, available_at=moment,
                       cohort_name='Cohort A', group_name='Group A', form=Row(title='Feedback', version=2))
        query = queryset([delivery])
        query.order_by.return_value = [delivery]
        with mock.patch.object(reporting.FeedbackDelivery.objects, 'filter', return_value=query) as filtered:
            options = reporting.lecture_analytics_options([4])
        filtered.assert_called_once_with(form__form_type='post_lecture')
        query.filter.assert_called_once_with(form_id__in=[4])
        query.exclude.assert_called_once_with(status='cancelled')
        self.assertEqual(options[0]['startsAt'], moment.isoformat())
        self.assertEqual((options[0]['deliveryId'], options[0]['occurrenceKey'], options[0]['groupName']), (30, 'occurrence-30', 'Group A'))


class RuleBasedClassificationTests(SimpleTestCase):
    def test_multiple_answers_average_selected_option_scores_and_deduplicate_choices(self):
        config = {'options': ['Helpful', 'Mixed', 'Unhelpful'], 'analytics': {'scoring': 'options', 'optionScores': {'Helpful': 100, 'Mixed': 60, 'Unhelpful': 0}}}
        validate_analytics_settings('multiple_choice', config)
        self.assertEqual(answer_score('multiple_choice', config, ['Helpful', 'Unhelpful']), 50)
        self.assertEqual(answer_score('multiple_choice', config, ['Helpful', 'Helpful', 'Unhelpful']), 50)
        self.assertEqual(answer_score('multiple_choice', config, ['Helpful', 'Mixed']), 80)
        for value in [[], ['Unknown'], ['Helpful', 'Unknown'], 'Helpful', [True], None]:
            self.assertIsNone(answer_score('multiple_choice', config, value))

    def test_numeric_ranges_are_explicit_clamped_and_independent_of_student_validation(self):
        config = {'min': -1000, 'max': 1000, 'analytics': {'scoring': 'higher', 'scoreMin': 10, 'scoreMax': 20}}
        original = deepcopy(config)
        validate_analytics_settings('number', config)
        self.assertEqual([answer_score('number', config, value) for value in [-100, 10, 15, 20, 100]], [0, 0, 50, 100, 100])
        self.assertEqual(config, original)
        config['analytics']['scoring'] = 'lower'
        self.assertEqual([answer_score('number', config, value) for value in [-100, 15, 100]], [100, 50, 0])
        self.assertIsNone(answer_score('number', {}, 10))
        for value in [True, '15', float('inf'), float('nan'), None]:
            self.assertIsNone(answer_score('number', config, value))
        for lower, upper in [(None, 10), (0, None), (10, 10), (11, 10), (False, 10), (0, float('inf'))]:
            with self.subTest(lower=lower, upper=upper), self.assertRaises(ValueError):
                validate_analytics_settings('number', {'analytics': {'scoring': 'higher', 'scoreMin': lower, 'scoreMax': upper}})

    def test_exact_classification_boundaries_and_unscored_values(self):
        for score, expected in [(0, 'negative'), (49.999, 'negative'), (50, 'neutral'), (74.999, 'neutral'), (75, 'positive'), (100, 'positive'), (None, 'unscored'), (True, 'unscored')]:
            self.assertEqual(score_classification(score), expected)

    def test_question_answer_classification_is_distinct_from_the_mean_score(self):
        row = question_metrics(question(), set(), answers=[answer(5), answer(4, learner='2'), answer(1, learner='3'), answer(3, learner='4'), answer('', learner='5'), answer(5, learner='6', status='in_progress')])
        self.assertEqual(row['classification'], {'positive': 2, 'neutral': 1, 'negative': 1, 'unscored': 0})
        self.assertEqual(row['scoredResponses'], 4)
        text = question_metrics(question(kind='long_text'), set(), answers=[answer('Excellent support')])
        self.assertEqual(text['classification'], {'positive': 0, 'neutral': 0, 'negative': 0, 'unscored': 1})

    def test_response_uses_weighted_answer_scores_not_a_majority_vote_and_masks_anonymous_identity(self):
        form = Row(title='Lecture feedback', version=2, form_type='post_lecture', anonymous_responses=True)
        moment = datetime(2026, 10, 20, 9, tzinfo=timezone.utc)
        response = Row(id=70, form_id=4, form=form, learner_id='1', learner_name='Private respondent', delivery_id=30, status='completed', submitted_at=moment)
        critical = question(config={'analytics': {'importance': 'critical'}})
        low = question(2, config={'analytics': {'importance': 'low'}})
        critical.section.form = low.section.form = form
        pairs = [(critical, [Row(answer=5, response=response)]), (low, [Row(answer=1, response=response)])]
        rows = [question_metrics(q, set(), answers=answers) for q, answers in pairs]
        result = response_classifications(rows, pairs, [response])
        self.assertEqual((result['total'], result['positive'], result['negative']), (1, 1, 0))
        self.assertEqual(result['responses'][0]['score'], 80)
        self.assertEqual(result['responses'][0]['respondent'], 'Anonymous learner')
        self.assertNotIn('Private respondent', json.dumps(result))
        self.assertNotIn('learnerId', result['responses'][0])
        self.assertEqual(result['byType'][0]['formType'], 'post_lecture')
        self.assertEqual(result['trend'][0]['month'], '2026-10')

    def test_text_only_empty_and_excluded_responses_remain_unscored_and_guests_do_not_merge_across_forms(self):
        form = Row(title='Event feedback', version=1, form_type='post_event', anonymous_responses=False)
        def response(identifier, form_id):
            return Row(id=identifier, form_id=form_id, form=form, learner_id='', learner_name='Synthetic guest', delivery_id=None, event_recipient_id=9, status='completed', submitted_at=None)
        first, second = response(70, 4), response(71, 5)
        q1, q2 = question(kind='long_text'), question(2, config={'analytics': {'includeInOverall': False}}, form_id=5)
        q1.section.form = q2.section.form = form
        pairs = [(q1, [Row(answer='Great', response=first)]), (q2, [Row(answer=5, response=second)])]
        rows = [question_metrics(q, set(), answers=answers) for q, answers in pairs]
        result = response_classifications(rows, pairs, [first, second])
        self.assertEqual((result['total'], result['unscored'], result['positive']), (2, 2, 0))
        empty = response_classifications([], [], [first, second])
        self.assertEqual(empty['unscored'], 2)
        self.assertTrue(all(item['score'] is None for item in empty['responses']))

    def test_completed_response_query_combines_form_lecture_and_submission_scope_without_writes(self):
        query = queryset([])
        period = submission_period('2026-10-01', '2026-10-25')
        with mock.patch.object(reporting.FeedbackResponse.objects, 'filter', return_value=query) as filtered:
            self.assertEqual(reporting.completed_report_responses([4], delivery_ids=[30], **period), [])
        filtered.assert_called_once_with(status='completed')
        query.filter.assert_any_call(form_id__in=[4])
        query.filter.assert_any_call(delivery_id__in=[30])
        query.filter.assert_any_call(submitted_at__gte=period['submitted_from'])
        query.filter.assert_any_call(submitted_at__lt=period['submitted_until'])


class FeedbackDashboardReadTests(SimpleTestCase):
    report = QuestionCoverageTests.report

    def test_dashboard_scopes_historical_versions_and_filters_without_syncing_or_drawing(self):
        with (
            mock.patch.object(feedback.FeedbackForm.objects, 'filter', return_value=queryset([4, 5])),
            mock.patch.object(feedback, 'question_analytics', return_value={}) as report,
            mock.patch.object(reporting, 'dashboard_groups', return_value=[{'id': 'G1', 'name': 'Group One'}]),
            mock.patch.object(reporting, 'dashboard_modules', return_value=[{'id': 'M1', 'name': 'Marketing'}]) as modules,
            mock.patch.object(feedback, 'sync_module_feedback') as sync,
            mock.patch.object(feedback, 'ensure_delivery_questions') as draw,
        ):
            response = feedback.insights_dashboard.__wrapped__(RequestFactory().get('/?formType=post_lecture&groupId=G1&moduleId=M1&classification=negative&submittedFrom=2026-10-01&submittedTo=2026-10-25'))
        self.assertEqual(response.status_code, 200)
        report.assert_called_once_with([4, 5], group_id='G1', module_id='M1', classification='negative', dashboard=True, **submission_period('2026-10-01', '2026-10-25'))
        modules.assert_called_once_with([4, 5], group_id='G1')
        sync.assert_not_called()
        draw.assert_not_called()
        self.assertEqual(json.loads(response.content)['analytics']['groups'][0]['id'], 'G1')
        self.assertEqual(json.loads(response.content)['analytics']['modules'][0]['id'], 'M1')

    def test_dashboard_rejects_bad_filters_before_queries(self):
        for query in ['formType=wrong', 'classification=high', 'groupId=' + 'x' * 256, 'groupId=bad%00group', 'moduleId=' + 'x' * 256, 'moduleId=bad%00module', 'submittedFrom=2026-02-30', 'submittedFrom=2026-10-26&submittedTo=2026-10-01']:
            with self.subTest(query=query), mock.patch.object(feedback, 'question_analytics') as report, mock.patch.object(reporting, 'dashboard_groups') as groups:
                self.assertEqual(feedback.insights_dashboard.__wrapped__(RequestFactory().get('/?' + query)).status_code, 400)
                report.assert_not_called()
                groups.assert_not_called()

    def test_dashboard_requires_staff_and_get_without_weakening_other_roles(self):
        for role, expected in [('staff', 200), ('admin', 200), ('learner', 403), ('employer', 403), ('coach', 403)]:
            with self.subTest(role=role), mock.patch('engagement_api.permissions.authenticate_request', return_value=Row(role=role)), mock.patch.object(feedback, 'question_analytics', return_value={}), mock.patch.object(reporting, 'dashboard_groups', return_value=[]), mock.patch.object(reporting, 'dashboard_modules', return_value=[]):
                self.assertEqual(feedback.insights_dashboard(RequestFactory().get('/')).status_code, expected)
        with mock.patch('engagement_api.permissions.authenticate_request', return_value=None):
            self.assertEqual(feedback.insights_dashboard(RequestFactory().get('/')).status_code, 401)
        self.assertEqual(feedback.insights_dashboard.__wrapped__(RequestFactory().post('/')).status_code, 405)

    def test_group_scope_uses_delivery_snapshot_and_form_only_when_no_delivery_exists(self):
        query = queryset([])
        with mock.patch.object(reporting.FeedbackResponse.objects, 'filter', return_value=query):
            reporting.completed_report_responses([4], group_id='G1')
        condition = query.filter.call_args_list[1].args[0]
        self.assertEqual(condition.connector, 'OR')
        self.assertEqual(condition.children[0], ('delivery__group_id', 'G1'))
        self.assertEqual(dict(condition.children[1].children), {'delivery_id__isnull': True, 'form__group_id': 'G1'})
        query.select_related.assert_called_once_with('form', 'delivery')

    def test_group_choices_include_historical_form_and_lecture_snapshots_and_keep_scope(self):
        forms = queryset([('G1', 'Group One'), ('G2', '')])
        deliveries = queryset([('G1', 'Group One'), ('G3', 'Group Three')])
        with mock.patch.object(reporting.FeedbackForm.objects, 'all', return_value=forms), mock.patch.object(reporting.FeedbackDelivery.objects, 'all', return_value=deliveries):
            groups = reporting.dashboard_groups([4, 5])
        forms.filter.assert_called_once_with(id__in=[4, 5])
        deliveries.filter.assert_called_once_with(form_id__in=[4, 5])
        self.assertEqual({item['id'] for item in groups}, {'G1', 'G2', 'G3'})
        self.assertEqual(next(item['name'] for item in groups if item['id'] == 'G2'), 'G2')

    def test_module_scope_is_combined_with_group_and_uses_the_delivery_before_form_metadata(self):
        query = queryset([])
        with mock.patch.object(reporting.FeedbackResponse.objects, 'filter', return_value=query):
            reporting.completed_report_responses([4], group_id='G1', module_id='M1', **submission_period('2026-10-01', '2026-10-26'))
        conditions = [call.args[0] for call in query.filter.call_args_list if call.args]
        self.assertEqual(len(conditions), 2)  # Separate filters are ANDed, not ORed across group/module.
        module = conditions[1]
        self.assertEqual(module.connector, 'OR')
        self.assertEqual(module.children[0], ('delivery__module_catalogue_id', 'M1'))
        self.assertEqual(dict(module.children[1].children), {'delivery_id__isnull': True, 'form__module_catalogue_id': 'M1'})
        query.filter.assert_any_call(form_id__in=[4])

    def test_module_options_preserve_historical_ids_and_combine_type_family_with_saved_group(self):
        forms = queryset([('M1', 'Marketing'), ('M2', ''), ('M3', 'Marketing')])
        deliveries = queryset([('M1', 'Marketing')])
        forms.order_by.return_value = forms
        deliveries.order_by.return_value = deliveries
        with mock.patch.object(reporting.FeedbackForm.objects, 'all', return_value=forms), mock.patch.object(reporting.FeedbackDelivery.objects, 'all', return_value=deliveries):
            modules = reporting.dashboard_modules([4, 5], group_id='G1')
        forms.filter.assert_any_call(id__in=[4, 5])
        deliveries.filter.assert_any_call(form_id__in=[4, 5])
        for query in (forms, deliveries):
            query.filter.assert_any_call(group_id='G1')
            query.exclude.assert_called_once_with(module_catalogue_id='')
        self.assertEqual({item['id'] for item in modules}, {'M1', 'M2', 'M3'})
        self.assertEqual(next(item['name'] for item in modules if item['id'] == 'M2'), 'M2')

    def test_module_report_scopes_answers_manual_opportunities_and_all_time_coverage(self):
        q = question()
        q.section.form = Row(title='Reusable feedback', version=1, form_type='post_lecture', group_id='G1', module_catalogue_id='M2')
        response = Row(id=1, form_id=4, form=q.section.form, status='completed', learner_id='1', learner_name='Synthetic learner', delivery_id=30, submitted_at=None)
        q.submitted_answers = [Row(answer=1, response=response)]
        result = self.report([q], completed=[response], group_id='G1', module_id='M1', dashboard=True,
                             deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': True}], pins=[(30, 1)],
                             recipients=[(30, '1'), (30, '2'), (99, 'other-module-learner')])
        reporting.FeedbackAssignment.objects.filter.assert_called_once_with(form_id__in=set())
        delivery_query = reporting.FeedbackDelivery.objects.filter.return_value
        delivery_query.filter.assert_any_call(group_id='G1')
        delivery_query.filter.assert_any_call(module_catalogue_id='M1')
        module = reporting.FeedbackAnswer.objects.filter.return_value.filter.call_args.args[0]
        self.assertEqual(module.children[0], ('response__delivery__module_catalogue_id', 'M1'))
        self.assertEqual(dict(module.children[1].children), {'response__delivery_id__isnull': True, 'response__form__module_catalogue_id': 'M1'})
        self.assertEqual(result['coverage'], {'assigned': 2, 'submitted': 1, 'rate': 50})
        self.assertEqual(result['insights']['classification']['negative'], 1)
        self.assertEqual(result['questionMetrics'][0]['assignedCount'], 2)

    def test_unknown_module_never_falls_back_to_all_assignments_or_all_responses(self):
        q = question()
        q.section.form.module_catalogue_id = 'M2'
        result = self.report([q], module_id='missing', dashboard=True)
        self.assertEqual(result['coverage']['assigned'], 0)
        self.assertIsNone(result['coverage']['rate'])
        self.assertEqual(result['insights']['classification']['total'], 0)
        self.assertIsNone(result['overallScore']['score'])

    def test_classification_filter_recomputes_question_metrics_but_coverage_stays_all_time(self):
        q = question(config={'display': 'stars'})
        form = Row(title='Lecture feedback', version=1, form_type='post_lecture', anonymous_responses=True)
        q.section.form = form
        def completed(identifier, learner, value, moment):
            response = Row(id=identifier, form_id=4, form=form, status='completed', learner_id=learner, learner_name='Private name', delivery_id=30, submitted_at=moment)
            return response, Row(response=response, answer=value)
        current, negative = completed(1, '1', 1, datetime(2026, 10, 20, tzinfo=timezone.utc))
        old, positive = completed(2, '2', 5, datetime(2026, 9, 1, tzinfo=timezone.utc))
        another, in_period_positive = completed(3, '3', 5, datetime(2026, 10, 21, tzinfo=timezone.utc))
        q.submitted_answers = [negative, positive, in_period_positive]
        result = self.report([q], completed=[current, another], all_completed=[current, old, another], dashboard=True, classification='negative',
                             deliveries=[{'id': 30, 'form_id': 4, 'question_set_pinned': True}], pins=[(30, 1)],
                             recipients=[(30, '1'), (30, '2'), (30, '3'), (30, '4')], **submission_period('2026-10-01', '2026-10-26'))
        self.assertEqual(result['coverage'], {'assigned': 4, 'submitted': 3, 'rate': 75})
        self.assertEqual(result['insights']['classification']['total'], 1)
        self.assertEqual(result['questionMetrics'][0]['classification']['negative'], 1)
        self.assertEqual(result['questionMetrics'][0]['score'], 0)
        self.assertNotIn('Private name', json.dumps(result))

    def test_group_scope_excludes_manual_assignments_of_other_form_groups(self):
        q = question()
        q.section.form.group_id = 'G2'
        result = self.report([q], group_id='G1', dashboard=True)
        reporting.FeedbackAssignment.objects.filter.assert_called_once_with(form_id__in=set())
        reporting.FeedbackDelivery.objects.filter.return_value.filter.assert_any_call(group_id='G1')
        condition = reporting.FeedbackAnswer.objects.filter.return_value.filter.call_args.args[0]
        self.assertEqual(condition.children[0], ('response__delivery__group_id', 'G1'))
        self.assertEqual(dict(condition.children[1].children), {'response__delivery_id__isnull': True, 'response__form__group_id': 'G1'})
        self.assertIsNone(result['coverage']['rate'])
        self.assertEqual(result['coverage']['assigned'], 0)


class FeedbackInsightTests(SimpleTestCase):
    def test_uk_calendar_day_boundaries_include_dst_changes_and_exclude_next_day(self):
        period = submission_period('2026-10-25', '2026-10-25')
        self.assertEqual(period['submitted_from'].astimezone(timezone.utc).isoformat(), '2026-10-24T23:00:00+00:00')
        self.assertEqual(period['submitted_until'].astimezone(timezone.utc).isoformat(), '2026-10-26T00:00:00+00:00')
        for moment, expected in [('2026-10-24T22:59:59+00:00', False), ('2026-10-24T23:00:00+00:00', True), ('2026-10-25T23:59:59+00:00', True), ('2026-10-26T00:00:00+00:00', False)]:
            self.assertEqual(answer_in_period(answer(5, submitted_at=datetime.fromisoformat(moment)), **period), expected)
        self.assertFalse(answer_in_period(answer(5), **period))
        self.assertEqual(submission_period('', ''), {})
        self.assertEqual(set(submission_period('', '2026-10-01')), {'submitted_until'})

    def test_raw_stars_exclude_numeric_scales_invalid_values_drafts_and_duplicates(self):
        star = question(config={'display': 'stars', 'analytics': {'scoring': 'lower'}})
        answers = [answer(1), answer(1), answer(5, learner='2'), answer(True, learner='3'),
                   answer(6, learner='4'), answer(5, learner='5', status='in_progress')]
        numeric = question(2, config={'min': 1, 'max': 10})
        rows = [question_metrics(star, set(), answers=answers), question_metrics(numeric, set(), answers=[answer(10)])]
        result = report_insights(rows, [(star, answers), (numeric, [answer(10)])])
        self.assertEqual(result['stars']['average'], 3)
        self.assertEqual(result['stars']['answers'], 2)
        self.assertEqual([item['count'] for item in result['stars']['distribution']], [1, 0, 0, 0, 1])

    def test_monthly_and_category_scores_use_question_weights_not_answer_counts_and_keep_versions_separate(self):
        critical = question(config={'display': 'stars', 'analytics': {'importance': 'critical'}})
        low = question(2, config={'display': 'stars', 'analytics': {'importance': 'low'}})
        v2 = question(3, version=2, form_id=5)
        moment = datetime(2026, 8, 31, 23, 30, tzinfo=timezone.utc)  # September in UK time.
        pairs = [(critical, [answer(5, submitted_at=moment)]),
                 (low, [answer(1, learner=str(index), submitted_at=moment) for index in range(10)]),
                 (v2, [answer(3, submitted_at=None)])]
        rows = [question_metrics(q, set(), answers=answers) for q, answers in pairs]
        result = report_insights(rows, pairs)
        self.assertEqual(result['trend'], [{'month': '2026-09', 'score': 80, 'scoredQuestions': 2, 'includedQuestions': 2, 'scoredAnswers': 11}])
        self.assertEqual([(category['version'], category['score']) for category in result['categories']], [(1, 80), (2, 50)])
        self.assertEqual(result['undatedScoredAnswers'], 1)
        self.assertEqual(result['stars']['average'], 1.36)

    def test_unscored_text_and_excluded_questions_do_not_create_scores_or_zero_data(self):
        text = question(kind='long_text')
        excluded = question(2, config={'display': 'stars', 'analytics': {'includeInOverall': False}})
        pairs = [(text, [answer('Fine')]), (excluded, [answer(1)])]
        rows = [question_metrics(q, set(), answers=answers) for q, answers in pairs]
        result = report_insights(rows, pairs)
        self.assertIsNone(result['categories'][0]['score'])
        self.assertEqual(result['trend'], [])
        self.assertEqual(result['stars']['average'], 1)  # Raw stars remain independent of scoring settings.
        self.assertIsNone(report_insights([], [])['stars']['average'])
