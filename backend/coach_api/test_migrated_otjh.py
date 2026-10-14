"""Synthetic template, lifecycle and read-only OTJ contribution regressions."""
from copy import deepcopy
from datetime import date, datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.db import transaction
from django.test import SimpleTestCase, TestCase

from . import migrated_template_views as api
from .migrated_otjh import add_to_metrics, review_rows_bulk, summarize, validate_expected_hours
from .migrated_templates import snapshot_for
from .migrated_template_sync import synchronize_locked
from .models import ImportedReviewInstance, MigratedReviewTemplate
from . import test_migrated_templates as template_tests


class OtjhTemplateTests(TestCase):
    setUp = template_tests.MigratedTemplateManagementTests.setUp
    template = template_tests.MigratedTemplateManagementTests.template
    request = template_tests.MigratedTemplateManagementTests.request

    def test_hours_round_trip_partial_updates_and_override_copy(self):
        template = self.template(expected_otjh=Decimal('1.50'), counts_towards_otjh=True)
        response = self.request(api.detail, pk=template.pk)
        import json
        self.assertEqual(json.loads(response.content)['expected_otjh'], 1.5)
        response = self.request(api.detail, 'patch', {'name': 'Renamed', 'updated_at': template.updated_at.isoformat()}, template.pk)
        self.assertEqual(response.status_code, 200)
        template.refresh_from_db()
        self.assertEqual(template.expected_otjh, Decimal('1.50'))
        self.assertTrue(template.counts_towards_otjh)
        response = self.request(api.collection, 'post', {'scope': 'PROGRAMME', 'programme_key': 'id:P1', 'review_family': 'PR', 'name': 'Custom'})
        self.assertEqual(response.status_code, 201)
        custom = MigratedReviewTemplate.objects.get(scope='PROGRAMME')
        self.assertEqual(custom.expected_otjh, template.expected_otjh)
        self.assertTrue(custom.counts_towards_otjh)
        response = self.request(api.detail, 'patch', {'counts_towards_otjh': False, 'updated_at': template.updated_at.isoformat()}, template.pk)
        self.assertEqual(response.status_code, 200)
        template.refresh_from_db()
        self.assertFalse(template.counts_towards_otjh)
        self.assertEqual(template.expected_otjh, Decimal('1.50'))

    def test_invalid_hours_and_flag_are_rejected_without_other_changes(self):
        template = self.template()
        for value in (None, True, -1, 'NaN', 'Infinity', '1.001', 1000000, ''):
            response = self.request(api.detail, 'patch', {'expected_otjh': value, 'name': 'Unwanted',
                'updated_at': template.updated_at.isoformat()}, template.pk)
            self.assertEqual(response.status_code, 400, value)
            template.refresh_from_db()
            self.assertEqual(template.name, 'Approved form')
        for value in (None, 1, 'false'):
            response = self.request(api.detail, 'patch', {'counts_towards_otjh': value,
                'updated_at': template.updated_at.isoformat()}, template.pk)
            self.assertEqual(response.status_code, 400)


class OtjhContributionTests(TestCase):
    def setUp(self):
        self.owner = {'id': 42, 'aptem_id': 101, 'programme_id': 'P1', 'programme': 'Synthetic'}
        self.template = MigratedReviewTemplate.objects.create(scope='GLOBAL', programme_key='', review_family='MCM',
            name='Synthetic MCM', definition_json={'sections': [{'key': 's', 'title': 'Section', 'order': 0,
                'fields': [{'key': 'note', 'title': 'Note', 'aptemType': 1, 'order': 0}]}]},
            is_active=True, expected_otjh=Decimal('1.50'), counts_towards_otjh=True)
        self.source = {'id': 7001, 'learner_id': 42, 'review_type': 'Monthly Coaching Meeting',
            'status': 'Scheduled', 'planned_scheduled_date': date(2026, 10, 14), 'completed_date': None}

    def overlay(self, status='scheduled', legacy=False):
        snapshot = snapshot_for(self.template)
        if legacy:
            snapshot.pop('otjh')
        return ImportedReviewInstance.objects.create(learner_id=42, source_review_id=7001,
            event_key='imported-review:synthetic-hours', owner_email='coach@example.invalid',
            migrated_template=self.template, template_snapshot=snapshot, status=status,
            completed_at=datetime(2026, 10, 14, 23, 30, tzinfo=timezone.utc) if status == 'completed' else None)

    def rows(self, sources=None, owners=None):
        with patch('coach_api.migrated_otjh._source_rows', return_value=sources or [self.source]):
            return review_rows_bulk(owners or [self.owner])

    def sync(self, overlay):
        with transaction.atomic():
            synchronize_locked(overlay, 'MCM', 'id:P1')
        overlay.refresh_from_db()

    def test_unstarted_uses_latest_hours_then_start_freezes_them(self):
        overlay = self.overlay()
        self.template.expected_otjh = Decimal('2.50')
        self.template.save()
        self.assertEqual(summarize(self.rows()[42]), {'planned': 2.5, 'completed': 0})
        self.sync(overlay)
        overlay.status = 'in-progress'
        overlay.save()
        self.template.expected_otjh = Decimal('9')
        self.template.definition_json['sections'][0]['fields'][0]['title'] = 'New question label'
        self.template.save()
        self.sync(overlay)
        self.assertEqual(overlay.template_snapshot['sections'][0]['fields'][0]['title'], 'New question label')
        self.assertEqual(overlay.template_snapshot['otjh']['expectedHours'], 2.5)
        self.assertEqual(summarize(self.rows()[42]), {'planned': 2.5, 'completed': 0})

    def test_preexisting_started_awaiting_and_completed_never_gain_hours(self):
        for status in ('in-progress', 'awaiting-signature', 'completed'):
            overlay = self.overlay(status, legacy=True)
            before = deepcopy(overlay.template_snapshot)
            self.template.definition_json['sections'][0]['title'] = 'Edited section'
            self.template.save()
            self.sync(overlay)
            self.assertNotIn('otjh', overlay.template_snapshot)
            if status != 'in-progress':
                self.assertEqual(before, overlay.template_snapshot)
            self.assertEqual(summarize(self.rows()[42]), {'planned': 0, 'completed': 0})
            overlay.delete()

    def test_completed_uses_frozen_hours_once_after_template_disabled(self):
        self.overlay('completed')
        self.template.counts_towards_otjh = False
        self.template.expected_otjh = 99
        self.template.is_active = False
        self.template.save()
        first = self.rows()[42]
        self.assertEqual(summarize(first), {'planned': 1.5, 'completed': 1.5})
        self.assertEqual(self.rows()[42], first)
        self.assertEqual(summarize(first, window_end=date(2026, 10, 14))['completed'], 0)
        self.assertEqual(summarize(first, window_start=date(2026, 10, 15))['completed'], 1.5)

    def test_historical_source_completed_never_counts_again(self):
        self.overlay('completed')
        for changes in ({'status': 'Completed'}, {'completed_date': date(2026, 9, 1)}):
            self.assertEqual(self.rows([{**self.source, **changes}])[42], [])

    def test_family_programme_and_learner_isolation(self):
        MigratedReviewTemplate.objects.create(scope='PROGRAMME', programme_key='id:P1', review_family='MCM',
            name='Custom MCM', definition_json=self.template.definition_json, is_active=True,
            expected_otjh=3, counts_towards_otjh=True)
        for family, source_type, amount in (('PR', 'Progress Review', 2), ('PR_SKILLS_RADAR', 'Progress Review (+ Skills Radar)', 4)):
            MigratedReviewTemplate.objects.create(scope='GLOBAL', programme_key='', review_family=family,
                name=family, definition_json=self.template.definition_json, is_active=True,
                expected_otjh=amount, counts_towards_otjh=True)
        sources = [self.source, {**self.source, 'id': 7002, 'review_type': 'Progress Review'},
            {**self.source, 'id': 7003, 'review_type': 'Progress Review (+ Skills Radar)'},
            {**self.source, 'id': 8001, 'learner_id': 43}]
        owners = [self.owner, {**self.owner, 'id': 43, 'programme_id': 'P2'}, {**self.owner, 'id': 44, 'aptem_id': None}]
        rows = self.rows(sources, owners)
        self.assertEqual(summarize(rows[42])['planned'], 9)
        self.assertEqual(summarize(rows[43])['planned'], 1.5)
        self.assertNotIn(44, rows)

    def test_opt_out_keeps_hours_but_adds_nothing(self):
        self.template.counts_towards_otjh = False
        self.template.save()
        self.assertEqual(self.rows()[42], [])
        self.assertEqual(self.template.expected_otjh, Decimal('1.50'))

    def test_mismatched_frozen_family_fails_closed(self):
        overlay = self.overlay('completed')
        overlay.template_snapshot['templateSource']['family'] = 'PR'
        overlay.save()
        with self.assertRaisesRegex(ValueError, 'conflicting template'):
            self.rows()

    def test_missing_target_date_does_not_invent_a_planned_occurrence(self):
        rows = self.rows([{**self.source, 'planned_scheduled_date': None}])[42]
        self.assertEqual(summarize(rows)['planned'], 0)


class OtjhMetricTests(SimpleTestCase):
    def test_case_file_month_and_totals_include_review_without_changing_stored_history(self):
        from . import otjh_ksb
        totals = [{'month': '2026-10', 'completed': 10, 'submitted': 2}]
        targets = {'2026-10': 20}
        owner = {'id': 42, 'aptem_id': 101}
        context = SimpleNamespace(profile=SimpleNamespace(enrolment_id=7, start_date=date(2026, 1, 1),
            end_date=date(2026, 12, 31)), source=SimpleNamespace())
        row = {'hoursEach': 1.5, 'targetDate': date(2026, 10, 14), 'status': 'completed',
               'completedDate': date(2026, 10, 15)}
        with patch.object(otjh_ksb, 'read_hour_totals', return_value=totals), \
             patch.object(otjh_ksb, 'read_chart_plan', return_value={}), \
             patch.object(otjh_ksb.canonical, 'programme_planned_hours', return_value=100), \
             patch.object(otjh_ksb.canonical, 'targets_for', return_value=targets), \
             patch.object(otjh_ksb.canonical, 'query', return_value=[]), \
             patch.object(otjh_ksb.timezone, 'localdate', return_value=date(2026, 10, 20)), \
             patch('coach_api.migrated_otjh.review_rows_bulk', return_value={42: [row]}):
            result = otjh_ksb.read_otjh(context, owner)
        self.assertEqual(result['actualHours'], 11.5)
        self.assertEqual(result['plannedHours'], 101.5)
        self.assertEqual(result['months'], [{'month': '2026-10', 'targetHours': 21.5,
            'submittedHours': 2, 'completedHours': 11.5}])
        self.assertEqual(targets, {'2026-10': 20})
        self.assertEqual(totals, [{'month': '2026-10', 'completed': 10, 'submitted': 2}])

    def test_learner_detail_adds_only_new_contributions_to_existing_calculation(self):
        from learner_api.learner_detail import _review_otjh_hours
        profile = SimpleNamespace(id=42, aptem_id=101, programme_id='P1', programme_status='Active',
                                  start_date=date(2026, 1, 1), end_date=date(2026, 12, 31))
        with patch('curriculum_api.review_otjh.planned_hours', return_value=10), \
             patch('curriculum_api.review_otjh.completed_hours', return_value=3), \
             patch('coach_api.migrated_otjh.hours_for_profile', return_value={'planned': 2, 'completed': 1}):
            self.assertEqual(_review_otjh_hours(profile), (12, 4))

    def test_validation_accepts_zero_and_fractional_hours(self):
        self.assertEqual(validate_expected_hours(0), Decimal('0'))
        self.assertEqual(validate_expected_hours('1.25'), Decimal('1.25'))

    def test_additive_metrics_preserve_history_and_unknown_totals(self):
        row = {'hoursEach': 1.5, 'targetDate': date(2026, 10, 14), 'status': 'completed',
               'completedDate': date(2026, 10, 15)}
        original = {'aptem_planned_total': 500, 'otjh': {'historical': 100, 'new': 5,
            'actual': 105, 'completed_actual': 105, 'planned': 500}}
        result = add_to_metrics(deepcopy(original), [row])
        self.assertEqual(result['otjh'], {'historical': 100, 'new': 6.5, 'actual': 106.5,
            'completed_actual': 106.5, 'planned': 501.5})
        self.assertEqual(result['aptem_planned_total'], 501.5)
        original['otjh']['actual'] = original['otjh']['planned'] = None
        result = add_to_metrics(original, [row])
        self.assertIsNone(result['otjh']['actual'])
        self.assertIsNone(result['otjh']['planned'])

    def test_canonical_single_bulk_and_dashboard_add_the_same_contribution(self):
        from learner_api import canonical_learning as canonical
        owner = {'id': 42, 'enrolment_id': 7, 'aptem_id': 101, 'email': 'learner@example.invalid',
                 'account_record_id': 7, 'account_email': 'learner@example.invalid', 'account_aptem_id': 101,
                 'programme_planned_hours': 100}
        row = {'hoursEach': 1.5, 'targetDate': date(2026, 10, 14), 'status': 'completed',
               'completedDate': date(2026, 10, 15)}
        with patch.object(canonical, 'review_rows_bulk', return_value={42: [row]}), \
             patch.object(canonical, 'require_profile', return_value=owner), \
             patch.object(canonical, 'entries_for', return_value=[]), \
             patch.object(canonical, 'targets_for', return_value={'2026-10': 100}), \
             patch('learner_api.journal_sources.enabled', return_value=False):
            single = canonical.metrics(7)
            with patch.object(canonical, 'query', side_effect=[[owner], [], [{'learner_id': 42, 'report_month': '2026-10', 'target_hours': 100}]]), \
                 patch.object(canonical, 'current_records_bulk', return_value={7: []}):
                bulk = canonical.metrics_bulk([7])[7]
            with patch.object(canonical, 'query', side_effect=[[owner], [], [{'learner_id': 42, 'report_month': '2026-10', 'target_hours': 100}]]), \
                 patch('learner_api.canonical_hours.pending_hour_records', return_value={42: []}):
                dashboard = canonical.otjh_summary_bulk([7])[7]
        self.assertEqual(single['otjh'], bulk['otjh'])
        self.assertEqual(single['otjh']['actual'], 1.5)
        self.assertEqual(single['otjh']['planned'], 101.5)
        for key in ('actual', 'completed_actual', 'planned', 'historical', 'new'):
            self.assertEqual(dashboard[key], single['otjh'][key])
