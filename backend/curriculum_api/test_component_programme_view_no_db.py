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

    def test_keep_mode_strips_everything_else_but_never_beyond_content_on_a_live_session(self):
        sql, params = self._run(('videoUrl', 'displayType'))
        self.assertIn("entry.key <> all(%s::text[])", sql)
        self.assertIn("replace(coalesce(component.type::text, ''), '_', '-') = 'live-session'", sql)
        self.assertEqual(params[:2], [list(views.COMPONENT_CONTENT_SETTING_KEYS), ['videoUrl', 'displayType']])

    def test_content_mode_is_unchanged(self):
        sql, params = self._run(None)
        self.assertIn('where entry.key = any(%s::text[])', sql)
        self.assertNotIn('<> all', sql)
        keys = list(views.COMPONENT_CONTENT_SETTING_KEYS)
        self.assertEqual(params[:2], [keys, keys])


class ProgrammeViewEndpointTests(SimpleTestCase):
    def test_has_its_own_cache_entry_and_asks_for_the_programme_projection(self):
        seen = []

        def cached(key, build, ttl=None):
            seen.append(key)
            return build()

        request = RequestFactory().get('/x', {'module_catalogue_ids': 'MOD-1', 'fields': 'programme'})
        with mock.patch.object(views, 'cached_curriculum_value', side_effect=cached), \
             mock.patch.object(views, 'component_builder_rows', return_value=[]) as rows, \
             mock.patch.object(views, 'conditional_json_response', return_value='response'):
            self.assertEqual(views.curriculum_component_collection(request), 'response')
        self.assertTrue(seen[0].startswith('components-response:programme:'))
        rows.assert_called_once_with(['MOD-1'], omit_content=False, programme_view=True)

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
