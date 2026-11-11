"""Isolated grouping tests: SQLite in memory and mocked external boundaries."""
import copy
import json
import sqlite3
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import patch
from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory
from . import web_week_points as author
from .web_week_points_schema import provision
from learner_api import web_week_points as learner


class MemoryCursor:
    def __init__(self, raw): self.raw = raw
    def __enter__(self): return self
    def __exit__(self, *args): self.raw.close()
    def execute(self, sql, params=()): return self.raw.execute(sql.replace('%s', '?'), params)
    def fetchone(self): return self.raw.fetchone()
    def fetchall(self): return self.raw.fetchall()


class MemoryDatabase:
    vendor = 'sqlite'
    ops = SimpleNamespace(quote_name=lambda name: '"' + name + '"')
    def __init__(self): self.raw = sqlite3.connect(':memory:')
    def cursor(self): return MemoryCursor(self.raw.cursor())


class OptionalPointTests(SimpleTestCase):
    def setUp(self):
        self.points = [{'id': 'P1', 'title': 'Explore', 'componentIds': ['R1', 'Q1']},
                       {'id': 'P2', 'title': 'Apply', 'componentIds': ['V1']}]

    def test_store_round_trip_conflicts_and_removal_do_not_touch_activities(self):
        db = MemoryDatabase()
        self.addCleanup(db.raw.close)
        provision(db)
        with patch.object(author.timezone, 'now', return_value='2026-11-09T12:00:00Z'):
            self.assertEqual(author.save_configuration('M1', 'W1', self.points, 0, 1, db=db), 1)
            self.assertEqual(author.read_configurations(['W1'], db=db)['W1']['points'], self.points)
            for module, revision in [('M1', 0), ('M1', 2), ('M2', 1)]:
                with self.assertRaises(author.RevisionConflict):
                    author.save_configuration(module, 'W1', [], revision, 2, db=db)
            self.assertEqual(author.save_configuration('M1', 'W1', [], 1, 1, db=db), 2)
            self.assertEqual(author.read_configurations(['W1'], db=db)['W1']['points'], [])

    def test_validation_rejects_duplicates_cross_week_and_bad_names(self):
        allowed = {'R1', 'Q1', 'V1'}
        self.assertEqual(author.validate_points(self.points, allowed), self.points)
        for extra in [dict(id='P3', title='Other', componentIds=['OTHER']),
                      dict(id='P3', title='Other', componentIds=['R1']),
                      dict(id='P1', title='Other', componentIds=[]),
                      dict(id='P3', title=' ', componentIds=[])]:
            with self.subTest(extra=extra), self.assertRaises(ValueError):
                author.validate_points([*self.points, extra], allowed)

    def test_projection_is_grouping_only_and_never_reads_or_changes_progress(self):
        rows = [('R1','W1','M1'), ('Q1','W1','M1'), ('V1','W1','M1'), ('FREE','W1','M1'), ('OTHER','W2','M2')]
        config = {'W1': {'moduleId': 'M1', 'points': self.points}}
        before = copy.deepcopy((rows, config))
        result = learner.project_points(rows, config)
        self.assertEqual(result['weeks']['W1']['points'], self.points)
        self.assertEqual(learner.project_points(rows, {}), {'weeks': {}})
        self.assertEqual((rows, config), before)
        self.assertNotIn('activities', result)  # no access/visibility overrides
        self.assertNotIn('locked', json.dumps(result))

    def test_stale_members_and_cross_module_config_cannot_move_another_activity(self):
        config = {'W1': {'moduleId': 'M1', 'points': self.points}}
        result = learner.project_points([('R1','W1','M1'), ('Q1','W2','M2')], config)
        self.assertEqual(result['weeks']['W1']['points'][0]['componentIds'], ['R1'])
        config['W1']['moduleId'] = 'M2'
        self.assertEqual(learner.project_points([('R1','W1','M1')], config), {'weeks': {}})

    def author_request(self, *, role='staff', access='curriculum', method='get', csrf=True, saved=None):
        account = SimpleNamespace(id=1, role=role, subject_id=7) if role else None
        request = getattr(RequestFactory(), method)('/points/',
            data=json.dumps({'points': self.points, 'expectedRevision': 0}) if method == 'put' else {},
            content_type='application/json')
        request.login_account = account
        request._dont_enforce_csrf_checks = csrf
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch('login.permissions._accesses_of', return_value={access}), \
             patch('curriculum_api.module_hours.stored_module', return_value=('M1', {})), \
             patch.object(author.transaction, 'atomic', return_value=nullcontext()), \
             patch.object(author, 'saved_week', return_value=[{'id': cid, 'title': cid, 'type': 'reading'} for cid in ('R1','Q1','V1')]), \
             patch.object(author, 'read_configurations', return_value=saved or {}), \
             patch.object(author, 'save_configuration', return_value=1) as save, \
             patch('curriculum_api.views.lock_module_structure_row'), \
             patch('curriculum_api.views.authoring_module_exists', return_value={'title':'Module'}), \
             patch('curriculum_api.views.archived_programme_module_edit_error', return_value=None):
            response = author.week_points(request, module_id='M1', week_id='W1')
        return response, save

    def test_author_permissions_and_empty_default(self):
        response, save = self.author_request()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)['points'], [])
        save.assert_not_called()
        for role, access, expected in [('learner','curriculum',403), ('employer','curriculum',403),
                                      ('staff','enrolment',403), (None,'curriculum',401)]:
            response, save = self.author_request(role=role, access=access, method='put')
            self.assertEqual(response.status_code, expected)
            save.assert_not_called()

    def test_save_requires_csrf_and_preserves_explicit_assignment(self):
        response, save = self.author_request(method='put', csrf=False)
        self.assertEqual(response.status_code, 403)
        save.assert_not_called()
        response, save = self.author_request(method='put')
        self.assertEqual(response.status_code, 200)
        save.assert_called_once_with('M1', 'W1', self.points, 0, 1)

    def test_learner_endpoint_ownership_both_kinds_and_failed_read(self):
        for kind in ('commercial','apprenticeship'):
            for role, subject, expected in [('learner',7,200), ('learner',8,404), ('staff',8,200), ('employer',7,403)]:
                account = SimpleNamespace(role=role, subject_id=subject)
                request = RequestFactory().get('/points/')
                request.login_account = account
                with patch('login.permissions.authenticate_request', return_value=account), \
                     patch.object(learner, 'learner_plan', return_value={'weeks': {}}) as read:
                    response = learner.web_points(request, kind=kind, pk=7)
                self.assertEqual(response.status_code, expected)
                self.assertEqual(read.call_count, 1 if expected == 200 else 0)
        request = RequestFactory().get('/points/')
        account = SimpleNamespace(role='learner', subject_id=7)
        request.login_account = account
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch.object(learner, 'learner_plan', side_effect=DatabaseError('unavailable')):
            self.assertEqual(learner.web_points(request, kind='commercial', pk=7).status_code, 503)
