"""Compare the focused calendar with the original full payload using real planners.

Django SimpleTestCase forbids database access. All I/O providers use synthetic
rows; the serializers, holiday/date/clock rules and session builders are real.
Run through a verified isolated test runner, never the application database.
"""
import copy
import json
from contextlib import ExitStack
from unittest.mock import patch
from django.test import SimpleTestCase, override_settings
from . import views, delivery_dashboard, learner_assignment_counts_sql

def module(mid='M1', group='G1', cohort='C1', status='published'):
    return dict(module_catalogue_id=mid, title='Example '+mid, group_id=group, group_name=group,
        cohort_id=cohort, cohort_name=cohort, programme_id='P1', programme_name='Example programme',
        status=status, tutor_name='Example tutor', start_date='2030-09-01', end_date='2030-10-31',
        sessions_number=2, session_week_day='Wednesday', session_start_time='09:30', session_end_time='11:00', source_type='module_authoring')

class DeliveryCalendarProjectionTests(SimpleTestCase):
    def setUp(self):
        self.modules=[module(), module('M2','G2','C2','draft'), module('ARCH','G1','C1','archived'), module('UNALLOCATED','','')]
        self.groups=[dict(group_id=g, group_name=g, cohort_id=c, cohort_name=c, programme_id='P1', programme_name='Example programme',
            coach_name='Example coach', status='planned', session_week_day='Wednesday', session_start_time='09:30', session_end_time='11:00') for g,c in [('G1','C1'),('G2','C2')]]
        self.cohorts=[dict(cohort_id=c, cohort_name=c, programme_id='P1', programme_name='Example programme', status=status,
            start_date='2030-09-01', end_date='2030-10-31', excluded_holiday_ids='[]') for c,status in [('C1','active'),('C2','planned')]]
        self.weeks=[dict(id='W'+str(i), module_catalogue_id='M1', week_number=i, display_order=i, title='Example week') for i in [1,2]]
        self.components=[dict(id='L'+str(i), module_catalogue_id='M1', week_id='W'+str(i), display_order=0, title='Example live '+str(i),
            type='live_session', settings_json=json.dumps({'sessionDate':day,'sessionTime':'09:30','durationMinutes':90,'extraTeamsMeetingUrl':'https://example.invalid/meeting'}))
            for i,day in [(1,'2030-09-04'),(2,'2030-09-11')]]
        self.holidays=[]
        self.reads=[]
        patches={
            'authoring_fetch_all':self.fetch, 'get_holiday_rows':lambda:copy.deepcopy(self.holidays),
            'get_holiday_rows_safe':lambda:copy.deepcopy(self.holidays), 'ensure_module_authoring_tables':lambda:None,
            'safe_module_index_rows':lambda:copy.deepcopy(self.modules), 'module_index_rows':lambda **kwargs:copy.deepcopy(self.modules),
            'get_authoring_module_rows':lambda:copy.deepcopy(self.modules),
            'column_names':lambda table:set().union(*(row.keys() for row in self.source_rows(table))),
            'active_learner_delivery_counts':lambda:({},{}),
            'cohort_authoring_detail_rows':lambda:[views.serialize_cohort_authoring_detail(r,self.holidays) for r in self.cohorts],
            'group_authoring_detail_rows':lambda:[views.serialize_group_authoring_detail(r) for r in self.groups],
            'build_programmes':lambda *a,**kw:[{'id':'P1','sourceId':'P1','name':'Example programme'}],
            'build_ksb_data':lambda *a,**kw:([],[]),
        }
        for name,value in patches.items():
            p=patch.object(views,name,value); p.start(); self.addCleanup(p.stop)
        p=patch.object(learner_assignment_counts_sql,'bulk_assigned_learner_counts_sql',lambda *a,**kw:{})
        p.start(); self.addCleanup(p.stop)
    def source_rows(self, table):
        data={views.AUTHORING_MODULES_TABLE:self.modules, views.GROUPS_TABLE:self.groups,
              views.COHORT_AUTHORING_DETAILS_TABLE:self.cohorts, views.AUTHORING_WEEKS_TABLE:self.weeks,
              views.AUTHORING_COMPONENTS_TABLE:self.components, views.AUTHORING_KSB_MAPPINGS_TABLE:[]}
        if table not in data: raise AssertionError('Unexpected data source: '+table)
        return data[table]
    def fetch(self, table, where_sql='', params=None, order_sql='', **kwargs):
        rows=copy.deepcopy(self.source_rows(table)); params=params or []
        if where_sql and params:
            if 'module_catalogue_id' in where_sql: rows=[r for r in rows if r.get('module_catalogue_id') in params]
            elif 'group_id' in where_sql: rows=[r for r in rows if r.get('group_id') in params]
            elif 'cohort_id' in where_sql: rows=[r for r in rows if r.get('cohort_id') in params]
        if table==views.AUTHORING_COMPONENTS_TABLE and where_sql: rows=[r for r in rows if r['type']=='live_session']
        self.reads.append((table,len(rows)))
        if kwargs.get('columns'):
            rows=[{key:value for key,value in row.items() if key in kwargs['columns']} for row in rows]
        return rows
    def compare(self):
        training=views.authoring_modules_as_training_rows(module_rows=self.modules,group_rows=self.groups,cohort_rows=self.cohorts)
        catalogue=views.authoring_modules_as_catalogue_rows(module_rows=self.modules,week_rows=self.weeks)
        rows=dict(training=training, modules=catalogue, authoring_modules=self.modules, program_configs=[],ksb_profiles=[],holidays=self.holidays,tutors=[],coaches=[],tutor_modules=[])
        original=views.build_curriculum_payload_from_rows(rows,compact=True)
        original_calendar=views.build_curriculum_payload_from_rows(rows,compact=False)
        small=delivery_dashboard.build_overview(); calendar=delivery_dashboard.build_sessions()['sessions']
        self.assertEqual(sorted(m['id'] for m in small['modules']), sorted(m['id'] for m in original['modules']))
        self.assertEqual(sorted((c['id'],c['status']) for c in small['cohorts']),sorted((c['id'],c['status']) for c in original['cohorts']))
        self.assertEqual(sorted((g['id'],g['cohortId'],sorted(g['moduleIds'])) for g in small['groups']),sorted((g['id'],g['cohortId'],sorted(g['moduleIds'])) for g in original['groups']))
        self.assertEqual(delivery_dashboard.build_calendar_sessions(),original_calendar['sessions'])
        fields=('id','type','date','startTime','timeZone','title','status','moduleCatalogueId','moduleId')
        self.assertEqual(calendar,[{key:s.get(key) for key in fields} for s in original_calendar['sessions']])
        return original,small,calendar

    def production_reader_parity(self):
        """Use the actual main row reader, not an invented legacy training input.

        get_training_rows() currently projects the normalized authoring tables.
        The older prefer_authoring_module_sessions() compatibility contract can
        accept unmatched training rows, but that is not an independent source
        read by the live endpoint. Keep this boundary covered before adding a
        legacy fallback that would change main's data source or read cost.
        """
        with ExitStack() as sources:
            sources.enter_context(patch.object(views, 'table_exists', return_value=False))
            for name in ('get_ksb_profile_rows', 'get_program_config_rows', 'get_tutor_rows',
                         'get_coach_rows', 'get_tutor_module_rows'):
                sources.enter_context(patch.object(views, name, return_value=[]))
            rows = views.get_curriculum_rows(compact=False)
        original = views.build_curriculum_payload_from_rows(rows, compact=False)
        from django.test import RequestFactory
        request = RequestFactory().get('/curriculum/sessions/')
        endpoint = views.curriculum_sessions
        while hasattr(endpoint, '__wrapped__'):
            endpoint = endpoint.__wrapped__
        self.reads.clear()
        with patch.object(views, 'cached_curriculum_value', side_effect=lambda key, build, **kw: build()), \
             patch.object(views, 'get_cached_payload', side_effect=AssertionError('Full overview must not be loaded')):
            response = endpoint(request)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual(payload['results'], original['sessions'])
        self.assertEqual(payload['count'], len(original['sessions']))
        self.assertEqual(len(self.reads), 5)
        return rows, payload

    def test_live_source_reader_preserves_training_plan_origin_sessions_without_an_extra_legacy_read(self):
        self.modules[0].update(module_catalogue_id='MOD-LEGACY-1', source_type='training_plan', source_id='legacy-delivery-1')
        for row in [*self.weeks, *self.components]:
            row['module_catalogue_id'] = 'MOD-LEGACY-1'
        before = copy.deepcopy((self.modules, self.weeks, self.components))
        rows, payload = self.production_reader_parity()
        self.assertEqual({row['id'] for row in rows['training']}, {'MOD-LEGACY-1', 'M2', 'ARCH'})
        self.assertEqual({row['moduleCatalogueId'] for row in payload['results']}, {'MOD-LEGACY-1'})
        self.assertEqual({row['trainingPlanId'] for row in payload['results']}, {'legacy-delivery-1'})
        self.assertEqual(len(payload['results']), 2)
        self.assertEqual((self.modules, self.weeks, self.components), before)

    def test_live_source_reader_does_not_regenerate_training_plan_sessions_without_authored_components(self):
        self.modules[0].update(source_type='training_plan', source_id='legacy-delivery-1', sessions_number=14)
        self.components = []
        _, payload = self.production_reader_parity()
        self.assertEqual(payload['results'], [])
    def test_allocations_dates_clocks_and_empty_modules_match_main(self):
        original,small,calendar=self.compare(); self.assertEqual(len(calendar),2)
        self.assertNotIn('ARCH',[m['id'] for m in small['modules']]); self.assertNotIn('UNALLOCATED',[m['id'] for m in small['modules']])
    def test_explicitly_moved_live_date_is_preserved(self):
        settings=json.loads(self.components[0]['settings_json']); settings['sessionDate']='2030-09-06'
        self.components[0]['settings_json']=json.dumps(settings)
        _,_,calendar=self.compare(); self.assertIn('2030-09-06',[s['date'] for s in calendar])
    def test_empty_structure_does_not_invent_a_session(self):
        self.components=[]
        _,_,calendar=self.compare(); self.assertEqual(calendar,[])
    def test_group_clock_is_used_for_an_unbooked_session(self):
        self.groups[0]['session_start_time']='13:00'; self.groups[0]['session_end_time']='14:30'
        for component in self.components:
            data=json.loads(component['settings_json']); data.pop('extraTeamsMeetingUrl'); data['sessionTime']=''
            component['settings_json']=json.dumps(data)
        _,_,calendar=self.compare(); self.assertTrue(all(s['startTime']=='13:00' for s in calendar))
    def test_booked_clock_does_not_move_with_the_group_clock(self):
        self.groups[0]['session_start_time']='13:00'; self.groups[0]['session_end_time']='14:30'
        _,_,calendar=self.compare(); self.assertTrue(all(s['startTime']=='09:30' for s in calendar))

    def test_dashboard_preserves_confirmed_session_timezone_and_wall_clock(self):
        settings=json.loads(self.components[0]['settings_json'])
        settings.update(sessionDate='2030-09-06',sessionTime='00:30',sessionTimeZone='Africa/Cairo')
        self.components[0]['settings_json']=settings
        before=copy.deepcopy(self.components)
        self.reads.clear()
        sessions=delivery_dashboard.build_sessions()['sessions']
        self.assertEqual(len(self.reads),5)
        self.assertEqual(sessions[0]['date'],'2030-09-06')
        self.assertEqual(sessions[0]['startTime'],'00:30')
        self.assertEqual(sessions[0]['timeZone'],'Africa/Cairo')
        self.assertEqual(self.components,before)
        self.compare()
    def test_soft_deleted_modules_are_not_counted_or_scheduled(self):
        self.modules[0]['deleted_at']='2030-09-01'
        _,small,calendar=self.compare(); self.assertNotIn('M1',[m['id'] for m in small['modules']]); self.assertEqual(calendar,[])
    def test_holidays_do_not_rewrite_booked_session_dates(self):
        self.holidays=[dict(id='H1',date='2030-09-04',label='Synthetic holiday')]
        _,_,calendar=self.compare(); self.assertEqual([s['date'] for s in calendar],['2030-09-04','2030-09-11'])
    def test_additional_live_components_keep_distinct_session_identity_and_date(self):
        extra=copy.deepcopy(self.components[0]); extra['id']='EXTRA'; extra['display_order']=1
        data=json.loads(extra['settings_json']); data['sessionDate']='2030-09-06'; extra['settings_json']=json.dumps(data)
        self.components.insert(1,extra)
        _,_,calendar=self.compare(); self.assertEqual(len(calendar),3); self.assertEqual(len({s['id'] for s in calendar}),3)

    def test_legacy_settings_and_explicit_nulls_keep_the_same_booking_and_clock(self):
        self.components[0]['settings_json'] = {
            'legacySettings': json.dumps({'sessionDate': '2030-09-06', 'sessionTime': '11:45',
                'durationMinutes': 90, 'extraTeamsMeetingUrl': 'https://example.invalid/booked'}),
            'sessionTime': None,
        }
        self.compare()

    def test_deleted_and_detached_rows_never_reappear_on_the_calendar(self):
        self.weeks[0]['library_state'] = views.LIBRARY_STATE_DETACHED
        self.components[1]['deleted_at'] = '2030-09-01'
        _, _, calendar = self.compare()
        self.assertEqual(calendar, [])

    def test_unallocated_authored_sessions_are_preserved_even_without_an_overview_card(self):
        module_row = next(row for row in self.modules if row['module_catalogue_id'] == 'UNALLOCATED')
        module_row['session_week_day'] = 'Friday'
        self.weeks.append(dict(id='WU', module_catalogue_id='UNALLOCATED', week_number=1, display_order=0))
        self.components.append(dict(id='LU', module_catalogue_id='UNALLOCATED', week_id='WU', type='live_session',
            settings_json={'sessionDate': '2030-09-06', 'extraTeamsMeetingUrl': 'https://example.invalid/unallocated'}))
        _, _, calendar = self.compare()
        self.assertIn('UNALLOCATED', [row['moduleCatalogueId'] for row in calendar])

    def test_dashboard_counts_undated_live_components_without_changing_calendar_rows(self):
        before_calendar = delivery_dashboard.build_calendar_sessions()
        for identifier, day in [('blank', ''), ('invalid', '2030-02-30')]:
            self.components.append(dict(id=identifier, module_catalogue_id='M1', week_id='W1',
                display_order=1, type='live_session', settings_json={'sessionDate': day,
                    'extraTeamsMeetingUrl': 'https://example.invalid/additional'}))
        before_components = copy.deepcopy(self.components)
        self.reads.clear()
        dashboard = delivery_dashboard.build_sessions()
        self.assertEqual(dashboard['undatedSessionCount'], 2)
        self.assertEqual(len(self.reads), 5)
        self.assertEqual(len(dashboard['sessions']), len(before_calendar))
        self.assertEqual(delivery_dashboard.build_calendar_sessions(), before_calendar)
        self.assertEqual(self.components, before_components)
        self.compare()

    def test_primary_live_date_resolved_by_the_plan_is_not_reported_as_missing(self):
        self.components[0]['settings_json'] = {'sessionDate': ''}
        dashboard = delivery_dashboard.build_sessions()
        self.assertEqual(dashboard['undatedSessionCount'], 0)
        self.assertEqual(len(dashboard['sessions']), 2)
        self.compare()

    def test_all_undated_components_remain_counted_with_an_empty_calendar(self):
        for component in self.components:
            settings = json.loads(component['settings_json'])
            settings['sessionDate'] = ''
            component['settings_json'] = settings
        payload = delivery_dashboard.build_sessions()
        self.assertEqual(payload, {'sessions': [], 'undatedSessionCount': 2})
        self.compare()

    def test_undated_warning_uses_the_existing_archived_deleted_and_detached_scope(self):
        self.weeks.extend([
            dict(id='WA', module_catalogue_id='ARCH', week_number=1, display_order=0),
            dict(id='WD', module_catalogue_id='M1', week_number=3, display_order=3,
                 library_state=views.LIBRARY_STATE_DETACHED),
        ])
        for identifier, mid, week, extra in [
            ('missing', 'M1', 'W1', {}),
            ('archived', 'ARCH', 'WA', {}),
            ('detached', 'M1', 'WD', {}),
            ('deleted', 'M1', 'W1', {'deleted_at': '2030-09-01'}),
        ]:
            self.components.append(dict(id=identifier, module_catalogue_id=mid, week_id=week,
                display_order=2, type='live_session', settings_json={'sessionDate': '',
                    'extraTeamsMeetingUrl': 'https://example.invalid/additional'}, **extra))
        self.assertEqual(delivery_dashboard.build_sessions()['undatedSessionCount'], 1)
        self.compare()

    @override_settings(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
    def test_chart_and_calendar_cache_invalidate_together_after_a_curriculum_write(self):
        from django.test import RequestFactory
        request = RequestFactory().get('/curriculum/sessions/')
        generation = [1001]
        key = 'delivery-calendar:v3'
        views._CURRICULUM_CACHE.pop(key, None)
        self.addCleanup(views._CURRICULUM_CACHE.pop, key, None)
        with patch.object(views, 'shared_curriculum_epoch', side_effect=lambda: generation[0]), \
             patch.object(delivery_dashboard, 'build_calendar_snapshot', side_effect=[
                 {'sessions': [{'id': 'one'}], 'undatedSessionCount': 2},
                 {'sessions': [{'id': 'two'}], 'undatedSessionCount': 0},
             ]) as builder:
            first = delivery_dashboard.cached_calendar_sessions(request)
            self.assertEqual(delivery_dashboard.cached_calendar_sessions(request), first)
            self.assertEqual(delivery_dashboard.cached_calendar_snapshot(request)['undatedSessionCount'], 2)
            builder.assert_called_once()
            generation[0] += 1
            self.assertEqual(delivery_dashboard.cached_calendar_sessions(request), [{'id': 'two'}])
            self.assertEqual(delivery_dashboard.cached_calendar_snapshot(request)['undatedSessionCount'], 0)
            self.assertEqual(builder.call_count, 2)
