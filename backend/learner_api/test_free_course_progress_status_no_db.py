"""Free Course progress status: only active rows are completions.

An inactive row is a withdrawn completion kept for history. Readers ignore it,
and neither the activity nor the quiz endpoint may reactivate it. The store is
an in-memory stand-in keyed like the table (learner, component_ref), so these
tests need no database.
"""
import json
from datetime import datetime, timezone as dt_timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase

from login import permissions

from . import free_courses_view as view
from .models import LearnerFreeCourseProgress

LEARNER = SimpleNamespace(pk=544, enrolment_id=134, learner_type="commercial")
LEARNER_ACCOUNT = SimpleNamespace(role="learner", subject_id=134, subject_type="learner")
STAFF_ACCOUNT = SimpleNamespace(role="staff", subject_id=7, subject_type="staff")
WITHDRAWN_AT = datetime(2026, 10, 2, 12, 39, 1, 961000, tzinfo=dt_timezone.utc)


def inner(fn):
    while hasattr(fn, "__wrapped__"):
        fn = fn.__wrapped__
    return fn


def catalogue():
    courses = {"FREE-SAFE": {"id": "FREE-SAFE", "course_name": "Safeguarding For Learners"}}
    weeks = [{"id": "W-SAFE", "course_id": "FREE-SAFE"}]
    components = [
        {"id": "VIDEO", "free_module_id": "W-SAFE", "type": "video", "display_order": 1},
        {"id": "AUDIO", "free_module_id": "W-SAFE", "type": "audio", "display_order": 2},
        {"id": "READ", "free_module_id": "W-SAFE", "type": "reading", "display_order": 3},
        {"id": "QUIZ", "free_module_id": "W-SAFE", "type": "quiz", "display_order": 4,
         "settings_json": {"linkedQuizId": "7"}},
    ]
    return courses, weeks, components


class Store:
    """The progress table in memory, unique on (learner_id, component_ref)."""

    def __init__(self, *rows):
        self.rows = [SimpleNamespace(**row) for row in rows]
        self.created = 0

    def filter(self, **criteria):
        def matches(row):
            return (row.learner_id == criteria["learner_id"]
                    and row.free_course_ref in criteria["free_course_ref__in"]
                    and ("status" not in criteria or row.status == criteria["status"])
                    and ("is_completed" not in criteria or row.is_completed == criteria['is_completed'])
                    and ("deleted_at__isnull" not in criteria or (row.deleted_at is None) == criteria['deleted_at__isnull']))
        selected = [row for row in self.rows if matches(row)]
        return SimpleNamespace(values_list=lambda *fields: [tuple(getattr(row, f) for f in fields) for row in selected])

    def get_or_create(self, *, learner_id, component_ref, defaults):
        for row in self.rows:
            if (row.learner_id, row.component_ref) == (learner_id, component_ref):
                return row, False
        row = SimpleNamespace(learner_id=learner_id, component_ref=component_ref, deleted_at=None, **defaults)
        self.rows.append(row)
        self.created += 1
        return row, True


def row(component_ref, status="active", completed_at=WITHDRAWN_AT, deleted_at=None):
    return {"learner_id": LEARNER.pk, "component_ref": component_ref, "free_course_ref": "FREE-SAFE",
            "completed_at": completed_at, "status": status, "deleted_at": deleted_at,
            "is_completed": True, "activity_state": "completed"}


def inactive(component_ref):
    return row(component_ref, status="inactive", deleted_at=WITHDRAWN_AT)


class GuardedSideEffects(SimpleTestCase):
    """Every test also proves programme progress, OTJH and KSBs stay untouched."""

    def setUp(self):
        self.enterContext(patch.object(view.free_course_attempts, "activity_times", return_value={}))
        self.enterContext(patch.object(view, "accepted_activity_seconds", return_value={}))
        self.programme_progress = self.enterContext(patch("learner_api.models.LearnerProgressEntry.objects"))
        self.bump = self.enterContext(patch("learner_api.progress_cache.bump_learners"))
        self.enterContext(patch.object(view, "_resolve_source", return_value=(LEARNER, None)))
        self.enterContext(patch.object(view, "assigned_course_ids", return_value=["FREE-SAFE"]))
        self.enterContext(patch.object(view, "_scoped_rows", return_value=catalogue()))

    def tearDown(self):
        self.assertEqual(self.programme_progress.mock_calls, [])
        self.bump.assert_not_called()

    def use(self, store):
        self.enterContext(patch.object(view.LearnerFreeCourseProgress, "objects", store))
        return store


class ModelTests(SimpleTestCase):
    def test_canonical_owner_never_falls_back_to_the_enrolment_id(self):
        from .free_course_records import progress_owner
        with patch('learner_api.identity_placement.public.learner_profile_for_source', return_value=None) as resolve:
            self.assertIsNone(progress_owner(SimpleNamespace(pk=19)))
            self.assertFalse(resolve.call_args.kwargs['heal'])

    def test_completion_and_activity_defaults_are_independent_of_lifecycle(self):
        progress = LearnerFreeCourseProgress(learner_id=501, component_ref='C', free_course_ref='F')
        self.assertEqual((progress.is_completed, progress.activity_state, progress.status,
                          progress.completed_at, progress.deleted_at),
                         (False, 'not_started', 'active', None, None))

    def test_status_defaults_active_and_deleted_at_is_optional(self):
        status = LearnerFreeCourseProgress._meta.get_field("status")
        deleted_at = LearnerFreeCourseProgress._meta.get_field("deleted_at")
        self.assertEqual((status.default, status.max_length), ("active", 20))
        self.assertTrue(deleted_at.null)
        self.assertFalse(deleted_at.has_default())
        self.assertFalse(LearnerFreeCourseProgress._meta.managed)
        self.assertEqual(LearnerFreeCourseProgress._meta.unique_together, (("learner", "component_ref"),))


class ReadTests(GuardedSideEffects):
    def summary(self):
        response = inner(view.free_courses)(RequestFactory().get("/"), "commercial", 134)
        self.assertEqual(response.status_code, 200)
        return json.loads(response.content)["freeCourses"][0]

    def detail(self):
        response = inner(view.free_course_detail)(RequestFactory().get("/"), "commercial", 134, "FREE-SAFE")
        self.assertEqual(response.status_code, 200)
        weeks = json.loads(response.content)["freeCourse"]["weeks"]
        return {item["componentId"]: item["completed"] for week in weeks for item in week["activities"]}

    def test_active_rows_count_and_inactive_rows_do_not(self):
        self.use(Store(row("READ"), inactive("VIDEO"), inactive("AUDIO"), inactive("QUIZ")))
        card = self.summary()
        self.assertEqual((card["activityCount"], card["completedActivities"], card["progressPercentage"]), (4, 1, 25))
        self.assertEqual(self.detail(), {"VIDEO": False, "AUDIO": False, "READ": True, "QUIZ": False})

    def test_active_row_with_unknown_date_still_counts(self):
        self.use(Store(row("READ", completed_at=None), row("VIDEO", completed_at=None)))
        card = self.summary()
        self.assertEqual((card["completedActivities"], card["progressPercentage"]), (2, 50))
        self.assertTrue(self.detail()["READ"])

    def test_incomplete_rows_and_soft_deleted_completions_are_excluded(self):
        unread = row("READ") | {"is_completed": False, "activity_state": "not_started"}
        viewed = row("VIDEO") | {"is_completed": False, "activity_state": "reading_viewed"}
        archived = row("AUDIO", completed_at=None, deleted_at=WITHDRAWN_AT)
        self.use(Store(unread, viewed, archived))
        self.assertEqual(self.summary()["completedActivities"], 0)
        self.assertFalse(any(self.detail().values()))

    def test_inactive_rows_alone_leave_progress_at_zero(self):
        self.use(Store(inactive("VIDEO"), inactive("AUDIO"), inactive("QUIZ")))
        card = self.summary()
        self.assertEqual((card["completedActivities"], card["progressPercentage"]), (0, 0))
        self.assertFalse(any(self.detail().values()))


class ActivityWriteTests(GuardedSideEffects):
    def setUp(self):
        from .test_free_course_attempts_no_db import empty_attempt_storage
        cursor = self.enterContext(empty_attempt_storage())
        cursor.fetchone.side_effect = None
        cursor.fetchone.return_value = (501,)
        super().setUp()
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))

    def complete(self, component_id, account=LEARNER_ACCOUNT, activity_state=None):
        request = RequestFactory().post("/learner_api/free-courses/commercial/134/complete/",
                                        data=json.dumps({"componentId": component_id, **({"activityState": activity_state} if activity_state is not None else {})}),
                                        content_type="application/json")
        with patch.object(permissions, "authenticate_request", return_value=account):
            return view.complete_free_course_activity(request, kind="commercial", pk=134)

    def test_reading_view_initializes_incomplete_progress_and_bad_states_are_rejected(self):
        store = self.use(Store())
        response = self.complete("READ", activity_state="reading_viewed")
        self.assertEqual(response.status_code, 200)
        self.assertFalse(json.loads(response.content)['completed'])
        self.assertEqual((store.rows[0].activity_state, store.rows[0].is_completed,
                          store.rows[0].completed_at), ('reading_viewed', False, None))
        for state in ('inactive', 'unknown', []):
            self.assertEqual(self.complete("READ", activity_state=state).status_code, 400)
        self.assertEqual(self.complete("VIDEO", activity_state="reading_viewed").status_code, 400)
        self.assertEqual(self.complete("QUIZ", activity_state="completed").status_code, 409)
        self.assertEqual(store.created, 1)

    def test_new_completion_is_saved_active_with_a_date(self):
        store = self.use(Store())
        response = self.complete("READ")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"componentId": "READ", "completed": True})
        self.assertEqual(store.rows[0].status, "active")
        self.assertIsNotNone(store.rows[0].completed_at)
        self.assertIsNone(store.rows[0].deleted_at)

    def test_repeat_requests_keep_one_row(self):
        store = self.use(Store())
        for _ in range(3):
            self.assertEqual(self.complete("READ").status_code, 200)
        self.assertEqual((store.created, len(store.rows)), (1, 1))

    def test_inactive_row_is_never_reactivated(self):
        store = self.use(Store(inactive("VIDEO")))
        for _ in range(2):
            response = self.complete("VIDEO")
            self.assertEqual(response.status_code, 409)
            self.assertIn("withdrawn", json.loads(response.content)["error"])
        withdrawn = store.rows[0]
        self.assertEqual((withdrawn.status, withdrawn.deleted_at, withdrawn.completed_at),
                         ("inactive", WITHDRAWN_AT, WITHDRAWN_AT))
        self.assertEqual((store.created, len(store.rows)), (0, 1))

    def test_staff_preview_cannot_write(self):
        store = self.use(Store(inactive("VIDEO")))
        for component_id in ("READ", "VIDEO"):
            self.assertEqual(self.complete(component_id, account=STAFF_ACCOUNT).status_code, 403)
        self.assertEqual((store.created, store.rows[0].status), (0, "inactive"))


class QuizWriteTests(GuardedSideEffects):
    QUIZ = {"id": 7, "passingGrade": 100, "questions": [{
        "id": 1, "text": "Pick", "type": "single_choice", "points": 1,
        "answers": [{"id": 11, "text": "Right", "isCorrect": True, "sortOrder": 1},
                    {"id": 12, "text": "Wrong", "isCorrect": False, "sortOrder": 2}],
    }]}

    def setUp(self):
        super().setUp()
        from .test_free_course_attempts_no_db import empty_attempt_storage
        self.enterContext(empty_attempt_storage())
        self.enterContext(patch.object(view, "_resolve_quiz_component", return_value=(7, "FREE-SAFE", None)))
        self.enterContext(patch.object(view, "_fetch_quiz", return_value=self.QUIZ))

    def submit(self, answer_id):
        request = RequestFactory().post("/", data=json.dumps({"answers": {"1": answer_id}}),
                                        content_type="application/json")
        return inner(view.submit_free_course_quiz)(request, "commercial", 134, "QUIZ")

    def test_pass_records_an_active_completion_once(self):
        store = self.use(Store())
        for _ in range(2):
            response = self.submit(11)
            self.assertEqual(response.status_code, 200)
            self.assertTrue(json.loads(response.content)["passed"])
        self.assertEqual((store.created, store.rows[0].status), (1, "active"))

    def test_fail_records_no_completion(self):
        store = self.use(Store())
        response = self.submit(12)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((json.loads(response.content)["passed"], store.created), (False, 0))

    def test_pass_over_an_inactive_row_does_not_reactivate_it(self):
        store = self.use(Store(inactive("QUIZ")))
        response = self.submit(11)
        self.assertEqual(response.status_code, 409)
        self.assertIn("withdrawn", json.loads(response.content)["error"])
        self.assertEqual((store.rows[0].status, store.rows[0].deleted_at, store.created), ("inactive", WITHDRAWN_AT, 0))

    def test_fail_over_an_inactive_row_is_graded_as_before(self):
        store = self.use(Store(inactive("QUIZ")))
        response = self.submit(12)
        self.assertEqual(response.status_code, 200)
        self.assertFalse(json.loads(response.content)["passed"])
        self.assertEqual(store.rows[0].status, "inactive")
