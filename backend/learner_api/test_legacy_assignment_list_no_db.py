"""O01 regressions with real source functions and intercepted I/O only.

Run: python -B backend/learner_api/test_legacy_assignment_list_no_db.py
No Django startup, settings, database drivers or external services. The response
double verifies payload bytes/headers, not the real Django/HTTP integration.
"""
import ast
from contextlib import nullcontext
from copy import deepcopy
from datetime import date, datetime, timezone
import functools
import json
import logging
from pathlib import Path
import sys
from types import ModuleType, SimpleNamespace
import unittest
from unittest.mock import Mock, patch


ROOT = Path(__file__).resolve().parent


def forbidden(*args, **kwargs):
    raise AssertionError('Unmocked I/O prohibited in O01 tests')


def guard(event, args):
    if event == 'import' and args[0].split('.')[0] in {
        'django', 'psycopg', 'psycopg2', 'sqlite3', 'httpx', 'requests', 'azure',
    }:
        forbidden()
    if event.startswith('socket.') or event in {'subprocess.Popen', 'os.system'}:
        forbidden()
    if event == 'open':
        name, mode, flags = args
        if str(name).replace(chr(92), '/').split('/')[-1].startswith('.env'):
            forbidden()
        if isinstance(mode, str) and any(char in mode for char in 'wax+'):
            forbidden()
        if isinstance(flags, int) and flags & (1 | 2 | 64 | 512 | 1024):
            forbidden()


# Audit hooks cannot be removed: constrain only this standalone subprocess,
# without installing a global import/I/O policy during other test discovery.
if __name__ == '__main__':
    sys.addaudithook(guard)


def definitions(path, names, scope, constants=()):
    """Execute named unmodified source definitions, including real decorators."""
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if
             (isinstance(node, ast.FunctionDef) and node.name in names) or
             (isinstance(node, ast.Assign) and any(
                 isinstance(target, ast.Name) and target.id in constants
                 for target in node.targets))]
    found = {node.name for node in nodes if isinstance(node, ast.FunctionDef)}
    if found != set(names):
        raise AssertionError(f'Missing source functions: {set(names) - found}')
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), scope)
    return scope


class Response(dict):
    """Explicit HTTP response double; no fake Django module/imports."""
    def __init__(self, payload, status=200):
        super().__init__()
        self.status_code = status
        self.content = json.dumps(payload).encode('utf-8')


class DatabaseError(Exception):
    pass


def evidence_rows():
    # Preserve intentionally non-sorted fixture order; no real learner data.
    return [dict(evidence_id=702, aptem_id=601, component_id=91,
                 evidence_name='Second.pdf', component_name='Module B',
                 evidence_status='Accepted', file_blob='synthetic-file',
                 report_blob='synthetic-report', feedbacks='[{"text":"Original"}]',
                 submission_date=datetime(2026, 1, 4, tzinfo=timezone.utc),
                 activity_date=date(2025, 6, 20), learner_name='Synthetic learner',
                 programme_name='Example programme', run_id=19),
            dict(evidence_id=701, aptem_id=601, component_id=92,
                 evidence_name='First.pdf', component_name='Module A',
                 evidence_status=None, file_blob=None, report_blob=None,
                 feedbacks='invalid JSON', submission_date=None,
                 activity_date=None, learner_name='Synthetic learner',
                 programme_name='Example programme', run_id=19)]


COMPACT = {'assignments': [
    {'id': 'aptem:601:evidence:702', 'activityId': 'aptem:601:evidence:702',
     'title': 'Second.pdf', 'moduleTitle': 'Module B', 'status': 'accepted',
     'month': '2025-06', 'dateCompleted': '2025-06-20',
     'submittedAt': '2026-01-04T00:00:00+00:00', 'submissionOrigin': 'classified_legacy'},
    {'id': 'aptem:601:evidence:701', 'activityId': 'aptem:601:evidence:701',
     'title': 'First.pdf', 'moduleTitle': 'Module A', 'status': 'unknown',
     'month': '', 'dateCompleted': '', 'submittedAt': None,
     'submissionOrigin': 'classified_legacy'},
]}


class LegacyAssignmentListTests(unittest.TestCase):
    def setUp(self):
        self.rows = evidence_rows()
        self.calls = []
        self.classification_error = None
        self.mark_error = None
        self.mark_rows = [(702, 'accepted', 'Reviewed', 'Synthetic reviewer',
                           datetime(2026, 2, 1, tzinfo=timezone.utc))]

        def execute(sql, params):
            self.calls.append((sql, params))
            if 'Advanced_admin_legacy_marks' in sql:
                if self.mark_error:
                    raise self.mark_error
                self.cursor.fetchall.return_value = self.mark_rows
            else:
                if self.classification_error:
                    raise self.classification_error
                selected = [row for row in self.rows if not params[2] or
                            f"aptem:{row['aptem_id']}:evidence:{row['evidence_id']}" == params[2]]
                columns = list(evidence_rows()[0])
                self.cursor.description = [(key,) for key in columns]
                self.cursor.fetchall.return_value = [tuple(row[key] for key in columns)
                                                     for row in selected]

        self.cursor = Mock(execute=Mock(side_effect=execute))
        connection = SimpleNamespace(cursor=lambda: nullcontext(self.cursor))
        connections = {'enrolment': connection}
        marks = definitions(ROOT / 'legacy_marking.py', {'reviews_for_evidence'},
                            {'connections': connections})
        self.mark_reader = Mock(wraps=marks['reviews_for_evidence'])
        self.content = Mock(return_value={'text': 'Selected content'})

        # Local relative imports are explicitly injected; no app import/setup.
        package = ModuleType('learner_api')
        package.__path__ = []
        marking = ModuleType('learner_api.legacy_marking')
        marking.reviews_for_evidence = self.mark_reader
        content = ModuleType('learner_api.assignment_content')
        content.load_assignment_content = self.content
        legacy = ModuleType('learner_api.legacy_assignments')
        self.legacy = definitions(ROOT / 'legacy_assignments.py',
                                  {'classified_rows', 'classified_submission', 'classified_response'},
                                  {'__package__': 'learner_api', 'json': json,
                                   'connections': connections, 'JsonResponse': Response},
                                  constants=('CLASSIFIED_SQL',))
        legacy.classified_response = self.legacy['classified_response']
        topics = ModuleType('learner_api.assignment_topics')
        definitions(ROOT / 'assignment_topics.py', {'topic_id', 'aggregate_statuses'},
                    topics.__dict__, constants=('STATUS_PRIORITY',))
        topics.json = json
        modules = patch.dict(sys.modules, {'learner_api': package,
                             'learner_api.legacy_marking': marking,
                             'learner_api.assignment_content': content,
                             'learner_api.legacy_assignments': legacy,
                             'learner_api.assignment_topics': topics})
        modules.start()
        self.addCleanup(modules.stop)

        self.account = SimpleNamespace(role='learner', subject_id=501)
        self.unreadable = False
        permissions = definitions(ROOT.parent / 'login' / 'permissions.py',
                                  {'_unauthenticated', '_unavailable', '_read_only_learner_view',
                                   '_target_learner_id', '_error_bad_target',
                                   '_learner_progress_gate', 'learner_self_or_staff'},
                                  {'functools': functools, 'JsonResponse': Response,
                                   '_auth_gate_enabled': lambda: True,
                                   'authenticate_request': lambda request: self.account,
                                   'session_unreadable': lambda request: self.unreadable})
        logger = Mock(spec=logging.Logger)
        self.view = definitions(ROOT / 'reflection_submissions.py',
                                {'_text', '_error', 'create_reflection_submission',
                                 'get_reflection_submission'},
                                {'__package__': 'learner_api', 'json': json,
                                 'JsonResponse': Response, 'DatabaseError': DatabaseError,
                                 'connections': connections, 'logger': logger,
                                 'csrf_exempt': lambda view: view,  # No HTTP middleware in this harness.
                                 'learner_self_or_staff': permissions['learner_self_or_staff'],
                                 '_submit_reflection': forbidden},
                                constants=('VALID_KINDS',))['create_reflection_submission']

    def request(self, kind='commercial', **query):
        return SimpleNamespace(method='GET', GET={
            'view': 'assignments', 'learnerKind': kind, 'learnerId': '501', **query})

    def read(self, **query):
        return self.view(self.request(**query))

    def assert_response(self, response, payload, status=200):
        self.assertEqual(response.status_code, status)
        self.assertEqual(json.loads(response.content), payload)
        self.assertEqual(response.content, json.dumps(payload).encode('utf-8'))

    def test_empty_list_skips_marks_and_content(self):
        self.rows = []
        response = self.read()
        self.assert_response(response, {'assignments': []})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.mark_reader.assert_not_called()
        self.content.assert_not_called()

    def test_nonempty_compact_json_matches_characterization_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.assert_response(self.read(kind=kind), COMPACT)
        self.content.assert_not_called()

    def test_nonempty_list_never_invokes_marks_reader_or_its_sql(self):
        self.mark_reader.side_effect = AssertionError('Compact list invoked marks')
        self.assert_response(self.read(), COMPACT)
        self.mark_reader.assert_not_called()
        self.assertFalse(any('Advanced_admin_legacy_marks' in sql for sql, _ in self.calls))
        self.assertEqual(len(self.calls), 1)  # Intercepted feature SQL, not physical DB count.

    def test_list_preserves_classification_query_parameters_and_input_rows(self):
        original = deepcopy(self.rows)
        self.read(kind='apprenticeship')
        sql, params = self.calls[0]
        self.assertEqual(params, ['apprenticeship', '501', '', ''])
        for clause in ('u.aptem_id', 'u."Email"', "r.status = 'completed'",
                       'r.source_fingerprint IS NOT NULL', 'v.source_evidence_ids',
                       'ORDER BY e.evidence_id, v.id'):
            self.assertIn(clause, sql)
        self.assertEqual(self.rows, original)

    def test_selected_detail_keeps_actual_reader_reviews_and_content(self):
        activity = 'aptem:601:evidence:702'
        response = self.read(activityType='assignment', activityId=activity)
        submission = json.loads(response.content)['submission']
        self.assertEqual(submission['activityId'], activity)
        self.assertEqual(submission['legacyAssignment']['lmsReviews'], [{
            'decision': 'accepted', 'feedback': 'Reviewed', 'reviewedBy': 'Synthetic reviewer',
            'reviewedAt': '2026-02-01T00:00:00+00:00'}])
        self.assertEqual(submission['legacyAssignment']['content'], {'text': 'Selected content'})
        self.mark_reader.assert_called_once_with(601, [702])
        self.content.assert_called_once_with(self.rows[0], [{'text': 'Original'}])
        self.assertEqual(self.calls[0][1], ['commercial', '501', activity, activity])
        self.assertEqual(self.calls[1][1], ['601', [702]])
        self.assertEqual(response['Cache-Control'], 'private, no-store')

    def test_selected_detail_without_reviews_keeps_empty_review_array(self):
        self.mark_rows = []
        response = self.read(activityType='assignment', activityId='aptem:601:evidence:701')
        self.assertEqual(json.loads(response.content)['submission']['legacyAssignment']['lmsReviews'], [])
        self.mark_reader.assert_called_once_with(601, [701])

    def test_missing_selected_assignment_returns_null_without_marks_or_content(self):
        response = self.read(activityType='assignment', activityId='aptem:601:evidence:999')
        self.assert_response(response, {'submission': None})
        self.mark_reader.assert_not_called()
        self.content.assert_not_called()

    def test_unauthenticated_is_denied_before_any_read(self):
        self.account = None
        self.assert_response(self.read(), {'error': 'Authentication required.',
                                          'code': 'unauthenticated'}, 401)
        self.assertEqual(self.calls, [])
        self.mark_reader.assert_not_called()

    def test_unreadable_session_remains_unavailable(self):
        self.account = None
        self.unreadable = True
        response = self.read()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)['code'], 'session_unavailable')
        self.assertEqual(response['Retry-After'], '5')
        self.assertEqual(self.calls, [])

    def test_other_learner_is_denied_before_list_and_detail_reads(self):
        self.account = SimpleNamespace(role='learner', subject_id=502)
        for query in ({}, {'activityType': 'assignment', 'activityId': 'aptem:601:evidence:702'}):
            with self.subTest(query=query):
                self.assert_response(self.read(**query), {'error': 'Not found.'}, 404)
        self.assertEqual(self.calls, [])
        self.mark_reader.assert_not_called()

    def test_employer_role_is_forbidden_before_reads(self):
        self.account = SimpleNamespace(role='employer', subject_id=501)
        response = self.read()
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)['code'], 'read_only_learner_view')
        self.assertEqual(self.calls, [])

    def test_staff_and_admin_keep_list_and_detail_read_access(self):
        for role in ('staff', 'admin'):
            with self.subTest(role=role):
                self.account = SimpleNamespace(role=role, subject_id=900)
                self.assert_response(self.read(), COMPACT)
                response = self.read(activityType='assignment', activityId='aptem:601:evidence:702')
                self.assertTrue(json.loads(response.content)['submission']['legacyAssignment']['lmsReviews'])

    def test_invalid_target_or_kind_or_unpaired_activity_is_rejected_before_reads(self):
        for query in ({'learnerId': ''}, {'learnerId': 'invalid'}, {'learnerKind': 'invalid'},
                      {'activityType': 'assignment'}, {'activityId': 'aptem:601:evidence:702'},
                      {'assignmentTopicId': '99'}):
            with self.subTest(query=query):
                self.assertEqual(self.read(**query).status_code, 400)
        self.assertEqual(self.calls, [])
        self.mark_reader.assert_not_called()

    def test_classification_database_failure_preserves_502_error(self):
        self.classification_error = DatabaseError('synthetic classification failure')
        self.assert_response(self.read(), {'error': 'Could not load the saved reflection.'}, 502)
        self.mark_reader.assert_not_called()

    def test_selected_marks_database_failure_preserves_502_error(self):
        self.mark_error = DatabaseError('synthetic marks failure')
        response = self.read(activityType='assignment', activityId='aptem:601:evidence:702')
        self.assert_response(response, {'error': 'Could not load the saved reflection.'}, 502)
        self.content.assert_not_called()

    def test_compact_list_does_not_depend_on_unavailable_marks(self):
        self.mark_error = DatabaseError('synthetic unused marks failure')
        self.assert_response(self.read(), COMPACT)
        self.mark_reader.assert_not_called()


if __name__ == '__main__':
    unittest.main(verbosity=2)
