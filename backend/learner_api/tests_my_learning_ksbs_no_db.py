"""Course KSB percentages, ownership and bounded reads; no database or network."""
from unittest.mock import patch

from django.test import SimpleTestCase

from . import my_learning as learning
from . import my_learning_ksbs as ksbs
from .tests_my_learning_no_db import component, metadata, native


class MyLearningKsbTests(SimpleTestCase):
    def cards(self, content, mappings):
        meta = metadata()
        meta['current_subjects'] = [{'id': 'M1', 'title': 'One'}, {'id': 'M2', 'title': 'Two'}]
        with patch('learner_api.course_catalogue_display.read_export_placements', return_value=[]):
            return learning.assemble_cards(content, meta['current_subjects'], [], [], set(), set(), {}, meta,
                [], {}, [], ksb_mappings=mappings)[0]

    def test_percentage_uses_ksb_points_in_this_course_not_activity_count_or_other_courses(self):
        content = native([component('C1'), component('C2'), component('NO-KSBS'), component('OTHER', 'M2')])
        content['componentProgress'] = [{'componentId': cid, 'kind': 'component'} for cid in ('C1', 'NO-KSBS')]
        cards = {c['id']: c for c in self.cards(content, {
            'C1': {'K1', 'K2', 'S1'}, 'C2': {'K1'}, 'NO-KSBS': set(), 'OTHER': {'K1', 'S2'},
        })}
        self.assertEqual(cards['current:M1']['progress'], 66.67)
        self.assertEqual(cards['current:M1']['ksbProgress'], {
            'completed': 3, 'total': 4, 'percent': 75, 'status': 'ready'})
        self.assertEqual(cards['current:M2']['ksbProgress']['percent'], 0)

    def test_duplicate_placements_failed_quizzes_and_attendance_keep_existing_completion_rules(self):
        content = native([component('C1'), component('C1'),
            component('QUIZ', isQuiz=True, quizMeta={'quizId': 1}),
            component('LIVE', type='live_session', attendanceCompleted=True)])
        content['componentProgress'] = [{'componentId': 'C1', 'kind': 'component', 'passed': False}]
        content['quizAttempts'] = [{'componentId': 'QUIZ', 'quizId': 1, 'passed': False}]
        card = self.cards(content, {'C1': {'K1'}, 'QUIZ': {'K2'}, 'LIVE': {'S1'}})[0]
        self.assertEqual(card['ksbProgress']['completed'], 1)
        self.assertEqual(card['ksbProgress']['total'], 3)
        self.assertEqual(card['ksbProgress']['percent'], 33.33)

    def test_unknown_mappings_are_unavailable_instead_of_a_partial_hundred_percent(self):
        items = [dict(component={'componentId': 'C1'}, completed=True),
                 dict(component={'componentId': 'UNKNOWN'}, completed=False)]
        result = ksbs.card_ksb_progress(items, {'C1': {'K1'}})
        self.assertEqual(result['status'], 'unavailable')
        self.assertIsNone(result['percent'])
        self.assertEqual(result['unmappedActivities'], 1)
        self.assertEqual(result['mappedTotal'], 1)
        self.assertEqual(ksbs.card_ksb_progress(items[:1], {'C1': set()})['status'], 'empty')

    def test_historical_material_and_quiz_with_same_number_have_separate_points(self):
        items = [dict(activity_id='catalogue:50:material:7', completed=True),
                 dict(activity_id='catalogue:50:quiz:7', completed=False)]
        result = ksbs.card_ksb_progress(items, {
            'catalogue:50:material:7': {'K1'}, 'catalogue:50:quiz:7': {'S1', 'S2'},
            'catalogue:51:material:7': {'B1'},
        })
        self.assertEqual(result, {'completed': 1, 'total': 3, 'percent': 33.33, 'status': 'ready'})

    def test_batch_read_preserves_inline_precedence_and_scopes_legacy_codes_to_owned_records(self):
        rows = [dict(component_id='C1', inline_mappings=[{'code': 'K1'}, {'code': 'K1'}],
                     normalized_mappings=[{'code': 'STALE'}]),
                dict(component_id='C2', inline_mappings=[], normalized_mappings=[{'code': 'S1'}])]
        lineage = {('50', 'material:7'): {'10'}, ('51', 'quiz:7'): {'11'}}
        with patch.object(ksbs.canonical, 'query', side_effect=[rows, [
                {'id': 10, 'codes': ['K2']}, {'id': 11, 'codes': ['B1']} ]]) as query, \
                patch.object(ksbs, 'and_not_excluded', return_value=' AND excluded_ksbs_are_ignored'):
            result = ksbs.read_card_ksb_mappings({'id': 9}, native([component('C1'), component('C2')]), lineage)
        self.assertEqual(result, {'C1': {'K1'}, 'C2': {'S1'},
            'catalogue:50:material:7': {'K2'}, 'catalogue:51:quiz:7': {'B1'}})
        self.assertEqual(query.call_count, 2)
        self.assertEqual(query.call_args_list[0].args[1], [['C1', 'C2']])
        statement, params = query.call_args_list[1].args
        self.assertIn('p.learner_id=%s', statement)
        self.assertIn('p.deleted_at IS NULL', statement)
        self.assertIn('p.id=ANY(%s)', statement)
        self.assertIn('excluded_ksbs_are_ignored', statement)
        self.assertEqual(params, [9, [10, 11]])

    def test_empty_scope_performs_no_database_reads(self):
        with patch.object(ksbs.canonical, 'query') as query:
            self.assertEqual(ksbs.read_card_ksb_mappings({'id': 9}, native(), {}), {})
        query.assert_not_called()
