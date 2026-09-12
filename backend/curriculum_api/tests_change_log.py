"""The log that tells a polling client *what* was written, not just that
something was.

The shared epoch is enough to make a tab in another country notice a colleague's
save, but it names nothing, so every tab that saw it move threw away its whole
cache and read the multi-second overview back -- for one edit, across the whole
estate, on every write. These cover the middleware that attributes an epoch span
to the path that produced it, and the endpoint that hands the log out.

Nothing here needs a database: the log lives entirely in the shared cache.
"""
from __future__ import annotations

import json
from unittest.mock import patch

from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.test import RequestFactory, SimpleTestCase, override_settings

from .middleware import CurriculumChangeLogMiddleware
from .views import (
    CURRICULUM_CHANGE_LOG_KEY,
    CURRICULUM_CHANGE_LOG_SIZE,
    curriculum_cache_epoch,
    record_curriculum_change,
    recent_curriculum_changes,
)

LOCMEM = {'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}}


@override_settings(CACHES=LOCMEM)
class CurriculumChangeLogTests(SimpleTestCase):
    def setUp(self):
        cache.delete(CURRICULUM_CHANGE_LOG_KEY)

    def test_records_the_span_a_write_accounts_for(self):
        record_curriculum_change('/curriculum/programmes/', 4, 5)
        self.assertEqual(
            recent_curriculum_changes(),
            [{'path': '/curriculum/programmes/', 'lo': 4, 'hi': 5}],
        )

    def test_a_write_that_moved_nothing_is_not_worth_recording(self):
        record_curriculum_change('/curriculum/programmes/', 5, 5)
        record_curriculum_change('/curriculum/programmes/', 6, 5)
        self.assertEqual(recent_curriculum_changes(), [])

    def test_keeps_only_the_most_recent_entries(self):
        # Unbounded, this grows for the life of the process and is read on every
        # poll from every tab.
        for epoch in range(CURRICULUM_CHANGE_LOG_SIZE + 10):
            record_curriculum_change('/curriculum/modules/', epoch, epoch + 1)
        entries = recent_curriculum_changes()
        self.assertEqual(len(entries), CURRICULUM_CHANGE_LOG_SIZE)
        self.assertEqual(entries[-1]['hi'], CURRICULUM_CHANGE_LOG_SIZE + 10)

    def test_an_unreachable_cache_is_not_an_outage(self):
        # Redis being down must cost the client its precision, never its page.
        with patch('curriculum_api.views.cache.set', side_effect=RuntimeError('down')):
            record_curriculum_change('/curriculum/programmes/', 1, 2)
        with patch('curriculum_api.views.cache.get', side_effect=RuntimeError('down')):
            self.assertEqual(recent_curriculum_changes(), [])


@override_settings(CACHES=LOCMEM)
class CurriculumChangeLogMiddlewareTests(SimpleTestCase):
    def setUp(self):
        cache.delete(CURRICULUM_CHANGE_LOG_KEY)
        self.factory = RequestFactory()

    def run_request(self, request, epochs, response=None):
        """Drive the middleware with a scripted sequence of epoch readings."""
        answer = response or HttpResponse(status=200)
        with patch('curriculum_api.views.shared_curriculum_epoch', side_effect=epochs):
            middleware = CurriculumChangeLogMiddleware(lambda _request: answer)
            return middleware(request)

    def test_attributes_the_span_to_the_path_that_was_written(self):
        self.run_request(self.factory.post('/curriculum_api/curriculum/modules/'), [7, 9])
        self.assertEqual(
            recent_curriculum_changes(),
            [{'path': '/curriculum/modules/', 'lo': 7, 'hi': 9}],
        )

    def test_records_the_path_as_the_browser_names_it(self):
        # The client matches these against the same strings a same-browser write
        # broadcasts, so the API prefix must not be on the front of one and not
        # the other.
        self.run_request(self.factory.patch('/curriculum_api/curriculum/programmes/p1/'), [1, 2])
        self.assertEqual(recent_curriculum_changes()[0]['path'], '/curriculum/programmes/p1/')

    def test_a_read_is_not_a_change(self):
        self.run_request(self.factory.get('/curriculum_api/curriculum/modules/'), [1, 2])
        self.assertEqual(recent_curriculum_changes(), [])

    def test_a_refused_write_is_not_a_change(self):
        # A 409 for a tutor clash wrote nothing, and telling every tab in the
        # estate to refresh for it would be pure noise.
        self.run_request(
            self.factory.post('/curriculum_api/curriculum/modules/'),
            [1, 2],
            response=JsonResponse({'error': 'tutor is busy'}, status=409),
        )
        self.assertEqual(recent_curriculum_changes(), [])

    def test_a_write_that_did_not_move_the_counter_records_nothing(self):
        self.run_request(self.factory.post('/curriculum_api/curriculum/modules/'), [3, 3])
        self.assertEqual(recent_curriculum_changes(), [])

    def test_leaves_other_apis_alone(self):
        request = self.factory.post('/coach_api/sessions/')
        # Never even reads the epoch for a path it does not own.
        with patch('curriculum_api.views.shared_curriculum_epoch') as epoch:
            CurriculumChangeLogMiddleware(lambda _r: HttpResponse(status=200))(request)
        epoch.assert_not_called()
        self.assertEqual(recent_curriculum_changes(), [])


@override_settings(CACHES=LOCMEM)
class CurriculumCacheEpochViewTests(SimpleTestCase):
    def setUp(self):
        cache.delete(CURRICULUM_CHANGE_LOG_KEY)

    def test_hands_out_the_counter_and_the_log_together(self):
        record_curriculum_change('/curriculum/ksb-sets/', 11, 12)
        with patch('curriculum_api.views.shared_curriculum_epoch', return_value=12):
            response = curriculum_cache_epoch(RequestFactory().get('/curriculum_api/curriculum/cache-epoch/'))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            json.loads(response.content),
            {'epoch': 12, 'changes': [{'path': '/curriculum/ksb-sets/', 'lo': 11, 'hi': 12}]},
        )

    def test_answers_with_an_empty_log_before_anybody_has_written(self):
        with patch('curriculum_api.views.shared_curriculum_epoch', return_value=0):
            response = curriculum_cache_epoch(RequestFactory().get('/curriculum_api/curriculum/cache-epoch/'))
        self.assertEqual(json.loads(response.content), {'epoch': 0, 'changes': []})
