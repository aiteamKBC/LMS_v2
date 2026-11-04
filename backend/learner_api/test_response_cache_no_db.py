"""The learner read cache serves repeat GETs, keeps viewers apart, waits for an
in-flight build, and is dropped by writes. Uses no database or network."""
import os
import threading
import time
import unittest
from unittest import mock

import django
from django.conf import settings

if not settings.configured:
    settings.configure(CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
                       DEFAULT_CHARSET='utf-8')
    django.setup()

from django.core.cache import cache
from django.http import HttpResponse, JsonResponse
from django.test import RequestFactory

from learner_api import response_cache


class Account:
    def __init__(self, pk, role):
        self.pk, self.role = pk, role


def request(path='/learner_api/dashboard/commercial/7/overview/', account=Account(1, 'learner'), method='get'):
    req = getattr(RequestFactory(), method)(path)
    req.login_account = account
    return req


class ResponseCacheTests(unittest.TestCase):
    def setUp(self):
        cache.clear()
        patcher = mock.patch.dict(os.environ, {'LEARNER_RESPONSE_CACHE_SECONDS': '30'})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.calls = 0

        @response_cache.cached_learner_read('test')
        def view(req, kind, pk):
            self.calls += 1
            return JsonResponse({'n': self.calls})

        self.view = view

    def test_repeat_get_is_served_from_cache(self):
        first = self.view(request(), kind='commercial', pk=7)
        second = self.view(request(), kind='commercial', pk=7)
        self.assertEqual(self.calls, 1)
        self.assertEqual(second.content, first.content)
        self.assertEqual(second['X-Learner-Cache'], 'hit')
        self.assertEqual(second['Cache-Control'], 'private, no-store')

    def test_viewers_and_query_strings_are_kept_apart(self):
        self.view(request(), kind='commercial', pk=7)
        self.view(request(account=Account(2, 'coach')), kind='commercial', pk=7)
        self.view(request('/learner_api/dashboard/commercial/7/overview/?viewAsCoach=1'), kind='commercial', pk=7)
        self.assertEqual(self.calls, 3)

    def test_write_to_learner_path_invalidates(self):
        self.view(request(), kind='commercial', pk=7)
        middleware = response_cache.LearnerReadCacheMiddleware(lambda req: HttpResponse(status=201))
        middleware(request('/learner_api/student-activity/commercial/7/3/4/attempts/', method='post'))
        self.view(request(), kind='commercial', pk=7)
        self.assertEqual(self.calls, 2)

    def test_errors_are_not_cached(self):
        @response_cache.cached_learner_read('test')
        def failing(req, kind, pk):
            self.calls += 1
            return JsonResponse({'error': 'x'}, status=503)

        failing(request(), kind='commercial', pk=7)
        failing(request(), kind='commercial', pk=7)
        self.assertEqual(self.calls, 2)

    def test_off_when_ttl_is_zero(self):
        with mock.patch.dict(os.environ, {'LEARNER_RESPONSE_CACHE_SECONDS': '0'}):
            self.view(request(), kind='commercial', pk=7)
            self.view(request(), kind='commercial', pk=7)
        self.assertEqual(self.calls, 2)

    def test_concurrent_requests_wait_for_one_build(self):
        @response_cache.cached_learner_read('test')
        def slow(req, kind, pk):
            self.calls += 1
            time.sleep(0.3)
            return JsonResponse({'ok': True})

        threads = [threading.Thread(target=slow, args=(request(),), kwargs={'kind': 'commercial', 'pk': 7})
                   for _ in range(5)]
        for t in threads:
            t.start()
        for t in threads:
            t.join()
        self.assertEqual(self.calls, 1)


if __name__ == '__main__':
    unittest.main()
