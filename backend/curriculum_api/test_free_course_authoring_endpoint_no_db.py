"""DB-free HTTP and permission contracts for Phase B.1 authoring GETs."""
import json
from types import SimpleNamespace
from unittest import mock

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve, reverse

from curriculum_api import free_course_authoring as authoring
from curriculum_api import free_course_authoring_views as views
from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING


REVISION = "fcv1:" + "a" * 64
CATALOGUE_REVISION = "fccv1:" + "b" * 64


class FreeCourseAuthoringEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()

    def _call(self, view, request, *args, account=None, accesses=()):
        with mock.patch("login.permissions.authenticate_request", return_value=account), \
             mock.patch("login.permissions._accesses_of", return_value=frozenset(accesses)), \
             mock.patch.object(views, "authenticate_request", return_value=account):
            return view(request, *args)

    def _staff(self):
        return SimpleNamespace(role="staff", subject_type="staff", subject_id=7)

    def test_routes_are_distinct_get_documents(self):
        catalogue_url = reverse("free-course-authoring-catalogue")
        course_url = reverse("free-course-authoring-course", args=["FREE-1"])
        self.assertIs(resolve(catalogue_url).func, views.catalogue)
        self.assertIs(resolve(course_url).func, views.course)

    def test_catalogue_200_has_private_cache_and_valid_matching_etag(self):
        document = {
            "schemaVersion": authoring.CATALOGUE_SCHEMA_VERSION,
            "scope": "catalogue", "revision": CATALOGUE_REVISION, "courses": [],
        }
        request = self.factory.get("/curriculum/free-courses/authoring/")
        with mock.patch.object(authoring, "catalogue_document", return_value=document):
            response = self._call(
                views.catalogue, request,
                account=self._staff(), accesses={ACCESS_CURRICULUM},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), document)
        self.assertEqual(response["ETag"], f'"{CATALOGUE_REVISION}"')
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertIn("Cookie", response["Vary"])

    def test_course_200_etag_matches_returned_revision(self):
        document = {
            "schemaVersion": authoring.CATALOGUE_SCHEMA_VERSION,
            "scope": "course", "revision": REVISION,
            "course": {}, "weeks": [], "integrity": {}, "policies": {},
        }
        request = self.factory.get("/curriculum/free-courses/FREE-1/authoring/")
        with mock.patch.object(authoring, "course_document", return_value=document):
            response = self._call(
                views.course, request, "FREE-1",
                account=self._staff(), accesses={ACCESS_CURRICULUM},
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["revision"], REVISION)
        self.assertEqual(response["ETag"], f'"{REVISION}"')

    def test_unauthenticated_is_401_and_service_is_not_called(self):
        request = self.factory.get("/curriculum/free-courses/authoring/")
        with mock.patch.object(authoring, "catalogue_document") as service:
            response = self._call(views.catalogue, request, account=None)
        self.assertEqual(response.status_code, 401)
        self.assertEqual(json.loads(response.content)["code"], "unauthenticated")
        service.assert_not_called()

    def test_staff_without_curriculum_access_is_403(self):
        request = self.factory.get("/curriculum/free-courses/authoring/")
        with mock.patch.object(authoring, "catalogue_document") as service:
            response = self._call(
                views.catalogue, request, account=self._staff(), accesses={"enrolment"},
            )
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "forbidden")
        service.assert_not_called()

    def test_learner_is_forbidden_even_if_access_value_is_injected(self):
        request = self.factory.get("/curriculum/free-courses/authoring/")
        learner = SimpleNamespace(role="learner", subject_type="learner", subject_id=5)
        response = self._call(
            views.catalogue, request,
            account=learner, accesses={ACCESS_CURRICULUM},
        )
        self.assertEqual(response.status_code, 403)

    def test_invalid_course_id_is_400(self):
        request = self.factory.get("/curriculum/free-courses/x/authoring/")
        response = self._call(
            views.course, request, "x" * 129,
            account=self._staff(), accesses={ACCESS_CURRICULUM},
        )
        self.assertEqual(response.status_code, 400)
        self.assertEqual(json.loads(response.content)["code"], "invalid_free_course_id")

    def test_missing_course_is_404(self):
        request = self.factory.get("/curriculum/free-courses/FREE-404/authoring/")
        with mock.patch.object(authoring, "course_document", side_effect=authoring.FreeCourseNotFound):
            response = self._call(
                views.course, request, "FREE-404",
                account=self._staff(), accesses={ACCESS_CURRICULUM},
            )
        self.assertEqual(response.status_code, 404)
        self.assertEqual(json.loads(response.content)["code"], "free_course_not_found")

    def test_database_or_schema_failure_is_503_without_details(self):
        request = self.factory.get("/curriculum/free-courses/authoring/")
        with mock.patch.object(authoring, "catalogue_document", side_effect=DatabaseError("secret")):
            response = self._call(
                views.catalogue, request,
                account=self._staff(), accesses={ACCESS_CURRICULUM},
            )
        self.assertEqual(response.status_code, 503)
        payload = json.loads(response.content)
        self.assertEqual(payload["code"], "free_course_authoring_unavailable")
        self.assertNotIn("secret", response.content.decode())

    def test_post_requires_separate_authoring_capability(self):
        request = self.factory.post("/curriculum/free-courses/authoring/", data={})
        request._dont_enforce_csrf_checks = True
        response = self._call(
            views.catalogue, request,
            account=self._staff(), accesses={ACCESS_CURRICULUM},
        )
        self.assertEqual(response.status_code, 403)

    def test_post_returns_canonical_create_contract(self):
        request = self.factory.post(
            "/curriculum/free-courses/authoring/",
            data=json.dumps({"expectedRevision": CATALOGUE_REVISION}),
            content_type="application/json",
            HTTP_IDEMPOTENCY_KEY="create:12345678",
        )
        request._dont_enforce_csrf_checks = True
        result = {
            "body": {"scope": "course", "revision": REVISION},
            "status": 201,
            "etag": f'"{REVISION}"',
            "location": "/curriculum_api/curriculum/free-courses/FREE-1/authoring/",
            "replayed": False,
        }
        with mock.patch.object(views.free_course_authoring_mutations, "create_course", return_value=result) as create:
            response = self._call(
                views.catalogue, request,
                account=self._staff(),
                accesses={ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING},
            )
        self.assertEqual(response.status_code, 201)
        self.assertEqual(response["ETag"], f'"{REVISION}"')
        self.assertEqual(response["Location"], result["location"])
        create.assert_called_once()
