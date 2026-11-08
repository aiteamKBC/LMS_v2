"""Slice 03b-2C: Dashboard Overview exposes metrics.otjh.officialPlannedHours.

Database and network are prohibited. The real dashboard_tab / Employer views,
read_tab, read_overview, Target-to-Date helper and formula run; only data
readers are synthetic (the shared Employer parity fixture plus register mocks).
"""
import json
from contextlib import ExitStack, contextmanager
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import (canonical_learning, dashboard_metrics, dashboard_tabs, employer_learning, employer_portal,
               official_hours)
from . import test_employer_learning_no_db as employer_parity
from . import training_plan_dashboard as schedule
from .journal_sources import learner_journal_reads

START, END, MID = date(2026, 1, 1), date(2027, 1, 1), date(2026, 7, 2)
MONTHLY = {'2026-01': 200.0, '2026-07': 200.0}      # Training Plan: hours.planned 400
INVALID = (Decimal('-1'), Decimal('NaN'), Decimal('Infinity'), Decimal('-Infinity'), 'abc', '')
GOLDEN = ((Decimal('288.00'), 288.0, 143.61), (None, None, None), (Decimal('0'), 0.0, None),
          *((raw, None, None) for raw in INVALID))
FIELDS = {'actual', 'targetToDate', 'officialPlannedHours'}


def official(raw):
    """What metrics_bulk(learner_workspace=True) holds for a stored value."""
    return canonical_learning.programme_planned_hours(None, owner={'programme_planned_hours': raw})


class _Missing(Exception):
    pass


class OfficialPlannedHoursTests(SimpleTestCase):
    fixture = employer_parity.EmployerLearningParityTests.fixture

    @contextmanager
    def dashboard(self, raw, *, today=MID):
        """The shared fixture with learner dates, a Training Plan and no extra readers."""
        with ExitStack() as stack:
            source, owner, profile = stack.enter_context(self.fixture(planned=official(raw), today=today))
            owner.update(learner_start_date=START, learner_end_date=END, programme_planned_hours=raw,
                         Planned_hours=576)                          # historical: never read
            stack.enter_context(patch('coach_api.bulk_register.register_rows', return_value={'17': []}))
            stack.enter_context(patch('learner_api.attendance.kbc_attendance_rows', return_value=[]))
            stack.enter_context(patch('learner_api.canonical_learning.targets_for', return_value=dict(MONTHLY)))
            calls = SimpleNamespace(
                plan=stack.enter_context(patch.object(schedule, 'plan_planned_hours', return_value=400.0)),
                reviews=stack.enter_context(patch('coach_api.migrated_otjh.planned_hours_bulk',
                                                  return_value={265: 20})),
                selector_query=stack.enter_context(patch.object(official_hours, 'query')),
                identity=canonical_learning.require_profile,
                bulk=canonical_learning.metrics_bulk,
                save=stack.enter_context(patch('learner_api.models.LearnerProfile.save')),
            )
            yield source, owner, calls

    def read(self, raw, *, kind='commercial', today=MID):
        request = RequestFactory().get('/', {'month': '2026-07'})
        with self.dashboard(raw, today=today) as (source, owner, calls):
            with learner_journal_reads():
                learner = dashboard_tabs.read_tab(source, kind, 'overview', request)
            employer = employer_learning.read_dashboard(source, kind, 'overview', request)
            counts = (calls.identity.call_count, calls.bulk.call_count)
        return learner, employer, calls, counts, owner

    # 1-6, 8: values, presence, type and the unchanged target
    def test_golden_values_are_always_present_and_typed(self):
        for raw, expected, target in GOLDEN:
            with self.subTest(raw=raw):
                learner, _employer, *_ = self.read(raw)
                otjh = learner['metrics']['otjh']
                self.assertEqual(set(otjh), FIELDS)
                self.assertIn('officialPlannedHours', otjh)               # present even when null
                self.assertEqual(otjh['officialPlannedHours'], expected)
                self.assertTrue(otjh['officialPlannedHours'] is None or type(otjh['officialPlannedHours']) is float)
                self.assertEqual(json.loads(json.dumps(otjh))['officialPlannedHours'], expected)
                self.assertEqual(otjh['targetToDate'], target)

    def test_zero_is_a_real_zero_not_null(self):
        learner, *_ = self.read(Decimal('0'))
        value = learner['metrics']['otjh']['officialPlannedHours']
        self.assertEqual(value, 0.0)
        self.assertIsNotNone(value)
        self.assertEqual(str(value), '0.0')                                # never -0.0
        self.assertIsNone(learner['metrics']['otjh']['targetToDate'])

    # D5: the value that paced the target, under the official rule
    def test_same_source_as_target_to_date_and_the_official_selector(self):
        for raw, expected, _target in GOLDEN:
            with self.subTest(raw=raw):
                learner, _e, _c, _n, owner = self.read(raw)
                self.assertEqual(learner['metrics']['otjh']['officialPlannedHours'],
                                 official_hours.official_planned_hours(owner))
                self.assertEqual(learner['metrics']['otjh']['officialPlannedHours'], official(raw) or (
                    0.0 if official(raw) == 0 else None))

    # 7: no fallback source
    def test_no_training_plan_review_or_historical_substitution(self):
        for raw in (None, Decimal('0'), *INVALID):
            with self.subTest(raw=raw):
                learner, _e, calls, *_ = self.read(raw)
                value = learner['metrics']['otjh']['officialPlannedHours']
                self.assertNotIn(value, (400.0, 420.0, 576.0, 20.0, 308.0))
                calls.plan.assert_not_called()
                calls.reviews.assert_not_called()
                calls.selector_query.assert_not_called()

    # 9-11: Actual, hours.planned and monthly rows preserved
    def test_actual_training_plan_and_monthly_rows_are_unchanged(self):
        results = {raw: self.read(raw)[0] for raw in (Decimal('288'), None, Decimal('0'), Decimal('-1'))}
        for raw, result in results.items():
            with self.subTest(raw=raw):
                self.assertEqual(result['metrics']['otjh']['actual'], 1.0)
                self.assertEqual(result['hours']['planned'], 400.0)          # Training Plan, not official
                self.assertNotEqual(result['hours']['planned'], result['metrics']['otjh']['officialPlannedHours'])
                targets = {row['key']: row['target'] for row in result['hours']['months']}
                self.assertEqual((targets.get('2026-01'), targets.get('2026-07')), (200.0, 200.0))
        strip = lambda r: {**r, 'metrics': {**r['metrics'], 'otjh': {'actual': r['metrics']['otjh']['actual']}}}
        baseline = strip(results[Decimal('288')])
        for raw, result in results.items():
            with self.subTest(raw=raw):
                self.assertEqual(strip(result), baseline)   # months, modules, KSB, attendance, reviews, dates

    # 12-13: Learner/Employer identical contract, both kinds
    def test_learner_and_employer_projections_are_identical_for_both_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            for raw, expected, target in GOLDEN[:4]:
                with self.subTest(kind=kind, raw=raw):
                    learner, employer, *_ = self.read(raw, kind=kind)
                    self.assertEqual(employer, learner)
                    self.assertEqual(employer['metrics']['otjh']['officialPlannedHours'], expected)
                    self.assertEqual(employer['metrics']['otjh']['targetToDate'], target)

    # 15-16: no extra reads, no writes
    def test_no_additional_query_or_write(self):
        for raw in (Decimal('288'), None):
            with self.subTest(raw=raw):
                _l, _e, calls, (identity, bulk), _o = self.read(raw)
                self.assertEqual((identity, bulk), (2, 2))    # one owner + one metrics read per request (learner, employer)
                calls.selector_query.assert_not_called()
                calls.save.assert_not_called()

    # 14: real routes and gates: learner self/staff preview, Employer ownership
    def route(self, view_call, account, raw=Decimal('288')):
        from login import permissions
        with self.dashboard(raw) as (source, _owner, _calls), ExitStack() as stack:
            stack.enter_context(patch.object(permissions, '_auth_gate_enabled', return_value=True))
            stack.enter_context(patch.object(permissions, 'authenticate_request', return_value=account))
            stack.enter_context(patch('os.environ', {**__import__('os').environ, 'LEARNER_API_REQUIRE_AUTH': '1'}))
            stack.enter_context(patch('learner_api.case_file_sources.source_for_case_file', return_value=source))
            model = SimpleNamespace(DoesNotExist=_Missing, all_learners=SimpleNamespace(
                get=lambda pk: source if str(pk) == str(source.pk) else (_ for _ in ()).throw(_Missing())))
            stack.enter_context(patch.object(employer_portal, 'SOURCE_MODELS', {'commercial': model}))
            stack.enter_context(patch.object(employer_portal, '_employer_or_404',
                                             side_effect=lambda eid: (SimpleNamespace(pk=int(eid)), None)))
            return view_call(source)

    def learner_route(self, source):
        return dashboard_tabs.dashboard_tab(RequestFactory().get('/'), kind='commercial', pk=source.pk, tab='overview')

    def employer_route(self, employer_id):
        return lambda source: employer_portal.employer_portal_learner_overview(
            RequestFactory().get('/'), employer_id=employer_id, kind='commercial', learner_id=source.pk, part='dashboard')

    def test_learner_route_gate_and_payload(self):
        for account, status in ((None, 401), (SimpleNamespace(role='employer', subject_id=9), 403),
                                (SimpleNamespace(role='learner', subject_type='learner', subject_id=999), 404),
                                (SimpleNamespace(role='learner', subject_type='learner', subject_id=265), 200),
                                (SimpleNamespace(role='staff', subject_type='staff', subject_id=3), 200)):
            with self.subTest(role=getattr(account, 'role', None), subject=getattr(account, 'subject_id', None)):
                response = self.route(self.learner_route, account)
                self.assertEqual(response.status_code, status)
                if status == 200:
                    self.assertEqual(json.loads(response.content)['metrics']['otjh'],
                                     {'actual': 1.0, 'targetToDate': 143.61, 'officialPlannedHours': 288.0})

    def test_employer_route_gate_and_payload(self):
        employer = SimpleNamespace(role='employer', subject_id=9)
        other_employer = SimpleNamespace(role='employer', subject_id=10)
        cases = ((employer, 9, 200),
                 (employer, 10, 404),                   # cannot name another employer
                 (other_employer, 10, 403),             # the learner belongs to employer 9
                 (SimpleNamespace(role='learner', subject_id=265), 9, 403),
                 (SimpleNamespace(role='staff', subject_id=None), 9, 200))
        for account, employer_id, status in cases:
            with self.subTest(role=account.role, employer=employer_id):
                response = self.route(self.employer_route(employer_id), account)
                self.assertEqual(response.status_code, status)
                if status == 200:
                    self.assertEqual(json.loads(response.content)['metrics']['otjh'],
                                     {'actual': 1.0, 'targetToDate': 143.61, 'officialPlannedHours': 288.0})


class OtherContractsUntouchedTests(SimpleTestCase):
    # 17: Coach learner-overview (F1a, U1/D9) gains no field
    def test_coach_learner_overview_has_no_new_field(self):
        source = SimpleNamespace(pk=265)
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        model.all_learners.only.return_value.get.return_value = source
        payload = {'ksb': {}, 'otjh': {'actual': 120.0, 'planned': 288.0}}
        with patch.dict(dashboard_metrics.SOURCE_MODELS, {'commercial': model}), \
             patch.object(canonical_learning, 'metrics_bulk', return_value={265: payload}), \
             patch.object(dashboard_metrics, 'coach_otjh_target_to_date', return_value=143.61):
            response = dashboard_metrics.learner_metrics.__wrapped__.__wrapped__(
                RequestFactory().get('/', {'view': 'learner-overview'}), 'commercial', 265)
        body = json.loads(response.content)
        self.assertEqual(body['otjh'], {'actual': 120.0, 'planned': 288.0, 'targetToDate': 143.61})
        self.assertNotIn('officialPlannedHours', body['otjh'])

    # 18: Home/Progress canonical metrics contract gains no field
    def test_canonical_metrics_used_by_home_and_progress_has_no_new_field(self):
        owner = {'id': 17, 'enrolment_id': 265, 'programme_planned_hours': Decimal('288')}
        token = __import__('learner_api.journal_sources', fromlist=['_current'])._current.set(True)
        try:
            with patch.object(canonical_learning, 'entries_for', return_value=[]), \
                 patch.object(canonical_learning, 'targets_for', return_value=dict(MONTHLY)), \
                 patch('coach_api.migrated_otjh.planned_hours_bulk', return_value={265: 20}):
                result = canonical_learning.metrics(265, owner=owner)
        finally:
            __import__('learner_api.journal_sources', fromlist=['_current'])._current.reset(token)
        self.assertEqual(result['otjh']['planned'], 288.0)
        self.assertNotIn('officialPlannedHours', result['otjh'])
