"""O03: source-only full-response comparisons and reader interception.

Run: python -B backend/learner_api/test_my_learning_upcoming_no_db.py
No application imports/startup, database, environment files or live HTTP.
Reuses O02's guarded source loader/permission harness; external inputs are
synthetic doubles. Physical SQL counts and latency remain unmeasured.
"""
from collections import defaultdict
from copy import deepcopy
from datetime import date, datetime, timedelta, timezone
import html
import math
from pathlib import Path
import re
import sys
from types import ModuleType
import unittest
from unittest.mock import Mock
from urllib.parse import quote

if __package__:
    from . import test_my_learning_search_no_db as search_harness
    from .test_legacy_assignment_list_no_db import definitions, guard, DatabaseError
else:
    import test_my_learning_search_no_db as search_harness
    from test_legacy_assignment_list_no_db import definitions, guard, DatabaseError

if __name__ == '__main__':
    sys.addaudithook(guard)

ROOT = Path(__file__).resolve().parent
ServiceError = search_harness.ServiceError
# Frozen from the current working tree before O03, not reconstructed from the change.
BASELINE = r'''def assemble_cards(native, current, courses, definitions, done, started, hours, metadata, records, modules, credits, *, search=None):
    """Programme-wide counts with the same explicit import/replacement identities as My Learning."""
    from .progress_transfer_policy import credited_percent
    from .progress_demo import credit as demo_credit
    from .training_plan_dashboard import _canonical_module_progress, module_record_index
    from .live_session_progress import supplement_module_hours
    from .course_catalogue_display import catalogue_display_context, read_export_placements, display_schedule
    # Required only for the visible next-activity preview. SQL expands narrow
    # placement metadata; no course curriculum JSON is transferred to Python.
    if search is None:
        with projection_stage('historical_placements'):
            definitions = catalogue_display_context(definitions, read_export_placements(canonical.query, courses))
    legacy = defaultdict(list)
    for d in definitions:
        course, ref = str(d['source_course_ref']), d['source_activity_id']
        kind, _, ident = ref.partition(':')
        legacy[course].append({'activity_id': f'catalogue:{course}:{ref}', 'group_id': int(course),
            'source_activity_id': int(ident) if ident.isdigit() else 0, 'catalogue_kind': kind,
            'completed': (course, ref) in done, 'started': (course, ref) in started,
            '_course_ref': course, 'title': d['source_activity_title'], 'section_title': d.get('source_section_title'),
            'schedule': display_schedule(d) or {}, 'position': d.get('position') or 0})
    components = [*native.get('components', []), *native.get('retiredQuizComponents', [])]
    from .replacement_learning import project_approved_learning
    components = project_approved_learning(components, metadata['replacement_settings'], metadata.get('progress_transfers', []))
    native['components'] = components[:len(native.get('components', []))]
    native['retiredQuizComponents'] = components[len(native['components']):]
    by_id = {}
    for course in courses:
        ref = str(course['source_course_ref'])
        by_id[f'legacy:{int(ref)}'] = dict(id=f'legacy:{int(ref)}', title=course['source_course_title'],
            source='legacy', moduleId=course.get('curriculum_module_ref'), _hours=round(hours[ref], 6), _items=legacy[ref])
    transfers = metadata.get('progress_transfers', [])
    approved = {f"current:{item['moduleId']}": item for item in transfers if item['status'] == 'approved'}
    links = {**metadata['imported_courses'], **metadata['replacement_courses']}
    uses = Counter(links.values())
    replaced = {ref for ref, old in links.items() if old in by_id and uses[old] == 1 and ref not in approved}
    skipped_titles = set()
    for module in current:
        ref = f"current:{module['id']}"
        if ref in replaced:
            skipped_titles.add(module['title'].strip().casefold())
            continue
        by_id.setdefault(ref, dict(id=ref, title=module['title'], source='current', moduleId=module['id'], _items=[]))
    activity_ids = defaultdict(set)
    attempted_components = {a['componentId'] for a in native.get('quizAttempts', []) if a.get('componentId')}
    attempted_quizzes = {str(a.get('quizId')) for a in native.get('quizAttempts', []) if not a.get('componentId')}
    for index, c in enumerate(components):
        ref = f"current:{c['moduleId']}" if c.get('moduleId') else f"unlinked:{c.get('module')}"
        if ref in replaced:
            skipped_titles.add(str(c.get('module') or '').strip().casefold())
            continue
        subject = by_id.setdefault(ref, dict(id=ref, title=c.get('module') or 'Unnamed subject', source='current', _items=[]))
        ident = c.get('componentId') or f"quiz:{(c.get('quizMeta') or {}).get('quizId') or str(c.get('week')) + ':' + str(index)}"
        if ident in activity_ids[ref]:
            continue
        activity_ids[ref].add(ident)
        if search is not None:
            subject['_items'].append(dict(id=ident,title=c.get('component') or '',component=c))
            continue
        placement = metadata['activity_dates'].get(ident) or {}
        if not placement or placement.get('date_source') in ('original_created_at', 'source_date', 'undated'):
            raw = c.get('sessionDate')
            placement = {'date': raw[:10] if raw else None}
            if raw:
                try:
                    at = date.fromisoformat(raw[:10])
                except ValueError:
                    placement = {'date':None,'month':'undated'}
                else:
                    monday = at-timedelta(days=at.weekday())
                    placement.update(month=raw[:7],week_start=monday.isoformat(),week_end=(monday+timedelta(days=6)).isoformat())
        subject['_items'].append(dict(id=ident, title=c.get('component') or '', completed=native_done(c, native) if search is None else False,
            position=index, week=c.get('week'), weekId=c.get('weekId'), schedule=placement, component=c,
            started=(c.get('componentId') in attempted_components or str((c.get('quizMeta') or {}).get('quizId')) in attempted_quizzes) if c.get('isQuiz') else False))
    titles = {s['title'].strip().casefold() for s in by_id.values()} | skipped_titles
    for title in native.get('modules', []):
        if title.strip().casefold() not in titles:
            by_id[f'unlinked:{title}'] = dict(id=f'unlinked:{title}', title=title, source='current', _items=[])
            titles.add(title.strip().casefold())
    module_list = list(modules.values())
    progress_index = module_record_index(records,module_list) if search is None else None
    for ref, transfer in approved.items():
        if ref in by_id:
            by_id.pop(transfer['courseRef'], None)
    with projection_stage('module_hours'):
        progress = supplement_module_hours(_canonical_module_progress(records,module_list,record_index=progress_index), records, credits) if search is None else {}
    today = datetime.now(UK).date().isoformat()
    seen = set()
    cards = []
    for subject in sorted(by_id.values(), key=lambda s: (s['title'].casefold(), s['id'])):
        items = []
        for item in subject.pop('_items'):
            c = item.get('component') or {}
            key = f"legacy:{item['group_id']}:{item['catalogue_kind']}:{item['activity_id']}" if 'group_id' in item else (
                f"component:{c['componentId']}" if c.get('componentId') else f"quiz:{c['quizMeta']['quizId']}" if (c.get('quizMeta') or {}).get('quizId') else None)
            if key and key in seen:
                continue
            if key:
                seen.add(key)
            items.append(item)
        if search is not None:
            cards.append({'id':subject['id'], '_matches':any(search in i['title'].lower() for i in items)})
            continue
        count, complete = len(items), sum(i['completed'] for i in items)
        module = modules.get(subject.get('moduleId'))
        imported = subject['source'] == 'legacy' and subject['id'] in metadata['imported_courses'].values()
        if imported:
            module = None
        group = metadata['previous_learning_groups'].get(subject['id'])
        if subject['source'] == 'legacy' and group in by_id and by_id[group]['source'] == 'current':
            subject['previousLearningFor'] = group
        if metadata['imported_courses'].get(subject['id']):
            subject['importedCourseRef'] = metadata['imported_courses'][subject['id']]
        subject.update(activityCount=count, completedActivityCount=complete, progress=percent(complete, count),
            status='Completed' if count and complete == count else 'In progress' if any(i['completed'] or i.get('started') for i in items) else 'Upcoming',
            nextTitle=next_title(items, today),
            finalTestPassed=any(i.get('component', {}).get('isQuiz') and 'final' in i['title'].lower() and native_done({k:v for k,v in i['component'].items() if k not in ('previousLearning','attendanceCompleted')}, native) for i in items),
            planModule={k: module.get(k) for k in ('start_date','end_date','tutor_name','total_otjh','educational_session_count','programme_name','cohort_name','group_name')} if module else None,
            actualHours=subject.pop('_hours',None) if subject['source'] == 'legacy' or subject.get('replacementCourseRef') else progress.get(subject.get('moduleId'), {}).get('hours', {}).get('actual'))
        demo = demo_credit(next((course for course in courses if subject['id'] == f"legacy:{course['source_course_ref']}"), None))
        if demo:
            subject.update(demo, status='In progress' if demo['progress'] else 'Upcoming')
        pending = next((item for item in transfers if item['courseRef'] == subject['id'] and item['status'] == 'pending'), None)
        if pending:
            subject.update(progress=pending['percent'], actualHours=pending['hours'],
                activityCount=pending['activityCount'], completedActivityCount=pending['completedActivityCount'], transferPending=True)
            if pending.get('demoProgress'):
                subject['demoProgress'] = True
        transfer = approved.get(subject['id'])
        if transfer:
            completed_ids = [item['id'] for item in items if item['completed']]
            subject['progress'] = credited_percent(transfer, completed_ids, count)
            subject['transferredProgress'] = transfer['percent']
            if transfer.get('demoProgress'):
                subject['demoProgress'] = True
            subject.pop('importedCourseRef', None)
            previous_ids = set(transfer['recordIds'])
            native_records = [record for record in records if str(record['id']) not in previous_ids]
            native_hours = supplement_module_hours(_canonical_module_progress(native_records, module_list), native_records, credits)
            subject['actualHours'] = round(transfer['hours'] + (native_hours.get(subject.get('moduleId'), {}).get('hours', {}).get('actual') or 0), 6)
            subject['status'] = 'Completed' if subject['progress'] == 100 else 'In progress' if subject['progress'] > 0 else 'Upcoming'
        cards.append(subject)
    def totals(source):
        rows = [c for c in cards if c['source'] == source]
        total, complete = sum(c['activityCount'] for c in rows), sum(c['completedActivityCount'] for c in rows)
        weighted = sum(c['progress'] * c['activityCount'] for c in rows)
        return {'subjects': len(rows), 'total': total, 'completed': complete, 'percent': round(weighted/total, 2) if total else 0}
    if search is not None:
        return cards, {}
    return cards, {'current': totals('current'), 'previous': totals('legacy'),
                   'subjectCount': sum(not c.get('previousLearningFor') for c in cards)}

def read_catalogue(source, kind, owner, *, upcoming_only=False):
    from .subject_store import covers_for
    assigned, ids, records, native, courses, definitions, done, started, hours, metadata, credits = load_context(source, owner)
    modules = metadata['modules']
    with projection_stage('card_aggregation'):
        cards, summary = assemble_cards(native, metadata['current_subjects'], courses, definitions, done, started, hours, metadata, records, modules, credits)
    if upcoming_only:
        # Reuse native completion before selecting deadlines, just as the
        # initial catalogue does. No cover or programme metric reads on expansion.
        return dict(upcoming=upcoming_links(source,kind,ids,native,metadata,{c['id'] for c in cards}))
    from .student_activity import _cover_url
    with projection_stage('covers'):
        covers = {**metadata['covers'], **{ref:_cover_url(path) for ref,path in covers_for([c['id'] for c in cards if c['source']=='legacy']).items()}}
    for card in cards:
        card['cover'] = covers.get(card['id']) or None
        # Native module identity is encoded by its stable navigation ID.
        if card['source'] == 'current':
            card.pop('moduleId', None)
    # Programme totals follow metrics(), not selected-week sums.
    with projection_stage('programme_hours'):
        planned = canonical.programme_planned_hours(source.pk, owner=owner) if journal_enabled() else None
        if not journal_enabled():
            targets = canonical.targets_for(owner)
            planned = sum(targets.values()) if targets else None
        actual = round(sum(canonical.recorded_seconds(r) for r in records if canonical.counts_as_actual(r))/3600, 4)
    with projection_stage('upcoming'):
        upcoming = upcoming_links(source, kind, ids, native, metadata, {c['id'] for c in cards}, limit=4)
    return dict(learner=dict(id=str(source.pk),kind=kind,name=owner['name'],programme=owner.get('programme') or '',cohort=str(source.cohort or ''),group=str(source.group or '')),
        summary=summary, modules=cards, otjh=dict(actual=actual,planned=planned),
        upcoming=upcoming[:3], hasMoreUpcoming=len(upcoming)>3)
'''


class FixedDateTime(datetime):
    @classmethod
    def now(cls, tz=None):
        value = cls(2026, 10, 21, 12, tzinfo=timezone.utc)
        return value.astimezone(tz) if tz else value.replace(tzinfo=None)


class UpcomingProjectionTests(unittest.TestCase):
    def setUp(self):
        self.h = search_harness.SearchProjectionTests()
        self.h.setUp()
        self.addCleanup(self.h.doCleanups)
        self.scope = self.h.scope
        self.h.owner.update(name='Synthetic learner', programme='Example', programme_planned_hours=80)
        self.canonical = self.h.canonical
        self.export_calls = []
        self.queries = []
        self.sessions = []
        self.export_error = None
        self.journal = True
        self.scope.update(date=date, datetime=FixedDateTime, timedelta=timedelta,
                          timezone=timezone, quote=quote, re=re,
                          journal_enabled=lambda: self.journal)
        rules = definitions(ROOT / 'progress_rules.py', {'_kind', 'progress_counts_as_achieved'}, {},
                            constants=('GRADED_PROGRESS_KINDS',))
        self.scope['progress_counts_as_achieved'] = rules['progress_counts_as_achieved']
        numbers = definitions(ROOT / 'monthly_log_sources.py', {'number'}, {'math': math})
        canon = definitions(ROOT / 'canonical_learning.py',
                            {'counts_as_actual', 'allocations', 'recorded_seconds', 'programme_planned_hours'},
                            {'number': numbers['number']})
        for key, value in canon.items():
            if callable(value):
                setattr(self.canonical, key, value)
        self.canonical.targets_for = Mock(return_value={'2026-10': 7, '2026-11': 9})
        clean = definitions(ROOT / 'subject_content.py', {'clean_text'}, {'html': html, 're': re})
        self.clean = clean['clean_text']
        dashboard = sys.modules['learner_api.training_plan_dashboard']
        definitions(ROOT / 'training_plan_dashboard.py', {'module_record_index', '_canonical_module_progress'},
                    dashboard.__dict__)
        dashboard.defaultdict = defaultdict
        dashboard.clean_text = self.clean
        dashboard.number = numbers['number']
        dashboard.canonical_learning = self.canonical
        self.module_progress = Mock(wraps=dashboard._canonical_module_progress)
        dashboard._canonical_module_progress = self.module_progress
        live = sys.modules['learner_api.live_session_progress']
        live.__package__ = 'learner_api'
        definitions(ROOT / 'live_session_progress.py', {'supplement_module_hours'}, live.__dict__)
        live.defaultdict = defaultdict
        canonical_module = ModuleType('learner_api.canonical_learning')
        canonical_module.__dict__.update(vars(self.canonical))
        sys.modules['learner_api.canonical_learning'] = canonical_module
        # The import is inside the real supplement helper.
        sys.modules['learner_api'].canonical_learning = canonical_module

        display = sys.modules['learner_api.course_catalogue_display']
        definitions(ROOT / 'course_catalogue_display.py', {'read_export_placements', 'display_schedule'},
                    display.__dict__)

        def enrich(definitions, exports):
            # Display-only adapter double: neither identity nor completion changes.
            return [{**row, '_display_schedule': {'date': '2026-10-22', 'month': '2026-10'}}
                    for row in definitions]

        self.display = Mock(side_effect=enrich)
        display.catalogue_display_context = self.display
        demo = sys.modules['learner_api.progress_demo']
        definitions(ROOT / 'progress_demo.py', {'credit'}, demo.__dict__)
        transfer = sys.modules['learner_api.progress_transfer_policy']
        definitions(ROOT / 'progress_transfer_policy.py', {'credited_percent'}, transfer.__dict__)
        store = ModuleType('learner_api.subject_store')
        self.covers = Mock(return_value={'legacy:50': 'synthetic-cover'})
        store.covers_for = self.covers
        sys.modules[store.__name__] = store
        student = ModuleType('learner_api.student_activity')
        student._cover_url = lambda path: '/synthetic/' + path
        sys.modules[student.__name__] = student
        content = ModuleType('learner_api.subject_content')
        content.clean_text = self.clean
        sys.modules[content.__name__] = content

        def query(sql, params):
            self.queries.append((sql, deepcopy(params)))
            if '"MBA".course_curriculum' in sql:
                self.export_calls.append(deepcopy(params))
                if self.export_error:
                    raise self.export_error
                return [{'course_id': 50, 'section_title': 'Synthetic export'}]
            if 'WITH RECURSIVE owners' in sql:
                return deepcopy(self.sessions)
            raise AssertionError('Unexpected SQL in prepared-fact projection')

        self.canonical.query = Mock(side_effect=query)
        self.scope.update(definitions(ROOT / 'my_learning.py',
                                      {'percent', 'native_done', 'next_title', 'session_instant',
                                       'read_catalogue', 'upcoming_links'}, self.scope))
        old = dict(self.scope)
        exec(compile(BASELINE, '<frozen pre-O03>', 'exec'), old)
        self.old = old
        self.before = old['read_catalogue']
        self.after = self.scope['read_catalogue']
        self.h.context = self.context()

    def tearDown(self):
        # Restore extra injected modules, even when invoked under test discovery.
        for name in ('learner_api.canonical_learning', 'learner_api.subject_store',
                     'learner_api.student_activity', 'learner_api.subject_content'):
            sys.modules.pop(name, None)

    def context(self, native=True, source=True):
        context = list(self.h.make_context(2 if native else 0))
        context[1] = ['M0', 'M1'] if native else []
        context[2] = [dict(id=1, module_ref='M0', accepted=True, actual_seconds=1800, ksbs=['K1']),
                      dict(id=2, module_ref='M1', accepted=False, actual_seconds=900, ksbs=['K2'])] if native else []
        context[3]['videoProgress'] = []
        context[3]['componentProgress'] = [{'componentId': 'C0', 'kind': 'component', 'passed': None}] if native else []
        for index, component in enumerate(context[3]['components']):
            component.update(type='assignment', week='Week 1')
        context[4] = [{'id': 31, 'source_course_ref': '50', 'source_course_title': 'Source course'}] if source else []
        context[5] = [dict(source_course_ref='50', source_activity_id='material:7',
                           source_activity_title='Source lesson', position=1)] if source else []
        context[6] = {('50', 'material:7')} if source else set()
        context[8] = defaultdict(float, {'50': 2})
        context[9].update(covers={}, previous_learning_groups={},
                          current_subjects=[{'id': f'M{i}', 'title': f'Module {i}'}
                                            for i in range(2)] if native else [],
                          modules={f'M{i}': {'id': f'M{i}', 'title': f'Module {i}',
                                           'educational_session_count': 2} for i in range(2)} if native else {},
                          activity_dates={f'C{i}': {'date': '2026-10-23', 'week_end': '2026-10-23',
                                                   'due_timing': 'End of week'} for i in range(2)})
        return tuple(context)

    def compare(self, upcoming=False, kind='commercial'):
        self.export_calls.clear()
        self.module_progress.reset_mock()
        before = self.before
        source = type('Source', (), {'pk': 501, 'cohort': 'C', 'group': 'G'})()
        expected = before(source, kind, deepcopy(self.h.owner), upcoming_only=upcoming)
        before_exports = len(self.export_calls)
        before_progress = self.module_progress.call_count
        self.export_calls.clear()
        self.module_progress.reset_mock()
        actual = self.after(source, kind, deepcopy(self.h.owner), upcoming_only=upcoming)
        self.assertEqual(actual, expected)
        # Dict equality alone does not check ordering or omitted-vs-null payload shape.
        import json
        self.assertEqual(json.dumps(actual), json.dumps(expected))
        return actual, before_exports, len(self.export_calls), before_progress, self.module_progress.call_count

    def test_empty_native_source_and_mixed_complete_json_for_both_endpoints(self):
        for native, source in ((False, False), (True, False), (False, True), (True, True)):
            for upcoming in (False, True):
                for kind in ('commercial', 'apprenticeship'):
                    with self.subTest(native=native, source=source, upcoming=upcoming, kind=kind):
                        self.h.context = self.context(native, source)
                        self.compare(upcoming, kind)

    def test_populated_upcoming_eliminates_progress_reducer_but_retains_export_read(self):
        result, before_exports, after_exports, before_progress, after_progress = self.compare(True)
        self.assertTrue(result['upcoming'])
        self.assertEqual((before_exports, after_exports), (1, 1))
        self.assertEqual((before_progress, after_progress), (1, 0))
        self.covers.assert_not_called()

    def test_main_catalogue_keeps_export_progress_cover_and_hours_contract(self):
        result, before_exports, after_exports, before_progress, after_progress = self.compare(False)
        self.assertEqual((before_exports, after_exports), (1, 1))
        self.assertEqual((before_progress, after_progress), (1, 1))
        self.assertEqual(result['otjh'], {'actual': 0.5, 'planned': 80.0})
        self.assertIn('summary', result)
        self.assertEqual(len(result['modules']), 3)
        self.journal = False
        result, *_ = self.compare(False)
        self.assertEqual(result['otjh']['planned'], 16)

    def test_completed_unattempted_deadlines_and_session_ordering(self):
        native = self.h.context[3]
        native['components'].extend([
            {'moduleId': 'M1', 'module': 'Module 1', 'componentId': 'L1', 'component': 'Live',
             'type': 'live_session', 'teamsLiveSessionId': 'SER', 'week': 'Week 2'},
            {'moduleId': 'M1', 'module': 'Module 1', 'componentId': 'PAST', 'component': 'Past', 'type': 'assignment'},
            {'moduleId': 'M1', 'module': 'Module 1', 'componentId': 'UNPLACED', 'component': 'No date', 'type': 'checkpoint'}])
        self.h.context[9]['activity_dates']['PAST'] = {'due_timing': 'End of week', 'week_end': '2026-10-20'}
        self.sessions = [dict(id='OCC', series_id='SER', module_id='M1', title='<b>Live</b>',
                              start='2026-10-22T14:00:00+00:00', online=True)]
        result, *_ = self.compare(True)
        self.assertEqual([item['id'] for item in result['upcoming']],
                         ['session:M1:OCC', 'deadline:native:C1'])
        sql, params = next((sql, params) for sql, params in self.queries if 'WITH RECURSIVE owners' in sql)
        self.assertEqual(params[0], ['M0', 'M1'])
        self.assertIn("'canceled','completed'", sql)
        self.assertIn("'cancelled','deleted','failed','superseded'", sql)
        self.assertIn('depth<5', sql)

    def test_import_replacement_ambiguity_and_approved_pending_transfers(self):
        for links in ({'current:M0': 'legacy:50'},
                      {'current:M0': 'legacy:50', 'current:M1': 'legacy:50'}):
            for status in ('pending', 'approved'):
                with self.subTest(links=links, status=status):
                    self.h.context = self.context()
                    self.h.context[9]['replacement_courses'] = links
                    self.h.context[9]['progress_transfers'] = [dict(
                        moduleId='M0', courseRef='legacy:50', status=status, matchedComponents={},
                        percent=40, hours=1, activityCount=2, completedActivityCount=1, recordIds=[])]
                    self.compare(False)
                    self.compare(True)

    def test_duplicate_native_references_titles_and_retained_quizzes(self):
        self.h.context[3]['components'].append(deepcopy(self.h.context[3]['components'][1]))
        self.h.context[3]['retiredQuizComponents'] = [dict(
            componentId='OLD', moduleId='M1', module='Module 1', component='Final test',
            isQuiz=True, quizMeta={'quizId': 7}, type='quiz')]
        self.h.context[3]['quizAttempts'] = [{'componentId': 'OLD', 'quizId': 7, 'passed': True}]
        self.h.context[3]['modules'] = ['MODULE 1', 'Unlinked', 'unlinked']
        self.compare(False)
        self.compare(True)

    def test_demo_credit_does_not_change_upcoming_visibility(self):
        self.h.context[4][0]['demo_progress'] = {'percent': 65, 'hours': 0}
        self.compare(False)
        self.compare(True)

    def test_retained_context_failure_preserves_error_response(self):
        for error, status in ((DatabaseError('synthetic'), 503),
                              (ServiceError('Identity unavailable', status=409), 409)):
            for resource in (None, 'upcoming'):
                self.h.load.side_effect = error
                self.h.scope['read_catalogue'] = self.before
                expected = self.h.call(self.h.current, resource=resource)
                self.h.scope['read_catalogue'] = self.after
                actual = self.h.call(self.h.current, resource=resource)
                self.assertEqual(actual.content, expected.content)
                self.assertEqual(actual.status_code, status)

    def test_endpoint_json_headers_and_one_context_per_separate_request(self):
        for resource in (None, 'upcoming'):
            for kind in ('commercial', 'apprenticeship'):
                with self.subTest(resource=resource, kind=kind):
                    outputs = []
                    for reader in (self.before, self.after):
                        def with_placement(source, *args, **kwargs):
                            source.cohort, source.group = 'C', 'G'
                            return reader(source, *args, **kwargs)
                        self.h.scope['read_catalogue'] = with_placement
                        self.h.events.clear()
                        self.h.load.reset_mock()
                        response = self.h.call(self.h.current, kind=kind, resource=resource)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response['Cache-Control'], 'private, no-store')
                        self.assertEqual(self.h.events, [('source', {'pk': 501}), ('owner', 501)])
                        self.h.load.assert_called_once()
                        outputs.append((response.content, dict(response)))
                    self.assertEqual(outputs[0], outputs[1])

    def test_catalogue_and_upcoming_retain_export_failure_response(self):
        self.export_error = DatabaseError('synthetic export unavailable')
        for resource in (None, 'upcoming'):
            responses = []
            for reader in (self.before, self.after):
                self.h.scope['read_catalogue'] = reader
                response = self.h.call(self.h.current, resource=resource)
                self.assertEqual(response.status_code, 503)
                responses.append(response.content)
            self.assertEqual(responses[0], responses[1])

    def test_ownership_denial_and_unreadable_sessions_precede_preparation(self):
        from types import SimpleNamespace
        for account, unreadable, status in ((None, False, 401), (None, True, 503),
            (SimpleNamespace(role='learner', subject_id=999), False, 404),
            (SimpleNamespace(role='employer', subject_id=501), False, 403)):
            self.h.account, self.h.unreadable = account, unreadable
            for resource in (None, 'upcoming'):
                response = self.h.call(self.h.current, resource=resource)
                self.assertEqual(response.status_code, status)
        self.h.load.assert_not_called()
        self.assertEqual(self.h.events, [])


if __name__ == '__main__':
    unittest.main(verbosity=2)
