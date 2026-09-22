"""Real extra-activity policies and handlers with mocked DB/calendar dependencies."""
import ast
import calendar
import json
import math
import uuid
import unittest
from contextlib import nullcontext
from datetime import date, datetime, timedelta, timezone as utc
from pathlib import Path
from types import SimpleNamespace, ModuleType
from unittest.mock import MagicMock, patch
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
from django.conf import settings
from django.http import JsonResponse
from .assignment_attempts import preserve_attempts, submission_attempts
if not settings.configured:
    settings.configure(DEFAULT_CHARSET='utf-8')
ROOT = Path(__file__).parent


def load(filename, names, scope):
    nodes = [n for n in ast.parse((ROOT / filename).read_text(encoding='utf-8')).body if isinstance(n, ast.FunctionDef) and n.name in names]
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), filename, 'exec'), scope)


class ExtraActivityTests(unittest.TestCase):
    def setUp(self):
        for target in ('socket.socket.connect', 'socket.create_connection'):
            blocker = patch(target, side_effect=AssertionError('No network allowed'))
            blocker.start(); self.addCleanup(blocker.stop)
        self.connection = MagicMock()
        self.cur = self.connection.cursor.return_value.__enter__.return_value
        self.now = datetime(2026, 9, 30, 23, 30, tzinfo=utc.utc)
        self.scope = dict(__package__='learner_api', json=json, math=math, calendar=calendar, urlparse=urlparse, uuid=uuid, UUID=uuid.UUID,
            date=date, timedelta=timedelta, ZoneInfo=ZoneInfo, timezone=SimpleNamespace(now=lambda: self.now),
            JsonResponse=JsonResponse, connections={'enrolment': self.connection}, DatabaseError=RuntimeError,
            booking_date_restriction=lambda day, **_: day.weekday() >= 5,
            available_ksb_codes=lambda _: {'K1'}, approved_evidence_ids=lambda _: {'file-1'},
            valid_presentation=lambda _: False, EXTRA_CHECK_KEYS={'answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours'})
        load('monthly_assignment.py', {'text', 'mapping', 'items', 'words', 'month_bounds', 'valid_time_entries', 'assignment_checks'}, self.scope)
        load('extra_activities.py', {'prepare_extra_activity', 'extra_activity_checks', 'list_extra_activities'}, self.scope)
        sentence = ' '.join(['learning'] * 25)
        self.payload = {'learnerKind': 'commercial', 'learnerId': '101', 'activityType': 'extra_activity',
            'activityId': 'extra:00000000-0000-4000-8000-000000000001', 'activityTitle': 'Workshop',
            'assignmentAnswer': ' '.join(['learning'] * 120), 'whatYouLearned': sentence, 'actualTimeHours': '2',
            'monthlyAssignment': {'month': '2000-01', 'understood': sentence, 'gainedSkills': sentence,
                'claims': [{'code': 'K1', 'explanation': sentence, 'evidenceIds': []}],
                'timeEntries': [{'topic': 'Workshop', 'hours': '2', 'date': '2026-10-01'}],
                'plannedReviewed': True, 'newKnowledge': True, 'newSkills': True, 'sharingConsent': True}}

    def test_month_is_actual_uk_submission_month_and_only_eight_checks_apply(self):
        checks = self.scope['extra_activity_checks'](self.payload)
        self.assertEqual(len(checks), 8)
        self.assertTrue(all(c['passed'] for c in checks))
        self.assertNotIn('meeting', [c['key'] for c in checks])
        prepared = self.scope['prepare_extra_activity'](self.payload)
        self.assertEqual(prepared['monthlyAssignment']['month'], '2026-10')
        self.assertEqual(prepared['dateCompleted'], '2026-10-01')
        self.assertEqual(self.payload['monthlyAssignment']['month'], '2000-01')

    def test_invalid_identity_and_unowned_claims_cannot_pass(self):
        with self.assertRaises(ValueError):
            self.scope['prepare_extra_activity']({**self.payload, 'activityId': 'real-assignment'})
        self.payload['monthlyAssignment']['claims'][0]['code'] = 'OTHER'
        self.payload['monthlyAssignment']['evidence'] = [{'id': 'someone-elses-file', 'name': 'Evidence', 'points': '1'}]
        checks = {c['key']: c['passed'] for c in self.scope['extra_activity_checks'](self.payload)}
        self.assertFalse(checks['evidence']); self.assertFalse(checks['ksbs'])

    def test_month_list_shows_pending_immediately_and_excludes_drafts_other_months(self):
        data = json.dumps(self.payload)
        self.cur.fetchall.return_value = [
            ('extra:1', 'Workshop', 'submitted_for_tutor_review', self.now, data, None, None, None),
            ('extra:2', 'Draft', 'draft', self.now, data, None, None, None),
            ('extra:3', 'September', 'accepted', self.now - timedelta(days=1), data, 'Accepted', 'Coach', self.now),
        ]
        for kind in ('commercial', 'apprenticeship'):
            response = self.scope['list_extra_activities'](SimpleNamespace(GET={'learnerKind': kind, 'learnerId': '101', 'month': '2026-10'}))
            activities = json.loads(response.content)['activities']
            self.assertEqual([a['title'] for a in activities], ['Workshop'])
            self.assertEqual(activities[0]['status'], 'submitted_for_tutor_review')
            self.assertEqual(self.cur.execute.call_args.args[1], [kind, '101'])

    def test_submit_checks_and_preserves_rejected_history_and_blocks_pending_overwrite(self):
        extra = ModuleType('learner_api.extra_activities'); extra.__dict__.update(self.scope)
        monthly = ModuleType('learner_api.monthly_assignment'); monthly.assignment_checks = self.scope['assignment_checks']
        self.scope.update(VALID_KINDS={'commercial', 'apprenticeship'}, transaction=SimpleNamespace(atomic=lambda **_: nullcontext()),
            _reflection_lineage=lambda *_: {}, preserve_attempts=preserve_attempts, submission_attempts=submission_attempts)
        load('reflection_submissions.py', {'_submit_reflection', '_error', '_text', '_dict', '_list'}, self.scope)
        with patch.dict('sys.modules', {'learner_api.extra_activities': extra, 'learner_api.monthly_assignment': monthly}):
            self.cur.fetchone.side_effect = [('rejected', self.payload, 'Add evidence', 'Coach', None, None), ('saved-1',)]
            request = SimpleNamespace(method='POST', body=json.dumps({**self.payload, 'submissionMode': 'submit'}).encode())
            response = self.scope['_submit_reflection'](request)
            self.assertEqual(response.status_code, 201)
            attempts = json.loads(response.content)['submissionAttempts']
            self.assertEqual([a['status'] for a in attempts], ['rejected', 'submitted_for_tutor_review'])
            self.assertEqual(attempts[0]['coachFeedback'], 'Add evidence')
            self.cur.fetchone.side_effect = [('submitted_for_tutor_review', self.payload, None, None, None, None)]
            response = self.scope['_submit_reflection'](request)
            self.assertEqual(response.status_code, 409)


    def test_new_extra_activity_cannot_use_the_legacy_missing_time_entries_exemption(self):
        del self.payload['monthlyAssignment']['timeEntries']
        checks = {c['key']: c['passed'] for c in self.scope['extra_activity_checks'](self.payload)}
        self.assertFalse(checks['hours'])
