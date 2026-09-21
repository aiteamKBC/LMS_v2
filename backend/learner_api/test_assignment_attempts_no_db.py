"""No database, application imports, or external services."""
import ast
import json
import uuid
import unittest
from contextlib import nullcontext
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock
from django.conf import settings
from django.http import JsonResponse
from .assignment_attempts import HISTORY_KEY, preserve_attempts, submission_attempts

if not settings.configured:
    settings.configure(DEFAULT_CHARSET='utf-8')


class AttemptHistoryTests(unittest.TestCase):
    def test_rejected_then_pending_then_accepted_keep_two_distinct_answers(self):
        old = {'assignmentAnswer': 'Original answer'}
        new = {'assignmentAnswer': 'Revised answer'}
        preserve_attempts(new, old, 'rejected', '2026-09-01', 'Add evidence', 'Coach', '2026-09-02')
        pending = submission_attempts(new, 'submitted_for_tutor_review', '2026-09-03')
        self.assertEqual([a['status'] for a in pending], ['rejected', 'submitted_for_tutor_review'])
        accepted = submission_attempts(new, 'accepted', '2026-09-03', 'Well done', 'Coach', '2026-09-04')
        self.assertEqual([a['status'] for a in accepted], ['rejected', 'accepted'])
        self.assertEqual([a['answer'] for a in accepted], ['Original answer', 'Revised answer'])
        self.assertEqual([a['coachFeedback'] for a in accepted], ['Add evidence', 'Well done'])

    def test_repeated_draft_saves_do_not_create_attempts_or_trust_client_history(self):
        stored = {'assignmentAnswer': 'First'}
        draft = {'assignmentAnswer': 'Second', HISTORY_KEY: [{'status': 'accepted'}]}
        preserve_attempts(draft, stored, 'rejected')
        for _ in range(4):
            incoming = {'assignmentAnswer': 'Editing', HISTORY_KEY: [], 'submissionAttempts': ['forged']}
            preserve_attempts(incoming, draft, 'draft')
            draft = incoming
        self.assertEqual(len(submission_attempts(draft, 'draft')), 1)
        self.assertEqual(draft[HISTORY_KEY][0]['content']['assignmentAnswer'], 'First')
        self.assertNotIn('submissionAttempts', draft)

    def test_first_draft_is_not_a_submission(self):
        draft = {'assignmentAnswer': 'In progress'}
        preserve_attempts(draft, {})
        self.assertEqual(submission_attempts(draft, 'draft'), [])

    def test_snapshots_do_not_nest_history_or_change_on_later_edits(self):
        draft = {'assignmentAnswer': 'Second'}
        preserve_attempts(draft, {'assignmentAnswer': 'First'}, 'rejected')
        third = {'assignmentAnswer': 'Third'}
        preserve_attempts(third, draft, 'rejected')
        draft[HISTORY_KEY][0]['content']['assignmentAnswer'] = 'Modified elsewhere'
        self.assertEqual(third[HISTORY_KEY][0]['content']['assignmentAnswer'], 'First')
        self.assertNotIn(HISTORY_KEY, third[HISTORY_KEY][1]['content'])


class SaveBoundaryTests(unittest.TestCase):
    def test_actual_draft_handler_archives_review_before_overwriting_row(self):
        # Compile the real handler without importing its auth/database modules.
        source = Path(__file__).with_name('reflection_submissions.py')
        wanted = {'_submit_reflection', '_error', '_text', '_dict', '_list'}
        nodes = [n for n in ast.parse(source.read_text(encoding='utf-8')).body if isinstance(n, ast.FunctionDef) and n.name in wanted]
        for node in nodes:
            node.decorator_list = []
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        old = {'assignmentAnswer': 'Rejected answer'}
        cursor.fetchone.side_effect = [('rejected', old, 'Please revise', 'Coach', None, None), ('submission-1',)]
        scope = dict(json=json, uuid=uuid, date=date, JsonResponse=JsonResponse,
                     VALID_KINDS={'commercial', 'apprenticeship'}, connections={'enrolment': connection},
                     transaction=SimpleNamespace(atomic=lambda **_: nullcontext()), DatabaseError=RuntimeError,
                     _reflection_lineage=lambda *_: {}, preserve_attempts=preserve_attempts, submission_attempts=submission_attempts)
        exec(compile(ast.Module(body=nodes, type_ignores=[]), str(source), 'exec'), scope)
        request = SimpleNamespace(method='POST', body=json.dumps({'learnerKind': 'commercial', 'learnerId': '1', 'activityType': 'assignment', 'activityId': 'A1', 'submissionMode': 'draft', 'assignmentAnswer': 'New answer', HISTORY_KEY: []}).encode())
        response = scope['_submit_reflection'](request)
        self.assertEqual(response.status_code, 201)
        attempts = json.loads(response.content)['submissionAttempts']
        self.assertEqual(len(attempts), 1)
        self.assertEqual(attempts[0]['answer'], 'Rejected answer')
        self.assertEqual(attempts[0]['coachFeedback'], 'Please revise')
        sql, values = cursor.execute.call_args.args
        self.assertIn('coach_feedback = CASE', sql)
        documents = [json.loads(v) for v in values if isinstance(v, str) and v.startswith('{')]
        saved = next(v for v in documents if HISTORY_KEY in v)
        self.assertEqual(saved['assignmentAnswer'], 'New answer')
        self.assertEqual(saved[HISTORY_KEY][0]['content'], old)
