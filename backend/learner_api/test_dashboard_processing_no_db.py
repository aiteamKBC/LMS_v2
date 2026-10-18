"""Dashboard lookup regressions; synthetic facts, no database access."""
from django.test import SimpleTestCase
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from .dashboard_monthly import display_subjects
from .dashboard_overview import overview_subjects


class DashboardLookupTests(SimpleTestCase):
    def test_overview_component_identity_is_scoped_to_module(self):
        from . import dashboard_overview as overview
        subjects = [{'id': 'current:' + mid, 'moduleId': mid, 'activities': [
            {'id': 'C', 'nativeRefs': ['C']}]} for mid in ('M1', 'M2')]
        learning = {'activity': None, 'metadata': {'builder_subjects': {}}, 'detail': {
            'components': [{'componentId': 'C', 'moduleId': mid, 'isQuiz': True,
                            'quizMeta': {'quizId': quiz}} for mid, quiz in [('M1', 1), ('M2', 2)]],
            'quizAttempts': [{'quizId': 1, 'passed': True}]}}
        with patch.object(overview, 'display_subjects', return_value=subjects):
            result = overview.overview_subjects(learning)
        self.assertEqual([s['activities'][0]['completed'] for s in result], [True, False])

    def test_presentation_does_not_query_week_existence(self):
        from . import dashboard_header as header
        db = MagicMock()
        cur = db.cursor.return_value.__enter__.return_value
        with patch.object(header, 'connections', {'enrolment': db}), \
             patch.object(header, '_effective_plan_ids', return_value=['M']), \
             patch.object(header.canonical_learning, 'curriculum_module_ids_for', return_value=[]), \
             patch.object(header, 'rows', return_value=[]):
            header.dashboard_modules(SimpleNamespace(), {}, include_week_counts=False)
        self.assertNotIn('curriculum.weeks', cur.execute.call_args.args[0])
        self.assertIn('curriculum.groups', cur.execute.call_args.args[0])

    def test_weekly_navigation_only_traverses_source_once(self):
        from coach_api.weekly_contract import compact_weekly
        class Once:
            def __init__(self):
                self.read = False
            def __iter__(self):
                if self.read:
                    raise AssertionError('Repeated navigation traversal')
                self.read = True
                yield {'id': 'W', 'moduleId': 'M', 'moduleTitle': 'Module', 'sessionState': 'upcoming'}
        result = compact_weekly(weeks=Once())
        self.assertEqual(result['modules'], [{'id': 'M', 'title': 'Module'}])
        self.assertEqual(result['weeks'][0]['attendance'], 'upcoming')

    def test_monthly_session_indexes_preserve_or_matching_ambiguity_and_offsets(self):
        from .dashboard_monthly import session_titles
        self.assertEqual(session_titles({}, []), {})
        session = {'id': 'S', 'start': '2026-07-01T23:30:00Z', 'title': 'Original'}
        activity = {'title': 'Both', 'category': 'live_session', 'date': '2026-07-02',
                    'sessionInstant': '2026-07-02T00:30:00+01:00'}
        self.assertEqual(session_titles({'activities': [activity]}, [session])['S']['title'], 'Both')
        self.assertEqual(session_titles({'activities': [activity, activity]}, [session])['S']['title'], 'Original')
        naive = {**activity, 'category': 'reading', 'sessionInstant': '2026-07-01T23:30:00'}
        self.assertEqual(session_titles({'activities': [naive]}, [session])['S']['title'], 'Original')
        invalid = {**naive, 'sessionInstant': 'invalid'}
        self.assertEqual(session_titles({'activities': [invalid]}, [session])['S']['title'], 'Original')

    def test_weekly_detail_does_not_traverse_unreturned_module_navigation(self):
        from coach_api.weekly_contract import compact_weekly
        class UnreadNavigation:
            def __iter__(self):
                raise AssertionError('Detail must not build the module navigator')
        self.assertEqual(compact_weekly(), {'modules': [], 'weeks': [], 'selectedWeek': None})

    def test_header_review_ties_preserve_first_source_row_and_booking_precedence(self):
        from datetime import datetime, timezone
        from .dashboard_header import next_review
        now = datetime(2026, 10, 17, tzinfo=timezone.utc)
        base = {'id': 'R', 'source': 'mcr', 'status': 'scheduled', 'date': '2026-10-20'}
        first = {**base, 'title': 'First'}
        self.assertEqual(next_review([first, {**base, 'title': 'Second'},
                                      {**base, 'scheduledDate': '2026-10-21'}], now), [first])

    def test_monthly_assignment_top_two_keep_stable_ties_and_exclude_ambiguous_dates(self):
        from .dashboard_monthly_v2 import assignment_rows
        activities = [{'id': str(i), 'title': 'Same', 'category': 'assignment', 'date': '2026-10-20'}
                      for i in range(5)]
        subjects = [{'id': 'legacy:1', 'title': 'Imported', 'activities': [
            {**activities[0], 'id': 'ambiguous', 'date': '2026-10-01', 'needsReview': True}, *activities]}]
        result = assignment_rows({}, subjects, '2026-10', 'commercial', 1)
        self.assertEqual([r['id'] for r in result], ['legacy:1:0', 'legacy:1:1'])

    def test_training_session_title_requires_one_live_activity_on_business_day(self):
        from . import dashboard_training as training
        activities = [
            {'id': 'one', 'title': 'Unique', 'category': 'live_session', 'date': '2026-07-02', 'completed': False},
            {'id': 'two', 'title': 'Ambiguous A', 'category': 'live_session', 'date': '2026-07-03', 'completed': False},
            {'id': 'three', 'title': 'Ambiguous B', 'category': 'live_session', 'date': '2026-07-03', 'completed': False},
            {'id': 'other', 'title': 'Reading', 'category': 'reading', 'date': '2026-07-02', 'completed': False}]
        subject = {'id': 'current:M', 'activities': activities}
        selected = {'id': 'current:M', 'title': 'Module', 'moduleId': 'M', 'start': '2026-07-02',
                    'end': '2026-07-03', 'dates': [], '_subject': subject}
        sessions = [{'id': 's1', 'title': 'Original 1', 'start': '2026-07-01T23:30:00Z'},
                    {'id': 's2', 'title': 'Original 2', 'start': '2026-07-03T09:00:00Z'}]
        with patch.object(training, 'connections', {'enrolment': MagicMock()}), \
             patch.object(training.schedule, 'plan_sessions', return_value=sessions), \
             patch.object(training.schedule, '_canonical_module_progress', return_value={}):
            result = training.selected_detail(SimpleNamespace(email='synthetic@example.test'), {}, None, [],
                                              selected, {}, {}, facts=([subject], {}), metadata={})
        self.assertEqual([s['title'] for s in result['sessions']], ['Unique', 'Original 2'])

    def test_training_quiz_indexes_keep_existing_truthy_pass_semantics(self):
        from . import dashboard_training as training, weekly_learning, student_activity_access, student_activity, builder_activity_dates
        native = {'components': [
            {'componentId': 'C1', 'moduleId': 'M', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 7}},
            {'componentId': 'C2', 'moduleId': 'M', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 8}},
            {'componentId': 'C3', 'moduleId': 'M', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 9}}],
            'quizAttempts': [{'quizId': '7', 'passed': 1}, {'quizId': 8, 'passed': False},
                             {'componentId': 'C3', 'quizId': 99, 'passed': True}]}
        source = SimpleNamespace(pk=265, aptem_id=None)
        with patch.object(training, 'connections', {'enrolment': MagicMock()}), \
             patch.object(weekly_learning, 'build_learning_content_summary', return_value=native), \
             patch.object(student_activity_access, 'student_activity_available', return_value=False), \
             patch.object(student_activity, 'builder_subject_links', return_value={'current:M': {'id': 'M', 'title': 'Native'}}), \
             patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value={}):
            subjects, _ = training.learning_facts(source, {}, None, [], ['M'])
        self.assertEqual({a['id']: a['completed'] for s in subjects for a in s['activities']},
                         {'C1': True, 'C2': False, 'C3': True})

    def test_first_legacy_placement_and_native_duplicate_order_remain_stable(self):
        learning = {'activity': {'subjects': [{'id': 1, 'name': 'Legacy'}], 'activities': [
            {'group_id': 1, 'activity_id': 'A', 'source_activity_id': 7, 'activity': 'First'},
            {'group_id': 1, 'activity_id': 'A', 'source_activity_id': 8, 'activity': 'Duplicate'},
            {'group_id': 1, 'activity_id': 'B', 'source_activity_id': 7, 'activity': 'Second'}],
            'activity_sources': {'C': {'group_id': 1, 'activity_id': 7, 'module_id': 'M'}}},
            'metadata': {'builder_subjects': {'legacy:1': {'id': 'M', 'title': 'Legacy'}}},
            'detail': {'components': [{'componentId': 'C', 'moduleId': 'M', 'module': 'Legacy',
                'sessionDate': '2026-10-01', 'ksbMappings': [{'code': 'K1'}]},
                {'componentId': 'C', 'moduleId': 'M', 'module': 'Legacy',
                'sessionDate': '2026-10-02', 'ksbMappings': [{'code': 'K2'}]}],
                'modules': ['LEGACY', 'Unlinked', ' unlinked ']}}
        subjects = display_subjects(learning)
        legacy = next(s for s in subjects if s['id'] == 'legacy:1')
        self.assertEqual([a['id'] for a in legacy['activities']], ['A', 'B'])
        self.assertEqual(legacy['activities'][0]['title'], 'First')
        self.assertEqual(legacy['activities'][0]['nativeRefs'], ['C', 'C'])
        self.assertEqual(legacy['activities'][0]['ksbs'], ['K2'])
        self.assertEqual(legacy['activities'][1]['ksbs'], [])
        self.assertEqual(len(subjects), 2)

    def test_overview_quiz_indexes_preserve_strict_pass_and_identifier_rules(self):
        learning = {'activity': None, 'metadata': {'builder_subjects': {}}, 'detail': {
            'components': [
                {'componentId': 'C1', 'moduleId': 'M', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 7}},
                {'componentId': 'C2', 'moduleId': 'M', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 8}},
                {'componentId': 'C3', 'moduleId': 'M', 'module': 'Native', 'isQuiz': True, 'quizMeta': {'quizId': 9}},
                {'componentId': 'C4', 'moduleId': 'M', 'module': 'Native', 'isQuiz': True}],
            'quizAttempts': [{'quizId': '7', 'passed': True}, {'quizId': 8, 'passed': 1},
                             {'componentId': 'C3', 'quizId': 99, 'passed': True},
                             {'quizId': None, 'passed': True}]}}
        subjects = overview_subjects(learning)
        self.assertEqual({a['id']: a['completed'] for s in subjects for a in s['activities']},
                         {'C1': True, 'C2': False, 'C3': True, 'C4': False})
