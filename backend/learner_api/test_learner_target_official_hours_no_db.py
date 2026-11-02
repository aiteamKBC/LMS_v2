"""Slice 03b-2B: Learner Target-to-Date paces the official programme total only.

Database and network are prohibited. The real ``coach_otjh_target_to_date`` and
``apply_otjh_to_date_metrics`` formula run with a frozen Europe/London business
date; only data readers are replaced with synthetic values.
"""
import json
from contextlib import ExitStack
from datetime import date
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import canonical_learning, dashboard_metrics, dashboard_tabs, employer_learning
from . import test_employer_learning_no_db as employer_parity
from . import training_plan_dashboard as schedule
from .dashboard_metrics import coach_otjh_target_to_date, learner_metrics
from .journal_sources import learner_journal_reads

START, END = date(2026, 1, 1), date(2027, 1, 1)          # learner dates, 365 days
MID = date(2026, 7, 2)                                   # 182/365 elapsed
PLAN = 400.0                                             # Training Plan module total
ACTUAL = 120.0
#: Raw stored learners.planned_hours -> the value metrics_bulk exposes.
UNAVAILABLE = (None, Decimal('-1'), Decimal('NaN'), 'abc')


def official(raw):
    """The canonical official value exactly as metrics_bulk derives it."""
    return canonical_learning.programme_planned_hours(None, owner={'programme_planned_hours': raw})


def owner(raw=Decimal('288'), start=START, end=END):
    return {'id': 17, 'enrolment_id': 265, 'aptem_id': 7265, 'email': 'learner@example.test',
            'learner_start_date': start, 'learner_end_date': end, 'programme_planned_hours': raw,
            # Never a Target-to-Date input.
            'start_date': date(2020, 1, 1), 'end_date': date(2030, 1, 1), 'Planned_hours': 576}


def target(planned, today, **dates):
    with patch('django.utils.timezone.localdate', return_value=today):
        return coach_otjh_target_to_date(SimpleNamespace(pk=265), {'actual': ACTUAL, 'planned': planned},
                                         owner=owner(**dates))


class FormulaGoldenTests(SimpleTestCase):
    """The unchanged formula over the official value (learner dates, London day)."""

    def test_official_288_over_the_programme_window(self):
        for today, expected in ((date(2025, 12, 1), 0.0), (START, 0.0), (MID, 143.61),
                                (date(2026, 12, 31), 287.21), (END, 288.0), (date(2027, 2, 1), 288.0)):
            with self.subTest(today=today):
                self.assertEqual(target(official(Decimal('288.00')), today), expected)

    def test_unavailable_and_zero_official_values_have_no_target(self):
        for raw in (*UNAVAILABLE, Decimal('0')):
            with self.subTest(raw=raw):
                self.assertIsNone(target(official(raw), MID))

    def test_missing_or_invalid_learner_dates_have_no_target(self):
        for start, end in ((None, END), (START, None), (START, START), (END, START), ('not a date', END)):
            with self.subTest(start=start, end=end):
                self.assertIsNone(target(288.0, MID, start=start, end=end))


class LearnerOverviewMetricsTests(SimpleTestCase):
    """metrics/<kind>/<pk>/?view=learner-overview (F1a)."""

    def call(self, raw, *, kind='apprenticeship', account=None, query=None):
        source = SimpleNamespace(pk=265, aptem_id=7265, email='learner@example.test')
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        model.all_learners.only.return_value.get.return_value = source
        planned = official(raw)
        payload = {'programme': {'completed': 3, 'total': 10, 'percent': 30.0},
                   'ksb': {'completed': 4, 'total': 8, 'percent': 50.0},
                   'otjh': {'actual': ACTUAL, 'planned': planned, 'review_planned': 20},
                   'aptem_planned_total': planned, '_ksb_evidence_sources': []}
        request = RequestFactory().get(f'/learner_api/metrics/{kind}/265/', {'view': 'learner-overview', **(query or {})})
        request.login_account = account
        with ExitStack() as stack:
            calls = SimpleNamespace(
                bulk=stack.enter_context(patch.object(canonical_learning, 'metrics_bulk', return_value={265: payload})),
                identity=stack.enter_context(patch.object(canonical_learning, 'require_profile',
                                                          return_value=owner(raw))),
                profile=stack.enter_context(patch.object(canonical_learning, 'profile', return_value=owner(raw))),
                plan=stack.enter_context(patch.object(dashboard_metrics, 'plan_planned_hours', return_value=PLAN)),
                ordinary=stack.enter_context(patch.object(dashboard_metrics, 'read_metrics')),
                connections=stack.enter_context(patch.object(dashboard_metrics, 'connections', MagicMock())),
                save=stack.enter_context(patch('learner_api.models.LearnerProfile.save')),
            )
            stack.enter_context(patch.dict(dashboard_metrics.SOURCE_MODELS, {kind: model}))
            stack.enter_context(patch('django.utils.timezone.localdate', return_value=MID))
            response = learner_metrics.__wrapped__.__wrapped__(request, kind, 265)
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content), calls

    def test_official_288_target_is_unchanged_and_no_plan_is_read(self):
        body, calls = self.call(Decimal('288.00'))
        self.assertEqual(body['otjh']['targetToDate'], 143.61)
        self.assertEqual(body['otjh']['planned'], 288.0)
        calls.plan.assert_not_called()
        calls.profile.assert_not_called()

    def test_unavailable_official_has_no_target_even_with_a_plan_total(self):
        for raw in UNAVAILABLE:
            with self.subTest(raw=raw):
                body, calls = self.call(raw)
                self.assertIsNone(body['otjh']['targetToDate'])        # was 199.45 from plan 400
                self.assertNotEqual(body['otjh']['targetToDate'], 199.45)

    def test_zero_official_has_no_target_and_no_plan_read(self):
        body, calls = self.call(Decimal('0'))
        self.assertIsNone(body['otjh']['targetToDate'])
        self.assertEqual(body['otjh']['planned'], 0.0)
        calls.plan.assert_not_called()

    def test_coach_legacy_planned_field_is_retained_display_only(self):
        # U1: the Coach case file still reads otjh.planned; it keeps the
        # learning-plan total but never paces the target.
        body, calls = self.call(None)
        self.assertEqual(body['otjh']['planned'], PLAN)
        self.assertIsNone(body['aptem_planned_total'])
        self.assertIsNone(body['otjh']['targetToDate'])
        calls.plan.assert_called_once()

    def test_actual_and_other_fields_are_unchanged(self):
        for raw in (Decimal('288'), None, Decimal('0'), Decimal('-1')):
            with self.subTest(raw=raw):
                body, _ = self.call(raw)
                self.assertEqual(body['otjh']['actual'], ACTUAL)
                self.assertEqual(body['otjh']['review_planned'], 20)
                self.assertEqual(body['programme'], {'completed': 3, 'total': 10, 'percent': 30.0})
                self.assertEqual(body['ksb'], {'completed': 4, 'total': 8, 'percent': 50.0})
                self.assertNotIn('_ksb_evidence_sources', body)
                self.assertFalse({'otjhRagStatus', 'otjhShortfallHours', 'otjhTargetAsOfToday'} & set(body['otjh']))

    def test_both_kinds_and_every_identity_shape_get_the_same_target(self):
        accounts = (None, SimpleNamespace(role='learner', subject_type='learner', subject_id=265),
                    SimpleNamespace(role='staff', subject_type='staff', subject_id=3))
        for kind in ('commercial', 'apprenticeship'):
            for account in accounts:
                for raw, expected in ((Decimal('288'), 143.61), (None, None)):
                    with self.subTest(kind=kind, role=getattr(account, 'role', None), raw=raw):
                        body, _ = self.call(raw, kind=kind, account=account)
                        self.assertEqual(body['otjh']['targetToDate'], expected)
        staff = accounts[2]
        body, _ = self.call(None, account=staff, query={'viewAsCoach': 'coach@example.test'})
        self.assertIsNone(body['otjh']['targetToDate'])
        self.assertEqual(body['otjh']['planned'], PLAN)

    def test_no_extra_reads_or_writes(self):
        for raw in (Decimal('288'), Decimal('0')):
            with self.subTest(raw=raw):
                _, calls = self.call(raw)
                calls.bulk.assert_called_once_with([265], learner_workspace=True, include_ksb_points=True)
                calls.identity.assert_called_once_with(265)     # the existing owner read only
                calls.ordinary.assert_not_called()
                calls.connections.__getitem__.assert_not_called()
                calls.save.assert_not_called()


class DashboardOverviewTests(SimpleTestCase):
    """dashboard/<kind>/<pk>/overview/ (F1b) and its Employer projection."""

    fixture = employer_parity.EmployerLearningParityTests.fixture

    def read(self, raw, *, kind='commercial', today=MID, start=START, end=END):
        request = RequestFactory().get('/', {'month': '2026-10'})
        with ExitStack() as stack:
            source, canonical_owner, _profile = stack.enter_context(
                self.fixture(planned=official(raw), today=today))
            # The shared fixture's owner predates learner-specific dates.
            canonical_owner.update(learner_start_date=start, learner_end_date=end)
            stack.enter_context(patch('coach_api.bulk_register.register_rows', return_value={'17': []}))
            stack.enter_context(patch('learner_api.attendance.kbc_attendance_rows', return_value=[]))
            plan = stack.enter_context(patch.object(schedule, 'plan_planned_hours', return_value=PLAN))
            save = stack.enter_context(patch('learner_api.models.LearnerProfile.save'))
            with learner_journal_reads():
                learner = dashboard_tabs.read_tab(source, kind, 'overview', request)
            employer = employer_learning.read_dashboard(source, kind, 'overview', request)
        plan.assert_not_called()
        save.assert_not_called()
        return learner, employer

    def test_target_uses_the_official_total_only(self):
        for raw, expected in ((Decimal('288.00'), 143.61), *((value, None) for value in UNAVAILABLE),
                              (Decimal('0'), None)):
            with self.subTest(raw=raw):
                learner, employer = self.read(raw)
                self.assertEqual(learner['metrics']['otjh']['targetToDate'], expected)
                # U2: the Employer learner Overview shares the corrected target.
                self.assertEqual(employer['metrics']['otjh']['targetToDate'], expected)
                self.assertEqual(employer, learner)

    def test_date_boundaries_and_missing_dates(self):
        for today, expected in ((date(2025, 12, 1), 0.0), (START, 0.0), (END, 288.0), (date(2027, 2, 1), 288.0)):
            with self.subTest(today=today):
                learner, _ = self.read(Decimal('288'), today=today)
                self.assertEqual(learner['metrics']['otjh']['targetToDate'], expected)
        for start, end in ((None, END), (START, None)):
            with self.subTest(start=start, end=end):
                learner, _ = self.read(Decimal('288'), start=start, end=end)
                self.assertIsNone(learner['metrics']['otjh']['targetToDate'])

    def test_projection_contract_and_other_measures_are_unchanged(self):
        results = {raw: self.read(raw)[0] for raw in (Decimal('288'), None)}
        for raw, result in results.items():
            with self.subTest(raw=raw):
                # No 'planned' key; 03b-2C adds only the official programme total.
                self.assertEqual(set(result['metrics']['otjh']), {'actual', 'targetToDate', 'officialPlannedHours'})
                self.assertEqual(result['metrics']['otjh']['actual'], 1.0)
        strip = lambda result: {**result, 'metrics': {**result['metrics'],
                                'otjh': {'actual': result['metrics']['otjh']['actual']}}}
        # hours.planned (Training Plan), months, modules, KSB, attendance, reviews: identical.
        self.assertEqual(strip(results[Decimal('288')]), strip(results[None]))

    def test_both_learner_kinds(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                learner, employer = self.read(Decimal('288'), kind=kind)
                self.assertEqual(learner['metrics']['otjh']['targetToDate'], 143.61)
                self.assertEqual(employer['metrics']['otjh']['targetToDate'], 143.61)
