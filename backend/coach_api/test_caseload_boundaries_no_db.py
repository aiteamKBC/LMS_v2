from django.test import RequestFactory, SimpleTestCase

from coach_api.cache.learners import coach_caseload_cache_key, coach_caseload_lock_key
from coach_api.services.learners.context import CaseloadRequestContext


class CaseloadRequestContextTests(SimpleTestCase):
    def test_summary_and_paginated_modes_remain_distinct(self):
        factory = RequestFactory()
        summary = CaseloadRequestContext.from_request(factory.get("/coach/caseload", {"summary": "true"}))
        page = CaseloadRequestContext.from_request(factory.get("/coach/caseload", {"page": 2, "search": "Ada"}))

        self.assertTrue(summary.summary_only)
        self.assertFalse(summary.paginated)
        self.assertFalse(page.summary_only)
        self.assertTrue(page.paginated)

    def test_view_status_does_not_change_backend_pagination_mode(self):
        request = RequestFactory().get("/coach/caseload", {"view_status": "at-risk"})
        self.assertFalse(CaseloadRequestContext.from_request(request).paginated)


class CaseloadCacheBoundaryTests(SimpleTestCase):
    def test_cache_is_isolated_by_effective_coach_mode_and_full_query(self):
        base = coach_caseload_cache_key(" Coach@Example.com ", summary_only=False, query_string="page=1")
        self.assertNotEqual(base, coach_caseload_cache_key(
            "other@example.com", summary_only=False, query_string="page=1",
        ))
        self.assertNotEqual(base, coach_caseload_cache_key(
            "coach@example.com", summary_only=True, query_string="page=1",
        ))
        self.assertNotEqual(base, coach_caseload_cache_key(
            "coach@example.com", summary_only=False, query_string="page=2",
        ))
        self.assertEqual(coach_caseload_lock_key(base), f"{base}:building")
