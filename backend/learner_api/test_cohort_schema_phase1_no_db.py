"""Canonical curriculum.cohorts schema: learner access and cohort dates.

The cohorts table has cohort_id, cohort_name, programme_id and the date
columns; ``deleted_at`` and ``programme_name`` were removed and there is no
deletion marker. ``status`` (planned/active/inactive) is not an access rule.
No database: every cursor is a recorder answering from fixtures.
"""
import json
from datetime import date, datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.db.models import Model
from django.test import RequestFactory, SimpleTestCase

from . import learner_detail
from .learner_detail import _apply_cohort_schedule, _cohort_schedule
from .programme_access import cohort_programme_filter, learning_access

REMOVED = ('deleted_at', 'programme_name', 'status', 'updated_at')
SUBQUERY = 'programme_id IN (SELECT programme_id FROM curriculum.programmes WHERE name = %s)'


class Cursor:
    """Answers each SELECT from ``answer(sql, params)``; refuses anything else."""

    def __init__(self, answer):
        self.answer, self.calls, self.result = answer, [], None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((' '.join(sql.split()), list(params or [])))
        if not sql.lstrip().upper().startswith('SELECT'):
            raise AssertionError(f'non-SELECT statement: {sql}')
        self.result = self.answer(sql, params)

    def fetchone(self):
        return self.result[0] if self.result else None

    def fetchall(self):
        return list(self.result or [])


def connections_for(cursor):
    return {'default': SimpleNamespace(cursor=lambda: cursor)}


def source(**ids):
    """A learner record with placement labels and (optionally) placement ids."""
    values = {'programme': 'Marketing', 'cohort': 'October 2026', 'start_date': '2025-01-01',
              'cohort_id': '', 'programme_id': '', 'group_id': ''}
    values.update(ids)
    return SimpleNamespace(**values)


class AccessFixture(SimpleTestCase):
    def setUp(self):
        self.now = patch('django.utils.timezone.now', return_value=datetime(2026, 9, 12, 12, tzinfo=timezone.utc))
        self.now.start()
        self.addCleanup(self.now.stop)
        save = patch.object(Model, 'save', side_effect=AssertionError('write during an access check'))
        save.start()
        self.addCleanup(save.stop)

    def access(self, record, answer):
        cursor = Cursor(answer)
        with patch('learner_api.programme_access.connections', connections_for(cursor)):
            result = learning_access(record)
        for sql, _params in cursor.calls:
            for column in REMOVED:
                self.assertNotIn(column, sql)
        return result, cursor.calls


class CohortIdTests(AccessFixture):
    def test_cohort_id_is_looked_up_directly(self):
        result, calls = self.access(source(cohort_id='COH-1'), lambda sql, params: [(date(2026, 9, 1),)])
        self.assertEqual(result, {'blocked': False, 'startDate': '2026-09-01'})
        self.assertEqual(calls, [('SELECT start_date FROM curriculum.cohorts WHERE cohort_id = %s', ['COH-1'])])

    def test_a_missing_cohort_id_is_blocked_without_borrowing_a_namesake(self):
        result, calls = self.access(source(cohort_id='GONE'), lambda sql, params: [])
        self.assertEqual(result, {'blocked': True, 'startDate': ''})
        self.assertEqual(len(calls), 1)

    def test_the_cohort_id_wins_over_a_different_programme_id(self):
        # Mismatch: the placement's cohort belongs to another programme. The
        # cohort id stays authoritative, exactly as before; no programme filter.
        result, calls = self.access(source(cohort_id='COH-1', programme_id='PROG-OTHER'),
                                    lambda sql, params: [(date(2026, 9, 1),)])
        self.assertFalse(result['blocked'])
        self.assertEqual(calls[0][1], ['COH-1'])
        self.assertNotIn('programme_id', calls[0][0])

    def test_status_never_decides_access(self):
        # planned, active and inactive cohorts are all live; only the date decides.
        for status in ('planned', 'active', 'inactive'):
            for start, blocked in ((date(2026, 9, 1), False), (date(2026, 9, 12), False), (date(2026, 9, 13), True)):
                with self.subTest(status=status, start=start):
                    result, calls = self.access(source(cohort_id=f'COH-{status}'), lambda sql, params: [(start,)])
                    self.assertEqual(result, {'blocked': blocked, 'startDate': start.isoformat()})

    def test_a_cohort_without_a_start_date_is_blocked(self):
        result, _ = self.access(source(cohort_id='COH-1'), lambda sql, params: [(None,)])
        self.assertEqual(result, {'blocked': True, 'startDate': ''})


class ProgrammeMatchTests(AccessFixture):
    def test_programme_id_and_cohort_name_match_the_cohort(self):
        result, calls = self.access(source(programme_id='PROG-1'), lambda sql, params: [(date(2026, 9, 1),)])
        self.assertEqual(result, {'blocked': False, 'startDate': '2026-09-01'})
        self.assertEqual(calls, [(
            'SELECT start_date FROM curriculum.cohorts WHERE programme_id = %s AND cohort_name = %s '
            'ORDER BY cohort_id LIMIT 2', ['PROG-1', 'October 2026'])])

    def test_a_programme_label_is_resolved_through_curriculum_programmes(self):
        result, calls = self.access(source(), lambda sql, params: [(date(2026, 10, 1),)])
        self.assertEqual(result, {'blocked': True, 'startDate': '2026-10-01'})
        self.assertIn(SUBQUERY, calls[0][0])
        self.assertEqual(calls[0][1], ['Marketing', 'October 2026'])

    def test_an_ambiguous_cohort_name_is_blocked_and_never_aliased(self):
        # Two cohorts share the name, e.g. two programmes with the same label.
        result, calls = self.access(source(), lambda sql, params: [(date(2026, 9, 1),), (date(2026, 8, 1),)])
        self.assertEqual(result, {'blocked': True, 'startDate': ''})
        self.assertEqual(len(calls), 1)

    def test_no_match_is_blocked(self):
        result, _ = self.access(source(cohort='Spring intake'), lambda sql, params: [])
        self.assertEqual(result, {'blocked': True, 'startDate': ''})

    def test_a_unique_month_alias_resolves_within_the_programme(self):
        def answer(sql, params):
            return [] if 'cohort_name = %s' in sql else [('Oct 2026', date(2026, 9, 1)), ('Nov 2026', date(2026, 11, 1))]
        result, calls = self.access(source(programme_id='PROG-1'), answer)
        self.assertEqual(result, {'blocked': False, 'startDate': '2026-09-01'})
        self.assertEqual(calls[1], ('SELECT cohort_name, start_date FROM curriculum.cohorts WHERE programme_id = %s',
                                    ['PROG-1']))

    def test_ambiguous_or_mismatched_month_aliases_stay_blocked(self):
        for rows in ([('Oct 2026', date(2026, 9, 1))] * 2, [('Oct 2025', date(2025, 9, 1))],
                     [('Oct 2026', None)], []):
            with self.subTest(rows=rows):
                result, _ = self.access(source(), lambda sql, params, rows=rows: [] if 'cohort_name = %s' in sql else rows)
                self.assertEqual(result, {'blocked': True, 'startDate': ''})

    def test_without_a_cohort_the_individual_date_applies_with_no_query(self):
        result, calls = self.access(source(cohort='', start_date='2026-09-01'), lambda sql, params: [])
        self.assertEqual(result, {'blocked': False, 'startDate': '2026-09-01'})
        self.assertEqual(calls, [])

    def test_the_filter_helper_prefers_the_programme_id(self):
        self.assertEqual(cohort_programme_filter('PROG-1', 'Marketing'), ('programme_id = %s', ['PROG-1']))
        self.assertEqual(cohort_programme_filter('', 'Marketing'), (SUBQUERY, ['Marketing']))


class FailClosedTests(AccessFixture):
    def test_a_database_error_propagates_and_never_grants_access(self):
        def broken(sql, params):
            raise DatabaseError('column "deleted_at" does not exist')
        for record in (source(cohort_id='COH-1'), source(programme_id='PROG-1'), source()):
            with self.subTest(record=record), self.assertRaises(DatabaseError):
                self.access(record, broken)

    def test_a_failed_check_refuses_progress(self):
        from .programme_access import refusal
        cursor = Cursor(lambda sql, params: (_ for _ in ()).throw(DatabaseError('offline')))
        account = SimpleNamespace(role='learner', subject_id=101)
        with patch('learner_api.programme_access.connections', connections_for(cursor)), \
                patch('learner_api.programme_access.EnrolmentUser.all_learners') as manager:
            manager.only.return_value.get.return_value = source(cohort_id='COH-1')
            response = refusal('/learner_api/time-tracking/start/', account, 'POST')
        self.assertEqual(response.status_code, 503)


SCHEDULE_ROW = (date(2026, 8, 3), date(2027, 8, 2), date(2028, 1, 2), None, 5)


class CohortScheduleTests(SimpleTestCase):
    def schedule(self, *args, answer=lambda sql, params: [SCHEDULE_ROW], **kwargs):
        cursor = Cursor(answer)
        with patch('learner_api.learner_detail.connections', connections_for(cursor)):
            result = _cohort_schedule(*args, **kwargs)
        for sql, _params in cursor.calls:
            for column in REMOVED:
                self.assertNotIn(column, sql)
        return result, cursor.calls

    def test_dates_by_cohort_id(self):
        result, calls = self.schedule('Old name', 'Marketing', 'COH-1', programme_id='PROG-1')
        self.assertEqual(result, {'cohortStartDate': '2026-08-03', 'gatewayStartDate': '2027-08-02',
                                  'epaEndDate': '2028-01-02', 'epaMonths': 5})
        self.assertEqual(calls[0][1], ['COH-1'])
        self.assertTrue(calls[0][0].endswith('FROM curriculum.cohorts WHERE cohort_id = %s'))

    def test_the_apprenticeship_end_override_wins(self):
        row = (date(2026, 8, 3), date(2027, 8, 2), date(2028, 1, 2), date(2028, 3, 1), '5')
        result, _ = self.schedule('C', '', 'COH-1', answer=lambda sql, params: [row])
        self.assertEqual(result['epaEndDate'], '2028-03-01')
        self.assertIsNone(result['epaMonths'])  # unchanged rule: only an int counts

    def test_name_matching_uses_programme_id_or_its_label(self):
        _, calls = self.schedule('October 2026', 'Marketing', programme_id='PROG-1')
        self.assertTrue(calls[0][0].endswith('WHERE cohort_name = %s AND programme_id = %s ORDER BY cohort_id LIMIT 2'))
        self.assertEqual(calls[0][1], ['October 2026', 'PROG-1'])
        _, calls = self.schedule('October 2026', 'Marketing')
        self.assertIn(SUBQUERY, calls[0][0])
        self.assertEqual(calls[0][1], ['October 2026', 'Marketing'])
        _, calls = self.schedule('October 2026', '')
        self.assertTrue(calls[0][0].endswith('WHERE cohort_name = %s ORDER BY cohort_id LIMIT 2'))

    def test_an_ambiguous_or_missing_cohort_shows_no_dates(self):
        for rows in ([SCHEDULE_ROW, SCHEDULE_ROW], []):
            with self.subTest(rows=len(rows)):
                result, _ = self.schedule('October 2026', 'Marketing', answer=lambda sql, params, rows=rows: rows)
                self.assertEqual(result, {})

    def test_a_database_error_leaves_the_page_without_dates(self):
        def broken(sql, params):
            raise DatabaseError('gone')
        with self.assertLogs('learner_api.learner_detail', level='WARNING'):
            result, _ = self.schedule('October 2026', 'Marketing', 'COH-1', answer=broken)
        self.assertEqual(result, {})

    def test_the_page_keys_are_always_present_and_ids_are_forwarded(self):
        detail = {}
        with patch('learner_api.placement_links.placement_ids', side_effect=DatabaseError('offline')), \
                patch.object(learner_detail, '_cohort_schedule', return_value={}) as schedule, \
                self.assertLogs('learner_api.learner_detail', level='WARNING'):
            _apply_cohort_schedule(detail, SimpleNamespace(cohort='October 2026', programme='Marketing'))
        self.assertEqual(detail, {'cohortStartDate': '', 'gatewayStartDate': '', 'epaEndDate': '', 'epaMonths': None})
        schedule.assert_called_once_with('October 2026', 'Marketing', '', programme_id='')


class Manager:
    def __init__(self, record):
        self.record = record

    def only(self, *fields):
        return self

    def get(self, **kwargs):
        return self.record


class LearnerSummaryContractTests(SimpleTestCase):
    def call(self, answer):
        record = SimpleNamespace(
            id=101, pk=101, username='Learner', email='learner@example.test', phone_number='', programme='Marketing',
            cohort='October 2026', group='Group A', employer='', employer_id=None, organization='',
            learner_type='commercial', aptem_id=None, start_date=None, end_date=None, learner_start_date=None,
            learner_end_date=None, practical_period_end_date=None, apprenticeship_end_date=None,
            onboarding_status='', programme_status='Active', cohort_id='COH-1', programme_id='PROG-1', group_id='')
        model = SimpleNamespace(all_learners=Manager(record), DoesNotExist=LookupError)
        cursor = Cursor(answer)
        with patch.dict(learner_detail.SOURCE_MODELS, {'commercial': model}), \
                patch('learner_api.programme_access.connections', connections_for(cursor)), \
                patch('learner_api.apprenticeship_agreement._group_dates', return_value=(None, None, 'learner')), \
                patch.object(learner_detail, 'access_gate', return_value={'blocked': False}), \
                patch.object(learner_detail, 'student_activity_available', return_value=False), \
                patch.object(learner_detail, '_first_session_unlocked', return_value=False), \
                patch.object(Model, 'save', side_effect=AssertionError('write during learner-summary')), \
                patch('django.utils.timezone.now', return_value=datetime(2026, 9, 12, 12, tzinfo=timezone.utc)):
            response = learner_detail.learner_summary.__wrapped__(RequestFactory().get('/'), 'commercial', 101)
        return response, cursor.calls

    def test_learner_summary_returns_its_access_contract(self):
        response, calls = self.call(lambda sql, params: [(date(2026, 9, 1),)])
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)
        self.assertEqual(body['learningAccess'], {'blocked': False, 'startDate': '2026-09-01'})
        self.assertEqual(calls, [('SELECT start_date FROM curriculum.cohorts WHERE cohort_id = %s', ['COH-1'])])

    def test_a_cohort_read_failure_is_a_safe_502(self):
        def broken(sql, params):
            raise DatabaseError('column "deleted_at" does not exist')
        with self.assertLogs('learner_api.learner_detail', level='ERROR'):
            response, _ = self.call(broken)
        self.assertEqual(response.status_code, 502)
        self.assertNotIn('deleted_at', response.content.decode())
