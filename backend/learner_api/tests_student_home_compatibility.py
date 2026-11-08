"""Student Home compatibility regressions; database and network are prohibited."""
import ast
import json
from datetime import date
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, RequestFactory
from . import learner_detail as detail, canonical_learning as canonical, dashboard_metrics
from . import overview_week as overview, training_plan_dashboard as training
from .models import EnrolmentUser, LearnerProfile


class StudentHomeCompatibilityTests(SimpleTestCase):
    def test_real_orm_compiles_every_source_projection_for_both_kinds(self):
        tree = ast.parse(Path(detail.__file__).read_text(encoding='utf-8'))
        summary = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == 'learner_summary')
        only = next(n for n in ast.walk(summary) if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == 'only')
        summary_fields = [ast.literal_eval(n) for n in only.args]
        for kind, model in detail.SOURCE_MODELS.items():
            for fields in (summary_fields, overview.HOME_SOURCE_FIELDS, training.TRAINING_PLAN_SOURCE_FIELDS):
                with self.subTest(kind=kind, fields=fields):
                    sql, params = model.all_learners.only(*fields).filter(pk=265).query.get_compiler(using='enrolment').as_sql()
                    self.assertIn(265, params)
                    self.assertTrue({'programme', 'cohort', 'group'}.isdisjoint(fields))
        LearnerProfile.objects.only(*training.TRAINING_PLAN_PROFILE_FIELDS).query.get_compiler(using='enrolment').as_sql()

    def source(self, kind):
        return EnrolmentUser(id=265, username='Synthetic Learner', email='learner@example.test',
            learner_type=kind, programme_status='Active', start_date=date(2026, 1, 1), end_date=date(2027, 1, 1))

    def test_summary_placement_is_one_read_by_enrolment_for_both_kinds_and_missing_links(self):
        for kind in ('commercial', 'apprenticeship'):
            for names in (('Official', 'Cohort', 'Group'), ('Official', 'Cohort', None),
                          ('Official', None, None), (None, None, None), None):
                with self.subTest(kind=kind, names=names):
                    source = self.source(kind)
                    cursor = MagicMock()
                    cursor.fetchone.return_value = names
                    conn = MagicMock()
                    conn.cursor.return_value.__enter__.return_value = cursor
                    with patch.object(EnrolmentUser.all_learners, 'only') as only, \
                         patch('learner_api.models.connections', {'enrolment': conn}), \
                         patch.object(detail, 'access_gate', return_value={}), \
                         patch.object(detail, 'learning_access', return_value={}), \
                         patch.object(detail, 'student_activity_available', return_value=False):
                        only.return_value.get.return_value = source
                        response = detail.learner_summary.__wrapped__(RequestFactory().get('/'), kind, 265)
                    self.assertEqual(response.status_code, 200)
                    payload = json.loads(response.content)
                    self.assertEqual(payload['id'], '265')
                    self.assertEqual([payload[k] for k in ('programme', 'cohort', 'group')], [v or '' for v in (names or (None, None, None))])
                    only.return_value.get.assert_called_once_with(pk=265)
                    cursor.execute.assert_called_once()
                    sql, params = cursor.execute.call_args.args
                    self.assertIn('l.enrolment_id = %s', sql)
                    self.assertEqual(params, [265])
                    self.assertNotIn('UPDATE', sql)

    def test_summary_database_error_is_generic_json_including_placement_failure(self):
        for placement in (False, True):
            with patch.object(EnrolmentUser.all_learners, 'only') as only, \
                 patch('learner_api.models._learner_placement_names', side_effect=DatabaseError('private SQL')):
                if placement:
                    only.return_value.get.return_value = self.source('commercial')
                else:
                    only.return_value.get.side_effect = DatabaseError('private SQL')
                response = detail.learner_summary.__wrapped__(RequestFactory().get('/'), 'commercial', 265)
            self.assertEqual(response.status_code, 502)
            self.assertNotIn('private SQL', response.content.decode())

    def test_canonical_profile_joins_curriculum_and_keeps_independent_ids(self):
        owner = dict(id=321, enrolment_id=265, email='learner@example.test', account_email='learner@example.test',
                     account_record_id=265, programme_planned_hours=120, learner_start_date=None, learner_end_date=None)
        with patch.object(canonical, 'query', return_value=[owner]) as query:
            self.assertEqual(canonical.require_profile(265)['id'], 321)
        sql, params = query.call_args.args
        self.assertEqual(params, [265])
        self.assertIn('WHERE l.enrolment_id=%s', sql)
        self.assertIn('p.programme_id=l.programme_id', sql)
        self.assertIn('p.name AS programme', sql)
        self.assertIn('l.planned_hours AS programme_planned_hours', sql)
        self.assertNotIn('u."Planned_hours"', sql)
        self.assertNotIn('l.programme,', sql)

    def test_target_to_date_uses_only_owner_learner_dates(self):
        source = SimpleNamespace(pk=265, start_date='2020-01-01', learner_start_date='2021-01-01', end_date='2030-01-01')
        for start, end in ((date(2026, 1, 1), date(2027, 1, 1)), (None, None)):
            owner = {'learner_start_date': start, 'learner_end_date': end, 'start_date': '2022-01-01'}
            with patch('coach_api.views.apply_otjh_to_date_metrics', return_value={'otjhTargetAsOfToday': 42}) as calculate:
                self.assertEqual(dashboard_metrics.coach_otjh_target_to_date(source, {'planned': 100}, owner=owner), 42)
            self.assertEqual(calculate.call_args.args[0]['otjhProgrammeStartDate'], start)
            self.assertEqual(calculate.call_args.args[0]['plannedEndDate'], end)

    def test_all_home_endpoints_preserve_access_gate_for_both_kinds(self):
        from login import permissions
        accounts = [(None, 401), (SimpleNamespace(role='employer'), 403),
                    (SimpleNamespace(role='learner', subject_id=999), 404),
                    (SimpleNamespace(role='learner', subject_id=265), 200),
                    (SimpleNamespace(role='staff'), 200), (SimpleNamespace(role='admin'), 200)]
        for kind in ('commercial', 'apprenticeship'):
            for account, expected in accounts:
                for view, section in ((detail.learner_summary, ''), (overview.overview_week, 'home-summary'),
                                      (training.training_plan_dashboard, 'upcoming')):
                    with self.subTest(kind=kind, role=getattr(account, 'role', None), section=section), \
                         patch.object(permissions, '_auth_gate_enabled', return_value=True), \
                         patch.object(permissions, 'authenticate_request', return_value=account), \
                         patch.object(EnrolmentUser.all_learners, 'only') as only, \
                         patch.object(detail, 'access_gate', return_value={}), \
                         patch.object(detail, 'learning_access', return_value={}), \
                         patch.object(detail, 'student_activity_available', return_value=False), \
                         patch.object(overview, 'read_week', return_value={'homeProgress': {}}), \
                         patch.object(training, 'read_dashboard', return_value={'events': []}), \
                         patch.object(canonical, 'require_profile', return_value={'id': 321, 'enrolment_id': 265}):
                        source = self.source(kind)
                        source.__dict__['_placement_names'] = (None, None, None)
                        only.return_value.get.return_value = source
                        response = view(RequestFactory().get('/?section=' + section), kind=kind, pk=265)
                        self.assertEqual(response.status_code, expected)
                        if expected != 200:
                            only.assert_not_called()

    def test_learner_metrics_never_add_review_planned_hours(self):
        from . import journal_sources
        owner = {'id': 321, 'enrolment_id': 265, 'programme_planned_hours': 100}
        with patch.object(journal_sources, 'enabled', return_value=True), \
             patch.object(canonical, 'entries_for', return_value=[]), \
             patch.object(canonical, 'targets_for', return_value={}), \
             patch('coach_api.migrated_otjh.planned_hours_bulk', return_value={265: 50}) as reviews:
            for value in (None, 0, 100):
                owner['programme_planned_hours'] = value
                result = canonical.metrics(265, owner=owner)
                self.assertEqual(result['otjh']['planned'], value)
                self.assertEqual(result['otjh']['review_planned'], 50)
        self.assertEqual(reviews.call_count, 3)

    def test_summary_missing_enrolment_and_unknown_kind_keep_404(self):
        with patch.object(EnrolmentUser.all_learners, 'only') as only:
            only.return_value.get.side_effect = EnrolmentUser.DoesNotExist
            response = detail.learner_summary.__wrapped__(RequestFactory().get('/'), 'commercial', 265)
            self.assertEqual(response.status_code, 404)
        self.assertEqual(detail.learner_summary.__wrapped__(RequestFactory().get('/'), 'unknown', 265).status_code, 404)
