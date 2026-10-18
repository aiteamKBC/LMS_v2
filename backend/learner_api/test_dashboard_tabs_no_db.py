"""Synthetic chart and read-path contracts; no database is configured."""
from datetime import date
import json
from unittest.mock import MagicMock, patch
from types import SimpleNamespace
from django.test import SimpleTestCase, RequestFactory
from django.db import DatabaseError
from . import dashboard_tabs


class DashboardMonthlyHoursTests(SimpleTestCase):
    def test_reporting_allocations_and_open_month_match_monthly_log_chart(self):
        records = [{'accepted': True, 'segments': []}]
        allocations = [
            {'reporting_month': '2026-09', 'actual_seconds': 3600, 'accepted': True},
            {'reporting_month': '2026-10', 'actual_seconds': 1800, 'accepted': False},
            {'reporting_month': '2026-11', 'actual_seconds': 900, 'accepted': True},
        ]
        with patch.object(dashboard_tabs.timezone, 'localdate', return_value=date(2026, 10, 15)), \
             patch.object(dashboard_tabs.canonical, 'allocations', return_value=allocations), \
             patch.object(dashboard_tabs.canonical, 'metrics_from_records', return_value={
                 'otjh': {'completed_actual': 1.25, 'planned': 20}}):
            result = dashboard_tabs.monthly_hours({'end_date': '2027-01-01'}, records,
                                                   {'2026-09': 5, '2026-10': 6, '2026-11': 9})
        self.assertEqual(result['months'], [
            {'month': '2026-09', 'actual_hours': 1, 'not_accepted_hours': 0, 'training_plan_target': 5},
            {'month': '2026-10', 'actual_hours': 0, 'not_accepted_hours': .5, 'training_plan_target': 6}])
        self.assertEqual(result['training_plan_totals'], {'accepted_hours': 1.25, 'planned_hours': 20})

    def test_missing_and_zero_seconds_are_not_invented(self):
        with patch.object(dashboard_tabs.timezone, 'localdate', return_value=date(2026, 10, 15)), \
             patch.object(dashboard_tabs.canonical, 'allocations', return_value=[
                 {'reporting_month': '2026-10', 'actual_seconds': None, 'accepted': False}]), \
             patch.object(dashboard_tabs.canonical, 'metrics_from_records', return_value={
                 'otjh': {'actual': None, 'planned': None}}):
            result = dashboard_tabs.monthly_hours({}, [{}], {})
        self.assertEqual(result['months'][0]['actual_hours'], 0)
        self.assertIsNone(result['training_plan_totals']['accepted_hours'])

    def test_signed_empty_months_remain_and_future_months_stay_excluded(self):
        with patch.object(dashboard_tabs.timezone, 'localdate', return_value=date(2026, 10, 15)), \
             patch.object(dashboard_tabs.canonical, 'metrics_from_records', return_value={
                 'otjh': {'actual': 0, 'planned': 0}}):
            result = dashboard_tabs.monthly_hours({}, [], {}, signed_months=['2026-09', '2026-11'])
        self.assertEqual(result['months'], [{'month': '2026-09', 'actual_hours': 0,
                                            'not_accepted_hours': 0, 'training_plan_target': None}])

    def test_numeric_aggregation_matches_authoritative_month_state(self):
        from . import monthly_logs
        from .monthly_log_sources import row
        parts = [{'actual_seconds': 3600, 'accepted': True},
                 {'actual_seconds': 1800, 'accepted': False, 'actual_estimated': True},
                 {'actual_seconds': -20, 'accepted': True},
                 {'actual_seconds': None, 'accepted': False}]
        rows = []
        for index, part in enumerate(parts):
            item = row(str(index), None, 'Synthetic', 'Learning',
                       hours=dashboard_tabs.number(part['actual_seconds']) / 3600)
            item.update(accepted=part['accepted'], actual_estimated=part.get('actual_estimated'))
            rows.append(item)
        with patch.object(monthly_logs.old, 'digest', return_value='digest'):
            expected = monthly_logs.month_state('2026-09', rows, [], 8)
        with patch.object(dashboard_tabs.timezone, 'localdate', return_value=date(2026, 10, 15)), \
             patch.object(dashboard_tabs.canonical, 'allocations', return_value=[
                 {**part, 'reporting_month': '2026-09'} for part in parts]), \
             patch.object(dashboard_tabs.canonical, 'metrics_from_records', return_value={
                 'otjh': {'actual': 1, 'planned': 8}}):
            actual = dashboard_tabs.monthly_hours({}, [{}], {'2026-09': 8})['months'][0]
        for key in ('month', 'actual_hours', 'not_accepted_hours', 'training_plan_target'):
            self.assertEqual(actual[key], expected[key], key)

    def test_training_tab_reuses_records_and_avoids_attendance_and_overview_reads(self):
        from . import identity, overview_week, training_plan_dashboard, attendance_lectures, module_progress, dashboard_training
        source = SimpleNamespace(pk=5)
        owner = {'id': 15}
        records = [{'id': 1}]
        with patch.object(dashboard_tabs.canonical, 'require_profile', return_value=owner), \
             patch.object(identity, 'learner_profile_for_source', return_value=SimpleNamespace(pk=15, enrolment_id=5)) as profile, \
             patch.object(dashboard_tabs.canonical, 'entries_for', return_value=records) as entries, \
             patch.object(dashboard_tabs.canonical, 'targets_for', return_value={}), \
             patch.object(dashboard_tabs.canonical, 'query', return_value=[]), \
             patch.object(training_plan_dashboard, 'read_dashboard', return_value={'modules': []}) as schedule, \
             patch.object(overview_week, 'read_week', return_value={'planSubjects': []}), \
             patch.object(dashboard_tabs, 'learning_projection', return_value={}), \
             patch.object(dashboard_tabs, 'monthly_hours', return_value={}), \
             patch.object(dashboard_training, 'read_training', return_value={'timeline': {}, 'selectedModuleId': None, 'selectedModule': None}) as training, \
             patch.object(attendance_lectures, 'read_workspace') as attendance, \
             patch.object(module_progress, 'canonical_module_progress') as progress:
            result = dashboard_tabs.read_tab(source, 'apprenticeship', 'training', object())
        self.assertEqual(set(result), {'timeline', 'selectedModuleId', 'selectedModule'})
        entries.assert_not_called()
        schedule.assert_not_called()
        training.assert_called_once()
        profile.assert_called_once_with(
            source, 5, heal=False,
            fields=training_plan_dashboard.TRAINING_PLAN_PROFILE_FIELDS)
        attendance.assert_not_called()
        progress.assert_not_called()

    def test_missing_or_mismatched_profile_fails_before_progress_reads(self):
        from . import identity
        from old_otjh.service import ServiceError
        source = SimpleNamespace(pk=5)
        for profile in (None, SimpleNamespace(pk=16, enrolment_id=5), SimpleNamespace(pk=15, enrolment_id=6)):
            for tab in ('monthly', 'training', 'overview'):
                with self.subTest(profile=profile, tab=tab), \
                     patch.object(dashboard_tabs.canonical, 'require_profile', return_value={'id': 15}), \
                     patch.object(identity, 'learner_profile_for_source', return_value=profile), \
                     patch.object(dashboard_tabs.canonical, 'entries_for') as entries:
                    with self.assertRaises(ServiceError) as raised:
                        dashboard_tabs.read_tab(source, 'commercial', tab, object())
                    self.assertEqual(raised.exception.status, 409)
                    entries.assert_not_called()


class DashboardTabEndpointTests(SimpleTestCase):
    def call(self, *, kind='commercial', tab='monthly', account=None, missing=False, error=None, method='get'):
        from . import learner_detail, case_file_sources
        model = MagicMock()
        model.DoesNotExist = type('Missing', (Exception,), {})
        model.all_learners.only.return_value.get.side_effect = model.DoesNotExist() if missing else None
        model.all_learners.only.return_value.get.return_value = SimpleNamespace(pk=201)
        request = getattr(RequestFactory(), method)(f'/learner_api/dashboard/{kind}/201/{tab}/')
        request.login_account = account
        with patch('login.permissions.authenticate_request', return_value=account), \
             patch.dict(learner_detail.SOURCE_MODELS, {'commercial': model, 'apprenticeship': model}), \
             patch.object(case_file_sources, 'source_for_case_file', return_value=None), \
             patch.object(dashboard_tabs, 'read_tab', return_value={'schedule': {}}, side_effect=error) as read, \
             patch.object(learner_detail, 'build_learner_detail') as legacy:
            response = dashboard_tabs.dashboard_tab(request, kind=kind, pk=201, tab=tab)
        legacy.assert_not_called()
        return response, read

    def test_self_and_staff_both_learner_types_all_tabs(self):
        for kind in ('commercial', 'apprenticeship'):
            for tab in ('monthly', 'training', 'overview'):
                for role, subject in (('learner', 201), ('staff', 7)):
                    with self.subTest(kind=kind, tab=tab, role=role):
                        response, read = self.call(kind=kind, tab=tab,
                                                  account=SimpleNamespace(role=role, subject_id=subject))
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response['Cache-Control'], 'private, no-store')
                        read.assert_called_once()

    def test_other_learner_employer_and_signed_out_cannot_read(self):
        for account, expected in ((SimpleNamespace(role='learner', subject_id=202), 404),
                                  (SimpleNamespace(role='employer', subject_id=201), 403), (None, 401)):
            response, read = self.call(account=account)
            self.assertEqual(response.status_code, expected)
            read.assert_not_called()

    def test_invalid_routes_missing_source_and_post_never_read(self):
        own = SimpleNamespace(role='learner', subject_id=201)
        for options, status in (({'kind': 'unknown'}, 404), ({'tab': 'rewards'}, 404),
                                ({'missing': True}, 404), ({'method': 'post'}, 405)):
            with self.subTest(options=options):
                response, read = self.call(account=own, **options)
                self.assertEqual(response.status_code, status)
                read.assert_not_called()

    def test_unavailable_data_and_identity_conflicts_are_visible(self):
        own = SimpleNamespace(role='learner', subject_id=201)
        for error, status in ((DatabaseError('offline'), 503), (LookupError('identity review'), 409)):
            response, _ = self.call(account=own, error=error)
            self.assertEqual(response.status_code, status)
            self.assertIn('error', json.loads(response.content))
            self.assertNotIn('schedule', json.loads(response.content))


class DashboardTabModuleReadTests(SimpleTestCase):
    def projection(self, tab, **flags):
        from . import training_plan_dashboard as plan
        source = SimpleNamespace(pk=5, email='learner@example.test', _case_file_profile=object())
        cursor = MagicMock()
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        module = {'id': 'M1', 'title': 'Module', 'description': 'Rich description',
                  'start_date': None, 'end_date': None, 'total_otjh': 8,
                  'weeks_number': 1, 'sessions_number': 1}
        week = {'id': 'W1', 'module_catalogue_id': 'M1', 'week_number': 1,
                'title': 'Teaching', 'learning_outcomes': ['Visible training outcome'],
                'holiday_note_enabled': True, 'holiday_note': 'Published holiday note',
                'live_session_count': 1}
        def slots(_rows, modules, *_args):
            modules['M1']['curriculumSlots'] = [{'date': '2026-10-20', 'learningOutcomes': ['Outcome']}]
        with patch.object(plan, 'connections', {'enrolment': connection}), \
             patch.object(plan, 'plan_module_ids', return_value=(['M1'], {})), \
             patch.object(plan, 'rows', side_effect=[[module], [week]]), \
             patch.object(plan, 'attach_curriculum_slots', side_effect=slots), \
             patch.object(plan, 'plan_sessions', return_value=[]), \
             patch.object(plan, 'current_coach', return_value={'coach_name': 'Coach', 'coach_email': ''}), \
             patch.object(plan, 'coach_phone', return_value=''), \
             patch.object(plan, 'plan_reviews', return_value=[]):
            result = plan.read_dashboard(source, section='overview', targets={}, dashboard_tab=tab, **flags)
        return result['modules'][0], [args[0] for args, _kwargs in cursor.execute.call_args_list]

    def test_compact_monthly_skips_only_the_live_session_count_it_never_returns(self):
        module, statements = self.projection('monthly', compact_monthly=True)
        self.assertIn('0 AS live_session_count', statements[1])
        self.assertNotIn('curriculum.components', statements[1])
        self.assertEqual(module['curriculumSlots'], [{'date': '2026-10-20'}])
        for tab in ('monthly', 'overview', 'training', None):
            with self.subTest(tab=tab):
                _module, statements = self.projection(tab)
                self.assertIn('curriculum.components', statements[1])

    def test_monthly_overview_omit_rich_columns_at_sql_and_response_levels(self):
        for tab in ('monthly', 'overview'):
            with self.subTest(tab=tab):
                module, statements = self.projection(tab)
                self.assertIn("''::text AS description", statements[0])
                self.assertNotIn('m.description', statements[0])
                self.assertIn("'[]'::jsonb AS learning_outcomes", statements[1])
                self.assertNotIn('w.learning_outcomes', statements[1])
                self.assertNotIn('description', module)
                self.assertNotIn('learning_outcomes', module)
                self.assertEqual(module['curriculumSlots'], [{'date': '2026-10-20'}])

    def test_training_and_existing_callers_retain_rich_content(self):
        for tab in (None, 'training'):
            with self.subTest(tab=tab):
                module, statements = self.projection(tab)
                self.assertIn('m.description', statements[0])
                self.assertIn('w.learning_outcomes', statements[1])
                self.assertEqual(module['description'], 'Rich description')
                self.assertEqual(module['learning_outcomes'], ['Visible training outcome'])
                self.assertEqual(module['curriculumSlots'][0]['learningOutcomes'], ['Outcome'])


class DashboardSourceMetadataTests(SimpleTestCase):
    def test_monthly_facts_omit_presentation_columns_but_keep_reconciliation_and_history(self):
        canonical = dashboard_tabs.canonical
        with patch.object(canonical, 'query', return_value=[]) as query, \
             patch.object(canonical, 'current_records', return_value=[]):
            canonical.entries_for({'id': 15}, lineage_only=True, dashboard_metadata=True, monthly_summary=True)
        sql, params = query.call_args.args
        self.assertEqual(params, [15])
        self.assertNotIn('SELECT progress.*', sql)
        for field in ('feedback', 'feed_detail', 'feed_action', 'feed_title', 'time_tracking_calculation'):
            self.assertNotIn('progress.' + field, sql)
        for field in ('source_payload', 'actual_seconds', 'accepted', 'reporting_month', 'component_link_source',
                      'claimed_seconds', 'verified_seconds', 'reported_time', 'time_tracking_source',
                      'submitted_at', 'quiz_ref', 'achieved_score', 'total_score', 'feed_kind'):
            self.assertIn('progress.' + field, sql)
        self.assertIn('to_jsonb(s) ORDER BY s.segment_order', sql)
        self.assertIn('to_jsonb(h) ORDER BY h.id', sql)
        self.assertIn('progress.learner_id=%s', sql)
        self.assertIn('progress.deleted_at IS NULL', sql)
        self.assertNotIn('progress.reporting_month=', sql)

    def test_dashboard_sql_extracts_only_required_placement_and_provisional_keys(self):
        canonical = dashboard_tabs.canonical
        with patch.object(canonical, 'query', return_value=[]) as query, \
             patch.object(canonical, 'current_records', return_value=[]):
            canonical.entries_for({'id': 15}, lineage_only=True, dashboard_metadata=True)
        sql, params = query.call_args.args
        self.assertEqual(params, [15])
        self.assertIn("CASE WHEN jsonb_typeof(p.source_payload)='object'", sql)
        self.assertIn("THEN to_jsonb(p)-'source_payload'||jsonb_build_object", sql)
        self.assertIn('ELSE to_jsonb(p) END', sql)
        self.assertIn("'original_source_ref',p.source_payload->'original_source_ref'", sql)
        self.assertIn("'course_id',p.source_payload->'course_display_placement'->'course_id'", sql)
        self.assertIn("'section',p.source_payload->'course_display_placement'->'section'", sql)
        self.assertIn("'estimated',p.source_payload->'reconciliation'->'reporting_allocation'->'estimated'", sql)
        self.assertNotIn("'course_display_placement',p.source_payload->'course_display_placement'", sql)
        self.assertNotIn("'reconciliation',p.source_payload->'reconciliation'", sql)
        self.assertIn('progress.learner_id=%s', sql)

    def test_legacy_lineage_default_keeps_its_existing_projection(self):
        canonical = dashboard_tabs.canonical
        with patch.object(canonical, 'query', return_value=[]) as query, \
             patch.object(canonical, 'current_records', return_value=[]):
            canonical.entries_for({'id': 15}, lineage_only=True)
        sql = query.call_args.args[0]
        self.assertNotIn('course_display_placement', sql)
        self.assertIn("jsonb_typeof(p.source_payload)='object'", sql)

    def test_minimal_metadata_preserves_introduction_date_and_estimated_verdict(self):
        canonical = dashboard_tabs.canonical
        full = {'reporting_started_at': '2026-05-31T23:30:00Z', 'reporting_month': '2026-06',
                'source_payload': {'original_source_ref': 'la:50:2',
                    'course_display_placement': {'course_id': 50, 'section': 'introduction', 'unused': 'body'},
                    'reconciliation': {'reporting_allocation': {'estimated': True, 'unused': 'body'}},
                    'evidence_body': 'Never read for the Dashboard'}}
        compact = {**full, 'source_payload': {'original_source_ref': 'la:50:2',
                    'course_display_placement': {'course_id': 50, 'section': 'introduction'},
                    'reconciliation': {'reporting_allocation': {'estimated': True}}}}
        for course in ('50', '51'):
            self.assertEqual(canonical.recorded_activity_schedule(full, course),
                             canonical.recorded_activity_schedule(compact, course))
        self.assertEqual(canonical.recorded_activity_schedule(compact, '50')['date_source'], 'introduction')
        self.assertEqual(canonical.recorded_activity_schedule(compact, '50')['date'], '2026-06-01')
        self.assertTrue(canonical.is_time_estimated(compact))
        self.assertEqual(canonical.is_time_estimated(full), canonical.is_time_estimated(compact))

    def test_encoded_json_payload_fallback_retains_supported_schedule_and_estimate(self):
        canonical = dashboard_tabs.canonical
        payload = {'course_display_placement': {'course_id': 50, 'section': 'introduction'},
                   'reconciliation': {'reporting_allocation': {'estimated': True}}}
        record = {'reporting_started_at': '2026-06-15T09:00:00Z', 'reporting_month': '2026-06',
                  'source_payload': payload}
        encoded = {**record, 'source_payload': json.dumps(payload)}
        self.assertEqual(canonical.recorded_activity_schedule(record, '50'),
                         canonical.recorded_activity_schedule(encoded, '50'))
        self.assertEqual(canonical.recorded_activity_schedule(encoded, '50')['date_source'], 'introduction')
        self.assertTrue(canonical.is_time_estimated(encoded))
