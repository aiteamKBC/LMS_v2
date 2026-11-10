import json
from contextlib import nullcontext
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from curriculum_api import free_course_quiz_views as views
from learner_api.constants import ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING


REVISION = "fcv1:" + "a" * 64
NEXT_REVISION = "fcv1:" + "b" * 64


class Cursor:
    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def execute(self, *_args, **_kwargs):
        return None

    def fetchall(self):
        return []


class FreeCourseQuizEndpointTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.staff = SimpleNamespace(role="staff", subject_type="staff", subject_id=9)

    def call(self, view, request, *args, accesses=()):
        request._dont_enforce_csrf_checks = True
        with mock.patch("login.permissions.authenticate_request", return_value=self.staff), \
             mock.patch("login.permissions._accesses_of", return_value=frozenset(accesses)):
            return view(request, *args)

    def test_create_requires_separate_capability(self):
        request = self.factory.post("/", data="{}", content_type="application/json")
        response = self.call(views.collection, request, "FREE-1", accesses={ACCESS_CURRICULUM})
        self.assertEqual(response.status_code, 403)

    def test_create_links_one_server_created_canonical_quiz(self):
        payload = {
            "expectedRevision": REVISION,
            "freeCourseWeekId": "FREEWEEK-1",
            "componentId": "FREECOMP-1",
            "title": "Knowledge check",
        }
        request = self.factory.post("/", data=json.dumps(payload), content_type="application/json")
        component = {
            "componentId": "FREECOMP-1", "type": "quiz", "settings": {},
            "weekTitle": "Week one", "courseName": "Safe course",
        }
        quiz = SimpleNamespace(id=44, free_course_week_id="FREEWEEK-1", week_id="", status="draft")
        with mock.patch.object(views, "require_mode"), \
             mock.patch.object(views, "_catalogue_lock"), \
             mock.patch.object(views.transaction, "atomic", return_value=nullcontext()), \
             mock.patch.object(views, "_document", side_effect=[{"revision": REVISION}, {"revision": NEXT_REVISION}]), \
             mock.patch.object(views, "_owned_component", return_value=component), \
             mock.patch.object(views.QuizPackage.objects, "create", return_value=quiz) as create, \
             mock.patch.object(views, "connection", SimpleNamespace(cursor=lambda: Cursor())), \
             mock.patch.object(views, "_quiz_preview_payload", return_value={"quiz": {"id": 44}, "questions": []}):
            response = self.call(
                views.collection, request, "FREE-1",
                accesses={ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING},
            )
        self.assertEqual(response.status_code, 201)
        body = json.loads(response.content)
        self.assertEqual(body["quiz"]["quiz"]["id"], 44)
        self.assertEqual(body["course"]["revision"], NEXT_REVISION)
        self.assertEqual(create.call_args.kwargs["free_course_week_id"], "FREEWEEK-1")
        self.assertEqual(create.call_args.kwargs["week_id"], "")

    def test_published_quiz_with_history_is_read_only(self):
        request = self.factory.patch(
            "/",
            data=json.dumps({"expectedRevision": REVISION, "componentId": "FREECOMP-1", "title": "Changed"}),
            content_type="application/json",
        )
        quiz = SimpleNamespace(id=44, free_course_week_id="FREEWEEK-1", week_id="", status="published")
        component = {"componentId": "FREECOMP-1", "type": "quiz", "settings": {"linkedQuizId": "44"}}
        with mock.patch.object(views, "require_mode"), \
             mock.patch.object(views, "_catalogue_lock"), \
             mock.patch.object(views.transaction, "atomic", return_value=nullcontext()), \
             mock.patch.object(views, "_document", return_value={"revision": REVISION}), \
             mock.patch.object(views, "_quiz_owner", return_value=quiz), \
             mock.patch.object(views, "_owned_component", return_value=component), \
             mock.patch.object(views, "_history_count", return_value=3):
            response = self.call(
                views.detail, request, "FREE-1", 44,
                accesses={ACCESS_CURRICULUM, ACCESS_FREE_COURSE_AUTHORING},
            )
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "quiz_has_history")
