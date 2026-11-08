"""Monthly Submission reads: parity with learner detail, contract, access, no writes.

No database or network: every selector that would query is replaced. The
parity cases run the real ``build_learner_detail(read_only=True, compact=True)``
and the real Monthly Submission builder over the same fixture plan, profile
and marking rows, and compare what the page consumes.
"""
import json
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.db.models import Model
from django.test import RequestFactory, SimpleTestCase

from . import learner_detail, monthly_submission as monthly
from .progress_rules import progress_record_counts_as_achieved
from .weekly_learning import component_content_available

LEAKY = 'SELECT * FROM "Learner".learners host=db.internal password=synthetic-secret'
SECRETS = ('SELECT', 'learners', 'db.internal', 'synthetic-secret')


def component(identity, kind='assignment', **extra):
    row = {'componentId': identity, 'moduleId': 'M1', 'module': 'Data and insight', 'week': 'Week 1',
           'component': f'Assignment · {identity}', 'type': kind, 'description': None,
           'assignmentTopics': [], 'assignmentBrief': None, 'assignmentBriefHtml': None,
           'resourceUrl': None, 'fileName': None, 'files': [], 'downloadAllowed': False,
           'ksbMappings': [], 'sessionDate': None, 'expectedOtjh': None, 'contentHtml': None,
           'hasReadingContent': False, 'isQuiz': False, 'quizMeta': None}
    row.update(extra)
    return row


def plan_components():
    """What _resolve_from_master returns for the fixture plan (compact)."""
    return [
        component('A1', assignmentBrief='Explain your data decisions.', sessionDate='2026-09-09',
                  ksbMappings=[{'code': 'K1', 'description': 'Data'}]),
        # The programme workbook template supplies its file; nothing authored.
        component('A2', type='Assignment', moduleId='M2', module='Project planning and control'),
        component('A1', assignmentBrief='duplicate row'),
        component('A3', description='<p>Answer the question.</p>', week='Week 2'),
        component('A4'),  # nothing authored: awaiting its brief
        component(None),  # an assignment without identity never lists
        component('R1', kind='reading', hasReadingContent=True),
        component('V1', kind='video', videoUrl='https://video.example/v1'),
    ]


# Stored progress rows. The serialised property and the value query read the same rows.
ENTRIES = [
    {'kind': 'component', 'component_ref': 'A1', 'passed': None, 'submitted_at': '2026-09-10', 'deleted': False},
    {'kind': 'component', 'component_ref': 'A3', 'passed': False, 'submitted_at': '2026-09-10', 'deleted': False},
    {'kind': 'quiz_reading', 'component_ref': 'A2', 'passed': True, 'submitted_at': None, 'deleted': False},
    {'kind': 'component', 'component_ref': 'A2', 'passed': True, 'submitted_at': '2026-09-11', 'deleted': True},
    {'kind': 'activity_event', 'component_ref': 'A4', 'passed': True, 'submitted_at': '2026-09-11', 'deleted': False},
    {'kind': 'video', 'component_ref': 'V1', 'passed': True, 'submitted_at': '2026-09-12', 'deleted': False},
    {'kind': 'component', 'component_ref': 'R1', 'passed': True, 'submitted_at': '2026-09-12', 'deleted': False},
    {'kind': 'quiz', 'component_ref': 'Q1', 'passed': True, 'submitted_at': '2026-09-12', 'deleted': False},
]
MARKING = {
    'A1': {'status': 'submitted_for_tutor_review', 'feedback': '', 'reviewedBy': '', 'reviewedAt': None},
    'A3': {'status': 'referred', 'feedback': 'Add an example.', 'reviewedBy': 'Coach', 'reviewedAt': '2026-09-20T10:00:00'},
    'R1': {'status': 'accepted', 'feedback': '', 'reviewedBy': '', 'reviewedAt': None},
}
OTJH = {'A1': 7.0, 'A2': 3.5, 'A3': None, 'A4': 2.0, 'R1': 1.0, 'V1': 0.5}
LIST_KEYS = ('componentId', 'type', 'component', 'module', 'week', 'sessionDate', 'expectedOtjh')
DETAIL_KEYS = ('assignmentTopics', 'assignmentBrief', 'assignmentBriefHtml', 'description',
               'resourceUrl', 'fileName', 'downloadAllowed', 'files', 'ksbMappings')
# Learner-wide fields the Monthly Submission responses must never carry.
LEARNER_WIDE = ('week', 'modules', 'quizAttempts', 'activityFeed', 'ksbs', 'progressKsbCodes',
                'plannedHours', 'completedHours', 'targetHours', 'progressHours', 'otjhStatus',
                'totalExpectedOtjh', 'officialPlannedHours', 'retiredQuizComponents', 'accessGate')


class ProgressQuery:
    """profile.progress_entries for the values() read; records its filters."""

    def __init__(self, calls):
        self.calls, self.rows = calls, [dict(row) for row in ENTRIES]

    def filter(self, **kwargs):
        self.calls.append(('filter', kwargs))
        if kwargs.get('deleted_at__isnull'):
            self.rows = [row for row in self.rows if not row['deleted']]
        if 'component_ref__in' in kwargs:
            wanted = set(kwargs['component_ref__in'])
            self.rows = [row for row in self.rows if row['component_ref'] in wanted]
        return self

    def exclude(self, **kwargs):
        self.calls.append(('exclude', kwargs))
        self.rows = [row for row in self.rows if row['kind'] != kwargs.get('kind')]
        return self

    def values(self, *fields):
        self.calls.append(('values', fields))
        return [{field: row[field] for field in fields} for row in self.rows]


def make_profile(calls):
    serialised = [{'kind': row['kind'], 'componentId': row['component_ref'], 'passed': row['passed'],
                   'submittedAt': row['submitted_at']}
                  for row in ENTRIES if not row['deleted'] and row['kind'] != 'activity_event']
    return SimpleNamespace(
        id=55, pk=55, enrolment_id=101, ksbs=[], planned_hours=None,
        training_plan_progress=serialised,
        activity_feed_entries=lambda newest_first=True: [{'kind': 'component', 'title': 'Feed row'}],
        progress_entries=SimpleNamespace(filter=lambda **kwargs: ProgressQuery(calls).filter(**kwargs)),
    )


def make_source():
    return SimpleNamespace(id=101, pk=101, username='Learner', email='learner@example.test', phone_number='',
                           programme='Programme', cohort='Cohort', group='Group', programme_status='Active',
                           learner_type='commercial', aptem_id=None)


class Fixture(SimpleTestCase):
    """Patch every query on both paths; the shared helpers run for real."""

    def setUp(self):
        self.progress_calls = []
        self.profile = make_profile(self.progress_calls)
        self.source = make_source()
        self.resolver_calls = []
        self.profile_calls = []
        self.assigned = [{'moduleId': 'M1'}, {'moduleId': 'M2'}]
        self.sql = []
        stack = ExitStack()
        self.addCleanup(stack.close)

        def resolve(modules, weeks, components, assigned_modules=None, **options):
            self.resolver_calls.append(([entry.get('moduleId') for entry in assigned_modules or []], options))
            wanted = {entry.get('moduleId') for entry in assigned_modules or [] if isinstance(entry, dict)}
            return [], [], [row for row in plan_components() if row.get('moduleId') in wanted]

        def resolve_profile(*args, **kwargs):
            self.profile_calls.append((args, kwargs))
            return self.profile

        test = self

        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, sql, params=None):
                test.sql.append((sql, params))
                test.module_row = next((row['moduleId'] for row in plan_components()
                                        if row['componentId'] == params[0] and row['moduleId'] in params[1]), None)

            def fetchone(self):
                return (test.module_row,) if test.module_row else None

        self.connections = {'enrolment': SimpleNamespace(cursor=Cursor)}
        replacements = {
            # Shared plan selectors, patched where each module looks them up.
            'learner_api.learner_detail._resolve_from_master': resolve,
            'learner_api.monthly_submission._resolve_from_master': resolve,
            'learner_api.learner_detail.effective_training_plan': lambda _source: list(self.assigned),
            'learner_api.monthly_submission.effective_training_plan': lambda _source: list(self.assigned),
            'learner_api.learner_detail._otjh_by_component_id': lambda components: dict(OTJH),
            'learner_api.learner_detail._otjh_by_legacy_title': lambda components: {},
            'learner_api.mappers.get_training_plan': lambda _source: [],
            'learner_api.monthly_submission.get_training_plan': lambda _source: [],
            'learner_api.mappers._component_marking_statuses': lambda *_args: dict(MARKING),
            'learner_api.monthly_submission._component_marking_statuses': lambda *_args: dict(MARKING),
            'learner_api.monthly_submission.learner_profile_for_source': resolve_profile,
            'learner_api.monthly_submission.connections': self.connections,
            # Learner-detail stages that would otherwise query.
            'learner_api.learner_detail._linked_profile_ids': lambda pk: (55,),
            'learner_api.learner_detail._active_profile_for_source': lambda *args, **kwargs: self.profile,
            'learner_api.learner_detail._official_planned_hours': lambda *args: None,
            'learner_api.learner_detail.access_gate': lambda _source: {'blocked': False},
            'learner_api.learner_detail.learning_access': lambda _source: {},
            'learner_api.learner_detail._apply_cohort_schedule': lambda detail, _source: detail,
            'learner_api.learner_detail._append_week_quizzes': lambda weeks, components, **kwargs: (
                weeks, components + [component('Q1', kind='quiz', isQuiz=True)]),
            'learner_api.learner_detail._live_otjh_snapshot': lambda *args: None,
            'learner_api.learner_detail.retain_quiz_progress': lambda detail, **kwargs: detail,
            'learner_api.teams_attendance.annotate_attendance_completion': lambda components, _profile: components,
            'learner_api.replacement_learning.annotate_replacement_learning': lambda components, _pk: components,
            'learner_api.live_session_progress.read_live_credits': lambda *args, **kwargs: [],
            'learner_api.active_users.current_curriculum_ksb_items_for_learner': lambda *args, **kwargs: [],
            'learner_api.apprenticeship_agreement._group_dates': lambda _source: (None, None, ''),
            'learner_api.mappers.student_activity_available': lambda _aptem: False,
            'learner_api.mappers.programme_status': lambda _source: 'Active',
        }
        for target, new in replacements.items():
            stack.enter_context(patch(target, new))
        # GET-side repairs: any call fails the test, on either path.
        for target in ('learner_api.learner_detail.advance_learner',
                       'learner_api.learner_detail.hydrate_source_training_plan',
                       'learner_api.learner_detail.persist_live_otjh_snapshot',
                       'learner_api.active_users.refresh_learner_ksb_snapshot'):
            stack.enter_context(patch(target, side_effect=AssertionError(f'{target} ran on a GET')))
        stack.enter_context(patch.object(Model, 'save', side_effect=AssertionError('Model.save on a GET')))

    def reference(self):
        """The approved parity reference: learner detail's read-only compact build."""
        return learner_detail.build_learner_detail(self.source, 101, compact=True, read_only=True)


class ParityTests(Fixture):
    def test_rows_match_learner_detail_assignments_field_for_field(self):
        detail = self.reference()
        expected, seen = [], set()
        for row in detail['components']:
            identity = row.get('componentId')
            if identity and identity not in seen and monthly._is_assignment(row):
                seen.add(identity)
                expected.append(row)
        rows = monthly.assignment_list(self.source, 101)['components']
        self.assertEqual([row['componentId'] for row in rows], ['A1', 'A2', 'A3', 'A4'])
        self.assertEqual([row['componentId'] for row in rows], [row['componentId'] for row in expected])
        for row, reference in zip(rows, expected):
            with self.subTest(component=row['componentId']):
                for key in LIST_KEYS:
                    # Both are compact: an omitted key means null.
                    self.assertEqual(row.get(key), reference.get(key), key)
                self.assertEqual(row['contentAvailable'], component_content_available(reference))
                self.assertEqual(set(row) - {'contentAvailable'}, set(LIST_KEYS) & (set(reference) | {
                    'module', 'week', 'component', 'expectedOtjh'}))

    def test_dates_otj_and_content_verdicts_are_carried(self):
        rows = {row['componentId']: row for row in monthly.assignment_list(self.source, 101)['components']}
        self.assertEqual(rows['A1']['sessionDate'], '2026-09-09')
        self.assertNotIn('sessionDate', rows['A3'])
        self.assertEqual({key: rows[key]['expectedOtjh'] for key in rows}, {'A1': 7.0, 'A2': 3.5, 'A3': None, 'A4': 2.0})
        # A2 has only the programme workbook: the template counts as its brief.
        self.assertEqual({key: rows[key]['contentAvailable'] for key in rows},
                         {'A1': True, 'A2': True, 'A3': True, 'A4': False})

    def test_marking_and_completion_match_for_every_assignment(self):
        detail = self.reference()
        data = monthly.assignment_list(self.source, 101)
        ids = {row['componentId'] for row in data['components']}

        def completed(payload):
            return {row['componentId'] for field in ('videoProgress', 'componentProgress')
                    for row in payload.get(field) or [] if row.get('componentId') in ids
                    and progress_record_counts_as_achieved(row)}

        self.assertEqual(data['componentMarkingStatus'],
                         {key: value for key, value in detail['componentMarkingStatus'].items() if key in ids})
        self.assertEqual(completed(data), completed(detail))
        self.assertEqual(completed(data), {'A1'})
        # Deleted and activity-event rows are excluded; failed attempts stay as history.
        self.assertEqual(sorted((row['componentId'], row['passed']) for row in data['componentProgress']),
                         [('A1', None), ('A3', False)])
        self.assertEqual(data['videoProgress'], [])

    def test_detail_matches_learner_detail_for_the_selected_assignment(self):
        reference = {}
        for row in self.reference()['components']:
            # The page keeps the first row for a repeated id.
            if row.get('componentId'):
                reference.setdefault(row['componentId'], row)
        for identity in ('A1', 'A2', 'A3', 'A4'):
            with self.subTest(component=identity):
                detail = monthly.assignment_detail(self.source, identity)
                self.assertEqual(detail['componentId'], identity)
                for key in DETAIL_KEYS:
                    self.assertEqual(detail.get(key), reference[identity].get(key), key)
        self.assertEqual(monthly.assignment_detail(self.source, 'A2')['fileName'], 'PCP.docx')


class ContractTests(Fixture):
    def test_list_returns_only_assignment_data(self):
        data = monthly.assignment_list(self.source, 101)
        self.assertEqual(set(data), {'learner', 'components', 'componentMarkingStatus', 'videoProgress', 'componentProgress'})
        self.assertEqual(data['learner'], {'id': '101', 'name': 'Learner'})
        for field in LEARNER_WIDE:
            self.assertNotIn(field, data)
        for row in data['components']:
            self.assertLessEqual(set(row), set(LIST_KEYS) | {'contentAvailable'})
            for key in DETAIL_KEYS:
                self.assertNotIn(key, row)
        self.assertNotIn('R1', data['componentMarkingStatus'])
        self.assertEqual(json.loads(json.dumps(data)), data)

    def test_progress_is_read_for_the_assignments_only(self):
        monthly.assignment_list(self.source, 101)
        filters = [kwargs for kind, kwargs in self.progress_calls if kind == 'filter']
        self.assertEqual(filters, [{'deleted_at__isnull': True, 'component_ref__in': ['A1', 'A2', 'A3', 'A4']}])
        self.assertIn(('exclude', {'kind': 'activity_event'}), self.progress_calls)

    def test_a_learner_without_a_profile_still_lists_assignments(self):
        self.profile = None
        data = monthly.assignment_list(self.source, 101)
        self.assertEqual(len(data['components']), 4)
        self.assertEqual((data['videoProgress'], data['componentProgress']), ([], []))

    def test_detail_resolves_only_the_owning_module(self):
        detail = monthly.assignment_detail(self.source, 'A2')
        self.assertEqual(detail['componentId'], 'A2')
        self.assertEqual([modules for modules, _ in self.resolver_calls], [['M2']])
        [(sql, params)] = self.sql
        self.assertTrue(sql.lstrip().upper().startswith('SELECT'))
        self.assertEqual(params, ['A2', ['M1', 'M2']])

    def test_detail_refuses_anything_not_an_assignment_in_this_plan(self):
        for identity in ('R1', 'V1', 'Q1', 'missing', 'A9'):
            with self.subTest(component=identity):
                self.assertIsNone(monthly.assignment_detail(self.source, identity))
        # An unassigned module is never resolved, even when the id exists there.
        self.assigned = [{'moduleId': 'M1'}]
        self.assertIsNone(monthly.assignment_detail(self.source, 'A2'))

    def test_detail_falls_back_to_the_whole_plan_for_id_less_modules(self):
        self.assigned = [{'moduleId': 'M1'}, {'moduleId': 'M2'}]
        self.connections['enrolment'] = SimpleNamespace(cursor=lambda: _NoRow())
        detail = monthly.assignment_detail(self.source, 'A3')
        self.assertEqual(detail['description'], '<p>Answer the question.</p>')
        self.assertEqual([modules for modules, _ in self.resolver_calls], [['M1', 'M2']])


class _NoRow:
    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        pass

    def fetchone(self):
        return None


class NoWriteTests(Fixture):
    def test_list_and_detail_never_repair_or_save(self):
        # setUp turns every repair and Model.save into a failure.
        monthly.assignment_list(self.source, 101)
        monthly.assignment_detail(self.source, 'A1')
        self.assertTrue(self.profile_calls)
        for args, kwargs in self.profile_calls:
            self.assertIs(kwargs.get('heal'), False)

    def test_the_module_does_not_reach_learner_detail_writers(self):
        for name in ('build_learner_detail', 'advance_learner', 'hydrate_source_training_plan',
                     'persist_live_otjh_snapshot', 'refresh_learner_ksb_snapshot', '_active_profile_for_source'):
            self.assertFalse(hasattr(monthly, name), name)


class Manager:
    def __init__(self, result):
        self.result = result

    def get(self, **kwargs):
        if isinstance(self.result, Exception):
            raise self.result
        if self.result is None:
            raise LookupError
        return self.result


def model(result):
    return SimpleNamespace(all_learners=Manager(result), DoesNotExist=LookupError)


class ViewTests(SimpleTestCase):
    factory = RequestFactory()

    def call(self, view, account, *args, method='get', source='source', pk=7):
        request = getattr(self.factory, method)('/')
        request.login_account = account
        result = make_source() if source == 'source' else source
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch.dict(monthly.SOURCE_MODELS, {'commercial': model(result), 'apprenticeship': model(result)}), \
             patch.object(monthly, 'assignment_list', return_value={'learner': {'id': str(pk)}, 'components': []}) as rows, \
             patch.object(monthly, 'assignment_detail', return_value={'componentId': 'A1'}) as detail:
            response = view(request, kind='commercial', pk=pk, **({'component_id': args[0]} if args else {}))
        return response, rows, detail

    def test_owner_and_staff_read_both_kinds_privately(self):
        for account in (SimpleNamespace(role='learner', subject_id=7), SimpleNamespace(role='staff', subject_id=1),
                        SimpleNamespace(role='admin', subject_id=1)):
            with self.subTest(role=account.role):
                response, rows, _ = self.call(monthly.monthly_submission, account)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response['Cache-Control'], 'private, no-store')
                rows.assert_called_once()
                response, _, detail = self.call(monthly.monthly_submission_assignment, account, 'A1')
                self.assertEqual((response.status_code, json.loads(response.content)), (200, {'componentId': 'A1'}))
                detail.assert_called_once()

    def test_another_learner_and_other_roles_are_refused_before_any_read(self):
        for account, status in ((SimpleNamespace(role='learner', subject_id=8), 404),
                                (SimpleNamespace(role='employer', subject_id=7), 403)):
            for view, args in ((monthly.monthly_submission, ()), (monthly.monthly_submission_assignment, ('A1',))):
                with self.subTest(role=account.role, view=view.__name__):
                    response, rows, detail = self.call(view, account, *args)
                    self.assertEqual(response.status_code, status)
                    rows.assert_not_called()
                    detail.assert_not_called()

    def test_unauthenticated_requests_are_refused(self):
        response, rows, _ = self.call(monthly.monthly_submission, None)
        self.assertEqual(response.status_code, 401)
        rows.assert_not_called()

    def test_writes_unknown_learners_and_unknown_assignments(self):
        owner = SimpleNamespace(role='learner', subject_id=7)
        response, rows, _ = self.call(monthly.monthly_submission, owner, method='post')
        self.assertEqual(response.status_code, 405)
        rows.assert_not_called()
        response, rows, _ = self.call(monthly.monthly_submission, owner, source=None)
        self.assertEqual((response.status_code, json.loads(response.content)), (404, {'error': 'Learner not found.'}))
        response, _, detail = self.call(monthly.monthly_submission_assignment, owner, 'x' * 201)
        self.assertEqual(response.status_code, 404)
        detail.assert_not_called()
        with patch.object(monthly, 'assignment_detail', return_value=None):
            request = self.factory.get('/')
            with patch.dict(monthly.SOURCE_MODELS, {'commercial': model(make_source())}):
                response = monthly.monthly_submission_assignment.__wrapped__(request, 'commercial', 7, 'R1')
        self.assertEqual((response.status_code, json.loads(response.content)),
                         (404, {'error': "Activity not found in this learner's plan."}))

    def test_database_failures_are_private_and_safe(self):
        request = self.factory.get('/')
        cases = (
            (monthly.monthly_submission, (), {'commercial': model(DatabaseError(LEAKY))}, None,
             'monthly_submission.source', monthly.LIST_UNAVAILABLE),
            (monthly.monthly_submission, (), {'commercial': model(make_source())}, 'assignment_list',
             'monthly_submission.build', monthly.LIST_UNAVAILABLE),
            (monthly.monthly_submission_assignment, ('A1',), {'commercial': model(make_source())}, 'assignment_detail',
             'monthly_submission_assignment.build', monthly.DETAIL_UNAVAILABLE),
        )
        for view, args, models, builder, operation, message in cases:
            with self.subTest(operation=operation), patch.dict(monthly.SOURCE_MODELS, models), \
                 (patch.object(monthly, builder, side_effect=DatabaseError(LEAKY)) if builder else ExitStack()), \
                 self.assertLogs('learner_api.monthly_submission', level='ERROR') as logs:
                response = view.__wrapped__(request, 'commercial', 7, *args)
            self.assertEqual((response.status_code, json.loads(response.content)), (502, {'error': message}))
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertIn(f'operation={operation}', logs.records[0].getMessage())
            for text in (response.content.decode(), logs.records[0].getMessage()):
                for secret in SECRETS:
                    self.assertNotIn(secret, text)


# --------------------------------------------------------------------------- #
# Scoped assignment dates (GET monthly-submission/<kind>/<pk>/dates/)
# --------------------------------------------------------------------------- #

DATE_FIELDS = ('date', 'date_source', 'date_needs_review', 'due_timing', 'week_end')
MODULE_ROW = ('MOD-1', '2026-10-26', 6, 'Monday', '10:00', '11:00', 'COHORT-1', None)
WEEK_ROWS = [('INTRO', 'MOD-1', 'Introduction'), ('W1', 'MOD-1', 'Week 1'), ('W2', 'MOD-1', 'Week 2'),
             ('W3', 'MOD-1', 'Week 3')]
# (id, module, week, title, type, schedule settings). Introduction, live, reading
# and quiz rows shape the week plan even though only assignments are returned.
COMPONENT_ROWS = [
    ('WELCOME', 'MOD-1', 'INTRO', 'Welcome assignment', 'assignment', {}),
    ('LIVE-1', 'MOD-1', 'W1', 'Live session', 'live_session', {}),
    ('READ-1', 'MOD-1', 'W1', 'Reading', 'reading', {}),
    ('A1', 'MOD-1', 'W1', 'Assignment 1', 'assignment', {'dueTiming': 'End of week'}),
    ('A2', 'MOD-1', 'W2', 'Assignment 2', ' ASSIGNMENT ', {}),
    ('QUIZ-1', 'MOD-1', 'W2', 'Quiz', 'quiz', {}),
    ('A3', 'MOD-1', 'W3', 'Assignment 3', 'assignment', {'sessionDate': '2026-12-01'}),
    ('A4', 'MOD-1', None, 'Unplaced assignment', 'Assignment', {}),
    # The approved legacy limit: listed as an assignment by an id-less legacy
    # plan, but the curriculum row with this id is a reading.
    ('LEGACY-1', 'MOD-1', 'W2', 'Legacy material', 'reading', {}),
]
HOLIDAYS = {'COHORT-1': [{'startDate': '2026-11-02', 'endDate': '2026-11-06'}]}


class DateCursor:
    """Answers the reader's SELECTs and the type lookup; refuses anything else."""

    def __init__(self, log, rows=COMPONENT_ROWS):
        self.log, self.rows, self.result = log, rows, []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.log.append((sql, params))
        assert sql.lstrip().upper().startswith('SELECT'), sql
        if 'FROM curriculum.modules m' in sql:
            self.result = [MODULE_ROW]
        elif 'FROM curriculum.weeks' in sql:
            self.result = list(WEEK_ROWS)
        elif 'FROM curriculum.components c' in sql:
            self.result = list(self.rows)
        elif sql.startswith('SELECT id, type FROM curriculum.components'):
            wanted = set(params[0])
            self.result = [(row[0], row[4]) for row in self.rows if row[0] in wanted]
        else:
            raise AssertionError(f'unexpected query: {sql}')

    def fetchall(self):
        return self.result


class DatesFixture(SimpleTestCase):
    factory = RequestFactory()

    def setUp(self):
        self.sql = []
        connections = {'enrolment': SimpleNamespace(cursor=lambda: DateCursor(self.sql))}
        stack = ExitStack()
        self.addCleanup(stack.close)
        self.subject_calls = []

        def subjects(cursor, pk):
            self.subject_calls.append(pk)
            return [{'id': 'MOD-1', 'title': 'Module'}]

        for target, new in {
            'learner_api.student_activity._effective_current_subjects': subjects,
            'learner_api.student_activity.connections': connections,
            'learner_api.monthly_submission.connections': connections,
            'curriculum_api.views.cohort_selected_holidays_by_cohort': lambda ids: HOLIDAYS,
            # subject-covers' other readers, which the dates endpoint never calls.
            'learner_api.subject_store.ready': lambda cursor: False,
            'learner_api.student_activity._builder_subject_metadata': lambda cursor, refs: ({}, {}),
            'learner_api.previous_learning_groups.read_previous_learning_groups': lambda *args: {},
            'learner_api.subject_origins.read_imported_courses': lambda *args: {},
            'learner_api.subject_origins.read_replacement_courses': lambda *args: {},
            'learner_api.progress_transfer.cover_transfer_metadata': lambda pk: {},
        }.items():
            stack.enter_context(patch(target, new))
        stack.enter_context(patch('curriculum_api.views.ensure_module_authoring_tables',
                                  side_effect=AssertionError('schema helper on a GET')))
        stack.enter_context(patch.object(Model, 'save', side_effect=AssertionError('Model.save on a GET')))
        stack.enter_context(patch.object(monthly, 'learner_profile_for_source',
                                         side_effect=AssertionError('profile resolved for dates')))
        self.owner = SimpleNamespace(role='learner', subject_id=101)

    def as_account(self, view, account, method='get', **kwargs):
        request = getattr(self.factory, method)('/', {'refs': ''} if method == 'get' else None)
        request.login_account = account
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch('login.permissions._auth_gate_enabled', return_value=True), \
             patch.dict(monthly.SOURCE_MODELS, {'commercial': model(make_source()), 'apprenticeship': model(make_source())}):
            return view(request, **kwargs)

    def covers(self):
        from .student_activity import subject_covers
        response = self.as_account(subject_covers, self.owner, pk=101)
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)['activity_dates']

    def scoped(self, account=None, method='get'):
        return self.as_account(monthly.monthly_submission_dates, account if account is not None else self.owner,
                               method=method, kind='commercial', pk=101)


class DatesParityTests(DatesFixture):
    def test_each_assignment_date_equals_subject_covers_field_for_field(self):
        full = self.covers()
        response = self.scoped()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        body = json.loads(response.content)
        self.assertEqual(set(body), {'activity_dates'})
        dates = body['activity_dates']
        self.assertEqual(set(dates), {'WELCOME', 'A1', 'A2', 'A3', 'A4'})
        for identity, schedule in dates.items():
            with self.subTest(component=identity):
                self.assertEqual(set(schedule), set(DATE_FIELDS))
                # Same values, including nulls and empty strings, as the full read.
                self.assertEqual(schedule, {field: full[identity].get(field) for field in DATE_FIELDS})

    def test_week_placement_uses_every_component_before_filtering(self):
        full = self.covers()
        dates = json.loads(self.scoped().content)['activity_dates']
        reader_sql = [sql for sql, _ in self.sql if 'FROM curriculum.components c' in sql]
        self.assertEqual(len(reader_sql), 2)  # once for subject-covers, once here
        self.assertEqual(reader_sql[0], reader_sql[1])  # the reader query is not narrowed
        self.assertEqual(dates['WELCOME']['date_source'], 'introduction')
        self.assertEqual(dates['A3']['date_source'], 'builder_session')
        self.assertEqual(dates['A3']['date'], '2026-12-01')
        self.assertEqual(dates['A1']['due_timing'], 'End of week')
        self.assertIsNone(dates['A4']['date'])
        self.assertIsNone(dates['A4']['week_end'])
        for identity in ('A1', 'A2'):
            self.assertEqual(dates[identity]['date'], full[identity]['date'])
            self.assertEqual(dates[identity]['week_end'], full[identity]['week_end'])

    def test_the_reader_runs_over_every_component_before_filtering(self):
        # Filter after, never before: the unchanged reader sees the whole week plan.
        from . import builder_activity_dates as reader
        real, seen = reader.read_builder_activity_dates, []

        def record(*args, **kwargs):
            seen.append((args[1:], kwargs, real(*args, **kwargs)))
            return seen[-1][2]

        with patch.object(reader, 'read_builder_activity_dates', side_effect=record):
            dates = json.loads(self.scoped().content)['activity_dates']
        [(args, kwargs, computed)] = seen
        self.assertEqual((args, kwargs), ((['MOD-1'],), {}))
        self.assertEqual(set(computed), {row[0] for row in COMPONENT_ROWS if row[2] or row[0] == 'A4'})
        self.assertEqual(set(dates), {'WELCOME', 'A1', 'A2', 'A3', 'A4'})

    def test_non_assignments_and_the_accepted_legacy_mismatch_are_excluded(self):
        full = self.covers()
        dates = json.loads(self.scoped().content)['activity_dates']
        for identity in ('LIVE-1', 'READ-1', 'QUIZ-1'):
            self.assertIn(identity, full)
            self.assertNotIn(identity, dates)
        # Accepted limit (owner decision): subject-covers dates LEGACY-1, the
        # scoped read does not; the page falls back to that row's sessionDate.
        self.assertIn('LEGACY-1', full)
        self.assertNotIn('LEGACY-1', dates)

    def test_the_same_module_scope_as_subject_covers(self):
        self.covers()
        self.scoped()
        self.assertEqual(self.subject_calls, [101, 101])
        lookups = [params for sql, params in self.sql if sql.startswith('SELECT id, type FROM curriculum.components')]
        self.assertEqual(len(lookups), 1)
        self.assertEqual(set(lookups[0][0]), set(self.covers()))

    def test_no_current_modules_returns_no_dates_without_queries(self):
        with patch('learner_api.student_activity._effective_current_subjects', return_value=[]):
            response = self.scoped()
        self.assertEqual(json.loads(response.content), {'activity_dates': {}})
        self.assertEqual(self.sql, [])


class DatesAccessTests(DatesFixture):
    def test_owner_and_staff_may_read(self):
        for account in (self.owner, SimpleNamespace(role='staff', subject_id=1), SimpleNamespace(role='admin', subject_id=1)):
            with self.subTest(role=account.role):
                self.assertEqual(self.scoped(account).status_code, 200)

    def test_others_are_refused_before_any_query(self):
        for account, status in ((SimpleNamespace(role='learner', subject_id=8), 404),
                                (SimpleNamespace(role='employer', subject_id=101), 403)):
            with self.subTest(role=account.role):
                self.sql.clear()
                self.assertEqual(self.scoped(account).status_code, status)
                self.assertEqual(self.sql, [])
        request = self.factory.get('/')
        with patch('login.permissions.authenticate_request', return_value=None), \
             patch('login.permissions._auth_gate_enabled', return_value=True):
            response = monthly.monthly_submission_dates(request, kind='commercial', pk=101)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(self.sql, [])

    def test_writes_are_refused(self):
        self.assertEqual(self.scoped(method='post').status_code, 405)
        self.assertEqual(self.sql, [])

    def test_unknown_learner_and_safe_database_failures(self):
        request = self.factory.get('/')
        with patch.dict(monthly.SOURCE_MODELS, {'commercial': model(None)}):
            response = monthly.monthly_submission_dates.__wrapped__(request, 'commercial', 7)
        self.assertEqual((response.status_code, json.loads(response.content)), (404, {'error': 'Learner not found.'}))
        for models, failure, operation in (
                ({'commercial': model(DatabaseError(LEAKY))}, AssertionError('not reached'), 'monthly_submission_dates.source'),
                ({'commercial': model(make_source())}, DatabaseError(LEAKY), 'monthly_submission_dates.build')):
            with self.subTest(operation=operation), patch.dict(monthly.SOURCE_MODELS, models), \
                 patch.object(monthly, 'assignment_dates', side_effect=failure), \
                 self.assertLogs('learner_api.monthly_submission', level='ERROR') as logs:
                response = monthly.monthly_submission_dates.__wrapped__(request, 'commercial', 7)
            self.assertEqual((response.status_code, json.loads(response.content)), (502, {'error': monthly.DATES_UNAVAILABLE}))
            self.assertEqual(response['Cache-Control'], 'private, no-store')
            self.assertIn(f'operation={operation}', logs.records[0].getMessage())
            for text in (response.content.decode(), logs.records[0].getMessage()):
                for secret in SECRETS:
                    self.assertNotIn(secret, text)
