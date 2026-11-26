"""Teaching reviews: synthetic lecture context, SQLite storage, blocked network."""
from contextlib import contextmanager
from copy import deepcopy
from datetime import datetime, timezone
from io import BytesIO
import json
from pathlib import Path
import re
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch
from uuid import uuid4

from django.db import connections
from django.test import SimpleTestCase, RequestFactory
from pypdf import PdfReader
from login import permissions
from coach_api import quality_review_api as quality, quality_review_store as store
from coach_api.quality_form_definition import default_definition
from coach_api.quality_review_pdf import _render
from coach_api.test_quality_feedback_library import answers
from coach_api.test_quality_reviews import SQLiteAdapter, snapshot as coaching_snapshot
from . import teaching_quality as api

SCOPE = {'moduleId': 'module-one', 'seriesId': 'series-one', 'occurrenceId': 'occurrence-one'}
ROW = {'module_title': 'Synthetic teaching lecture', 'tutor_name': 'Synthetic Tutor',
       'tutor_email': 'tutor@example.invalid', 'programme_name': 'Synthetic Programme',
       'cohort_name': 'Synthetic Cohort', 'group_name': 'Group A',
       'scheduled_start': datetime(2026, 11, 2, 10, tzinfo=timezone.utc),
       'scheduled_end': datetime(2026, 11, 2, 11, tzinfo=timezone.utc)}


class TeachingQualityTests(SimpleTestCase):
    def setUp(self):
        assert all(value['ENGINE'] == 'django.db.backends.sqlite3' for value in connections.databases.values())
        self.db = sqlite3.connect(':memory:')
        self.db.row_factory = lambda cursor, row: dict(zip([c[0] for c in cursor.description], row))
        self.db.create_function('octet_length', 1, len)
        self.db.create_function('jsonb_array_length', 1, lambda value: len(json.loads(value)))
        self.db.create_function('regexp', 2, lambda pattern, value: bool(re.search(pattern.replace(r'\y', r'\b'), value or '', re.I)))
        # SQLite has no ALTER COLUMN DROP NOT NULL; use the v4 column shape
        # while exercising the actual shared store, revision and document SQL.
        for version in (1, 2):
            sql = (Path(__file__).resolve().parents[1] / 'coach_api' / 'sql' / f'coaching_quality_v{version}.sql').read_text()
            sql = re.sub(r'CREATE SCHEMA[^;]+;|COMMENT ON SCHEMA[^;]+;', '', sql)
            sql = sql.replace('learner_id text NOT NULL', 'learner_id text').replace('learner_name text NOT NULL', 'learner_name text')
            self.db.executescript(sql.replace('lms_quality.', ''))
        @contextmanager
        def connect(**kwargs):
            with self.db:
                yield SQLiteAdapter(self.db)
        self.enterContext(patch.object(store, 'connect', side_effect=connect))
        self.addCleanup(self.db.close)
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))
        self.factory = RequestFactory()
        self.staff = SimpleNamespace(id=1, email='reviewer@example.invalid', username='Reviewer', access='curriculum', access_extra='')
        self.enterContext(patch.object(quality, '_staff', return_value=self.staff))
        def authenticate(request):
            request.login_account = SimpleNamespace(subject_id=1, subject_type='staff', role='staff')
            return request.login_account
        self.enterContext(patch.object(permissions, 'authenticate_request', side_effect=authenticate))
        self.accesses = self.enterContext(patch.object(permissions, '_accesses_of', return_value=frozenset({'curriculum'})))
        self.row = deepcopy(ROW)
        self.read = self.enterContext(patch.object(api.session_results, 'read',
            side_effect=lambda sql, params: [self.row] if params == list(SCOPE.values()) else []))

    def request(self, method='get', scope=None, **changes):
        from urllib.parse import urlencode
        path = '/curriculum_api/curriculum/session-recordings/quality/?' + urlencode(scope or SCOPE)
        if method == 'get':
            return self.factory.get(path)
        value = {'expectedVersion': 0, 'requestId': str(uuid4()), 'reviewType': 'FORM_TEACHING',
                 'templateVersion': 1, 'status': 'draft', 'form': answers(default_definition('FORM_TEACHING'))}
        value.update(changes)
        request = self.factory.post(path, data=json.dumps(value), content_type='application/json')
        request._dont_enforce_csrf_checks = True
        return request

    def save(self, **changes):
        response = api.teaching_review(self.request('post', **changes))
        self.assertEqual(response.status_code, 200, response.content)
        return json.loads(response.content)['review']

    def test_uses_existing_teaching_questions_and_server_owned_tutor_without_a_learner(self):
        response = api.teaching_review(self.request())
        value = json.loads(response.content)
        self.assertEqual(value['template'], default_definition('FORM_TEACHING'))
        self.assertEqual(value['snapshot']['coach']['email'], ROW['tutor_email'])
        self.assertIsNone(value['snapshot']['learner'])
        self.assertEqual(value['learners'], [])
        self.assertIn('Subject expertise and vocational relevance',
                      [q['text'] for s in value['template']['sections'] for q in s['criteria']])

    def test_draft_reopen_retry_and_stale_writer_preserve_one_review_and_history(self):
        key = str(uuid4())
        first = self.save(requestId=key)
        self.assertEqual(self.save(requestId=key), first)
        self.assertIsNone(first['learner'])
        self.assertEqual(self.db.execute('SELECT learner_id FROM review').fetchone()['learner_id'], None)
        response = api.teaching_review(self.request())
        self.assertEqual(json.loads(response.content)['review'], first)
        changed = deepcopy(first['form'])
        changed['answers']['session-context'] = 'Later teaching observation.'
        newer = self.save(expectedVersion=1, form=changed)
        self.assertEqual(newer['id'], first['id'])
        self.assertEqual(newer['version'], 2)
        self.assertEqual(store.read_revision(first['id'], 1)['form'], first['form'])
        self.assertEqual(api.teaching_review(self.request('post', expectedVersion=1)).status_code, 409)

    def test_separate_module_occurrence_and_tutor_never_overwrite_another_review(self):
        first = self.save()
        for key in SCOPE:
            response = api.teaching_review(self.request(scope={**SCOPE, key: 'another'}))
            self.assertEqual(response.status_code, 404)
        self.row['tutor_email'] = 'other-tutor@example.invalid'
        other = self.save()
        self.assertNotEqual(first['id'], other['id'])
        self.assertEqual(store.read_review(review_id=first['id'])['coach']['email'], ROW['tutor_email'])

    def test_uses_published_override_and_freezes_it_after_a_save(self):
        published = default_definition('FORM_TEACHING')
        published['sections'][0]['criteria'][0]['text'] = 'Published teaching context'
        store.save_template(published, expected=0, request_id=str(uuid4()), actor='staff:1', publish=True)
        saved = self.save(templateVersion=2)
        self.assertEqual(saved['definition']['sections'][0]['criteria'][0]['text'], 'Published teaching context')
        published['sections'][0]['criteria'][0]['text'] = 'Changed for future reviews'
        store.save_template(published, expected=1, request_id=str(uuid4()), actor='staff:1', publish=True)
        self.assertEqual(json.loads(api.teaching_review(self.request()).content)['template'], saved['definition'])

    def test_forbidden_roles_missing_csrf_and_client_context_are_rejected(self):
        self.staff.access = 'coach'
        self.assertEqual(api.teaching_review(self.request()).status_code, 403)
        self.staff.access = 'tutor'
        self.assertEqual(api.teaching_review(self.request('post')).status_code, 403)
        self.staff.access = 'curriculum'
        self.accesses.return_value = frozenset()
        self.assertEqual(api.teaching_review(self.request('post')).status_code, 403)
        self.accesses.return_value = frozenset({'curriculum'})
        request = self.request('post'); request._dont_enforce_csrf_checks = False
        self.assertEqual(api.teaching_review(request).status_code, 403)
        for change in ({'reviewType': 'FORM_MONTHLY_COACHING'}, {'learnerId': '123'}, {'coach': {'email': 'forged@example.invalid'}}, {'expectedVersion': True}):
            self.assertEqual(api.teaching_review(self.request('post', **change)).status_code, 400)
        self.assertEqual(self.db.execute('SELECT count(*) AS n FROM review').fetchone()['n'], 0)

    def test_missing_tutor_invalid_time_and_incomplete_completion_are_visible(self):
        self.row.update(tutor_name='', tutor_email='')
        self.assertEqual(api.teaching_review(self.request()).status_code, 400)
        self.row.update(ROW)
        self.row['scheduled_end'] = self.row['scheduled_start']
        self.assertEqual(api.teaching_review(self.request()).status_code, 400)
        self.row.update(ROW)
        incomplete = answers(default_definition('FORM_TEACHING')); incomplete['answers'] = {}
        self.assertEqual(api.teaching_review(self.request('post', status='completed', form=incomplete)).status_code, 400)

    def test_completed_pdf_contains_tutor_class_and_actual_teaching_form(self):
        saved = self.save(status='completed')
        self.assertIsNotNone(store.read_document(saved['id'], saved['version']))
        content = _render(saved, {})
        text = '\n'.join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
        for expected in ('Teaching Session Feedback Form', 'Synthetic Tutor', 'Synthetic Cohort', 'Group A', 'Subject expertise and vocational relevance'):
            self.assertIn(expected, text)
        self.assertNotIn('Synthetic Learner', text)

    def test_teaching_reviews_do_not_change_coaching_lists_or_allow_coach_update_path(self):
        teaching = self.save()
        coach = store.save_review(coaching_snapshot(), expected=0, request_id=str(uuid4()), actor='staff:1')
        rows, _ = store.list_reviews('2026-01-01', '2027-01-01')
        self.assertEqual([row['id'] for row in rows], [coach['id']])
        request = self.request('post')
        request.method = 'PUT'
        self.assertEqual(quality.review_detail(request, teaching['id']).status_code, 400)
        self.assertEqual(store.read_review(review_id=teaching['id'])['version'], 1)
