"""Replacement cards and navigation; persistence and external services are mocked."""
from collections import defaultdict
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase

from . import canonical_learning as canonical, my_learning as learning
from .tests_my_learning_no_db import component, fake_connections, metadata, native
from .tests_progress_transfer_no_db import item, saved


class ReplacementVisibilityTests(SimpleTestCase):
    def fixture(self, *, imported=False, status=None, owned=True, ambiguous=False):
        content = native([
            component('READ', component='Current reading'),
            component('VIDEO', type='video'),
            component('QUIZ', type='quiz', isQuiz=True, quizMeta={'quizId': 12}),
        ], id='7', week=[])
        content['modules'] = ['Same course title']
        for row in content['components']:
            row['module'] = 'Same course title'
        content['componentProgress'] = [{'componentId': 'READ', 'kind': 'component'}]
        content['quizAttempts'] = [{'componentId': 'QUIZ', 'quizId': 12, 'passed': False}]
        meta = metadata()
        meta['current_subjects'][0]['title'] = 'Same course title'
        meta['imported_courses' if imported else 'replacement_courses'] = {'current:M1': 'legacy:50'}
        meta['replacement_settings'] = {'READ': {'legacySettings': {'sourceLessonId': 7}}}
        meta['modules'] = {'M1': {'id': 'M1', 'title': 'Same course title', 'total_otjh': 10}}
        courses = [{'id': 3, 'source_course_ref': '50', 'source_course_title': 'Same course title',
                    'curriculum_module_ref': 'M1'}] if owned else []
        definitions = [{'source_course_ref': '50', 'source_activity_id': ref,
                        'source_activity_title': title, 'source_activity_type': 'reading'}
                       for ref, title in [('material:7', 'Previous reading'),
                                          ('material:8', 'Previous unfinished reading')]] if owned else []
        records = [{'id': 1, 'module_ref': '50', 'accepted': True, 'actual_seconds': 3600},
                   {'id': 2, 'module_ref': 'M1', 'accepted': True, 'actual_seconds': 1800}]
        if ambiguous:
            meta['replacement_courses']['current:M2'] = 'legacy:50'
            meta['current_subjects'].append({'id': 'M2', 'title': 'Another course'})
            other = component('OTHER', module='M2')
            other['module'] = 'Another course'
            content['components'].append(other)
        if status:
            meta['progress_transfers'] = saved(status, [item(matchedComponents={})])['items']
        assigned = [{'moduleId': row['id'], 'moduleTitle': row['title']}
                    for row in meta['current_subjects']]
        return (assigned, [row['moduleId'] for row in assigned], records, content, courses,
                definitions, {('50', 'material:7')} if owned else set(), set(),
                defaultdict(float, {'50': 1}), meta, [])

    @contextmanager
    def readers(self, context):
        from . import (builder_activity_dates, course_catalogue_display, dashboard_training,
                       live_session_progress, my_learning_activity, subject_store,
                       teams_attendance, training_plan_dashboard, weekly_learning)
        source = SimpleNamespace(pk=7, id=7, email='learner@example.test', cohort='', group='',
                                 _case_file_profile=SimpleNamespace(pk=9))
        owner = {'id': 9, 'name': 'Synthetic learner'}
        original = deepcopy(context)
        with ExitStack() as stack:
            stack.enter_context(patch.object(learning, 'load_context', side_effect=lambda *a, **kw: deepcopy(context)))
            stack.enter_context(patch.object(learning, 'connections', fake_connections()))
            stack.enter_context(patch.object(learning, 'journal_enabled', return_value=True))
            stack.enter_context(patch.object(canonical, 'query', return_value=[]))
            stack.enter_context(patch.object(canonical, 'programme_planned_hours', return_value=10))
            stack.enter_context(patch.object(course_catalogue_display, 'read_export_placements', return_value=[]))
            stack.enter_context(patch.object(subject_store, 'covers_for', return_value={}))
            stack.enter_context(patch.object(my_learning_activity, 'card_teaching_activity', return_value={}))
            stack.enter_context(patch.object(training_plan_dashboard, '_canonical_module_progress',
                                            return_value={'M1': {'hours': {'actual': .5}}}))
            stack.enter_context(patch.object(weekly_learning, 'build_learning_content_summary',
                side_effect=lambda *a, **kw: deepcopy(context[3]) if kw['assigned_modules'] else native([], id='7', week=[])))
            history = stack.enter_context(patch.object(canonical, 'source_subjects', return_value={
                'subjects': [{'id': 50, 'name': 'Same course title'}], 'activities': []}))
            stack.enter_context(patch.object(dashboard_training, 'module_rows', return_value=context[9]['modules']))
            stack.enter_context(patch.object(training_plan_dashboard, 'plan_sessions', return_value=[]))
            stack.enter_context(patch.object(live_session_progress, 'read_live_credits', return_value=[]))
            stack.enter_context(patch.object(teams_attendance, 'annotate_attendance_completion',
                                            side_effect=lambda rows, *a: rows))
            stack.enter_context(patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value={}))
            yield source, owner, history
        self.assertEqual(context, original, 'Display reads must preserve progress, plans and transfer snapshots.')

    def test_catalogue_exposes_current_completion_and_keeps_previous_progress_separate(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), self.readers(self.fixture()) as (source, owner, _):
                result = learning.read_catalogue(source, kind, owner)
            cards = {card['id']: card for card in result['modules']}
            self.assertEqual(set(cards), {'current:M1', 'legacy:50'})
            self.assertEqual(result['summary']['current'],
                             {'subjects': 1, 'total': 3, 'completed': 1, 'percent': 33.33})
            self.assertEqual(result['summary']['previous'],
                             {'subjects': 1, 'total': 2, 'completed': 1, 'percent': 50})
            self.assertEqual(result['summary']['subjectCount'], 1)
            self.assertEqual(cards['legacy:50']['previousLearningFor'], 'current:M1')
            self.assertEqual(cards['current:M1']['source'], 'current')
            self.assertEqual((cards['current:M1']['actualHours'], cards['legacy:50']['actualHours']), (.5, 1))
            self.assertEqual(result['otjh'], {'actual': 1.5, 'planned': 10})
            self.assertNotIn('transferredProgress', cards['current:M1'])
            self.assertFalse(cards['current:M1']['finalTestPassed'])

    def test_current_activity_search_returns_the_current_card(self):
        with self.readers(self.fixture()) as (source, owner, _):
            result = learning.read_search(source, owner, 'current reading', 0)
        self.assertEqual(result, {'matches': [{'id': 'current:M1'}], 'nextOffset': None})

    def test_pending_snapshot_and_approved_transfer_behaviour_are_preserved(self):
        for status in ('pending', 'approved'):
            with self.subTest(status=status), self.readers(self.fixture(status=status)) as (source, owner, _):
                result = learning.read_catalogue(source, 'commercial', owner)
            cards = {card['id']: card for card in result['modules']}
            self.assertEqual(cards['current:M1']['completedActivityCount'], 1)
            if status == 'pending':
                self.assertTrue(cards['legacy:50']['transferPending'])
                self.assertEqual((cards['legacy:50']['progress'], cards['legacy:50']['actualHours']), (40, 2))
            else:
                self.assertEqual(set(cards), {'current:M1'})
                self.assertEqual(cards['current:M1']['transferredProgress'], 40)

    def test_imported_courses_keep_the_existing_single_catalogue(self):
        with self.readers(self.fixture(imported=True)) as (source, owner, _):
            result = learning.read_catalogue(source, 'apprenticeship', owner)
        self.assertEqual([card['id'] for card in result['modules']], ['legacy:50'])
        self.assertEqual(result['summary']['current']['total'], 0)

    def test_unowned_or_ambiguous_replacements_never_group_by_title(self):
        for options, expected in (({'owned': False}, {'current:M1'}),
                                  ({'ambiguous': True}, {'current:M1', 'current:M2', 'legacy:50'})):
            with self.subTest(options=options), self.readers(self.fixture(**options)) as (source, owner, _):
                result = learning.read_catalogue(source, 'commercial', owner)
            self.assertEqual({card['id'] for card in result['modules']}, expected)
            self.assertTrue(all('previousLearningFor' not in card for card in result['modules']))

    def test_shared_aggregate_default_still_preserves_transfer_and_directory_population(self):
        context = self.fixture()
        with self.readers(context):
            cards, summary = learning.assemble_cards(context[3], context[9]['current_subjects'],
                context[4], context[5], context[6], context[7], context[8], context[9],
                context[2], context[9]['modules'], context[10])
        self.assertEqual([card['id'] for card in cards], ['legacy:50'])
        self.assertEqual(summary['current']['total'], 0)

    def test_opening_replacement_current_card_keeps_native_content_and_progress(self):
        for kind in ('commercial', 'apprenticeship'):
            for selected in ('current:M1', 'M1', 'activity:READ'):
                for status in (None, 'pending'):
                    with self.subTest(kind=kind, selected=selected, status=status), \
                            self.readers(self.fixture(status=status)) as (source, owner, history):
                        result = learning.read_module(source, kind, owner, selected)
                        history.assert_not_called()
                    self.assertEqual(result['subjectId'], 'current:M1')
                    self.assertIsNone(result['activity'])
                    self.assertEqual(len(result['detail']['components']), 3)
                    self.assertEqual(result['detail']['componentProgress'],
                                     [{'componentId': 'READ', 'kind': 'component'}])
                    self.assertTrue(all('previousLearning' not in row for row in result['detail']['components']))

    def test_previous_course_link_still_opens_owned_history_and_pending_snapshot(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), self.readers(self.fixture(status='pending')) as (source, owner, history):
                result = learning.read_module(source, kind, owner, 'legacy:50')
                self.assertEqual(history.call_args.kwargs['course_ids'], ['50'])
            self.assertEqual(result['subjectId'], 'legacy:50')
            self.assertEqual(result['detail']['components'], [])
            self.assertTrue(result['metadata']['module_credits']['legacy:50']['transferPending'])
