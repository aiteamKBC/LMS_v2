"""Read-only parity/contract tests with synthetic data and the original Student code."""
import json
from pathlib import Path
import subprocess
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import canonical_learning, journal_sources, module_progress
from .test_course_catalogue_no_db import CourseCatalogueTests


# Execute the existing Student calculation, rather than a copied Python oracle.
STUDENT_ORACLE = r"""
const fs = require('fs'), vm = require('vm'), path = require('path');
const ts = require('./frontend/node_modules/typescript');
const cache = {};
function load(file) {
  file = path.resolve(file);
  if (cache[file]) return cache[file].exports;
  const module = {exports: {}}; cache[file] = module;
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: {module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022}
  }).outputText;
  function localRequire(name) {
    if (name === '@/lib/format') return {};
    const target = name.startsWith('@/') ? path.join('frontend/src', name.slice(2))
      : path.join(path.dirname(file), name);
    return load(target + '.ts');
  }
  vm.runInNewContext(source, {module, exports: module.exports, require: localRequire, console, Date, Intl});
  return module.exports;
}
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const learning = load('frontend/src/pages/learner/my-learning/learningSummary.ts');
const progress = load('frontend/src/pages/learner/training-plan-timeline/progress.ts');
const real = {...input.detail, modules: [], videoProgress: [], componentProgress:
  input.progress.filter(row => ['video','component'].includes(row.kind)
    || (row.kind === 'quiz_reading' && row.submitted_at))
  .map(row => ({componentId: row.component_ref, kind: row.kind, passed: row.passed}))};
const subjects = learning.buildUnifiedLearningSummary(input.activity, real,
  {current_subjects: input.current, builder_subjects: input.titles}).subjects;
const result = subjects.map(subject => {
  const total = subject.activities.length, completed = subject.activities.filter(a => a.completed).length;
  return {id: subject.id, title: subject.title, total, completed,
    percent: progress.moduleProgress({done: completed, activityCount: total, sessions: [], actual: null}, {}).value};
});
process.stdout.write(JSON.stringify(result));
"""


def student_before(activity, detail, current, progress, titles=None):
    result = subprocess.run(['node', '-e', STUDENT_ORACLE],
        cwd=Path(__file__).resolve().parents[2],
        input=json.dumps(dict(activity=activity, detail=detail, current=current,
                              progress=progress, titles=titles or {})),
        text=True, capture_output=True, check=True)
    return json.loads(result.stdout)


class SharedModuleProgressTests(SimpleTestCase):
    def compare(self, activity, detail, current, progress, titles=None):
        before = student_before(activity, detail, current, progress, titles)
        after = module_progress.aggregate_module_progress(activity, detail, current, progress, titles)
        self.assertEqual({r['id']: r for r in after}, {r['id']: r for r in before})
        self.assertEqual(module_progress.compact_module_progress(after),
                         [{key: r[key] for key in ('id', 'title', 'percent')} for r in after])
        return after

    def test_catalogue_allocation_partial_zero_and_verified_module_suppression(self):
        fixture = CourseCatalogueTests()
        fixture.setUp()
        fixture.courses = [{**row, 'id': int(row['source_course_ref']),
                            'curriculum_module_ref': f"M-{row['source_course_ref']}"}
                           for row in fixture.courses]
        items, subjects, _ = fixture.project([fixture.record(), fixture.record(2)])
        activity = {'subjects': subjects, 'activities': items, 'progress_basis': 'catalogue_activities'}
        detail = {'components': [{'moduleId': 'M-50', 'module': 'Mapped', 'componentId': 'duplicate'}],
                  'quizAttempts': []}
        after = self.compare(activity, detail, [{'id': 'M-50', 'title': 'Mapped'},
                                               {'id': 'EMPTY', 'title': 'Empty'}], [])
        by_id = {row['id']: row for row in after}
        self.assertEqual(by_id['legacy:50']['percent'], 33.33)
        self.assertEqual(by_id['legacy:60']['percent'], 0)
        self.assertIsNone(by_id['current:EMPTY']['percent'])
        self.assertNotIn('current:M-50', by_id)

    def test_native_published_retained_repointed_failed_and_quiz_reading(self):
        components = [{'moduleId': 'M1', 'module': 'Same', 'componentId': f'C{i}'} for i in range(4)]
        components += [{'moduleId': 'M1', 'module': 'Same', 'componentId': 'quiz',
                        'isQuiz': True, 'quizMeta': {'quizId': 21}},
                       {'moduleId': 'M2', 'module': 'Same', 'componentId': 'failed',
                        'isQuiz': True, 'quizMeta': {'quizId': 22}}]
        detail = {'components': components + [components[0]], 'retiredQuizComponents': [
            {'moduleId': 'M1', 'module': 'Same', 'componentId': 'retired', 'isQuiz': True,
             'quizMeta': {'quizId': 20}}], 'quizAttempts': [
                {'quizId': '19', 'componentId': 'quiz', 'passed': True},
                {'quizId': 21, 'passed': False}, {'quizId': 22, 'passed': False},
                {'quizId': 20, 'passed': True}, {'quizId': 20, 'passed': False}]}
        progress = [{'kind': 'video', 'component_ref': 'C0', 'passed': None},
                    {'kind': 'component', 'component_ref': 'C1', 'passed': False},
                    {'kind': 'quiz_reading', 'component_ref': 'C2', 'passed': None, 'submitted_at': '2026-01-01'},
                    {'kind': 'quiz_reading', 'component_ref': 'C3', 'passed': None, 'submitted_at': None}]
        after = self.compare(None, detail, [{'id': 'M1', 'title': 'Same'}, {'id': 'M2', 'title': 'Same'}], progress)
        self.assertEqual([(r['completed'], r['total'], r['percent']) for r in after], [(4, 6, 66.67), (0, 1, 0)])

    def test_same_titles_and_foreign_lineage_never_link_modules(self):
        activity = {'progress_basis': 'catalogue_activities',
                    'subjects': [{'id': 1, 'name': 'Same', 'module_id': 'OLD'}],
                    'activities': [{'group_id': 1, 'activity_id': 'material:1', 'source_activity_id': 1,
                                    'completed': False}]}
        after = self.compare(activity, {'components': [{'moduleId': 'NEW', 'module': 'Same', 'componentId': 'C1'}],
                                       'quizAttempts': []}, [{'id': 'NEW', 'title': 'Same'}], [])
        self.assertEqual({r['id'] for r in after}, {'legacy:1', 'current:NEW'})

    def test_missing_identity_is_visible_and_never_title_matched(self):
        with self.assertRaises(module_progress.ServiceError):
            module_progress.aggregate_module_progress(None, {'components': [{'module': 'Same'}]},
                                                       [{'id': 'M1', 'title': 'Same'}], [])

    def test_shared_service_uses_student_sources_and_restores_coach_perspective(self):
        source = SimpleNamespace(pk=201, aptem_id=123)
        profile = SimpleNamespace(pk=101, enrolment_id=201)
        observed = []
        def catalogue(*args, **kwargs):
            observed.append(journal_sources.enabled())
            return {'subjects': [], 'activities': [], 'progress_basis': 'catalogue_activities'}
        self.assertFalse(journal_sources.enabled())
        with patch.object(canonical_learning, 'require_profile', return_value={'id': 101}), \
             patch.object(canonical_learning, 'source_subjects', side_effect=catalogue) as read, \
             patch.object(module_progress, 'read_native_progress', return_value=({'components': [], 'quizAttempts': []}, [], [], {})):
            self.assertEqual(module_progress.canonical_module_progress(source, profile), [])
        self.assertEqual(observed, [True])
        self.assertFalse(journal_sources.enabled())
        self.assertEqual(read.call_args.kwargs, {'owner': {'id': 101}})

    def test_identity_mismatch_stops_before_any_plan_read(self):
        with patch.object(canonical_learning, 'require_profile', return_value={'id': 999}), \
             patch.object(module_progress, 'read_native_progress') as read:
            with self.assertRaises(module_progress.ServiceError):
                module_progress.canonical_module_progress(SimpleNamespace(pk=201), SimpleNamespace(pk=101, enrolment_id=201))
        read.assert_not_called()

    def test_compact_reader_reuses_final_calculation_without_loading_student_content(self):
        source = SimpleNamespace(pk=201, aptem_id=123)
        profile = SimpleNamespace(pk=101, enrolment_id=201)
        inputs = (None, {'components': [
            {'moduleId': 'M1', 'module': 'Module', 'componentId': 'C1'},
            {'moduleId': 'M1', 'module': 'Module', 'componentId': 'C2'},
            {'moduleId': 'M1', 'module': 'Module', 'componentId': 'C3'}], 'quizAttempts': []},
            [{'id': 'M1', 'title': 'Module'}],
            [{'kind': 'component', 'component_ref': 'C1', 'passed': None}], {})
        observed = []
        def narrow():
            observed.append(journal_sources.enabled())
            return inputs
        with patch.object(canonical_learning, 'require_profile', return_value={'id': 101}), \
             patch.object(canonical_learning, 'source_subjects', side_effect=AssertionError('Broad historical reader')), \
             patch.object(module_progress, 'read_native_progress', side_effect=AssertionError('Content reader')):
            result = module_progress.canonical_module_progress(source, profile, read_projection=narrow)
        self.assertEqual(result, module_progress.aggregate_module_progress(*inputs))
        self.assertEqual(result[0]['percent'], 33.33)
        self.assertEqual(observed, [True])
        self.assertFalse(journal_sources.enabled())


class ModuleProgressEndpointTests(SimpleTestCase):
    def call(self, account, *, error=None, method='get'):
        source, profile = SimpleNamespace(pk=201), SimpleNamespace(pk=101)
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        model.all_learners.get.return_value = source
        request = getattr(RequestFactory(), method)('/learner_api/module-progress/commercial/201/')
        request.login_account = account
        rows = [{'id': 'current:M1', 'title': 'Synthetic', 'completed': 1, 'total': 4, 'percent': 25}]
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch.dict('learner_api.learner_detail.SOURCE_MODELS', {'commercial': model}), \
             patch('learner_api.models.LearnerProfile.objects') as manager, \
             patch.object(module_progress, 'canonical_module_progress', return_value=rows, side_effect=error) as shared:
            manager.using.return_value.get.return_value = profile
            response = module_progress.learner_module_progress(request, kind='commercial', pk=201)
        return response, shared, rows, source, profile

    def test_student_endpoint_uses_shared_final_counts_and_percent_without_projection(self):
        response, shared, rows, source, profile = self.call(SimpleNamespace(role='learner', subject_id=201))
        self.assertEqual(response.status_code, 200)
        shared.assert_called_once_with(source, profile)
        self.assertEqual(json.loads(response.content), {'modules': rows})
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_staff_read_is_allowed(self):
        response, shared, *_ = self.call(SimpleNamespace(role='staff', subject_id=1))
        self.assertEqual(response.status_code, 200)
        shared.assert_called_once()

    def test_other_learner_signed_out_employer_and_post_never_read(self):
        for account, method, status in [(SimpleNamespace(role='learner', subject_id=202), 'get', 404),
                                        (None, 'get', 401), (SimpleNamespace(role='employer', subject_id=201), 'get', 403),
                                        (SimpleNamespace(role='learner', subject_id=201), 'post', 405)]:
            with self.subTest(status=status):
                response, shared, *_ = self.call(account, method=method)
                self.assertEqual(response.status_code, status)
                shared.assert_not_called()

    def test_database_failure_is_visible_without_fake_zero_progress(self):
        response, _, *_ = self.call(SimpleNamespace(role='learner', subject_id=201), error=DatabaseError('offline'))
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('modules', json.loads(response.content))
