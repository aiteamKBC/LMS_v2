"""Actual required readers and HTTP error mapping; synthetic inputs, no DB access."""
from contextlib import contextmanager
from datetime import datetime, timezone
from inspect import signature
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.http import JsonResponse
from django.test import SimpleTestCase, RequestFactory, override_settings
from django.urls import path

from curriculum_api import middleware, learner_assignment_counts_sql
from curriculum_api.catalogue.application.read_errors import CatalogueReadUnavailable
from curriculum_api.catalogue.application.staff_profiles import StaffDirectoryUnavailable
from curriculum_api.catalogue.infrastructure import catalogue_sources, delivery_counts, row_queries, database_reads
from curriculum_api.catalogue.application import delivery_reads
from curriculum_api.catalogue.domain.values import clean_str
from curriculum_api.meetings.api import creation
from curriculum_api.meetings.infrastructure import calendar_verification
from curriculum_api.catalogue.infrastructure import structure_runtime
from curriculum_api.catalogue.infrastructure.cache_runtime import curriculum_read_scope
from curriculum_api.directory.infrastructure import membership_runtime, assigned_reads
from curriculum_api.reporting.infrastructure import progress, reflections, supplementary


def calendar_response(request):
    return JsonResponse({'holidays': catalogue_sources.get_holiday_rows_safe()})


def learner_schema_response(request, probe):
    if probe == 'table':
        value = database_reads.learner_schema_table_exists('synthetic')
    else:
        value = sorted(database_reads.learner_schema_columns('synthetic'))
    return JsonResponse({'result': value})


urlpatterns = [path('calendar/', calendar_response),
               path('learner-schema/<str:probe>/', learner_schema_response)]


class LearnerSchemaReadFailures(SimpleTestCase):
    @contextmanager
    def fail_at(self, mocked_call, failure):
        previous = mocked_call.side_effect
        mocked_call.side_effect = failure
        try:
            yield
        finally:
            mocked_call.side_effect = previous

    def setUp(self):
        database_reads.reset_learner_schema_cache()
        self.addCleanup(database_reads.reset_learner_schema_cache)
        self.db = MagicMock(vendor='postgresql')
        self.cursor = self.db.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = (1,)
        self.cursor.fetchall.return_value = [('programme_id',), ('cohort_id',), ('group_id',)]
        self.connection_patch = patch.object(database_reads, 'connection', self.db)
        self.connection_patch.start()
        self.addCleanup(self.connection_patch.stop)

    def test_table_probe_errors_raise_without_publishing_missing_metadata(self):
        for stage in ('cursor', 'enter', 'execute', 'fetchone'):
            with self.subTest(stage=stage):
                database_reads.reset_learner_schema_cache()
                failed = {'cursor': self.db.cursor,
                          'enter': self.db.cursor.return_value.__enter__,
                          'execute': self.cursor.execute,
                          'fetchone': self.cursor.fetchone}[stage]
                failure = RuntimeError('synthetic private connection diagnostic')
                with self.fail_at(failed, failure):
                    with self.assertRaises(CatalogueReadUnavailable) as caught:
                        database_reads.learner_schema_table_exists('synthetic')
                self.assertIs(caught.exception.__cause__, failure)
                self.assertEqual(caught.exception.code, 'learner_schema_unavailable')
                self.assertNotIn('private', str(caught.exception))
                self.assertEqual(database_reads._LEARNER_TABLES_PRESENT, set())
                self.assertTrue(database_reads.learner_schema_table_exists('synthetic'))

    def test_column_probe_errors_raise_without_publishing_empty_metadata(self):
        for stage in ('cursor', 'enter', 'execute', 'fetchall'):
            with self.subTest(stage=stage):
                database_reads.reset_learner_schema_cache()
                failed = {'cursor': self.db.cursor,
                          'enter': self.db.cursor.return_value.__enter__,
                          'execute': self.cursor.execute,
                          'fetchall': self.cursor.fetchall}[stage]
                failure = RuntimeError('synthetic private SQL diagnostic')
                with self.fail_at(failed, failure):
                    with self.assertRaises(CatalogueReadUnavailable) as caught:
                        database_reads.learner_schema_columns('synthetic')
                self.assertIs(caught.exception.__cause__, failure)
                self.assertEqual(caught.exception.code, 'learner_schema_unavailable')
                self.assertNotIn('private', str(caught.exception))
                self.assertEqual(database_reads._LEARNER_SCHEMA_COLUMNS, {})
                self.assertEqual(database_reads.learner_schema_columns('synthetic'),
                                 {'programme_id', 'cohort_id', 'group_id'})

    def test_failed_probes_are_not_memoized_inside_the_same_read_scope(self):
        for read in (database_reads.learner_schema_table_exists, database_reads.learner_schema_columns):
            with self.subTest(read=read.__name__):
                database_reads.reset_learner_schema_cache()
                self.cursor.execute.reset_mock()
                self.cursor.execute.side_effect = [RuntimeError('private'), None]
                with curriculum_read_scope():
                    with self.assertRaises(CatalogueReadUnavailable):
                        read('synthetic')
                    result = read('synthetic')
                    self.assertTrue(result)
                    self.assertEqual(read('synthetic'), result)
                self.assertEqual(self.cursor.execute.call_count, 2)

    def test_expired_columns_failure_does_not_return_or_refresh_stale_data(self):
        clock = [1000.0]
        with patch.object(database_reads.time, 'monotonic', side_effect=lambda: clock[0]):
            database_reads.learner_schema_columns('synthetic')
            original = database_reads._LEARNER_SCHEMA_COLUMNS['synthetic']
            clock[0] += database_reads.LEARNER_SCHEMA_COLUMNS_TTL_SECONDS + 1
            with self.fail_at(self.cursor.execute, RuntimeError('private')):
                with self.assertRaises(CatalogueReadUnavailable):
                    database_reads.learner_schema_columns('synthetic')
            self.assertEqual(database_reads._LEARNER_SCHEMA_COLUMNS['synthetic'], original)
            self.cursor.fetchall.return_value = [('new_column',)]
            self.assertEqual(database_reads.learner_schema_columns('synthetic'), {'new_column'})

    def test_successful_absence_and_unsupported_vendor_remain_distinct_from_failure(self):
        self.cursor.fetchone.return_value = None
        self.cursor.fetchall.return_value = []
        self.assertFalse(database_reads.learner_schema_table_exists('synthetic'))
        self.assertEqual(database_reads.learner_schema_columns('synthetic'), set())
        self.assertEqual(database_reads._LEARNER_TABLES_PRESENT, set())
        self.assertEqual(database_reads._LEARNER_SCHEMA_COLUMNS, {})
        self.db.cursor.reset_mock()
        self.db.vendor = 'sqlite'
        self.assertFalse(database_reads.learner_schema_table_exists('synthetic'))
        self.assertEqual(database_reads.learner_schema_columns('synthetic'), set())
        self.db.cursor.assert_not_called()

    @override_settings(ROOT_URLCONF=__name__, ALLOWED_HOSTS=['testserver'],
                       MIDDLEWARE=['curriculum_api.middleware.SchemaNotProvisionedMiddleware'])
    def test_actual_http_chain_reports_schema_failures_as_sanitized_503(self):
        for probe, expected in (
            ('table', 'Learner schema availability could not be verified. Please retry.'),
            ('columns', 'Learner schema columns could not be verified. Please retry.'),
        ):
            with self.subTest(probe=probe), self.fail_at(self.db.cursor, RuntimeError('private SQL')):
                response = self.client.get('/learner-schema/' + probe + '/')
            self.assertEqual(response.status_code, 503)
            self.assertEqual(response.json(), {'error': expected, 'code': 'learner_schema_unavailable'})

    def test_actual_membership_reader_stops_before_reading_facts_on_failed_metadata(self):
        for cached_table in (False, True):
            with self.subTest(cached_table=cached_table):
                database_reads.reset_learner_schema_cache()
                if cached_table:
                    database_reads._LEARNER_TABLES_PRESENT.add('learners')
                self.cursor.execute.reset_mock()
                with patch.object(membership_runtime, 'connection', self.db), \
                     self.fail_at(self.cursor.execute, RuntimeError('private')):
                    with self.assertRaises(CatalogueReadUnavailable):
                        membership_runtime.learner_facts({'SYNTHETIC-MODULE'})
                self.cursor.execute.assert_called_once()
                self.assertIn('information_schema.', self.cursor.execute.call_args.args[0])

    def test_actual_id_link_checks_do_not_choose_name_matching_on_probe_failure(self):
        for read in (structure_runtime.learners_link_programme_by_id, structure_runtime.learners_link_placement_by_id):
            with self.subTest(read=read.__name__), \
                 self.fail_at(self.cursor.execute, RuntimeError('private')):
                with self.assertRaises(CatalogueReadUnavailable):
                    read()

    def test_assigned_profiles_never_look_empty_after_failed_table_probe(self):
        for strict in (False, True):
            rows = Mock()
            with self.subTest(strict=strict), self.fail_at(self.cursor.execute, RuntimeError('private')):
                with self.assertRaises(CatalogueReadUnavailable):
                    assigned_reads.read_programme_profiles(
                        'SYNTHETIC-PROGRAMME', strict=strict, connection=self.db,
                        learner_schema_table_exists=database_reads.learner_schema_table_exists,
                        clean_str=clean_str, rows_as_dicts=rows, DatabaseError=RuntimeError, logger=Mock(),
                    )
            rows.assert_not_called()

    def test_progress_source_failure_is_not_optional_absence(self):
        with self.fail_at(self.cursor.execute, RuntimeError('private')):
            with self.assertRaises(CatalogueReadUnavailable):
                progress.progress_source_available(connection=self.db,
                    learner_schema_table_exists=database_reads.learner_schema_table_exists)

    def test_reflection_declaration_and_evidence_fail_before_data_queries(self):
        options = dict(connection=self.db, learner_schema_columns=database_reads.learner_schema_columns,
                       learner_schema_table_exists=database_reads.learner_schema_table_exists)
        for read in (lambda: reflections.reflection_columns(**options),
                     lambda: supplementary.declaration_source_available(**options),
                     lambda: supplementary.evidence_rows({'synthetic'}, **options,
                         logger=Mock(), quote_ident=database_reads.quote_ident, rows_as_dicts=Mock())):
            for cached_tables in (False, True):
                with self.subTest(reader=read, cached_tables=cached_tables):
                    database_reads.reset_learner_schema_cache()
                    if cached_tables:
                        database_reads._LEARNER_TABLES_PRESENT.update(
                            {'learning_reflection_submissions', 'learner_progress_entries', 'evidence_files'})
                    self.cursor.execute.reset_mock()
                    with self.fail_at(self.cursor.execute, RuntimeError('private')):
                        with self.assertRaises(CatalogueReadUnavailable):
                            read()
                    self.cursor.execute.assert_called_once()
                    self.assertIn('information_schema.', self.cursor.execute.call_args.args[0])


class RequiredReadFailures(SimpleTestCase):
    def test_actual_calendar_metadata_failure_cannot_look_like_missing_tables(self):
        with patch.object(database_reads, '_TABLE_EXISTS_CACHE', {}), \
             patch.object(database_reads.schema_gate, 'table_exists', side_effect=RuntimeError('private connection failure')):
            with self.assertRaises(CatalogueReadUnavailable) as caught:
                catalogue_sources.get_holiday_rows_safe()
        self.assertEqual(caught.exception.code, 'holiday_calendar_unavailable')

    def test_failed_schema_probe_is_not_cached_as_absence_and_can_recover(self):
        with patch.object(database_reads, '_TABLE_EXISTS_CACHE', {}) as cache, \
             patch.object(database_reads.schema_gate, 'table_exists', side_effect=[RuntimeError('private SQL'), True]) as probe:
            with self.assertRaises(CatalogueReadUnavailable): database_reads.table_exists('synthetic')
            self.assertEqual(cache, {})
            self.assertTrue(database_reads.table_exists('synthetic'))
            self.assertTrue(database_reads.table_exists('synthetic'))
            self.assertEqual(probe.call_count, 2)

    def test_successful_absent_schema_probe_still_returns_false(self):
        with patch.object(database_reads, '_TABLE_EXISTS_CACHE', {}), \
             patch.object(database_reads.schema_gate, 'table_exists', return_value=False):
            self.assertFalse(database_reads.table_exists('synthetic'))

    def test_calendar_failure_is_not_an_empty_calendar(self):
        failure = RuntimeError('synthetic private connection diagnostic')
        with patch.object(catalogue_sources, 'get_holiday_rows', side_effect=failure):
            with self.assertRaises(CatalogueReadUnavailable) as caught:
                catalogue_sources.get_holiday_rows_safe()
        self.assertIs(caught.exception.__cause__, failure)
        self.assertEqual(caught.exception.code, 'holiday_calendar_unavailable')
        self.assertNotIn('private', str(caught.exception))

    def test_successful_empty_calendar_remains_empty(self):
        with patch.object(catalogue_sources, 'get_holiday_rows', return_value=[]) as read:
            self.assertEqual(catalogue_sources.get_holiday_rows_safe(), [])
        read.assert_called_once_with()

    def test_calendar_success_preserves_rows(self):
        rows = [{'id': 'SYNTHETIC', 'title': 'Holiday'}]
        with patch.object(catalogue_sources, 'get_holiday_rows', return_value=rows):
            self.assertIs(catalogue_sources.get_holiday_rows_safe(), rows)

    @override_settings(ROOT_URLCONF=__name__, ALLOWED_HOSTS=['testserver'],
                       MIDDLEWARE=['curriculum_api.middleware.SchemaNotProvisionedMiddleware'])
    def test_actual_http_chain_reports_503_without_private_details(self):
        with patch.object(catalogue_sources, 'get_holiday_rows', side_effect=RuntimeError('private SQL')):
            response = self.client.get('/calendar/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'error': 'Holiday calendar is unavailable. Please retry.',
                                           'code': 'holiday_calendar_unavailable'})

    def test_error_mapper_preserves_unrelated_exceptions(self):
        adapter = middleware.SchemaNotProvisionedMiddleware(Mock())
        request = RequestFactory().get('/curriculum_api/overview/')
        self.assertIsNone(adapter.process_exception(request, TypeError('programming failure')))
        for failure, code in ((StaffDirectoryUnavailable('Staff directory unavailable.'), 'staff_directory_unavailable'),
                              (CatalogueReadUnavailable('Unavailable.', code='learner_counts_unavailable'), 'learner_counts_unavailable')):
            response = adapter.process_exception(request, failure)
            self.assertEqual(response.status_code, 503)
            self.assertEqual(json.loads(response.content)['code'], code)

    def count_options(self, db):
        return dict(connection=db, learner_relation_exists=Mock(return_value=True),
                    learners_link_placement_by_id=Mock(return_value=True), logger=Mock(),
                    schema_compat=SimpleNamespace(columns_of=Mock(return_value={'group_id', 'cohort_id'})))

    def test_count_connection_and_metadata_failures_never_become_zero(self):
        for source in ('connection', 'existence', 'columns', 'fetch'):
            with self.subTest(source=source):
                db = MagicMock(vendor='postgresql'); options = self.count_options(db)
                failure = RuntimeError('private SQL')
                if source == 'connection': db.cursor.side_effect = failure
                elif source == 'existence': options['learner_relation_exists'].side_effect = failure
                elif source == 'columns': options['schema_compat'].columns_of.side_effect = failure
                else: db.cursor.return_value.__enter__.return_value.fetchall.side_effect = failure
                with self.assertRaises(CatalogueReadUnavailable) as caught:
                    delivery_counts.active_learner_delivery_counts(**options)
                self.assertEqual(caught.exception.code, 'learner_counts_unavailable')

    def test_count_empty_success_and_explicit_unsupported_source_unchanged(self):
        for vendor, exists in (('postgresql', True), ('postgresql', False), ('sqlite', True)):
            db = MagicMock(vendor=vendor); options = self.count_options(db)
            options['learner_relation_exists'].return_value = exists
            db.cursor.return_value.__enter__.return_value.fetchall.return_value = []
            self.assertEqual(delivery_counts.active_learner_delivery_counts(**options), ({}, {}))
            if not exists or vendor == 'sqlite': db.cursor.assert_not_called()

    def test_count_identity_buckets_and_lifecycle_query_preserved(self):
        db = MagicMock(vendor='postgresql'); options = self.count_options(db)
        cursor = db.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('P', 'C', 'G', ' C1 ', 'G1', 2), ('p', 'c', 'g', '', '', 3)]
        self.assertEqual(delivery_counts.active_learner_delivery_counts(**options),
                         ({'C1': 2, ('p', 'c'): 3}, {'G1': 2, ('p', 'c', 'g'): 3}))
        self.assertIn("where lifecycle_status = 'active'", cursor.execute.call_args.args[0])

    def test_module_reader_aliases_propagate_failure(self):
        for name in ('get_authoring_module_rows', 'safe_module_index_rows', 'safe_authoring_module_rows'):
            with self.subTest(reader=name), patch.object(row_queries, 'authoring_fetch_all', side_effect=RuntimeError('private SQL')):
                with self.assertRaises(CatalogueReadUnavailable): getattr(row_queries, name)()

    def test_module_readers_preserve_empty_success_and_full_vs_index_projection(self):
        for name in ('get_authoring_module_rows', 'safe_module_index_rows', 'safe_authoring_module_rows'):
            with self.subTest(reader=name), patch.object(row_queries, 'authoring_fetch_all', return_value=[]) as read:
                self.assertEqual(getattr(row_queries, name)(), [])
                if name == 'safe_authoring_module_rows':
                    read.assert_called_once_with(row_queries.AUTHORING_MODULES_TABLE)
                else:
                    args, kwargs = row_queries.module_index_read()
                    read.assert_called_once_with(*args, **kwargs)

    def test_staff_failure_and_missing_alias_are_explicit(self):
        with patch.object(catalogue_sources, 'fetch_staff_users_by_access', side_effect=RuntimeError('private SQL')):
            with self.assertRaises(StaffDirectoryUnavailable): catalogue_sources.get_staff_profile_rows('tutor')
        with patch.object(catalogue_sources, 'connections', {}), patch.object(catalogue_sources, 'fetch_staff_users_by_access') as read:
            with self.assertRaises(StaffDirectoryUnavailable): catalogue_sources.get_staff_profile_rows('coach')
            read.assert_not_called()

    def test_staff_success_keeps_role_and_archive_filter(self):
        rows = [{'id': 'A', 'archived': False}, {'id': 'B', 'archived': True}]
        with patch.object(catalogue_sources, 'fetch_staff_users_by_access', return_value=rows) as read, \
             patch.object(catalogue_sources, 'staff_user_profile_source', side_effect=lambda row, role: {**row, 'role': role}), \
             patch.object(catalogue_sources, 'staff_profile_is_archived', side_effect=lambda row: row['archived']):
            self.assertEqual(catalogue_sources.get_staff_profile_rows('tutor'), [{**rows[0], 'role': 'tutor'}])
            self.assertEqual(catalogue_sources.get_staff_profile_rows('coach', True), [{**r, 'role': 'coach'} for r in rows])
            self.assertEqual(read.call_args.args, ('coach',))

    def test_group_projection_does_not_swallow_required_module_failure(self):
        options = {name: Mock() for name, p in signature(delivery_reads.group_authoring_detail_rows).parameters.items()
                   if p.default is p.empty}
        failure = CatalogueReadUnavailable('Module catalogue unavailable.')
        options['authoring_fetch_all'].return_value = []
        options['safe_module_index_rows'].side_effect = failure
        with self.assertRaises(CatalogueReadUnavailable) as caught:
            delivery_reads.group_authoring_detail_rows(**options)
        self.assertIs(caught.exception, failure)

    def test_cohort_projection_failure_is_not_an_empty_success(self):
        options = {name: Mock() for name in signature(delivery_reads.cohort_authoring_detail_rows).parameters}
        options['get_holiday_rows_safe'].return_value = []
        options['authoring_fetch_all'].side_effect = RuntimeError('private SQL')
        with self.assertRaises(CatalogueReadUnavailable): delivery_reads.cohort_authoring_detail_rows(**options)

    def test_failed_calendar_stops_meeting_create_before_provider_and_persistence(self):
        options = {name: Mock(name=name) for name in signature(creation.curriculum_teams_meeting).parameters if name != 'request'}
        options.update(clean_str=clean_str, JsonResponse=JsonResponse,
                       json_body=lambda request: {}, get_graph_settings=lambda: {},
                       has_graph_credentials=lambda: True, authoring_fetch_all=lambda *a: [],
                       module_has_external_teams_calendar=lambda *a: False,
                       calendar_groups=lambda *a: [], teams_new_meeting_organizer=lambda *a: 'synthetic@example.invalid',
                       graph_timezone_iana=lambda *a: 'Europe/London',
                       teams_event_payload=lambda *a, **kw: ({}, [], [], [], [], datetime(2026, 1, 5, tzinfo=timezone.utc), 60, 'none', 1),
                       calendar_targets=lambda *a, **kw: [{'start': datetime(2026, 1, 5, tzinfo=timezone.utc)}],
                       teams_non_delivery_reason=calendar_verification.teams_non_delivery_reason)
        with patch.object(catalogue_sources, 'get_holiday_rows', side_effect=RuntimeError('private SQL')):
            with self.assertRaises(CatalogueReadUnavailable):
                creation.curriculum_teams_meeting(RequestFactory().post('/'), **options)
        for name in ('microsoft_graph_request', 'persist_live_session_series', 'save_weekday_calendar', 'publish_teams_calendar_attendees'):
            options[name].assert_not_called()

    def test_removed_preset_branch_preserves_missing_id_normalization_and_cache(self):
        module = learner_assignment_counts_sql
        with patch.object(module, '_group_source', return_value='synthetic'), \
             patch.object(module.plans, '_group_module_ids', return_value=['M']) as read:
            cache = {}
            self.assertEqual(module._preset_ids('P', 'G', cache), [])
            read.assert_not_called()
            self.assertEqual(module._preset_ids('P', 'G', cache, ' G1 '), ['M'])
            self.assertEqual(module._preset_ids('other', 'name', cache, 'G1'), ['M'])
            read.assert_called_once_with('', '', source='synthetic', group_id='G1')
