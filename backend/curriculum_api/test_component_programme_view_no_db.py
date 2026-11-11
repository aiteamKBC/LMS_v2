"""The programme page's component read (``fields=programme``), without a database.

Pins what the page keeps, how a trimmed row is marked, that a live session is
never stripped beyond its content keys in SQL, and that the view has its own
cache entry.
"""
import json
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import views


def row(settings, **fields):
    base = {
        'id': 'COMP-1', 'moduleCatalogueId': 'MOD-1', 'title': 'Live intro', 'type': 'Live Session',
        'status': 'published', 'reflectionQuestion': 'What did you learn?', 'lastEdited': '2026-11-01',
        'isDeleted': False, 'deletedAt': None, 'deletedViaParent': '', 'coachValidationRequired': True,
        'ksbMappings': [{'code': 'K1', 'weight': 1}], 'description': 'Kick-off', 'settings': settings,
    }
    return {**base, **fields}


class ProgrammePageProjectionTests(SimpleTestCase):
    def test_keeps_only_the_page_settings_including_empty_ones_and_marks_the_row(self):
        source = row({'liveSessionUrl': 'https://teams.example/1', 'sessionDate': '', 'readingContent': '<p>x</p>',
                      'completionRule': 'view', 'shortDescription': ''})
        [projected] = views.component_rows_for_programme_page([source])
        self.assertEqual(projected['settings'], {'liveSessionUrl': 'https://teams.example/1', 'sessionDate': ''})
        self.assertEqual(projected['settingsOmitted'], [views.PROGRAMME_VIEW_OMITTED_MARKER])
        for field in views.PROGRAMME_PAGE_DROPPED_FIELDS:
            self.assertNotIn(field, projected)
        # What the page reads is untouched.
        for field in ('id', 'title', 'type', 'status', 'ksbMappings', 'description'):
            self.assertEqual(projected[field], source[field])

    def test_a_row_that_loses_nothing_is_returned_as_it_is(self):
        source = row({'videoUrl': 'https://video.example/1'})
        [projected] = views.component_rows_for_programme_page([source])
        self.assertIs(projected, source)
        self.assertEqual(projected['reflectionQuestion'], 'What did you learn?')
        self.assertNotIn('settingsOmitted', projected)

    def test_what_the_database_stripped_marks_the_row_even_if_nothing_is_left_to_trim(self):
        source = row({'videoUrl': 'https://video.example/1'})
        [projected] = views.component_rows_for_programme_page([source], already_omitted={'COMP-1': ['transcript']})
        self.assertEqual(projected['settingsOmitted'], ['*'])
        self.assertNotIn('reflectionQuestion', projected)

    def test_never_edits_the_cached_row(self):
        source = row({'videoUrl': 'u', 'transcript': 't'})
        before = json.dumps(source, sort_keys=True)
        views.component_rows_for_programme_page([source])
        self.assertEqual(json.dumps(source, sort_keys=True), before)

    def test_the_page_keys_include_every_teams_key_the_sessions_tab_reads(self):
        teams_keys = {'teamsLiveSessionId', 'teamsOccurrenceId', 'teamsSessionNumber', 'liveSessionUrl',
                      'sessionDate', 'sessionTime', 'sessionDateTimeUtc', 'selectedGroupNames',
                      'durationMinutes', 'attendanceRequired', 'recordingExpected'}
        self.assertLessEqual(teams_keys, set(views.PROGRAMME_PAGE_SETTING_KEYS))

    def test_a_marked_row_is_refused_on_save_before_any_database_read(self):
        self.assertTrue(views.partial_read_errors({'id': 'COMP-1', 'settingsOmitted': ['*']}))
        with mock.patch.object(views, 'authoring_fetch_all', side_effect=AssertionError('database read')):
            with self.assertRaises(views.ModuleAuthoringValidationError) as raised:
                views.save_component_builder_payload({
                    'id': 'C1', 'title': 'Live intro', 'module': 'MOD-1', 'type': 'Live Session',
                    'settings': {'videoUrl': ''}, 'settingsOmitted': ['*'],
                })
        self.assertEqual(raised.exception.errors[0]['path'], 'settings')


class ProgrammeViewSqlTests(SimpleTestCase):
    def _run(self, keep_keys):
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = [('COMP-1',)]
        connection = mock.MagicMock(vendor='postgresql')
        connection.cursor.return_value.__enter__.return_value = cursor
        with mock.patch.object(views, 'connection', connection), \
             mock.patch.object(views, 'ensure_module_authoring_tables'), \
             mock.patch.object(views, 'column_names', return_value={'id', 'type', 'module_catalogue_id', 'settings_json'}), \
             mock.patch.object(views, 'rows_as_dicts', return_value=[]):
            views.live_component_rows_without_content(['MOD-1'], keep_keys=keep_keys)
        return cursor.execute.call_args_list[-1].args

    def test_keep_mode_ships_only_kept_keys_but_never_strips_beyond_content_on_a_live_session(self):
        sql, params = self._run(('videoUrl', 'displayType'))
        live = "replace(coalesce(component.type::text, ''), '_', '-') = 'live-session'"
        # Other rows: only the kept keys are built into settings, in SQL.
        self.assertIn('jsonb_object_agg(entry.key, entry.value)', sql)
        # A live session: the stored settings minus its non-empty content keys.
        self.assertIn(f'when {live} then component."settings_json"::jsonb - omitted', sql)
        self.assertIn(f'where {live} and entry.key = any(%s::text[])', sql)
        self.assertEqual(params[:2], [['videoUrl', 'displayType'], list(views.COMPONENT_CONTENT_SETTING_KEYS)])

    def test_content_mode_is_unchanged(self):
        sql, params = self._run(None)
        self.assertIn('where entry.key = any(%s::text[])', sql)
        self.assertNotIn('<> all', sql)
        keys = list(views.COMPONENT_CONTENT_SETTING_KEYS)
        self.assertEqual(params[:2], [keys, keys])


class ProgrammeViewEndpointTests(SimpleTestCase):
    def test_has_its_own_cache_entry_and_asks_for_the_programme_projection(self):
        seen = []

        def cached(key, build, ttl=None, fingerprint=None):
            seen.append((key, ttl, fingerprint))
            return build()

        request = RequestFactory().get('/x', {'module_catalogue_ids': 'MOD-1', 'fields': 'programme'})
        with mock.patch.object(views, 'cached_curriculum_value', side_effect=cached), \
             mock.patch.object(views, 'component_builder_rows', return_value=[]) as rows, \
             mock.patch.object(views, 'conditional_json_response', return_value='response'):
            self.assertEqual(views.curriculum_component_collection(request), 'response')
        key, ttl, fingerprint = seen[0]
        self.assertTrue(key.startswith('components-response:programme:'))
        # Still bounded at 60s, but re-checked against the KSB sources past it.
        self.assertEqual(ttl, 60)
        self.assertIs(fingerprint, views.component_source_inputs_fingerprint)
        rows.assert_called_once_with(['MOD-1'], omit_content=False, programme_view=True)

    def test_other_component_reads_keep_a_plain_60s_entry(self):
        seen = []

        def cached(key, build, ttl=None, **options):
            seen.append(options)
            return build()

        request = RequestFactory().get('/x', {'module_catalogue_ids': 'MOD-1', 'omit': 'content'})
        with mock.patch.object(views, 'cached_curriculum_value', side_effect=cached), \
             mock.patch.object(views, 'component_builder_rows', return_value=[]), \
             mock.patch.object(views, 'conditional_json_response', return_value='response'):
            views.curriculum_component_collection(request)
        self.assertEqual(seen, [{}])

    def test_builder_rows_reach_the_page_projection_with_what_the_database_stripped(self):
        stripped = [{'id': 'COMP-1', views.COMPONENT_DB_OMITTED_KEYS_COLUMN: ['transcript']}]
        built = [row({'videoUrl': 'u'})]
        with mock.patch.object(views, 'live_component_rows_without_content', return_value=stripped) as sql, \
             mock.patch.object(views, '_component_builder_rows', return_value=built):
            [projected] = views.component_builder_rows(['MOD-1'], programme_view=True)
        keep = sql.call_args.kwargs['keep_keys']
        self.assertLessEqual(set(views.COMPONENT_DERIVED_SETTING_KEYS), set(keep))
        self.assertLessEqual(set(views.PROGRAMME_PAGE_SETTING_KEYS), set(keep))
        self.assertEqual(projected['settingsOmitted'], ['*'])

    def test_programme_read_leaves_out_long_text_and_marks_even_an_untrimmed_row(self):
        # Nothing stripped from settings, yet the description column was never
        # selected: the row must still read as partial, never as complete.
        stripped = [{'id': 'COMP-1', views.COMPONENT_DB_OMITTED_KEYS_COLUMN: []}]
        built = [row({'videoUrl': 'u'})]
        with mock.patch.object(views, 'live_component_rows_without_content', return_value=stripped) as sql, \
             mock.patch.object(views, '_component_builder_rows', return_value=built) as builder:
            [projected] = views.component_builder_rows(['MOD-1'], programme_view=True)
        self.assertEqual(sql.call_args.kwargs['exclude_columns'], views.PROGRAMME_VIEW_EXCLUDED_COLUMNS)
        self.assertEqual(builder.call_args.kwargs['mapping_exclude_columns'], views.PROGRAMME_VIEW_EXCLUDED_MAPPING_COLUMNS)
        self.assertEqual(projected['settingsOmitted'], ['*'])
        self.assertNotIn('reflectionQuestion', projected)

    def test_other_reads_select_every_column_and_every_mapping_field(self):
        with mock.patch.object(views, 'live_component_rows_without_content', return_value=[]) as sql, \
             mock.patch.object(views, '_component_builder_rows', return_value=[]) as builder:
            views.component_builder_rows(['MOD-1'], omit_content=True)
        self.assertEqual(sql.call_args.kwargs['exclude_columns'], ())
        self.assertNotIn('mapping_exclude_columns', builder.call_args.kwargs)


class ProgrammeViewExcludedColumnsSqlTests(SimpleTestCase):
    def test_excluded_columns_are_not_selected_but_the_id_always_is(self):
        cursor = mock.MagicMock()
        cursor.fetchall.return_value = [('COMP-1',)]
        connection = mock.MagicMock(vendor='postgresql')
        connection.cursor.return_value.__enter__.return_value = cursor
        columns = {'id', 'type', 'title', 'module_catalogue_id', 'description', 'Reflection_Question', 'settings_json'}
        with mock.patch.object(views, 'connection', connection), \
             mock.patch.object(views, 'ensure_module_authoring_tables'), \
             mock.patch.object(views, 'column_names', return_value=columns), \
             mock.patch.object(views, 'rows_as_dicts', return_value=[]):
            views.live_component_rows_without_content(
                ['MOD-1'], keep_keys=('videoUrl',), exclude_columns=('description', 'reflection_question', 'id'),
            )
        sql = cursor.execute.call_args_list[-1].args[0]
        self.assertNotIn('component."description"', sql)
        self.assertNotIn('component."Reflection_Question"', sql)
        self.assertIn('component."id"', sql)
        self.assertIn('component."title"', sql)


class ComponentSummaryKsbCodesTests(SimpleTestCase):
    def _codes(self, rows, mapping_columns):
        connection = mock.MagicMock(vendor='postgresql')
        component_columns = {'id', 'module_catalogue_id', 'week_id', 'type', 'status'}
        with mock.patch.object(views, 'connection', connection), \
             mock.patch.object(views, 'column_names', side_effect=lambda table: (
                 component_columns if table == views.AUTHORING_COMPONENTS_TABLE else mapping_columns)), \
             mock.patch.object(views, 'table_exists', return_value=True), \
             mock.patch.object(views, 'fetch_all', return_value=rows) as fetch:
            result = views.component_summary_ksb_codes(['MOD-1'])
        return result, (fetch.call_args.args[0] if fetch.called else '')

    def test_codes_are_distinct_normalised_and_keyed_by_module_and_week(self):
        rows = [
            {'module_catalogue_id': 'MOD-1', 'week_id': 'W1', 'type': 'video', '_codes': ['k1', 'K1', 'S2', '']},
            {'module_catalogue_id': 'MOD-1', 'week_id': 'W2', 'type': 'quiz', '_codes': ['B3']},
        ]
        codes, sql = self._codes(rows, {'id', 'component_id', 'standard_ksb_id', 'status'})
        self.assertEqual(codes[('MOD-1', 'W1')], {views.coverage_normalise_code('K1'), views.coverage_normalise_code('S2')})
        self.assertEqual(codes[('MOD-1', 'W2')], {views.coverage_normalise_code('B3')})
        # The code comes from the standard KSB, and both sides must be live.
        self.assertIn('standard.ksb_code', sql)
        self.assertIn('component."status" not in', sql)
        self.assertIn('mapping."status" not in', sql)

    def test_a_retired_component_type_contributes_no_codes(self):
        rows = [{'module_catalogue_id': 'MOD-1', 'week_id': 'W1', 'type': 'workplace_evidence', '_codes': ['K1']}]
        codes, _ = self._codes(rows, {'id', 'component_id', 'standard_ksb_id', 'status'})
        self.assertEqual(dict(codes), {})

    def test_unreadable_mapping_shape_answers_none(self):
        codes, _ = self._codes([], {'id', 'ksb_id'})
        self.assertIsNone(codes)

    def test_summary_buckets_carry_their_codes_and_an_empty_list_when_unmapped(self):
        source = [
            {'module_catalogue_id': 'MOD-1', 'week_id': 'W1', '_count': 2, '_published': 1, 'expected_otjh': 0.5,
             'display_order': 1, 'title': 'A'},
            {'module_catalogue_id': 'MOD-1', 'week_id': 'W2', '_count': 1, '_published': 0, 'expected_otjh': 0,
             'display_order': 1, 'title': 'B'},
        ]
        with mock.patch.object(views, 'ensure_module_authoring_tables'), \
             mock.patch.object(views, 'component_summary_source_rows', return_value=source), \
             mock.patch.object(views, 'authoring_fetch_all', return_value=[]), \
             mock.patch.object(views, 'component_summary_ksb_codes', return_value={('MOD-1', 'W1'): {'K2', 'K1'}}):
            rows = views.component_summary_rows(['MOD-1'])
        by_week = {row['weekId']: row for row in rows}
        self.assertEqual(by_week['W1']['ksbCodes'], ['K1', 'K2'])
        self.assertEqual(by_week['W2']['ksbCodes'], [])

    def test_summary_leaves_ksb_codes_out_when_they_cannot_be_read(self):
        source = [{'module_catalogue_id': 'MOD-1', 'week_id': 'W1', '_count': 1, '_published': 0,
                   'expected_otjh': 0, 'display_order': 1, 'title': 'A'}]
        with mock.patch.object(views, 'ensure_module_authoring_tables'), \
             mock.patch.object(views, 'component_summary_source_rows', return_value=source), \
             mock.patch.object(views, 'authoring_fetch_all', return_value=[]), \
             mock.patch.object(views, 'component_summary_ksb_codes', return_value=None):
            [bucket] = views.component_summary_rows(['MOD-1'])
        self.assertNotIn('ksbCodes', bucket)
