"""Synthetic, database-forbidden parity against the existing Coach Journey UI."""
import json
from pathlib import Path
import subprocess
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import patch
from unittest.mock import MagicMock

from django.test import RequestFactory, SimpleTestCase
from learner_api.tests_module_progress import STUDENT_ORACLE
from .learning_plan_projection import project_journey, journey_response
from .learning_plan_projection import read_timeline, canonical_progress_facts
from .case_file import case_file_section


ORACLE = STUDENT_ORACLE[:STUDENT_ORACLE.index("const input =")].replace(
    "const module = {exports: {}}; cache[file] = module;",
    "if (file.endsWith('.json')) return JSON.parse(fs.readFileSync(file, 'utf8'));\n"
    "  const module = {exports: {}}; cache[file] = module;"
).replace("return load(target + '.ts');", "return load(target.endsWith('.json') ? target : target + '.ts');").replace(
    "module: ts.ModuleKind.CommonJS", "esModuleInterop: true, module: ts.ModuleKind.CommonJS") + r"""
const input = JSON.parse(fs.readFileSync(0, 'utf8'));
const journey = load('frontend/src/utils/learnerJourney.ts');
const coach = load('frontend/src/pages/coach/learner-case-file/activityState.ts');
const modules = coach.buildFullCaseFileJourney(journey.buildLearnerJourney(input.detail),
  input.activity, input.detail, input.metadata, input.history);
const states = coach.buildCaseFileActivityStates(modules, {...input.detail, studentActivityAvailable: input.history}, input.activity);
const counts = module => {
  const r = coach.moduleActivitySummary(module, states);
  return {componentCount:r.total, completedCount:r.completed, inProgressCount:r['in-progress'],
    notStartedCount:r['not-started'], unavailableCount:r.unavailable, progressPercent:r.percent, status:r.status};
};
process.stdout.write(JSON.stringify(modules.map(module => ({title:module.module, weekCount:module.weeks.length,
  ...counts(module), otjh:module.weeks.reduce((n,w)=>n+w.otjh,0), weeks:module.weeks.map(week => ({title:week.week,
    ...counts({weeks:[week]}),otjh:week.otjh, components:week.components.map(c=>({componentId:c.componentId,title:c.title,
      status:states[c.componentId]?.status || 'not-started',completedAt:states[c.componentId]?.completedAt || null}))}))}))));
"""


class LearningPlanJourneyParityTests(SimpleTestCase):
    maxDiff = None

    def compare(self, detail, activity=None, metadata=None, history=False):
        metadata = metadata or {'current_subjects': [{'id': 'M1', 'title': 'Module'}]}
        result = subprocess.run(['node', '-e', ORACLE], cwd=Path(__file__).resolve().parents[2],
            input=json.dumps(dict(detail=detail, activity=activity, metadata=metadata, history=history)),
            text=True, capture_output=True)
        self.assertEqual(result.returncode, 0, result.stderr)
        before = json.loads(result.stdout)
        modules = project_journey(detail, activity, metadata, history)
        after = []
        for module in modules:
            weeks = []
            for week in module['weeks']:
                expanded = project_journey(detail, activity, metadata, history, module['id'], week['id'])
                selected = journey_response(expanded, module['id'], week['id'])
                weeks.append({key: selected[key] for key in before[len(after)]['weeks'][len(weeks)] if key != 'components'} |
                    {'components': [{key: component.get(key) for key in ('componentId', 'title', 'status', 'completedAt')}
                                    for component in selected['components']]})
            after.append({key: module[key] for key in before[len(after)] if key != 'weeks'} | {'weeks': weeks})
        self.assertEqual(after, before)
        initial = journey_response(modules)
        self.assertTrue(all('weeks' not in row for row in initial['modules']))
        self.assertEqual(initial['summary']['components'], sum(row['componentCount'] for row in before))
        for module in modules:
            self.assertTrue(all('components' not in row for row in journey_response(modules, module['id'])['weeks']))
        return modules

    def detail(self):
        return {'modules': ['Module'], 'week': [{'moduleId':'M1','module':'Module','weekId':'W1','week':'Week 1'},
                    {'moduleId':'M1','module':'Module','weekId':'W2','week':'Empty week'}],
            'components': [{'moduleId':'M1','module':'Module','weekId':'W1','week':'Week 1',
                'componentId':f'C{i}','component':f'Item {i}','type':'reading','expectedOtjh':None,
                'tutorValidationRequired':i == 1} for i in range(4)],
            'quizAttempts':[], 'videoProgress':[], 'componentProgress':[
                {'componentId':'C0','kind':'component','passed':None,'submittedAt':'2026-01-01'},
                {'componentId':'C1','kind':'component','passed':None,'submittedAt':'2026-01-02'},
                {'componentId':'C2','kind':'component','passed':False}], 'componentMarkingStatus':{}}

    def test_native_tutor_pending_accepted_failed_not_started_and_empty_weeks(self):
        detail = self.detail()
        self.compare(detail)
        detail['componentMarkingStatus']['C1'] = {'status':'accepted','reviewedAt':'2026-02-01'}
        self.compare(detail)

    def test_historical_and_native_states_are_distinct_from_catalogue_progress(self):
        detail = self.detail()
        detail['components'] += [dict(detail['components'][0])]
        activity = {'progress_basis':'catalogue_activities', 'subjects':[{'id':1,'name':'History','module_id':'OLD'}],
            'activities':[{'group_id':1,'activity_id':f'material:{i}','source_activity_id':i,'activity':f'Old {i}',
                'category':'reading','completed':i==0,'status':'in progress' if i==1 else 'not_started',
                'planned':2,'date':'2026-02-03' if i<2 else None,'month':'2026-02' if i<2 else 'undated',
                'section_title':'Week 3','position':i} for i in range(3)]}
        self.compare(detail, activity, history=True)

    def test_selected_module_and_week_are_scoped_to_membership(self):
        modules = self.compare(self.detail())
        with self.assertRaises(LookupError):
            journey_response(modules, 'current:FOREIGN')
        with self.assertRaises(LookupError):
            journey_response(modules, 'current:M1', 'FOREIGN')

    def test_authored_order_same_titles_quiz_lineage_and_complete_zero_states(self):
        detail = self.detail()
        detail['modules'] = ['Zulu', 'Module', 'Empty']
        detail['week'].insert(0, {'moduleId':'M2','module':'Zulu','weekId':'Z','week':'First'})
        detail['week'].append({'moduleId':'M3','module':'Empty','weekId':'E','week':'Empty'})
        detail['components'].insert(0, {'moduleId':'M2','module':'Zulu','weekId':'Z','week':'First',
            'componentId':'Q','component':'Quiz','type':'quiz','isQuiz':True,'quizMeta':{'quizId':21}})
        detail['quizAttempts'] = [{'componentId':'Q','quizId':'20','passed':True,'submittedAt':'2026-01-02'}]
        metadata = {'current_subjects':[{'id':'M1','title':'Module'},{'id':'M2','title':'Zulu'},{'id':'M3','title':'Empty'}]}
        self.compare(detail, metadata=metadata)
        self.compare(detail, {'progress_basis':'catalogue_activities','subjects':[], 'activities':[]}, metadata, True)

    def test_historical_dates_special_weeks_and_builder_suppression(self):
        detail = self.detail()
        activity = {'progress_basis':'catalogue_activities','subjects':[{'id':1,'name':'Module','module_id':'M1'}],
            'activities':[{'group_id':1,'activity_id':f'material:{i}','activity':f'Old {i}',
                'category':'quiz','completed':i==0,'video_started':i==1,'planned':1,'month':'undated',
                'date_source':source,'section_title':label,'position':i}
                for i,(source,label) in enumerate([('introduction','Intro'),('extra_activity','Extras'),
                                                   ('undated','Week 10'),('undated','Week 2'),('undated','')])]}
        # The old cover metadata links current subjects only, so it does not
        # append Builder weeks to a canonical historical course.
        self.compare(detail, activity, history=True)

    def test_quiz_attempts_without_component_lineage_preserve_history_in_progress(self):
        detail = self.detail()
        detail['components'][0].update(isQuiz=True, quizMeta={'quizId':21})
        detail['quizAttempts'] = [{'quizId':'21', 'passed':False}]
        self.compare(detail, {'progress_basis':'catalogue_activities','subjects':[], 'activities':[]}, history=True)

    def test_identically_named_authored_weeks_keep_separate_counts(self):
        detail = self.detail()
        detail['week'][1]['week'] = 'Week 1'
        self.compare(detail)

    def test_timeline_facts_keep_published_retained_quizzes_separate_from_journey(self):
        from copy import deepcopy
        from learner_api.retained_quiz_progress import attach_quiz_slots
        detail = self.detail()
        detail['_canonical_progress'] = []
        detail['quizAttempts'] = [{'quizId': '20', 'passed': True, 'componentId': None}]
        metadata = {'current_subjects': [{'id': 'M1', 'title': 'Module'}], '_assigned_ids': ['M1']}
        context = SimpleNamespace(_learning_plan_facts=(detail, None, metadata))
        before = deepcopy(detail)
        published = {'moduleId': 'M1', 'module': 'Module', 'weekId': 'W1', 'week': 'Week 1',
                     'isQuiz': True, 'quizMeta': {'quizId': 21}, 'componentId': None}
        def append(weeks, components, **kwargs):
            self.assertEqual(kwargs['assigned_modules'], [{'moduleId': 'M1'}])
            return weeks, [*components, published]
        def retain(canonical):
            return attach_quiz_slots(canonical, canonical['quizAttempts'], [
                {'quizId': '20', 'componentId': 'retired', 'moduleId': 'M1',
                 'weekId': 'W1', 'week': 'Week 1', 'title': 'Earned quiz'}])
        with patch('learner_api.learner_detail._append_week_quizzes', side_effect=append), \
             patch('learner_api.retained_quiz_progress.retain_quiz_progress', side_effect=retain):
            history, canonical, current, progress, titles = canonical_progress_facts(context)
        self.assertEqual(detail, before)
        self.assertIn(published, canonical['components'])
        self.assertEqual(canonical['retiredQuizComponents'][0]['componentId'], 'retired')
        self.assertEqual((history, current, progress, titles), (None, metadata['current_subjects'], [],
                         {'current:M1': {'title': 'Module'}}))

    def test_initial_and_lazy_get_never_invoke_legacy_hydration(self):
        context = SimpleNamespace(profile=SimpleNamespace(id=101), source=SimpleNamespace(id=201), stage_measurements=[])
        for section, query in [('learning-plan',{}),('learning-plan-module',{'moduleId':'current:M1','weekId':'W1'})]:
            request = RequestFactory().get('/coach_api/coach/case-file/101/learning-plan', query)
            request.coach_email = 'coach@example.test'
            with patch('coach_api.case_file.CaseFileContext', return_value=context), \
                 patch('coach_api.learning_plan_projection.read_learning_plan', return_value={'timeline':{},'journey':{}}) as initial, \
                 patch('coach_api.learning_plan_projection.read_journey', return_value={'components':[]}) as selected, \
                 patch('coach_api.case_file.build_tab', side_effect=AssertionError('Full hydration')), \
                 patch('coach_api.case_file.read_plan_detail', side_effect=AssertionError('Full plan')):
                response = unwrap(case_file_section)(request, 101, section=section)
            self.assertEqual(response.status_code, 200)
            if section == 'learning-plan':
                initial.assert_called_once_with(context)
                selected.assert_not_called()
            else:
                selected.assert_called_once_with(context, 'current:M1', 'W1')
                initial.assert_not_called()

    def test_timeline_uses_shared_progress_and_preserves_delivery_end_and_notes(self):
        context = SimpleNamespace(source=SimpleNamespace(pk=201), profile=SimpleNamespace(lifecycle_status='active'))
        scheduled = [{'id':'M1','title':'Module','start_date':'2026-10-01','end_date':'2026-10-20','session_week_day':'Friday'}]
        authored = [{'id':'W1','module_catalogue_id':'M1','week_number':1,'title':'Week 1',
                     'holiday_note_enabled':True,'holiday_note':'Published hint'}]
        def slots(modules, by_id, counts, weeks):
            self.assertEqual(weeks[('M1',1)]['holidayNote'], 'Published hint')
            by_id['M1'].update(effectiveEndDate='2026-11-06', curriculumSlots=[
                {'date':'2026-10-02','slotNumber':1,'weekTitle':'Week 1','holidayNote':'Published hint','holidays':[]}])
        with patch('coach_api.learning_plan_projection.connections') as connections, \
             patch('coach_api.learning_plan_projection.rows', side_effect=[scheduled, authored, []]), \
             patch('coach_api.learning_plan_projection.canonical_learning.require_profile', return_value={'id':101}), \
             patch('coach_api.learning_plan_projection.canonical_learning.curriculum_module_ids_for', return_value=[]), \
             patch('learner_api.learning_plan._effective_plan_ids', return_value=['M1']), \
             patch('learner_api.training_plan_dashboard.attach_curriculum_slots', side_effect=slots), \
             patch('learner_api.module_progress.canonical_module_progress', return_value=[
                 {'id':'current:M1','title':'Module','percent':33.33,'completed':1,'total':3}]) as canonical, \
             patch('coach_api.learning_plan_projection.query', return_value=[]), \
             patch('coach_api.learning_plan_projection.read_history', return_value=None), \
             patch('learner_api.calendar.coaching_events_for_learner', return_value=[]), \
             patch('coach_api.selectors.otjh.learner_programme_window', return_value=('2026-10-01','2027-09-30')):
            connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = MagicMock()
            timeline = read_timeline(context)
        self.assertEqual(canonical.call_args.args, (context.source, context.profile))
        self.assertEqual(set(canonical.call_args.kwargs), {'read_projection'})
        canonical.assert_called_once()
        row = timeline['modules'][0]
        self.assertEqual((row['progressPercent'],row['endDate'],row['weekAnchor']), (33.33,'2026-11-06','2026-10-02'))
        self.assertEqual(row['notes'][0]['holidayNote'], 'Published hint')
        forbidden = {'curriculumSlots','sessions','planSubjects','monthlyActivities','components','moduleLinks','moduleProgress'}
        self.assertFalse(forbidden.intersection(timeline))
        self.assertFalse(forbidden.intersection(row))
