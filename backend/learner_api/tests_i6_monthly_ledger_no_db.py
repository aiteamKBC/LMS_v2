"""F07-I6 request-scoped monthly ledger parity tests; no database access."""
from collections import defaultdict
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import date
from inspect import unwrap
import json
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import monthly_logs as coach_logs
from old_otjh.service import ServiceError
from . import monthly_logs as logs


class CanonicalMonthlyLedgerTests(SimpleTestCase):
    maxDiff = None

    def setUp(self):
        self.owner = {
            'id': 70, 'enrolment_id': 7, 'programme_id': 'P1',
            'start_date': date(2025, 8, 31), 'end_date': date(2027, 8, 31),
        }
        self.learner = {
            'id': 7, 'aptem_id': None, 'name': 'Synthetic learner',
            'programme': 'Synthetic programme', 'learner_type': 'commercial',
            '_canonical_profile': self.owner, '_profile': self.owner, '_view_as': False,
        }
        self.records = [
            {'id': 1, 'accepted': True, 'completed': True, 'actual_seconds': 5400,
             'expected_otjh': 2, 'reporting_month': '2026-02', 'ksbs': ['K1'],
             'source_system': 'journal', 'segments': []},
            {'id': 2, 'accepted': False, 'completed': False, 'actual_seconds': 1800,
             'expected_otjh': 1, 'reporting_month': '2026-02', 'ksbs': ['K2'],
             'source_system': 'old_lms', 'segments': []},
            {'id': 3, 'accepted': True, 'completed': True, 'actual_seconds': 900,
             'expected_otjh': 0, 'reporting_month': '2026-02', 'ksbs': ['K1', 'K3'],
             'source_system': 'azure-evidence', 'segments': []},
            {'id': 4, 'accepted': True, 'completed': True, 'actual_seconds': 0,
             'expected_otjh': 0, 'reporting_month': '2026-03', 'ksbs': [],
             'source_system': 'staff', 'segments': []},
            {'id': 5, 'accepted': True, 'completed': True, 'actual_seconds': 7200,
             'expected_otjh': 2, 'reporting_month': '2026-04', 'ksbs': ['K4'],
             'source_system': 'new_lms', 'segments': []},
            {'id': 6, 'accepted': True, 'completed': True, 'actual_seconds': 0,
             'expected_otjh': 0, 'reporting_month': '2024-02', 'ksbs': ['K0'],
             'source_system': 'aptem', 'segments': []},
            {'id': 7, 'accepted': True, 'completed': True, 'actual_seconds': 0,
             'expected_otjh': 0, 'reporting_month': '2025-12', 'ksbs': [],
             'source_system': 'old_lms', 'segments': []},
        ]
        self.rows = [
            self.row(101, 1, '2026-02-01', 1.0, 2.0, True, 'journal', ['K1']),
            self.row(102, 1, '2026-02-28', 0.5, 0.0, True, 'journal', ['K1']),
            self.row(103, 2, '2026-02-29', 0.5, 1.0, False, 'old_lms', ['K2']),
            self.row(104, 3, '2026-02-29', 0.25, 0.0, True, 'azure-evidence', ['K1', 'K3'], estimated=True),
            self.row(105, 4, '2026-03-29', 0.0, 0.0, True, 'staff', []),
            self.row(106, 5, '2026-04-01', 2.0, 2.0, True, 'new_lms', ['K4']),
            self.row(107, 6, '2024-02-29', 0.0, 0.0, True, 'aptem', ['K0']),
            self.row(108, 7, '2025-12-31', 0.0, 0.0, True, 'old_lms', []),
        ]
        self.signatures = [
            {'report_month': '2026-02', 'signer_role': 'learner', 'signer_name': 'Learner',
             'signed_at': '2026-03-01T09:00:00+00:00', 'url': 'learner-signature'},
            {'report_month': '2026-02', 'signer_role': 'coach', 'signer_name': 'Coach',
             'signed_at': '2026-03-02T09:00:00+00:00', 'url': 'coach-signature'},
        ]
        self.targets = {'2026-02': 8.0, '2026-03': 10.0, '2026-04': 12.0}

    @staticmethod
    def row(row_id, progress_id, activity_date, actual, planned, accepted, source, ksbs, *, estimated=False):
        return {
            'id': row_id, 'source_ref': f'canonical:{progress_id}:row:{row_id}',
            'progress_id': progress_id, 'title': f'Activity {row_id}', 'category': 'Learning',
            'activity_date': activity_date, 'activity_time': '00:30:00',
            'timestamp_label': '00:30:00', 'actual_hours': actual,
            'planned_hours': planned, 'accepted': accepted, 'actual_estimated': estimated,
            'documents': [], 'results': [], 'ksb_codes': ksbs,
            'source_system': source, 'reporting_month': activity_date[:7],
        }

    @contextmanager
    def readers(self):
        unlocked = {'locked': False, 'locked_at': None, 'unlocked_at': None, 'unlocked_by': None}

        def locks(_learner_id, months, **_kwargs):
            return {
                month: ({'locked': True, 'locked_at': '2026-03-02T09:00:00+00:00',
                         'unlocked_at': None, 'unlocked_by': None}
                        if month == '2026-02' else dict(unlocked))
                for month in months
            }

        with ExitStack() as stack:
            mocks = {
                'entries': stack.enter_context(patch.object(
                    logs.canonical, 'entries_for', side_effect=lambda _owner: deepcopy(self.records))),
                'signatures': stack.enter_context(patch.object(
                    logs.canonical, 'signatures_for', side_effect=lambda _owner: deepcopy(self.signatures))),
                'targets': stack.enter_context(patch.object(
                    logs.canonical, 'targets_for', side_effect=lambda _owner: dict(self.targets))),
                'rows': stack.enter_context(patch.object(
                    logs.canonical, 'rows_for', side_effect=lambda _owner, _records: deepcopy(self.rows))),
                'locks': stack.enter_context(patch.object(logs, 'lock_states', side_effect=locks)),
            }
            stack.enter_context(patch.object(logs.canonical, 'enabled', return_value=True))
            stack.enter_context(patch.object(
                logs.canonical, 'activity_rows', side_effect=lambda _learner_id: deepcopy(self.rows)))
            stack.enter_context(patch.object(
                logs.canonical, 'signatures', side_effect=lambda _learner_id: deepcopy(self.signatures)))
            stack.enter_context(patch.object(
                logs.canonical, 'targets', side_effect=lambda _learner_id: dict(self.targets)))
            stack.enter_context(patch.object(
                logs, 'lock_state', side_effect=lambda learner_id, month: locks(learner_id, [month])[month]))
            stack.enter_context(patch.object(logs.timezone, 'localdate', return_value=date(2026, 3, 29)))
            yield mocks

    def projection_options(self):
        return {'include_open': True, 'include_future': True, 'ensure_month': '2026-05'}

    def original_summary_data(self, learner, **options):
        """Frozen copy of the pre-I6 canonical branch for parity testing."""
        owner = learner['_canonical_profile']
        records = logs.canonical.entries_for(owner)
        signs = logs.canonical.signatures_for(owner)
        targets = logs.canonical.targets_for(owner)
        grouped = defaultdict(list)
        open_month = logs.timezone.localdate().strftime('%Y-%m')

        def allowed_month(month):
            return (
                month < open_month
                or (options['include_open'] and month == open_month)
                or (options['include_future'] and month > open_month)
            )

        for item in logs.canonical.rows_for(owner, records):
            month = item.get('reporting_month')
            if month and allowed_month(month):
                grouped[month].append(item)
        for month in {*targets, *(sign['report_month'] for sign in signs)}:
            if allowed_month(month):
                grouped.setdefault(month, [])
        ensure_month = options['ensure_month']
        if ensure_month and allowed_month(ensure_month):
            grouped.setdefault(ensure_month, [])
        locks = logs.lock_states(learner['id'], grouped, canonical_owner=owner)
        months = [
            logs.month_state(
                month,
                rows,
                signs,
                targets.get(month),
                learner_id=learner['id'],
                lock=locks[month],
            )
            for month, rows in grouped.items()
        ]
        months.sort(key=lambda item: item['month'])
        programme_metrics = logs.canonical.metrics_from_records(records, targets)['otjh']
        profile = learner.get('_profile') or {}
        return {
            'learner': {
                'id': learner['id'],
                'aptem_id': learner.get('aptem_id'),
                'name': learner['name'],
                'programme': learner['programme'],
                'coach_name': profile.get('coach_name') or learner.get('coach_name'),
                'planned_end_date': profile.get('end_date'),
            },
            'months': months,
            'total_months': len(months),
            'completed_months': sum(item['status'] == 'complete' for item in months),
            'training_plan_totals': {
                'accepted_hours': programme_metrics.get(
                    'completed_actual', programme_metrics.get('actual')),
                'planned_hours': programme_metrics['planned'],
            },
            'read_only': learner['_view_as'],
        }

    def original_detail_data(self, learner, month, **options):
        """Frozen copy of the pre-I6 canonical detail branch."""
        logs.valid_month_key(month)
        if not options['include_open']:
            logs.require_closed_month(month)
        signs = logs.signatures(learner)
        rows = logs.current_months(learner, signs, **options).get(month)
        if rows is None:
            raise ServiceError('No activities are recorded for this month.', 'not_found', 404)
        profile = learner.get('_profile') or {}
        target = logs.canonical.targets(learner['id']).get(
            month, 0 if logs.journal_sources.enabled() else None)
        return {
            **logs.month_state(month, rows, signs, target, learner_id=learner['id']),
            'rows': rows,
            'profile': {
                'start_date': profile.get('start_date'),
                'planned_end_date': profile.get('end_date'),
                'first_evidence_date': None,
            },
        }

    def test_golden_dataset_matches_independent_and_shared_projections_field_by_field(self):
        for learner_type, programme_id in (('commercial', 'P1'), ('apprenticeship', 'P2')):
            with self.subTest(learner_type=learner_type), self.readers():
                owner = {**self.owner, 'programme_id': programme_id}
                learner = {**self.learner, 'learner_type': learner_type,
                           '_canonical_profile': owner, '_profile': owner}
                options = self.projection_options()
                original_summary = self.original_summary_data(learner, **options)
                original_detail = self.original_detail_data(learner, '2026-02', **options)
                facts = logs.canonical_monthly_facts(learner, **options)
                optimized_summary = logs.summary_data(learner, canonical_facts=facts, **options)
                optimized_detail = logs.detail_data(
                    learner, '2026-02', canonical_facts=facts, **options)

                self.assertEqual(optimized_summary, original_summary)
                self.assertEqual(optimized_detail, original_detail)
                self.assertEqual(
                    [month['month'] for month in optimized_summary['months']],
                    ['2024-02', '2025-12', '2026-02', '2026-03', '2026-04', '2026-05'],
                )
                february = next(month for month in optimized_summary['months'] if month['month'] == '2026-02')
                self.assertEqual(february['row_count'], 3)
                self.assertEqual(february['actual_hours'], 1.75)
                self.assertEqual(february['estimated_hours'], 0.25)
                self.assertEqual(february['not_accepted_hours'], 0.5)
                self.assertEqual(february['total_actual_hours'], 2.0)
                self.assertEqual(february['training_plan_target'], 8.0)
                self.assertEqual(february['status'], 'complete')
                self.assertTrue(february['locked'])
                self.assertEqual(optimized_detail['rows'], self.rows[:4])
                self.assertEqual(optimized_summary['training_plan_totals'], {
                    'accepted_hours': 3.75,
                    'planned_hours': 30.0,
                })

    def test_loader_reads_learner_wide_facts_once_without_a_month_selector(self):
        with self.readers() as readers:
            facts = logs.canonical_monthly_facts(self.learner, **self.projection_options())

        readers['entries'].assert_called_once_with(self.owner)
        readers['signatures'].assert_called_once_with(self.owner)
        readers['targets'].assert_called_once_with(self.owner)
        readers['rows'].assert_called_once()
        self.assertIs(readers['rows'].call_args.args[1][0], facts.records[0])
        readers['locks'].assert_called_once()
        self.assertEqual(set(facts.grouped_rows), {
            '2024-02', '2025-12', '2026-02', '2026-03', '2026-04', '2026-05',
        })

    def test_coach_month_reuses_five_sql_equivalent_readers_and_preserves_contract(self):
        request = RequestFactory().get('/coach_api/coach/monthly-logs/7/2026-02')
        with self.readers() as readers, \
             patch.object(coach_logs, 'require_coach'), \
             patch.object(coach_logs.logs, 'scope', return_value=(self.learner, 'coach')), \
             patch.object(coach_logs, 'get_token', return_value='csrf-token'):
            response = unwrap(coach_logs.learner_month)(request, 7, '2026-02')

        payload = json.loads(response.content)
        self.assertEqual(set(payload), {'summary', 'detail'})
        self.assertEqual(payload['summary']['csrf_token'], 'csrf-token')
        self.assertEqual(payload['detail']['month'], '2026-02')
        self.assertEqual(payload['detail']['actual_hours'], 1.75)
        self.assertEqual(sum(reader.call_count for reader in readers.values()), 5)
        self.assertTrue(all(reader.call_count == 1 for reader in readers.values()))

    def test_facts_are_request_local_and_cross_learner_reuse_fails_closed(self):
        with self.readers() as readers:
            first = logs.canonical_monthly_facts(self.learner, **self.projection_options())
            second = logs.canonical_monthly_facts(self.learner, **self.projection_options())
            self.assertIsNot(first, second)
            self.assertEqual(sum(reader.call_count for reader in readers.values()), 10)
            other_owner = {**self.owner, 'id': 71, 'enrolment_id': 8}
            other = {**self.learner, 'id': 8, '_canonical_profile': other_owner, '_profile': other_owner}
            with self.assertRaises(ServiceError) as error:
                logs.summary_data(other, canonical_facts=first, **self.projection_options())
        self.assertEqual(error.exception.code, 'identity_review_required')
        self.assertEqual(error.exception.status, 409)

    def test_legacy_cutoff_detail_does_not_enter_the_canonical_projection(self):
        legacy = {key: value for key, value in self.learner.items() if key != '_canonical_profile'}
        legacy['aptem_id'] = 42
        historical = {'month': '2025-01', 'rows': [], 'student_signature': None, 'coach_signature': None}
        with patch.object(logs.canonical, 'enabled', return_value=False), \
             patch.object(logs.history, 'enabled', return_value=True), \
             patch.object(logs.history, 'detail', return_value=historical), \
             patch.object(logs, 'public_detail', side_effect=lambda _learner, payload: payload), \
             patch.object(logs, 'signed_training_plan_targets', return_value={}), \
             patch.object(logs, 'canonical_monthly_facts') as projection:
            result = logs.detail_data(legacy, '2025-01')
        self.assertEqual(result['source'], 'legacy')
        projection.assert_not_called()
