"""Synthetic transport parity; SimpleTestCase forbids every database operation."""
from datetime import date
import sqlite3
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase
from learner_api.aptem_ksb_breakdown import build_progress_breakdown
from learner_api import canonical_learning as canonical
from . import otjh_ksb as projection


class OtjhKsbProjectionTests(SimpleTestCase):
    def context(self, kind='apprenticeship'):
        return SimpleNamespace(learner_id=101,
            profile=SimpleNamespace(id=101, enrolment_id=201, learner_type=kind, start_date=None, end_date=None),
            source=SimpleNamespace(start_date='2025-01-01', end_date='2027-01-01'))

    def test_backend_values_match_existing_canonical_and_visible_formulas(self):
        from .views import apply_otjh_to_date_metrics
        records = [dict(accepted=True, actual_seconds=36000, ksbs=['K1']),
                   dict(accepted=True, actual_seconds=7200, ksbs=['K1']),
                   dict(accepted=False, actual_seconds=10800, ksbs=['S1'])]
        old = canonical.metrics_from_records(records, {})['otjh']['actual']
        for kind in ('apprenticeship', 'commercial'):
            context = self.context(kind)
            with patch.object(projection, 'read_hour_totals', return_value=[dict(month='2026-01', completed=12, submitted=3)]) as totals, \
                 patch.object(canonical, 'programme_planned_hours', return_value=576) as planned, \
                 patch.object(canonical, 'targets_for', return_value={'2026-01': 30}), \
                 patch.object(canonical, 'query', return_value=[]) as signs, \
                 patch.object(projection, 'read_chart_plan', return_value={}), \
                 patch.object(projection.timezone, 'localdate', return_value=date(2026, 10, 7)):
                result = projection.read_otjh(context, {'id': 101})
            prior = apply_otjh_to_date_metrics({'otjhCompleted': old, 'otjhPlanned': 576,
                'otjhProgrammeStartDate': '2025-01-01', 'plannedEndDate': '2027-01-01'}, today=date(2026, 10, 7))
            self.assertEqual(result['actualHours'], old)
            self.assertEqual(result['plannedHours'], 576)
            self.assertEqual(result['targetToDateHours'], prior['otjhTargetAsOfToday'])
            self.assertEqual(result['remainingHours'], max(0, prior['otjhTargetAsOfToday'] - old))
            self.assertEqual(result['progressPercent'], prior['otjhProgressAsOfToday'])
            self.assertNotEqual(result['plannedHours'], result['targetToDateHours'])
            totals.assert_called_once()
            planned.assert_called_once()
            self.assertIn('review_confirmed IS TRUE', signs.call_args.args[0])
            self.assertEqual(set(result), {'actualHours','targetToDateHours','plannedHours','remainingHours','progressPercent','months'})

    def test_months_keep_logs_priority_gaps_and_future_weekly_fallback(self):
        result = projection.project_months([
            dict(month='2026-01', completed=5.36, submitted=.33),
            dict(month='2026-04', completed=8, submitted=90)],
            {'2026-01': 12, '2026-04': 100}, ['2026-02'],
            {'2026-01': {'planned': 99, 'actual': 99, 'submitted': 99},
             '2026-02': {'planned': 4}, '2026-04': {'planned': 20, 'submitted': 3}},
            today=date(2026, 2, 15))
        self.assertEqual(result, [
            dict(month='2026-01', targetHours=12, submittedHours=.33, completedHours=5.36),
            dict(month='2026-02', targetHours=4, submittedHours=0, completedHours=0),
            dict(month='2026-03', targetHours=None, submittedHours=0, completedHours=0),
            dict(month='2026-04', targetHours=20, submittedHours=3, completedHours=8)])
        self.assertEqual(projection.project_months([], {}, [], {}, today=date(2026, 2, 15)), [])
        self.assertEqual(projection.project_months([dict(month='invalid', completed=2, submitted=1)], {}, [], {}, today=date(2026, 2, 15)), [])

    def test_distinct_codes_and_category_summary_match_the_table_rows(self):
        entries = [dict(id=i, learner_id=101, deleted_at=None, ksb_code=code,
            ksb_description=code, component_title='Synthetic activity',
            accepted=accepted, activity_status=status)
            for i, (code, accepted, status) in enumerate([
                ('K1', True, 'completed'), ('K1', False, 'completed'),
                ('S1', True, 'completed'), ('S2', True, 'passed'),
                ('B1', True, 'completed'), ('B2', False, 'completed'), ('B3', True, 'completed')])]
        old = build_progress_breakdown(101, entries)
        compact = projection.project_ksbs([dict(code=row['code'], description=row['description'],
            completed=row['completed'], evidenceCount=len(row['components']), pointsAchieved=row['pointsAchieved']) for row in old['rows']])
        self.assertEqual(compact['summary'], dict(total=6, achieved=5, remaining=1))
        self.assertEqual(compact['summary']['total'], old['totalKsbs'])
        self.assertEqual(compact['summary']['achieved'], sum(row['status'] == 'Achieved' for row in compact['rows']))
        self.assertEqual(compact['summary']['total'], sum(category['total'] for category in compact['categories']))
        for category in compact['categories']:
            population = [row for row in compact['rows'] if row['category'] == category['category']]
            self.assertEqual(category['total'], len(population))
            self.assertEqual(category['achieved'], sum(row['status'] == 'Achieved' for row in population))
        self.assertEqual(compact['categories'], [dict(category='Knowledge', achieved=1, total=1, percent=100),
            dict(category='Skills', achieved=2, total=2, percent=100),
            dict(category='Behaviours', achieved=2, total=3, percent=66.67)])
        for row in compact['rows']:
            self.assertEqual(set(row), {'code','description','category','status','evidenceCount','completed','pointsAchieved','totalPoints','progressPercent'})
        self.assertEqual(compact['rows'][0]['evidenceCount'], 2)

    def test_student_and_coach_match_every_code_with_acceptance_independent_of_completion(self):
        entries, aggregates = [], []
        for code, achieved, total in [('B1', 18, 20), ('B2', 13, 13), ('B3', 14, 14), ('B4', 47, 62), ('K1', 0, 3), ('S1', 1, 1)]:
            for index in range(total):
                entries.append(dict(id=len(entries)+1, ksbs=[code, code], accepted=index < achieved,
                                    activity_status='completed' if code.startswith('B') and index < 5 else 'passed'))
            aggregates.append(dict(code=code, description='Synthetic code', completed=min(5, achieved) if code.startswith('B') else 0,
                                   evidenceCount=total, pointsAchieved=achieved))
        student = {row['code']: row for row in canonical.metrics_from_records(entries, {})['ksb']['codes']}
        coach = projection.project_ksbs(aggregates)
        for row in coach['rows']:
            expected = student[row['code']]
            self.assertEqual((row['pointsAchieved'], row['totalPoints'], row['progressPercent']),
                             (expected['completed'], expected['total'], expected['percent']))
            self.assertEqual(row['status'], 'Achieved' if expected['completed'] else 'Not Achieved')
            for forbidden in ('activityNames', 'components', 'files', 'urls', 'reflection', 'quiz'):
                self.assertNotIn(forbidden, row)
        self.assertEqual(coach['summary'], dict(total=6, achieved=5, remaining=1))

    def test_readers_aggregate_before_transfer_and_bind_learner_identity(self):
        with patch.object(canonical, 'query', return_value=[]) as read:
            projection.read_ksb_rows(101)
            projection.read_hour_totals({'id': 101})
        for call in read.call_args_list:
            sql, params = call.args
            self.assertEqual(params, [101])
            self.assertIn('deleted_at IS NULL', sql)
            self.assertIn('GROUP BY', sql)
            self.assertNotIn('source_payload', sql)
        self.assertNotIn('component_title', read.call_args_list[0].args[0])
        self.assertIn('DISTINCT ON (k.ksb_code,p.id)', read.call_args_list[0].args[0])

    def test_hour_aggregate_keeps_fractional_hours_and_canonical_acceptance_on_isolated_sqlite(self):
        with sqlite3.connect(':memory:') as db:
            db.execute("ATTACH DATABASE ':memory:' AS Learner")
            db.create_function('GREATEST', 2, max)
            db.execute('CREATE TABLE Learner.learner_progress_entries(learner_id,reporting_month,actual_seconds,accepted,deleted_at)')
            db.executemany('INSERT INTO Learner.learner_progress_entries VALUES(?,?,?,?,?)', [
                (101,'2026-01',3600,1,None), (101,'2026-01',300,1,None),
                (101,'2026-01',1200,0,None), (101,'2026-01',600,None,None),
                (101,'2026-01',-300,1,None), (101,'2026-01',None,1,None),
                (101,'2026-01','NaN',1,None), (101,'2026-01','Infinity',0,None),
                (101,'2026-01',9000,1,'deleted'), (999,'2026-01',99000,1,None)])
            def query(sql, params):
                # SQLite spelling only; exercise the actual aggregate/predicates.
                cursor = db.execute(sql.replace('actual_seconds::text', 'CAST(actual_seconds AS TEXT)').replace('%s', '?'), params)
                return [dict(zip([column[0] for column in cursor.description], values)) for values in cursor.fetchall()]
            with patch.object(canonical, 'query', side_effect=query):
                result = projection.read_hour_totals({'id': 101})
        self.assertAlmostEqual(result[0]['completed'], 3900 / 3600)
        self.assertAlmostEqual(result[0]['submitted'], .5)

    def test_projection_does_not_call_full_builders_or_evidence_readers(self):
        compact = dict(actualHours=12, targetToDateHours=25, plannedHours=100,
                       remainingHours=13, progressPercent=48, months=[])
        with patch.object(canonical, 'require_profile', return_value={'id': 101}) as identity, \
             patch.object(projection, 'read_otjh', return_value=compact), \
             patch.object(projection, 'read_ksb_rows', return_value=[]), \
             patch('learner_api.aptem_ksb_breakdown.read_breakdown', side_effect=AssertionError('Evidence hydration')), \
             patch('learner_api.training_plan_dashboard.read_dashboard', side_effect=AssertionError('Full dashboard')), \
             patch('learner_api.overview_week.read_week', side_effect=AssertionError('Full week')):
            result = projection.read_otjh_ksb(self.context())
        identity.assert_called_once_with(201)
        self.assertEqual(set(result), {'otjh', 'ksb'})
        self.assertEqual(result['otjh'], compact)

    def test_hours_failure_keeps_ksbs_and_reports_unavailable_values(self):
        with patch.object(canonical, 'require_profile', return_value={'id': 101}), \
             patch.object(projection, 'read_ksb_rows', return_value=[]), \
             patch.object(projection, 'read_otjh', side_effect=RuntimeError('Synthetic failure')), \
             patch.object(projection.log, 'exception'):
            result = projection.read_otjh_ksb(self.context())
        self.assertIn('otjh', result['errors'])
        self.assertIsNone(result['otjh']['actualHours'])
        self.assertEqual(result['ksb']['summary'], dict(total=0, achieved=0, remaining=0))

    def test_ambiguous_identity_fails_before_data_reads(self):
        with patch.object(canonical, 'require_profile', return_value={'id': 999}), \
             patch.object(projection, 'read_ksb_rows') as read:
            with self.assertRaises(ValueError):
                projection.read_otjh_ksb(self.context())
        read.assert_not_called()

    def test_activity_search_is_literal_scoped_and_returns_codes_only(self):
        with patch.object(canonical, 'query', return_value=[{'code': 'K1'}]) as read:
            self.assertEqual(projection.search_ksb_activities(101, ' Evidence%_ '), {'codes': ['K1']})
            self.assertEqual(read.call_args.args[1], [101, 'evidence%_'])
            self.assertIn('strpos(', read.call_args.args[0])
            read.reset_mock()
            self.assertEqual(projection.search_ksb_activities(101, ''), {'codes': []})
            read.assert_not_called()
