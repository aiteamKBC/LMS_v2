"""Request-scoped reuse inside one Dashboard tab read; every DB connection is forbidden."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase


class PresetCacheTests(SimpleTestCase):
    def learner(self, **extra):
        return SimpleNamespace(programme='Programme', group='G1', training_plan=None, learning_plan=None, **extra)

    def test_installed_cache_reads_the_group_preset_once(self):
        from . import learning_plan
        source = self.learner(_plan_preset_cache={})
        with patch.object(learning_plan, '_group_module_ids', return_value=['M1', 'M2']) as preset:
            first = learning_plan._effective_plan_ids(source, learning_plan.request_preset_cache(source))
            second = learning_plan._effective_plan_ids(source, learning_plan.request_preset_cache(source))
        preset.assert_called_once_with('Programme', 'G1')
        self.assertEqual(first, ['M1', 'M2'])
        self.assertEqual(second, first)
        # Callers receive copies; mutating one result cannot change the cache.
        first.append('M3')
        self.assertEqual(source._plan_preset_cache[('Programme', 'G1')], ['M1', 'M2'])

    def test_without_an_installed_cache_each_resolution_is_independent(self):
        from . import learning_plan
        source = self.learner()
        with patch.object(learning_plan, '_group_module_ids', return_value=['M1']) as preset:
            learning_plan._effective_plan_ids(source, learning_plan.request_preset_cache(source))
            learning_plan._effective_plan_ids(source, learning_plan.request_preset_cache(source))
        self.assertEqual(preset.call_count, 2)
        self.assertFalse(hasattr(source, '_plan_preset_cache'))

    def test_shared_plan_readers_use_the_request_cache(self):
        from . import training_plan_dashboard, weekly_learning
        cache = {}
        source = self.learner(_plan_preset_cache=cache, id=265, cohort='', pk=265)
        cursor = MagicMock()
        with patch.object(training_plan_dashboard, '_effective_plan_ids', return_value=[]) as resolve, \
             patch.object(training_plan_dashboard, '_builder_subject_metadata', return_value=({}, {})):
            training_plan_dashboard.plan_module_ids(cursor, source, None)
        self.assertIs(resolve.call_args.args[1], cache)
        with patch.object(weekly_learning, 'effective_training_plan', side_effect=RuntimeError('stop')) as plan:
            with self.assertRaises(RuntimeError):
                weekly_learning.build_learning_content_summary(source, 265, learning_summary=True)
        self.assertIs(plan.call_args.args[1], cache)

    def test_tab_dispatch_installs_a_fresh_cache_for_each_request(self):
        from . import dashboard_tabs, dashboard_monthly, identity
        source = SimpleNamespace(pk=265, _plan_preset_cache={('stale', 'G1'): ['OLD']},
                                 _builder_link_cache={'current:OLD': {'id': 'OLD', 'title': 'Stale'}})
        with patch.object(dashboard_tabs.canonical, 'require_profile', return_value={'id': 17}), \
             patch.object(identity, 'learner_profile_for_source', return_value=SimpleNamespace(pk=17, enrolment_id=265)), \
             patch.object(dashboard_monthly, 'read_monthly',
                          side_effect=lambda s, *a: [dict(s._plan_preset_cache), dict(s._builder_link_cache)]) as read:
            self.assertEqual(dashboard_tabs.read_tab(source, 'commercial', 'monthly', object()), [{}, {}])
        read.assert_called_once()


class BuilderLinkReuseTests(SimpleTestCase):
    rows = {'current:M1': {'id': 'M1', 'title': 'One'}, 'current:M2': {'id': 'M2', 'title': 'Two'},
            'current:M3': {'id': 'M3', 'title': 'Three'}}

    def reader(self):
        return MagicMock(side_effect=lambda cursor, refs: ({}, {ref: dict(self.rows[ref]) for ref in refs if ref in self.rows}))

    def test_overlapping_reads_query_only_unresolved_refs(self):
        from .student_activity import builder_subject_links
        read, source = self.reader(), SimpleNamespace(_builder_link_cache={})
        plan = builder_subject_links(object(), source, ['current:M1', 'current:M2', 'current:GONE'], read=read)
        learning = builder_subject_links(object(), source, ['current:M2', 'current:M1', 'current:M3', 'current:GONE'], read=read)
        self.assertEqual([call.args[1] for call in read.call_args_list],
                         [['current:M1', 'current:M2', 'current:GONE'], ['current:M3']])
        self.assertEqual(plan, {key: self.rows[key] for key in ('current:M1', 'current:M2')})
        self.assertEqual(learning, {key: self.rows[key] for key in ('current:M2', 'current:M1', 'current:M3')})
        # A missing module stays missing without another read, and callers get copies.
        self.assertNotIn('current:GONE', learning)
        learning['current:M1']['title'] = 'Changed'
        self.assertEqual(builder_subject_links(object(), source, ['current:M1'], read=read)['current:M1']['title'], 'One')
        self.assertEqual(read.call_count, 2)

    def test_fully_resolved_refs_do_not_query_and_uncached_callers_read_once(self):
        from .student_activity import builder_subject_links
        read, source = self.reader(), SimpleNamespace(_builder_link_cache={})
        builder_subject_links(object(), source, ['current:M1'], read=read)
        builder_subject_links(object(), source, ['current:M1', 'current:M1'], read=read)
        read.assert_called_once()
        plain = self.reader()
        self.assertEqual(builder_subject_links(object(), SimpleNamespace(), ['current:M1'], read=plain),
                         {'current:M1': self.rows['current:M1']})
        builder_subject_links(object(), SimpleNamespace(), ['current:M1'], read=plain)
        self.assertEqual(plain.call_count, 2)

    def test_overview_plan_then_learning_reads_module_titles_once(self):
        from . import dashboard_tabs, training_plan_dashboard, weekly_learning, student_activity_access, \
            builder_activity_dates, learning_plan, student_activity, canonical_learning
        source = SimpleNamespace(pk=265, aptem_id=None, _plan_preset_cache={}, _builder_link_cache={})
        read = self.reader()
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        with patch.object(training_plan_dashboard, '_effective_plan_ids', return_value=['M1', 'M2']), \
             patch.object(learning_plan, '_effective_plan_ids', return_value=['M1', 'M2']), \
             patch.object(canonical_learning, 'curriculum_module_ids_for', return_value=[]), \
             patch.object(training_plan_dashboard, '_builder_subject_metadata', read), \
             patch.object(student_activity, '_builder_subject_metadata', read), \
             patch.object(weekly_learning, 'build_learning_content_summary', return_value={'components': [{'moduleId': 'M2'}]}), \
             patch.object(student_activity_access, 'student_activity_available', return_value=False), \
             patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value={}), \
             patch.object(dashboard_tabs, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}):
            ids, links = training_plan_dashboard.plan_module_ids(cursor, source, {'id': 17})
            learning = dashboard_tabs.learning_projection(source, {'id': 17}, [])
        read.assert_called_once()
        self.assertEqual(ids, ['M1', 'M2'])
        self.assertEqual(links, {key: self.rows[key] for key in ('current:M1', 'current:M2')})
        self.assertEqual(learning['metadata']['current_subjects'], [self.rows['current:M1'], self.rows['current:M2']])
        self.assertEqual(learning['metadata']['builder_subjects'], links)


class BuilderDatesReuseTests(SimpleTestCase):
    def read(self, source, subject_ids, **flags):
        from . import overview_week
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [(module_id, 'Title') for module_id in subject_ids]
        with patch.object(overview_week, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(overview_week, '_direct_progress_records', return_value=[]), \
             patch.object(overview_week, 'rows', return_value=[]), \
             patch.object(overview_week, 'read_builder_activity_dates', return_value={'fresh': {}}) as dates, \
             patch.object(overview_week, 'summarise_plan', return_value=[]), \
             patch.object(overview_week, 'monthly_otjh_summary', return_value={}), \
             patch.object(overview_week, 'direct_hours_by_subject', return_value={}):
            overview_week.read_week(source, **flags)
        return dates

    def test_monthly_fallback_reuses_dates_for_the_identical_module_set(self):
        shared = {'C1': {'date': '2026-11-02'}}
        source = SimpleNamespace(pk=265, _case_file_profile=object(), _dashboard_activity_dates=({'M1', 'M2'}, shared))
        dates = self.read(source, ['M2', 'M1'], plan_only=True)
        dates.assert_not_called()
        self.assertIs(source._dashboard_activity_dates[1], shared)

    def test_a_different_module_set_is_read_again(self):
        source = SimpleNamespace(pk=265, _case_file_profile=object(), _dashboard_activity_dates=({'M1'}, {'C1': {}}))
        dates = self.read(source, ['M1', 'M2'], plan_only=True)
        dates.assert_called_once()
        self.assertEqual(source._dashboard_activity_dates, ({'M1', 'M2'}, {'fresh': {}}))

    def test_other_read_week_modes_never_reuse_dashboard_dates(self):
        source = SimpleNamespace(pk=265, _case_file_profile=object(), _dashboard_activity_dates=({'M1'}, {'C1': {}}))
        with patch('learner_api.overview_week.summarise_week', return_value={}):
            dates = self.read(source, ['M1'])
        dates.assert_called_once()

    def test_learning_projection_publishes_the_dates_it_reads(self):
        from . import dashboard_tabs, weekly_learning, student_activity_access, builder_activity_dates, learning_plan, student_activity
        source = SimpleNamespace(pk=265, aptem_id=None, _plan_preset_cache={})
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        read = {'C1': {'date': '2026-11-02'}}
        with patch.object(weekly_learning, 'build_learning_content_summary', return_value={'components': []}), \
             patch.object(student_activity_access, 'student_activity_available', return_value=False), \
             patch.object(learning_plan, '_effective_plan_ids', return_value=['M1']), \
             patch.object(student_activity, '_builder_subject_metadata', return_value=({}, {})), \
             patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value=read) as dates, \
             patch.object(dashboard_tabs, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}):
            first = dashboard_tabs.learning_projection(source, {'id': 17}, [])
            second = dashboard_tabs.learning_projection(source, {'id': 17}, [])
        dates.assert_called_once()
        self.assertEqual(source._dashboard_activity_dates, ({'M1'}, read))
        self.assertIs(first['metadata']['activity_dates'], second['metadata']['activity_dates'])


class MonthlyFallbackModeTests(SimpleTestCase):
    """Monthly's no-target fallback reads only monthly OTJH, never plan subjects."""
    native = [{'id': 'C1', 'module_id': 'M1', 'title': 'Read', 'type': 'reading', 'quiz_id': None,
               'expected_hours': 2, 'section_title': '', 'ksb_mappings': [{'code': 'K1'}]},
              {'id': 'C2', 'module_id': 'M1', 'title': 'Quiz', 'type': 'quiz', 'quiz_id': 9,
               'expected_hours': None, 'section_title': '', 'ksb_mappings': []}]
    dates = {'C1': {'date': '2026-11-03', 'date_needs_review': False},
             'C2': {'date': '2026-12-01', 'date_needs_review': False}}
    progress = [{'componentId': 'C1', 'kind': 'reading', 'passed': True, 'submittedAt': '2026-11-04T10:00:00Z',
                 'actualSeconds': 3600, 'accepted': True}]

    def read(self, **flags):
        from . import overview_week
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [('M1', 'Module')]
        with patch.object(overview_week, 'connections', {'enrolment': SimpleNamespace(cursor=lambda: cursor)}), \
             patch.object(overview_week, '_direct_progress_records', return_value=[dict(r) for r in self.progress]), \
             patch.object(overview_week, 'rows', side_effect=lambda cur: [dict(r) for r in self.native]), \
             patch.object(overview_week, 'read_builder_activity_dates', return_value=self.dates):
            result = overview_week.read_week(SimpleNamespace(pk=265, _case_file_profile=object()), **flags)
        return result, cursor

    def test_monthly_hours_mode_matches_the_plan_mode_summary_without_ksb_lookups(self):
        plan, plan_cursor = self.read(plan_only=True)
        hours, hours_cursor = self.read(monthly_hours_only=True)
        self.assertEqual(hours, plan['monthlyOtjh'])
        self.assertIn('2026-11', hours)
        self.assertIn('curriculum.ksb_mappings', plan_cursor.execute.call_args_list[1].args[0])
        self.assertNotIn('curriculum.ksb_mappings', hours_cursor.execute.call_args_list[1].args[0])

    def test_monthly_reader_requests_only_the_monthly_hours_mode(self):
        from .test_dashboard_monthly_no_db import MonthlyProjectionTests
        fixture = MonthlyProjectionTests('test_exact_payload_and_selected_month_queries_without_week')
        result, *_rest, week = fixture.fixture('?month=2026-11', targets={}, fallback={'2026-11': {'planned': 3, 'actual': 1}})
        week.assert_called_once()
        self.assertEqual(week.call_args.kwargs, {'monthly_hours_only': True})
        self.assertEqual(result['summary']['requiredHours'], 3)
        self.assertEqual(result['summary']['achievedHours'], 1)


class TrainingTitleReuseTests(SimpleTestCase):
    builder = {f'current:{mid}': {'id': mid, 'title': title} for mid, title in (('M1', 'One'), ('M2', 'Two'))}
    detail = {'modules': ['One', 'Two'], 'components': [
        {'moduleId': 'M2', 'module': 'Two', 'componentId': 'C2', 'component': 'Read', 'type': 'reading', 'ksbMappings': []}],
        'quizAttempts': [], 'videoProgress': [], 'componentProgress': [], 'retiredQuizComponents': []}

    def facts(self, source):
        from . import dashboard_training as training, weekly_learning, student_activity_access, student_activity, builder_activity_dates
        read = MagicMock(side_effect=lambda cursor, refs: ({}, {r: dict(self.builder[r]) for r in refs if r in self.builder}))
        with patch.object(training, 'connections', {'enrolment': MagicMock()}), \
             patch.object(weekly_learning, 'build_learning_content_summary', side_effect=lambda *a, **k: {**self.detail}), \
             patch.object(student_activity_access, 'student_activity_available', return_value=False), \
             patch.object(student_activity, '_builder_subject_metadata', read), \
             patch.object(builder_activity_dates, 'read_builder_activity_dates', return_value={}):
            timeline = training.learning_facts(source, {}, None, [], ['M1', 'M2'])
            selected = training.learning_facts(source, {}, None, [], ['M2'], selected=True, subject_id='current:M2')
        return timeline, selected, read

    def test_timeline_and_selected_module_read_titles_once_with_identical_results(self):
        cached = SimpleNamespace(pk=265, aptem_id=None, _training_module_ids=['M1', 'M2'], _builder_link_cache={})
        plain = SimpleNamespace(pk=265, aptem_id=None, _training_module_ids=['M1', 'M2'])
        *with_cache, read = self.facts(cached)
        *without_cache, plain_read = self.facts(plain)
        read.assert_called_once()
        self.assertEqual(plain_read.call_count, 2)
        self.assertEqual(with_cache, without_cache)

    def test_selected_module_endpoint_installs_fresh_request_caches(self):
        import os
        from . import dashboard_training as training, identity, case_file_sources
        from login import permissions
        source = SimpleNamespace(pk=265, _plan_preset_cache={('stale', 'G'): ['OLD']}, _builder_link_cache={'current:OLD': {}})
        seen = []
        with patch.dict(os.environ, {'LEARNER_API_REQUIRE_AUTH': '1'}), \
             patch.object(permissions, 'authenticate_request', return_value=SimpleNamespace(role='learner', subject_id=265)), \
             patch.object(case_file_sources, 'source_for_case_file', return_value=source), \
             patch.object(identity, 'learner_profile_for_source', return_value=SimpleNamespace(pk=8, enrolment_id=265)), \
             patch.object(training.canonical, 'require_profile', return_value={'id': 8}), \
             patch.object(training, 'read_training', side_effect=lambda s, *a: seen.append(
                 (dict(s._plan_preset_cache), dict(s._builder_link_cache))) or {'id': 'current:M1'}):
            from django.test import RequestFactory
            response = training.training_module(RequestFactory().get('/module/'), kind='commercial', pk=265, module_id='current:M1')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(seen, [({}, {})])


class TrainingDatesReuseTests(SimpleTestCase):
    def test_same_scope_reuses_dates_but_different_scope_and_learner_do_not(self):
        from . import dashboard_training as training, weekly_learning, student_activity_access, student_activity, builder_activity_dates
        source = SimpleNamespace(pk=265, aptem_id=None)
        dates = MagicMock(side_effect=[{'C1': {'date': '2026-10-01'}}, {}, {}])
        with patch.object(training, 'connections', {'enrolment': MagicMock()}), \
             patch.object(weekly_learning, 'build_learning_content_summary', return_value={'components': []}), \
             patch.object(student_activity_access, 'student_activity_available', return_value=False), \
             patch.object(student_activity, 'builder_subject_links', return_value={}), \
             patch.object(builder_activity_dates, 'read_builder_activity_dates', dates):
            first = training.learning_facts(source, {}, None, [], ['M1', 'M2'])
            repeated = training.learning_facts(source, {}, None, [], ['M2', 'M1'])
            self.assertEqual(dates.call_count, 1)
            self.assertEqual(first, repeated)
            training.learning_facts(source, {}, None, [], ['M1'])
            training.learning_facts(SimpleNamespace(pk=266, aptem_id=None), {}, None, [], ['M1'])
        self.assertEqual(dates.call_count, 3)

    def test_request_initialization_discards_prior_training_dates(self):
        from .dashboard_tabs import install_request_caches
        source = SimpleNamespace(_training_activity_dates=(frozenset(['OLD']), {'C': {}}))
        install_request_caches(source)
        self.assertIsNone(source._training_activity_dates)
