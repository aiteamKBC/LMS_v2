"""Opt-in SELECT-only integration tests on the approved Development database.

Run explicitly with RUN_INCLUSION_READ_ONLY_TESTS=1. Fixtures are CTE values;
no tables, records, constraints or views are created or changed.
"""
import os
import re
import unittest

from psycopg.types.json import Jsonb
from scripts.verify_inclusion_canonical_targets import connect_development, installed_views, verify


@unittest.skipUnless(os.environ.get('RUN_INCLUSION_READ_ONLY_TESTS') == '1',
                     'requires explicit read-only Development integration opt-in')
class InclusionCanonicalTargetsSQLTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.conn = connect_development()

    @classmethod
    def tearDownClass(cls):
        cls.conn.rollback()
        cls.conn.close()

    def setUp(self):
        self.learners = [dict(id=1, aptem_id=101, programme_id='current', planned_hours=100,
                              updated_at='2026-01-01T00:00:00Z')]
        self.targets = [dict(id=1, learner_id=1, programme_id='former', programme_profile_id='',
                             report_month='2001-01', target_hours=20, updated_at='2026-01-01T00:00:00Z')]
        self.roster = [dict(learner_id='101', lms_id='1')]
        self.actual = [dict(lms_id='1', month='2001-01', actual=10,
                           actual_updated_at='2026-01-01T00:00:00Z')]

    def query(self, progress=False):
        views = installed_views(self.conn)
        # pg_get_viewdef qualifies columns of unaliased relations. Retarget those
        # qualifiers as well as FROM/JOIN relations to the SELECT-only fixtures.
        views['inclusion_plan_months'] = re.sub(
            r'(?<![\w.])learners\.', 'fixture_learners.', views['inclusion_plan_months'])
        views['inclusion_time_progress'] = re.sub(
            r'(?<![\w.])inclusion_plan_months\.', 'fixture_plan.', views['inclusion_time_progress'])
        tables = {
            'fixture_learners': ('"Learner".learners', self.learners),
            'fixture_targets': ('"Learner".learner_monthly_targets', self.targets),
            'fixture_roster': ('kbc_quality_reporting.inclusion_roster_v2', self.roster),
            'fixture_actual': ('kbc_quality_reporting.inclusion_time_monthly', self.actual),
        }
        plan = views['inclusion_plan_months']
        query = views['inclusion_time_progress'].replace(
            'kbc_quality_reporting.inclusion_plan_months', 'fixture_plan') if progress else plan
        for alias, (table, _) in tables.items():
            query = query.replace(table, alias)
            plan = plan.replace(table, alias)
        ctes = [f'{alias} AS (SELECT * FROM jsonb_populate_recordset(NULL::{table},%s::jsonb))'
                for alias, (table, _) in tables.items()]
        if progress:
            ctes.append(f'fixture_plan AS ({plan})')
        cursor = self.conn.execute('WITH ' + ','.join(ctes) + ' SELECT * FROM (' + query + ') result',
                                   [Jsonb(rows) for _, rows in tables.values()])
        names = [column.name for column in cursor.description]
        return [dict(zip(names, row)) for row in cursor.fetchall()]

    def test_seventeen_historical_programme_months_are_retained(self):
        months = [f'2001-{month:02d}' for month in range(1, 13)] + [f'2002-{month:02d}' for month in range(1, 6)]
        self.targets = [{**self.targets[0], 'id': index, 'report_month': month}
                        for index, month in enumerate(months, 1)]
        self.assertEqual({row['month'] for row in self.query()}, set(months))

    def test_one_historical_profile_month_is_retained(self):
        self.targets[0]['programme_profile_id'] = 'former-profile'
        self.assertEqual(self.query()[0]['expected'], 20)

    def test_conflicting_programme_scopes_are_not_summed_or_selected(self):
        self.targets.append({**self.targets[0], 'id': 2, 'programme_id': 'current', 'target_hours': 30})
        rows = self.query()
        self.assertEqual(len(rows), 1)
        self.assertIsNone(rows[0]['expected'])
        self.assertIn('unresolved or ambiguous', rows[0]['target_basis'])

    def test_ambiguous_aptem_identity_does_not_choose_an_owner(self):
        self.learners.append({**self.learners[0], 'id': 2})
        self.assertEqual(self.query(), [])

    def test_unowned_target_does_not_enter_another_learner_plan(self):
        self.targets[0]['learner_id'] = 2
        self.assertEqual(self.query(), [])

    def test_invalid_months_are_excluded(self):
        self.targets = [{**self.targets[0], 'report_month': month}
                        for month in ('2001-00', '2001-13', '2001-1', 'unknown')]
        self.assertEqual(self.query(), [])

    def test_null_and_negative_targets_remain_unresolved_and_zero_is_retained(self):
        for hours in (None, -1, 0):
            with self.subTest(hours=hours):
                self.targets[0]['target_hours'] = hours
                self.assertEqual(self.query()[0]['expected'], 0 if hours == 0 else None)

    def test_canonical_values_are_not_replaced_with_legacy_values(self):
        for index in range(19):
            self.targets[0]['target_hours'] = 10.25 + index
            self.assertEqual(self.query()[0]['expected'], 10.25 + index)

    def test_due_boundary_excludes_current_and_future_months(self):
        current = self.conn.execute("SELECT to_char(now() AT TIME ZONE 'Europe/London','YYYY-MM')").fetchone()[0]
        for month in (current, '2999-01'):
            self.targets.append({**self.targets[0], 'report_month': month, 'target_hours': 900})
            self.actual.append({**self.actual[0], 'month': month, 'actual': 800})
        row = self.query(progress=True)[0]
        self.assertEqual(row['time_actual_hours'], 10)
        self.assertEqual(row['time_planned_to_date_hours'], 20)
        self.assertEqual(row['time_total_planned_hours'], 100)
        self.assertEqual(row['time_progress_pct'], 50)
        self.assertEqual(row['time_total_progress_pct'], 10)

    def test_unresolved_due_month_does_not_produce_fabricated_percentage(self):
        self.targets.append({**self.targets[0], 'report_month': '2001-02', 'target_hours': None})
        row = self.query(progress=True)[0]
        self.assertIsNone(row['time_planned_to_date_hours'])
        self.assertIsNone(row['time_progress_pct'])
        self.assertEqual(row['time_actual_hours'], 10)

    def test_no_monthly_plan_does_not_invent_due_hours(self):
        self.targets = []
        row = self.query(progress=True)[0]
        self.assertIsNone(row['time_planned_to_date_hours'])
        self.assertEqual(row['time_total_planned_hours'], 100)

    def test_total_plan_requires_matching_canonical_and_aptem_identity(self):
        self.roster[0]['learner_id'] = '202'
        row = self.query(progress=True)[0]
        self.assertIsNone(row['time_total_planned_hours'])
        self.assertIsNone(row['time_total_progress_pct'])

    def test_installed_reports_match_canonical_sources_and_contracts(self):
        report = verify(self.conn)
        self.assertTrue(report['installed_view_contracts_valid'])
        self.assertTrue(report['canonical_hours_and_percentages_match'])
