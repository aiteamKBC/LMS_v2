"""Real extra-activity policies and handlers with mocked DB/calendar dependencies."""
import ast
import calendar
import json
import math
import uuid
import unittest
from datetime import date, datetime, timedelta, timezone as utc
from inspect import unwrap
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
from urllib.parse import urlparse
from zoneinfo import ZoneInfo
from django.conf import settings
from django.http import JsonResponse
from .extra_activities import list_extra_activities
from .extra_activity_month import valid_activity_month
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
            valid_activity_month=valid_activity_month,
            JsonResponse=JsonResponse, connections={'enrolment': self.connection}, DatabaseError=RuntimeError,
            canonical_learning=SimpleNamespace(require_profile=lambda _: {'id': 272}),
            booking_date_restriction=lambda day, **_: day.weekday() >= 5,
            available_ksb_codes=lambda _: {'K1'}, approved_evidence_ids=lambda _: {'file-1'},
            valid_presentation=lambda _: False, EXTRA_CHECK_KEYS={'answer', 'learning', 'evidence', 'ksbs', 'planned', 'declarations', 'hours'})
        load('monthly_assignment.py', {'text', 'mapping', 'items', 'words', 'month_bounds', 'valid_time_entries', 'assignment_checks'}, self.scope)
        load('extra_activities.py', {'prepare_extra_activity', 'extra_activity_checks'}, self.scope)
        sentence = ' '.join(['learning'] * 25)
        self.payload = {'learnerKind': 'commercial', 'learnerId': '101', 'activityType': 'extra_activity',
            'activityId': 'extra:00000000-0000-4000-8000-000000000001', 'activityTitle': 'Workshop',
            'assignmentAnswer': ' '.join(['learning'] * 120), 'whatYouLearned': sentence, 'actualTimeHours': '2',
            'monthlyAssignment': {'month': '2026-10', 'understood': sentence, 'gainedSkills': sentence,
                'claims': [{'code': 'K1', 'explanation': sentence, 'evidenceIds': []}],
                'timeEntries': [{'topic': 'Workshop', 'hours': '2', 'date': '2026-10-01'}],
                'plannedReviewed': True, 'newKnowledge': True, 'newSkills': True, 'sharingConsent': True}}

    def test_missing_month_defaults_to_current_uk_month_and_only_eight_checks_apply(self):
        del self.payload['monthlyAssignment']['month']
        checks = self.scope['extra_activity_checks'](self.payload)
        self.assertEqual(len(checks), 8)
        self.assertTrue(all(c['passed'] for c in checks))
        self.assertNotIn('meeting', [c['key'] for c in checks])
        prepared = self.scope['prepare_extra_activity'](self.payload)
        self.assertEqual(prepared['monthlyAssignment']['month'], '2026-10')
        self.assertEqual(prepared['dateCompleted'], '2026-10-01')
        self.assertNotIn('month', self.payload['monthlyAssignment'])

    def test_selected_past_and_future_months_are_preserved_for_both_learner_types(self):
        for kind in ('commercial', 'apprenticeship'):
            for month, day in [('2026-09', '2026-09-29'), ('2026-11', '2026-11-02'), ('2025-12', '2025-12-01')]:
                with self.subTest(kind=kind, month=month):
                    self.payload['learnerKind'] = kind
                    self.payload['monthlyAssignment']['month'] = month
                    self.payload['monthlyAssignment']['timeEntries'][0]['date'] = day
                    prepared = self.scope['prepare_extra_activity'](self.payload)
                    self.assertEqual(prepared['monthlyAssignment']['month'], month)
                    self.assertEqual(prepared['dateCompleted'], '2026-10-01')
                    self.assertTrue(all(check['passed'] for check in self.scope['extra_activity_checks'](self.payload)))

    def test_invalid_month_is_rejected_instead_of_silently_changing_the_claim(self):
        for month in ('', None, '2026-13', '2026-1', '0000-01', '2026-09-29', 202609):
            with self.subTest(month=month), self.assertRaisesRegex(ValueError, 'activity month'):
                self.scope['prepare_extra_activity']({**self.payload, 'monthlyAssignment': {'month': month}})

    def test_dates_must_still_belong_to_selected_month(self):
        self.payload['monthlyAssignment']['month'] = '2026-09'
        checks = {check['key']: check['passed'] for check in self.scope['extra_activity_checks'](self.payload)}
        self.assertFalse(checks['hours'])
        self.assertEqual(self.payload['monthlyAssignment']['timeEntries'][0]['hours'], '2')

    def test_invalid_identity_and_unowned_claims_cannot_pass(self):
        with self.assertRaises(ValueError):
            self.scope['prepare_extra_activity']({**self.payload, 'activityId': 'real-assignment'})
        self.payload['monthlyAssignment']['claims'][0]['code'] = 'OTHER'
        self.payload['monthlyAssignment']['evidence'] = [{'id': 'someone-elses-file', 'name': 'Evidence', 'points': '1'}]
        checks = {c['key']: c['passed'] for c in self.scope['extra_activity_checks'](self.payload)}
        self.assertFalse(checks['evidence']); self.assertFalse(checks['ksbs'])

    def test_month_list_shows_pending_immediately_and_excludes_drafts_other_months(self):
        rows = [
            {'id': '00000000-0000-4000-8000-000000000001', 'title': 'Workshop', 'status': 'pending',
             'submitted_at': self.now, 'reviewed_at': None, 'activity_date': date(2026, 10, 1),
             'requested_minutes': 120, 'reflection_payload': {'full_submission': self.payload},
             'review_note': None, 'reviewed_by': None},
            {'id': '00000000-0000-4000-8000-000000000002', 'title': 'Draft', 'status': 'draft',
             'submitted_at': None, 'reviewed_at': None, 'activity_date': date(2026, 10, 1),
             'requested_minutes': 120, 'reflection_payload': {'full_submission': self.payload},
             'review_note': None, 'reviewed_by': None},
            {'id': '00000000-0000-4000-8000-000000000003', 'title': 'September', 'status': 'approved',
             'submitted_at': self.now, 'reviewed_at': self.now, 'activity_date': date(2026, 9, 1),
             'requested_minutes': 120, 'reflection_payload': {'full_submission': {
                 **self.payload, 'monthlyAssignment': {'month': '2026-09'}}},
             'review_note': 'Accepted', 'reviewed_by': 'Coach'},
        ]
        for kind in ('commercial', 'apprenticeship'):
            with patch('learner_api.extra_activity_store.list_rows', return_value=rows) as native:
                response = unwrap(list_extra_activities)(SimpleNamespace(
                    GET={'learnerKind': kind, 'learnerId': '101', 'month': '2026-10'}))
            activities = json.loads(response.content)['activities']
            self.assertEqual([a['title'] for a in activities], ['Workshop'])
            self.assertEqual(activities[0]['status'], 'submitted_for_tutor_review')
            native.assert_called_once_with(101, kind)

    def test_selected_month_filters_history_without_changing_submission_timestamp(self):
        self.payload['monthlyAssignment']['month'] = '2026-09'
        rows = [
            {'id': '00000000-0000-4000-8000-000000000001', 'title': 'September work', 'status': 'approved',
             'submitted_at': self.now, 'reviewed_at': None, 'activity_date': date(2026, 10, 1),
             'requested_minutes': 120, 'reflection_payload': {'full_submission': self.payload},
             'review_note': None, 'reviewed_by': None},
            {'id': '00000000-0000-4000-8000-000000000002', 'title': 'Legacy October', 'status': 'approved',
             'submitted_at': self.now, 'reviewed_at': None, 'activity_date': date(2026, 10, 1),
             'requested_minutes': 120, 'reflection_payload': {},
             'review_note': None, 'reviewed_by': None},
        ]
        request = SimpleNamespace(GET={'learnerKind': 'apprenticeship', 'learnerId': '101', 'month': '2026-09'})
        with patch('learner_api.extra_activity_store.list_rows', return_value=rows):
            activities = json.loads(unwrap(list_extra_activities)(request).content)['activities']
        self.assertEqual(len(activities), 1)
        self.assertEqual(activities[0]['month'], '2026-09')
        self.assertEqual(activities[0]['submittedAt'], self.now.isoformat())
        request.GET['month'] = '2026-10'
        with patch('learner_api.extra_activity_store.list_rows', return_value=rows):
            legacy = json.loads(unwrap(list_extra_activities)(request).content)['activities']
        self.assertEqual([row['title'] for row in legacy], ['Legacy October'])

    def test_new_extra_activity_cannot_use_the_legacy_missing_time_entries_exemption(self):
        del self.payload['monthlyAssignment']['timeEntries']
        checks = {c['key']: c['passed'] for c in self.scope['extra_activity_checks'](self.payload)}
        self.assertFalse(checks['hours'])
