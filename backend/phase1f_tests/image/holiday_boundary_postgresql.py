"""Holiday HTTP/storage parity on one disposable synthetic PostgreSQL schema."""
def composition_fixture(*args, **kwargs):
    from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture as inject
    return inject(*args, **kwargs)

from contextlib import ExitStack, contextmanager
import copy
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest

from django.db import connection, transaction
from curriculum_api import views, calendar_holidays as calendar, england_holidays
from curriculum_api.catalogue.infrastructure import holiday_store
from curriculum_api.test_holiday_boundary_no_db import original_holidays, request, response, NOW
from curriculum_api.test_hierarchy_commands_boundary_no_db import FrozenClock

SCHEMA = 'phase1f_holiday_boundary'


def query(sql, params=None):
    with connection.cursor() as cursor:
        cursor.execute(sql, params or [])
        if cursor.description:
            return [dict(zip([c[0] for c in cursor.description], row)) for row in cursor.fetchall()]
    return []


@contextmanager
def scope(old, *, normalized=True):
    with ExitStack() as stack:
        ports = dict(datetime=FrozenClock,
            authored_holiday_table_name=Mock(return_value='' if normalized else 'holidays'),
            table_exists=Mock(side_effect=lambda table: not normalized and table in {'holidays', 'england_holidays'}),
            table_name=Mock(side_effect=lambda table: f'"{SCHEMA}"."{table}"'),
            column_names=Mock(return_value=['id','label','start_date','end_date','type','color','notes','is_archived','created_at','updated_at']),
            curriculum_names=SimpleNamespace(store_staff=lambda t,p,c:(p,set()), attach=lambda t,r:r),
            write_shape=SimpleNamespace(normalise=lambda t,p,c:(p,set())),
            versioning=SimpleNamespace(record_rows=Mock()), note_live_rows=Mock(),
            note_previous_content_modules=Mock(), native_only=Mock(return_value=False),
            invalidate_curriculum_cache=Mock(), curriculum_visibility=Mock(return_value='operational'),
            archive_payload=Mock(return_value={'is_archived':True}),
            cached_curriculum_value=Mock(side_effect=lambda key, build:build()))
        for name, value in ports.items():
            stack.enter_context(composition_fixture(views, name, value))
        stack.enter_context(patch.object(calendar, '_ref', lambda table: f'"{SCHEMA}"."{table}"'))
        stack.enter_context(patch.object(calendar, '_now', return_value=NOW))
        stack.enter_context(patch.object(calendar, 'in_use', return_value=normalized))
        stack.enter_context(patch('curriculum_api.curriculum_names.invalidate'))
        for name in ('run_sync', 'auto_sync_if_due', 'sync_status', 'recent_syncs', 'reset_auto_sync_state'):
            stack.enter_context(patch.object(england_holidays, name, side_effect=AssertionError('Provider dispatch forbidden')))
        if old:
            stack.enter_context(original_holidays())
        yield


class HolidayBoundaryPostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        query(f'CREATE SCHEMA {SCHEMA}')
        query(f'''CREATE TABLE {SCHEMA}.calendar_holidays (
            id text primary key, source_kind text not null, source_record_id text not null,
            label text not null, start_date date not null, end_date date not null,
            category text, color text, notes text, is_archived boolean not null default false,
            is_system_marker boolean not null default false, division text, bunting boolean,
            fetched_at timestamptz, created_at timestamptz, updated_at timestamptz,
            unique(source_kind,source_record_id))''')
        query(f'''CREATE TABLE {SCHEMA}.cohort_calendar_holidays (
            id bigint generated always as identity primary key, cohort_id text,
            calendar_holiday_id text references {SCHEMA}.calendar_holidays(id) ON DELETE RESTRICT,
            is_selected boolean, is_excluded boolean)''')
        query(f'''CREATE TABLE {SCHEMA}.holidays (
            id bigint generated always as identity primary key, label text, start_date date, end_date date,
            type text, color text, notes text, is_archived boolean default false,
            created_at timestamp, updated_at timestamp)''')
        query(f'''CREATE TABLE {SCHEMA}.england_holidays (
            id text primary key, title text, holiday_date date, division text, notes text,
            bunting boolean, fetched_at timestamp, created_at timestamp, updated_at timestamp)''')
        query(f'CREATE TABLE {SCHEMA}.cohorts (cohort_id text primary key)')

    def clear(self):
        query(f'TRUNCATE {SCHEMA}.cohort_calendar_holidays, {SCHEMA}.calendar_holidays, {SCHEMA}.holidays, {SCHEMA}.england_holidays, {SCHEMA}.cohorts RESTART IDENTITY')

    def compare(self, scenario):
        actual = scenario(False)
        self.assertEqual(actual, scenario(True))
        return actual

    def lifecycle(self, old, normalized):
        self.clear()
        with scope(old, normalized=normalized):
            created = response(views.curriculum_holiday_collection(request('POST', {
                'label':'Synthetic closure','startDate':'2026-12-20','endDate':'2026-12-21','notes':'Keep notes'})))
            ident = str(created[1]['holiday']['id'])
            changed = response(views.curriculum_holiday_detail(request('PATCH', {'type':'Exam'}), ident))
            read = response(views.curriculum_holiday_detail(request('GET'), ident))
            archived = response(views.curriculum_holiday_detail(request('DELETE'), ident))
            active = views.get_holiday_rows()
            all_rows = views.get_holiday_rows(include_archived=True)
        return created, changed, read, archived, active, all_rows

    def test_normalized_http_create_partial_update_archive_and_read_back_match(self):
        with patch.object(holiday_store, 'create_local', wraps=holiday_store.create_local) as invoked:
            actual = self.lifecycle(False, True)
        invoked.assert_called_once()
        self.assertEqual(actual, self.lifecycle(True, True))
        self.assertEqual(actual[0][0], 201)
        self.assertEqual(actual[2][1]['startDate'], '2026-12-20')
        self.assertEqual(actual[2][1]['endDate'], '2026-12-21')
        self.assertEqual(actual[2][1]['type'], 'Exam')
        self.assertEqual(actual[4], [])
        self.assertTrue(actual[5][0]['is_archived'])

    def test_separate_table_http_contract_and_partial_fields_match(self):
        actual = self.compare(lambda old:self.lifecycle(old, False))
        self.assertEqual(actual[0][0], 201)
        self.assertEqual(actual[2][1]['label'], 'Synthetic closure')
        self.assertEqual(actual[5][0]['notes'], 'Keep notes')
        self.assertEqual(actual[4], [])

    def test_local_create_and_update_obey_callers_outer_rollback(self):
        def scenario(old):
            self.clear()
            with scope(old), transaction.atomic():
                row = calendar.create_local({'label':'Rollback','start_date':'2026-01-01','end_date':'2026-01-01'})
                calendar.update_local(row['id'], {'label':'Changed'})
                transaction.set_rollback(True)
            return query(f'SELECT * FROM {SCHEMA}.calendar_holidays')
        self.assertEqual(self.compare(scenario), [])

    def test_choices_preserve_other_cohorts_exclusion_priority_and_original_ids(self):
        def scenario(old):
            self.clear()
            with scope(old):
                first = calendar.create_local({'label':'First','start_date':'2026-01-01','end_date':'2026-01-01'})
                second = calendar.create_local({'label':'Second','start_date':'2026-01-02','end_date':'2026-01-02'})
                calendar.store_cohort_choices({'cohort_id':'OTHER','holiday_ids':[first['id']]}, [])
                rows = [{'cohort_id':'TARGET'}]
                calendar.store_cohort_choices({'holiday_ids':[first['id'],second['id'],'MISSING'],
                                              'excluded_holiday_ids':[second['id']]}, rows)
                selected = calendar.cohort_choices()
                calendar.store_cohort_choices({'cohort_id':'TARGET','holiday_ids':[]}, rows)
                cleared = calendar.cohort_choices()
            return selected, cleared, rows
        selected, cleared, rows = self.compare(scenario)
        self.assertEqual(selected['TARGET'], {'selected':['1'],'excluded':['2']})
        self.assertEqual(cleared['TARGET'], {'selected':[],'excluded':['2']})
        self.assertEqual(cleared['OTHER'], {'selected':['1'],'excluded':[]})
        self.assertEqual(rows[0]['holiday_ids'], [])

    def test_official_mirror_retains_referenced_withdrawals_and_rejects_http_edits(self):
        def scenario(old):
            self.clear()
            first = {'id':'synthetic:2026-12-25','title':'First','date':'2026-12-25','notes':'','bunting':True}
            second = {'id':'synthetic:2026-12-26','title':'Second','date':'2026-12-26','notes':'','bunting':False}
            with scope(old):
                calendar.apply_official({first['date']:first,second['date']:second}, [first,second], [], [], 'synthetic', now=NOW)
                calendar.store_cohort_choices({'cohort_id':'TARGET','holiday_ids':[first['id']]}, [])
                denied = response(views.curriculum_holiday_detail(request('PATCH', {'label':'Forbidden'}), first['id']))
                calendar.apply_official({}, [], [], [first,second], 'synthetic', now=NOW)
                hidden = calendar.rows(calendar.OFFICIAL)
                kept = query(f'SELECT source_record_id,is_archived FROM {SCHEMA}.calendar_holidays ORDER BY id')
                calendar.apply_official({first['date']:first}, [first], [], [], 'synthetic', now=NOW)
                restored = calendar.stored_official()
                latest = calendar.last_fetched()
            return denied, hidden, kept, restored, latest
        denied, hidden, kept, restored, latest = self.compare(scenario)
        self.assertEqual(denied[0], 405)
        self.assertEqual(hidden, [])
        self.assertEqual(kept, [{'source_record_id':'synthetic:2026-12-25','is_archived':True}])
        self.assertEqual(set(restored), {'2026-12-25'})
        self.assertEqual(latest, NOW)
