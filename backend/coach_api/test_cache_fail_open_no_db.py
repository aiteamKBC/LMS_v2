from unittest.mock import patch

from inspect import unwrap

from django.test import RequestFactory, SimpleTestCase

from .cache.learners import (
    acquire_caseload_lock,
    cache_caseload,
    get_cached_caseload,
    release_caseload_lock,
)
from .dashboard_cache import (
    cache_coach_dashboard,
    get_cached_coach_dashboard,
    invalidate_coach_dashboard_cache,
)
from .dashboard_view import coach_dashboard


class CoachCacheFailOpenTests(SimpleTestCase):
    @patch("coach_api.dashboard_cache.cache.set", side_effect=ConnectionError("redis unavailable"))
    @patch("coach_api.dashboard_cache.cache.get", side_effect=ConnectionError("redis unavailable"))
    @patch("coach_api.dashboard_view.CoachDashboardService.build")
    def test_dashboard_returns_computed_payload_when_redis_is_down(self, build, _get, _set):
        build.return_value = {"owner": {"email": "coach@example.test"}, "learners": []}
        request = RequestFactory().get("/coach_api/coach/dashboard")
        request.coach_email = "coach@example.test"

        response = unwrap(coach_dashboard)(request)

        self.assertEqual(response.status_code, 200)
        build.assert_called_once_with()

    @patch("coach_api.dashboard_cache.cache.get", side_effect=ConnectionError("redis unavailable"))
    def test_dashboard_cache_read_failure_is_a_cache_miss(self, _get):
        self.assertIsNone(get_cached_coach_dashboard("coach@example.test"))

    @patch("coach_api.dashboard_cache.cache.set", side_effect=ConnectionError("redis unavailable"))
    def test_dashboard_cache_write_failure_does_not_fail_response(self, _set):
        self.assertIsNone(cache_coach_dashboard("coach@example.test", {"learners": []}))

    @patch("coach_api.dashboard_cache.cache.delete", side_effect=ConnectionError("redis unavailable"))
    def test_dashboard_invalidation_failure_does_not_fail_mutation(self, _delete):
        self.assertIsNone(invalidate_coach_dashboard_cache("coach@example.test"))

    @patch("coach_api.cache.learners.cache.get", side_effect=ConnectionError("redis unavailable"))
    def test_caseload_cache_read_failure_is_a_cache_miss(self, _get):
        self.assertIsNone(get_cached_caseload("caseload-key"))

    @patch("coach_api.cache.learners.cache.set", side_effect=ConnectionError("redis unavailable"))
    def test_caseload_cache_write_failure_does_not_fail_response(self, _set):
        self.assertIsNone(cache_caseload("caseload-key", {"results": []}, 30))

    @patch("coach_api.cache.learners.cache.add", side_effect=ConnectionError("redis unavailable"))
    def test_caseload_lock_failure_allows_request_to_build(self, _add):
        self.assertTrue(acquire_caseload_lock("lock-key"))

    @patch("coach_api.cache.learners.cache.delete", side_effect=ConnectionError("redis unavailable"))
    def test_caseload_unlock_failure_does_not_fail_response(self, _delete):
        self.assertIsNone(release_caseload_lock("lock-key"))
