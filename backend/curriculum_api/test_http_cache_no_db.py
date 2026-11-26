"""Conditional responses, shared-build single flight and paged component reads.

No database: the encoded-response helpers are pure, the single-flight helpers
take the cache as an argument, and the paged reader is driven through a stub
of authoring_fetch_all.
"""

import gzip
import json
from unittest import mock

from django.core.serializers.json import DjangoJSONEncoder
from django.test import RequestFactory, SimpleTestCase

from curriculum_api import http_cache, shared_build
from curriculum_api import views


def json_response_body(payload):
    """The bytes a JsonResponse of ``payload`` carries: json.dumps with DjangoJSONEncoder.

    Spelled out rather than built through django.http, whose JsonResponse
    another no-DB module replaces with a stub for the length of a combined run.
    """
    return json.dumps(payload, cls=DjangoJSONEncoder).encode('utf-8')


class EncodedEntryTests(SimpleTestCase):
    def setUp(self):
        self.rf = RequestFactory()
        self.payload = {'schema': 'x', 'results': [{'id': index, 'title': f'Row {index}'} for index in range(50)]}

    def test_body_is_byte_identical_to_json_response(self):
        entry = http_cache.encode_json_entry(self.payload)
        self.assertEqual(http_cache.entry_body(entry), json_response_body(self.payload))

    def test_gzip_is_served_only_when_accepted(self):
        entry = http_cache.encode_json_entry(self.payload)
        compressed = http_cache.conditional_json_response(self.rf.get('/', HTTP_ACCEPT_ENCODING='gzip, deflate'), entry)
        self.assertEqual(compressed['Content-Encoding'], 'gzip')
        self.assertEqual(json.loads(gzip.decompress(compressed.content)), self.payload)
        plain = http_cache.conditional_json_response(self.rf.get('/'), entry)
        self.assertFalse(plain.has_header('Content-Encoding'))
        self.assertEqual(json.loads(plain.content), self.payload)
        refused = http_cache.conditional_json_response(self.rf.get('/', HTTP_ACCEPT_ENCODING='gzip;q=0, identity'), entry)
        self.assertFalse(refused.has_header('Content-Encoding'))

    def test_matching_etag_is_a_304_and_a_changed_body_is_not(self):
        entry = http_cache.encode_json_entry(self.payload)
        first = http_cache.conditional_json_response(self.rf.get('/'), entry)
        etag = first['ETag']
        self.assertEqual(first['Cache-Control'], 'private, no-cache')
        again = http_cache.conditional_json_response(self.rf.get('/', HTTP_IF_NONE_MATCH=etag), entry)
        self.assertEqual(again.status_code, 304)
        self.assertEqual(again.content, b'')
        # The strong spelling of the same tag matches too (weak comparison).
        strong = etag[2:]
        self.assertEqual(http_cache.conditional_json_response(self.rf.get('/', HTTP_IF_NONE_MATCH=strong), entry).status_code, 304)
        changed = http_cache.encode_json_entry({**self.payload, 'schema': 'y'})
        self.assertNotEqual(changed['etag'], etag)
        self.assertEqual(http_cache.conditional_json_response(self.rf.get('/', HTTP_IF_NONE_MATCH=etag), changed).status_code, 200)

    def test_error_entries_keep_status_and_body_and_never_304(self):
        entry = http_cache.encode_json_error_entry('Programme not found.', status=404)
        response = http_cache.conditional_json_response(self.rf.get('/', HTTP_IF_NONE_MATCH='*'), entry)
        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.content), {'error': 'Programme not found.'})
        self.assertEqual(response.content, json_response_body({'error': 'Programme not found.'}))
        self.assertFalse(response.has_header('ETag'))

    def test_plain_response_never_compresses(self):
        entry = http_cache.encode_json_entry(self.payload)
        response = http_cache.plain_json_response(entry)
        self.assertFalse(response.has_header('Content-Encoding'))
        self.assertEqual(json.loads(response.content), self.payload)

    def test_encode_json_bytes_keeps_the_serialised_body(self):
        original = json_response_body(self.payload)
        entry = http_cache.encode_json_bytes(original, status=200)
        self.assertEqual(http_cache.entry_body(entry), original)


class QueryParameterTests(SimpleTestCase):
    def setUp(self):
        self.rf = RequestFactory()

    def test_camel_case_and_snake_case_alias(self):
        self.assertTrue(http_cache.query_flag(self.rf.get('/', {'deferStats': '1'}), 'deferStats'))
        self.assertTrue(http_cache.query_flag(self.rf.get('/', {'defer_stats': 'true'}), 'deferStats'))
        self.assertFalse(http_cache.query_flag(self.rf.get('/', {}), 'deferStats'))
        self.assertFalse(http_cache.query_flag(self.rf.get('/', {'deferStats': '0'}), 'deferStats'))

    def test_list_parameter(self):
        self.assertEqual(http_cache.query_list(self.rf.get('/', {'omit': 'Components, stats'}), 'omit'), {'components', 'stats'})
        self.assertEqual(http_cache.query_list(self.rf.get('/', {}), 'omit'), set())


class FakeSharedCache:
    """Enough of a Redis-backed cache for the single-flight helpers."""

    __module__ = 'django.core.cache.backends.redis'

    def __init__(self):
        self.store = {}
        self._degraded_until = 0.0

    def add(self, key, value, timeout=None):
        if key in self.store:
            return False
        self.store[key] = value
        return True

    def get(self, key, default=None):
        return self.store.get(key, default)

    def set(self, key, value, timeout=None):
        self.store[key] = value

    def delete(self, key):
        self.store.pop(key, None)


FakeSharedCache.__name__ = 'RedisCache'


class SharedBuildTests(SimpleTestCase):
    def test_per_process_cache_never_locks(self):
        from django.core.cache.backends.locmem import LocMemCache
        acquired, token = shared_build.try_acquire(LocMemCache('t', {}), 'k')
        self.assertTrue(acquired)
        self.assertIsNone(token)

    def test_second_worker_waits_for_the_first_workers_value(self):
        cache = FakeSharedCache()
        acquired, token = shared_build.try_acquire(cache, 'k')
        self.assertTrue(acquired)
        self.assertTrue(token)
        self.assertEqual(shared_build.try_acquire(cache, 'k'), (False, None))

        def publish_on_first_poll(_seconds):
            cache.store['k'] = {'value': 1}
            shared_build.release(cache, 'k', token)

        value, holder_gone = shared_build.wait_for_value(cache, 'k', sleep=publish_on_first_poll)
        self.assertEqual(value, {'value': 1})
        self.assertFalse(holder_gone)
        self.assertNotIn(shared_build.lock_key_for('k'), cache.store)

    def test_a_failed_build_hands_the_lock_over(self):
        cache = FakeSharedCache()
        _acquired, token = shared_build.try_acquire(cache, 'k')

        def fail_on_first_poll(_seconds):
            shared_build.release(cache, 'k', token)

        value, holder_gone = shared_build.wait_for_value(cache, 'k', sleep=fail_on_first_poll)
        self.assertIsNone(value)
        self.assertTrue(holder_gone)
        self.assertTrue(shared_build.try_acquire(cache, 'k')[0])

    def test_degraded_redis_counts_as_per_process(self):
        cache = FakeSharedCache()
        cache._degraded_until = float('inf')
        self.assertFalse(shared_build.cache_is_shared(cache))

    def test_release_leaves_someone_elses_lock_alone(self):
        cache = FakeSharedCache()
        shared_build.try_acquire(cache, 'k')
        shared_build.release(cache, 'k', 'not-the-holder')
        self.assertIn(shared_build.lock_key_for('k'), cache.store)


class CachedValueSingleFlightTests(SimpleTestCase):
    """cached_curriculum_value() waits for another worker's build of the same key."""

    def setUp(self):
        self.cache = FakeSharedCache()
        patches = [
            mock.patch.object(views, 'cache', self.cache),
            mock.patch.object(views, 'shared_curriculum_epoch', return_value=7),
            mock.patch.object(shared_build, 'POLL_SECONDS', 0.001),
        ]
        for patcher in patches:
            patcher.start()
            self.addCleanup(patcher.stop)
        with views._CURRICULUM_CACHE_LOCK:
            views._CURRICULUM_CACHE.clear()
        self.addCleanup(views._CURRICULUM_CACHE.clear)
        self.shared_key = views.shared_curriculum_cache_key('single-flight-key', 7)

    def test_a_build_running_on_another_worker_is_awaited_not_repeated(self):
        # Another worker holds the lock and publishes after a few polls.
        self.cache.add(shared_build.lock_key_for(self.shared_key), 'other-worker')
        polls = []
        real_get = self.cache.get

        def get(key, default=None):
            if key == self.shared_key:
                polls.append(key)
                if len(polls) == 3:
                    self.cache.store[self.shared_key] = {'built': 'elsewhere'}
                    self.cache.delete(shared_build.lock_key_for(self.shared_key))
            return real_get(key, default)

        factory = mock.Mock(return_value={'built': 'here'})
        with mock.patch.object(self.cache, 'get', side_effect=get):
            value = views.cached_curriculum_value('single-flight-key', factory)
        self.assertEqual(value, {'built': 'elsewhere'})
        factory.assert_not_called()

    def test_a_failed_build_elsewhere_is_built_here_exactly_once(self):
        self.cache.add(shared_build.lock_key_for(self.shared_key), 'other-worker')
        real_get = self.cache.get
        calls = {'n': 0}

        def get(key, default=None):
            calls['n'] += 1
            if calls['n'] == 3:
                # The other worker failed: its lock goes away with nothing published.
                self.cache.delete(shared_build.lock_key_for(self.shared_key))
            return real_get(key, default)

        factory = mock.Mock(return_value={'built': 'here'})
        with mock.patch.object(self.cache, 'get', side_effect=get):
            value = views.cached_curriculum_value('single-flight-key', factory)
        self.assertEqual(value, {'built': 'here'})
        factory.assert_called_once()
        # Published for the other workers, and the lock released.
        self.assertEqual(self.cache.store.get(self.shared_key), {'built': 'here'})
        self.assertNotIn(shared_build.lock_key_for(self.shared_key), self.cache.store)

    def test_a_writer_asking_for_its_own_state_never_waits(self):
        self.cache.add(shared_build.lock_key_for(self.shared_key), 'other-worker')
        factory = mock.Mock(return_value={'built': 'here'})
        self.assertEqual(views.cached_curriculum_value('single-flight-key', factory, force=True), {'built': 'here'})
        factory.assert_called_once()


class PagedComponentReadTests(SimpleTestCase):
    """The paged reader returns the single statement's rows, in its order."""

    def _run(self, rows, page_rows):
        calls = []

        def fake_fetch(table, where_sql='', params=None, order_sql='', **kwargs):
            calls.append((where_sql, list(params or []), order_sql))
            limit_part = order_sql.split(' limit ')[1]
            limit, offset = (int(part) for part in limit_part.split(' offset '))
            return rows[offset:offset + limit]

        with mock.patch.object(views, 'authoring_fetch_all', side_effect=fake_fetch), \
                mock.patch.object(views, 'COMPONENT_FULL_READ_PAGE_ROWS', page_rows):
            result = views.live_component_rows_paged(['M2', 'M1', 'M2'], 'display_order, id')
        return result, calls

    def test_pages_concatenate_in_order_and_ids_are_canonical(self):
        rows = [{'id': f'c{index}', 'module_catalogue_id': 'M1'} for index in range(7)]
        result, calls = self._run(rows, page_rows=3)
        self.assertEqual(result, rows)
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(params[:2] == ['M1', 'M2'] for _where, params, _order in calls))
        self.assertTrue(calls[0][2].startswith('display_order, id limit 3 offset 0'))

    def test_a_row_repeated_across_pages_is_returned_once(self):
        rows = [{'id': 'a'}, {'id': 'b'}, {'id': 'b'}, {'id': 'c'}]
        result, _calls = self._run(rows, page_rows=2)
        self.assertEqual([row['id'] for row in result], ['a', 'b', 'c'])

    def test_no_ids_means_no_read(self):
        with mock.patch.object(views, 'authoring_fetch_all') as fetch:
            self.assertEqual(views.live_component_rows_paged([], 'display_order, id'), [])
        fetch.assert_not_called()


class WeekOutlineTests(SimpleTestCase):
    """``omit=weekComponents``: weeks keep their own fields and lose only ``components``."""

    def setUp(self):
        self.module = {
            'id': 'MOD-1',
            'name': 'Data Foundations',
            'weekStructure': [
                {'id': 'W1', 'weekNumber': 1, 'title': 'Kick-off', 'ksbMappings': [{'code': 'K1'}],
                 'components': [{'id': 'C1', 'settings': {'teamsLiveSessionId': 'LS-1'}}]},
                {'id': 'W2', 'weekNumber': 2, 'title': 'Empty week', 'components': []},
            ],
        }

    def test_outline_drops_only_the_components_key_and_marks_what_it_did(self):
        [outline] = views.module_rows_with_week_outline([self.module])
        self.assertTrue(outline['weekStructureOutline'])
        self.assertEqual(outline['weekStructure'], [
            {'id': 'W1', 'weekNumber': 1, 'title': 'Kick-off', 'ksbMappings': [{'code': 'K1'}], 'componentsOmitted': True},
            {'id': 'W2', 'weekNumber': 2, 'title': 'Empty week', 'componentsOmitted': True},
        ])
        # Not an empty list: an outline week must never read as a week with none.
        self.assertNotIn('components', outline['weekStructure'][0])

    def test_outline_copies_and_never_edits_the_cached_module(self):
        before = json.dumps(self.module, sort_keys=True)
        views.module_rows_with_week_outline([self.module])
        self.assertEqual(json.dumps(self.module, sort_keys=True), before)

    def test_module_without_a_structure_list_is_left_as_it_is(self):
        bare = {'id': 'MOD-2', 'name': 'No structure'}
        self.assertIs(views.module_rows_with_week_outline([bare])[0], bare)


class ComponentContentProjectionTests(SimpleTestCase):
    """``omit=content``: the authored long text leaves, and the row says so."""

    def row(self, **settings):
        return {'id': 'C1', 'title': 'Reading', 'settings': {
            'teamsLiveSessionId': 'LS-1', 'liveSessionUrl': 'https://teams.example/1',
            'sessionDateTimeUtc': '2026-09-07T08:00:00Z', 'embedCode': '<iframe src="https://x"></iframe>',
            **settings,
        }}

    def test_long_text_is_removed_and_named(self):
        row = self.row(readingContent='<p>long</p>', transcript='words', lessonContent='', speakerNotes=None)
        [projected] = views.component_rows_without_content([row])
        self.assertEqual(projected['settingsOmitted'], ['readingContent', 'transcript'])
        self.assertNotIn('readingContent', projected['settings'])
        self.assertNotIn('transcript', projected['settings'])
        # Empty values stay: nothing is missing, so nothing to fetch again.
        self.assertEqual(projected['settings']['lessonContent'], '')
        self.assertIsNone(projected['settings']['speakerNotes'])

    def test_schedule_teams_and_link_settings_are_never_removed(self):
        row = self.row(readingContent='<p>long</p>', legacySettings={'old': 'copy'})
        [projected] = views.component_rows_without_content([row])
        for key in ('teamsLiveSessionId', 'liveSessionUrl', 'sessionDateTimeUtc', 'embedCode'):
            self.assertEqual(projected['settings'][key], row['settings'][key])

    def test_a_row_with_nothing_to_remove_is_unchanged_and_unflagged(self):
        row = self.row()
        [projected] = views.component_rows_without_content([row])
        self.assertIs(projected, row)
        self.assertNotIn('settingsOmitted', projected)

    def test_projection_copies_and_never_edits_the_cached_row(self):
        row = self.row(readingContent='<p>long</p>')
        before = json.dumps(row, sort_keys=True)
        views.component_rows_without_content([row])
        self.assertEqual(json.dumps(row, sort_keys=True), before)

    def test_every_listed_key_is_a_long_text_key_and_none_is_read_by_teams(self):
        # The Teams/schedule readers use these keys; none may ever be trimmed.
        teams_keys = {
            'teamsLiveSessionId', 'teamsOccurrenceId', 'teamsSessionNumber', 'teamsEventId',
            'liveSessionUrl', 'sessionDate', 'sessionTime', 'sessionDateTimeUtc',
            'selectedGroupNames', 'teamsMeetingScope', 'durationMinutes', 'attendanceRequired',
        }
        self.assertFalse(teams_keys & set(views.COMPONENT_CONTENT_SETTING_KEYS))


class PartialReadSaveGuardTests(SimpleTestCase):
    """A save built from either projection is refused before anything is written."""

    def module_payload(self, week=None, component=None, **module_fields):
        return {
            'title': 'Data Foundations',
            **module_fields,
            'weekStructure': [{
                'id': 'W1', 'title': 'Kick-off', **(week or {}),
                'components': [{'id': 'C1', 'title': 'Reading', 'type': 'Reading Material',
                                'settings': {}, **(component or {})}],
            }],
        }

    def test_an_outline_module_is_refused(self):
        payload = self.module_payload(weekStructureOutline=True)
        self.assertIn('weekStructure', [e['path'] for e in views.validate_module_authoring_payload(payload)])

    def test_an_outline_week_is_refused(self):
        payload = self.module_payload(week={'componentsOmitted': True})
        self.assertIn('weekStructure.0.components', [e['path'] for e in views.validate_module_authoring_payload(payload)])

    def test_a_trimmed_component_is_refused(self):
        payload = self.module_payload(component={'settingsOmitted': ['readingContent']})
        self.assertIn('weekStructure.0.components.0.settings', [e['path'] for e in views.validate_module_authoring_payload(payload)])

    def test_a_complete_structure_raises_no_partial_read_error(self):
        errors = views.validate_module_authoring_payload(self.module_payload())
        self.assertFalse([error for error in errors if 'Reload it before saving' in error['message']])

    def test_component_endpoint_refuses_a_trimmed_component_before_reading_the_database(self):
        with mock.patch.object(views, 'authoring_fetch_all', side_effect=AssertionError('database read')):
            with self.assertRaises(views.ModuleAuthoringValidationError) as raised:
                views.save_component_builder_payload({
                    'id': 'C1', 'title': 'Reading', 'module': 'MOD-1', 'type': 'Reading Material',
                    'settings': {'videoUrl': ''}, 'settingsOmitted': ['readingContent'],
                })
        self.assertEqual(raised.exception.errors[0]['path'], 'settings')
