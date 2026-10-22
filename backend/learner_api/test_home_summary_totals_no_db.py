"""Guarded Home totals parity tests. No settings files, DB or network access."""
import sys
from pathlib import Path
sys.path[0] = str(Path(__file__).resolve().parent.parent)
import ast
from contextlib import ExitStack
from copy import deepcopy
from datetime import date, datetime, timezone
import gzip
import json
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, patch


class HomeTotalsTests(unittest.TestCase):
    def test_real_reader_preserves_catalogue_counts_and_skips_unused_work(self):
        from learner_api import canonical_learning as canonical, module_progress, journal_sources
        owner = {'id': 7, 'enrolment_id': 101, 'name': 'Synthetic', 'aptem_id': 1}
        source = SimpleNamespace(pk=101, aptem_id=1)
        profile = SimpleNamespace(pk=7, enrolment_id=101)
        items = [{'activity_id': 'a', 'group_id': 2, 'completed': True},
                 {'activity_id': 'b', 'group_id': 2, 'completed': False}]
        subjects = [{'id': 2, 'name': 'Synthetic catalogue'}]
        calls = []
        real_reader = canonical.source_subjects

        def reader(*args, **kwargs):
            self.assertTrue(journal_sources.enabled())
            calls.append(dict(kwargs))
            return real_reader(args[0], lambda rows: {'activities': rows}, **kwargs)

        with ExitStack() as stack:
            def mock(target, **kwargs):
                return stack.enter_context(patch(target, **kwargs))
            mock('learner_api.canonical_learning.require_profile', return_value=owner)
            mock('learner_api.canonical_learning.owned_source_courses', return_value=[])
            mock('learner_api.course_catalogue_display.read_export_placements', return_value={})
            mock('learner_api.course_catalogue_display.catalogue_display_context', return_value=[])
            entries = mock('learner_api.canonical_learning.entries_for', return_value=[])
            placement = mock('learner_api.canonical_learning.recorded_course_items',
                             return_value=(items, subjects, {}))
            ledger = mock('learner_api.canonical_learning.otjh_activities', return_value=[])
            planned = mock('learner_api.canonical_learning.programme_planned_hours', return_value=100)
            review = mock('coach_api.migrated_otjh.planned_hours_bulk', return_value={101: 2})
            mock('learner_api.canonical_learning.source_subjects', side_effect=reader)
            mock('learner_api.module_progress.read_native_progress',
                 return_value=({'components': [], 'quizAttempts': []}, [], [], {}))
            mock('learner_api.live_session_progress.read_live_credits', return_value=[])
            before = module_progress.canonical_module_progress(source, profile)
            self.assertEqual((ledger.call_count, planned.call_count, review.call_count), (1, 1, 1))
            after = module_progress.canonical_module_progress(source, profile, counts_only=True)
            self.assertEqual(before, after)
            self.assertEqual([(r['completed'], r['total']) for r in after], [(1, 2)])
            self.assertEqual((ledger.call_count, planned.call_count, review.call_count), (1, 1, 1))
            self.assertEqual(entries.call_count, 2)  # No speculative record reuse.
            self.assertEqual(calls, [{'owner': owner}, {'owner': owner,
                'include_totals': False, 'include_ledger': False}])
            for call in placement.call_args_list:
                self.assertEqual(call.kwargs, {'overview_only': False, 'include_catalogue': True})
        self.assertFalse(journal_sources.enabled())

    def test_home_payload_and_encoded_sizes_match_with_corrections(self):
        from learner_api.home_progress import read_home_progress
        source = SimpleNamespace(pk=101, _canonical_profile={'id': 7})
        metrics = {'otjh': {'actual': 4, 'planned': 100}, 'programme': {'status': 'ready'}}
        modules = [{'total': 2, 'completed': 1}]
        with patch('learner_api.home_progress.connections', {'enrolment': MagicMock()}), \
             patch('learner_api.home_progress.rows', return_value=[]), \
             patch('learner_api.home_progress._group_dates', return_value=(date(2026, 1, 1), None, 'learner')), \
             patch('learner_api.home_progress.lecture_register', return_value=[]), \
             patch('learner_api.module_progress.canonical_module_progress', return_value=modules) as reader, \
             patch('learner_api.live_session_progress.read_live_credits', return_value=[
                 {'moduleId': 'M', 'componentId': 'C', 'hours': 2}]), \
             patch('learner_api.canonical_learning.entries_for', return_value=[
                 {'component_ref': 'C', 'accepted': True, 'actual_seconds': 3600,
                  'actual_basis': 'staff:module-progress'}]):
            results = [read_home_progress(source, 'commercial', [], [], [], [('M', 'Module')],
                date(2026, 10, 18), canonical_metrics=deepcopy(metrics), module_counts_only=flag)
                for flag in (False, True)]
        self.assertEqual(results[0], results[1])
        self.assertEqual(results[1]['otjh']['actual'], 4)
        self.assertEqual(results[1]['otjh']['planned'], 100)
        self.assertEqual(results[1]['activities'], {'completed': 1, 'total': 2})
        self.assertEqual(reader.call_args_list[0].kwargs, {})
        self.assertEqual(reader.call_args_list[1].kwargs, {'counts_only': True})
        encoded = [json.dumps(result).encode() for result in results]
        self.assertEqual(encoded[0], encoded[1])
        self.assertEqual(gzip.compress(encoded[0], mtime=0), gzip.compress(encoded[1], mtime=0))
        print('Synthetic Home card bytes: raw=%s gzip=%s (before=after)' %
              (len(encoded[0]), len(gzip.compress(encoded[0], mtime=0))))

    def test_identity_and_reader_failures_remain_visible(self):
        from learner_api import module_progress, canonical_learning, journal_sources
        source, profile = SimpleNamespace(pk=101, aptem_id=1), SimpleNamespace(pk=7, enrolment_id=101)
        for flag in (False, True):
            with patch.object(canonical_learning, 'require_profile', return_value={'id': 99}), \
                 patch.object(canonical_learning, 'source_subjects') as reader:
                with self.assertRaises(module_progress.ServiceError):
                    module_progress.canonical_module_progress(source, profile, counts_only=flag)
                reader.assert_not_called()
            with patch.object(canonical_learning, 'require_profile', return_value={'id': 7}), \
                 patch.object(canonical_learning, 'source_subjects', side_effect=RuntimeError('synthetic')):
                with self.assertRaisesRegex(RuntimeError, 'synthetic'):
                    module_progress.canonical_module_progress(source, profile, counts_only=flag)
                self.assertFalse(journal_sources.enabled())

    def test_complete_summary_json_matches_previous_call_path(self):
        from learner_api import overview_week as week, home_progress as home
        from django.http import JsonResponse
        source = SimpleNamespace(pk=101)
        owner = {'id': 7}
        metrics = {'otjh': {'actual': 4, 'planned': 100}, 'programme': {'status': 'ready'}}
        real_home = home.read_home_progress
        def before(*args, **kwargs):
            kwargs.pop('module_counts_only', None)
            return real_home(*args, **kwargs)
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch.object(week, 'connections', {'enrolment': connection}), \
             patch.object(week.canonical_learning, 'require_profile', return_value=owner), \
             patch.object(week.canonical_learning, 'metrics', return_value=metrics), \
             patch.object(week, '_direct_progress_records', return_value=[]), \
             patch.object(week, 'rows', return_value=[]), \
             patch.object(week, 'read_builder_activity_dates', return_value={}), \
             patch.object(week, '_home_navigation_modules', return_value=[]), \
             patch.object(home, 'connections', {'enrolment': connection}), \
             patch.object(home, 'rows', return_value=[]), \
             patch.object(home, '_group_dates', return_value=(date(2026, 1, 1), None, 'learner')), \
             patch.object(home, 'lecture_register', return_value=[]), \
             patch('learner_api.live_session_progress.read_live_credits', return_value=[]), \
             patch('learner_api.module_progress.canonical_module_progress', return_value=[]) as modules:
            results = []
            for reader in (before, real_home):
                with patch.object(home, 'read_home_progress', side_effect=reader):
                    results.append(week.read_week(source, datetime(2026, 10, 14, tzinfo=timezone.utc),
                                                  home_kind='commercial', home_summary=True))
        self.assertEqual(results[0], results[1])
        self.assertEqual(set(results[1]), {'weekStart', 'weekEnd', 'modules', 'homeProgress'})
        self.assertEqual(modules.call_args_list[0].kwargs, {})
        self.assertEqual(modules.call_args_list[1].kwargs, {'counts_only': True})
        encoded = [JsonResponse(result).content for result in results]
        self.assertEqual(encoded[0], encoded[1])
        self.assertEqual(gzip.compress(encoded[0], mtime=0), gzip.compress(encoded[1], mtime=0))
        print('Synthetic full section bytes: raw=%s gzip=%s (before=after)' %
              (len(encoded[0]), len(gzip.compress(encoded[0], mtime=0))))


def main():
    root = Path(__file__).resolve().parent.parent
    sys.path[0] = str(root)

    allowed_node = None
    def guard(event, args):
        # Only the inspected existing TypeScript calculation oracle may run.
        if event == 'subprocess.Popen' and allowed_node is not None:
            if args[1] == allowed_node and Path(args[2]).resolve() == root.parent:
                return
        if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system'}:
            raise RuntimeError('External IO forbidden')
        if event == 'open' and Path(str(args[0])).name.startswith('.env'):
            raise RuntimeError('Environment files forbidden')
    sys.addaudithook(guard)
    from django.conf import settings
    tree = ast.parse((root / 'config/settings.py').read_text(encoding='utf-8'))
    apps = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == 'INSTALLED_APPS' for t in n.targets))
    # No ASGI server/event loop is needed for synchronous reader tests.
    settings.configure(SECRET_KEY='synthetic', INSTALLED_APPS=[a for a in apps if a != 'daphne'], USE_TZ=True,
        BASE_DIR=root, DATABASES={a: {'ENGINE': 'django.db.backends.dummy'} for a in ('default', 'enrolment')},
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
    import django
    with patch.object(sys, 'argv', [__file__, 'test']):
        django.setup()
        from learner_api.tests_module_progress import STUDENT_ORACLE
        from subprocess import list2cmdline
        allowed_node = list2cmdline(['node', '-e', STUDENT_ORACLE])
        names = ['learner_api.tests_module_progress', 'learner_api.tests_home_progress',
                 'learner_api.test_home_compact_sections_no_db', 'learner_api.tests_live_session_progress',
                 'learner_api.test_projection_performance_no_db']
        suite = unittest.TestSuite([unittest.defaultTestLoader.loadTestsFromTestCase(HomeTotalsTests),
            *(unittest.defaultTestLoader.loadTestsFromName(name) for name in names)])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    return 0 if result.wasSuccessful() else 1


if __name__ == '__main__':
    sys.exit(main())
