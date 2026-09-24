"""The employer portal's learner-dashboard reads and all-documents list.

GET /learner_api/employer-portal/<employer_id>/learner/<kind>/<id>/overview/<part>/
GET /learner_api/employer-portal/<employer_id>/documents/

Database-free: the employer, learners, dashboard readers and signing rows are
stubbed, so these pin the endpoints' own decisions — who may read, which
learners, and what is removed before a payload reaches an employer.
"""
import json
from types import SimpleNamespace
from unittest import mock

from django.test import RequestFactory, SimpleTestCase

from learner_api import employer_portal


class _Missing(Exception):
    pass


def _model(learner):
    def get(pk):
        if learner is None or str(pk) != str(learner.pk):
            raise _Missing()
        return learner

    return SimpleNamespace(DoesNotExist=_Missing, all_learners=SimpleNamespace(get=get))


class EmployerPortalOverviewTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role="employer", subject_id=9)
        self.learner = SimpleNamespace(pk=101, employer_id=9)
        patches = [
            mock.patch("login.permissions.authenticate_request", side_effect=lambda request: self.account),
            mock.patch.object(employer_portal, "_employer_or_404", return_value=(SimpleNamespace(pk=9), None)),
            mock.patch.object(employer_portal, "SOURCE_MODELS", {"commercial": _model(self.learner)}),
            mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def get(self, part, employer_id=9, learner_id=101, method="get"):
        request = getattr(self.factory, method)(f"/overview/{part}/")
        return employer_portal.employer_portal_learner_overview(
            request, employer_id=employer_id, kind="commercial", learner_id=learner_id, part=part,
        )

    def test_schedule_is_served_without_meeting_or_booking_links(self):
        payload = {
            "modules": [{"id": "m1"}],
            "sessions": [{"id": "s1", "joinUrl": "https://teams.example/join", "start": "2026-09-04T08:00:00Z"}],
            "reviews": [{"eventKey": "e1", "meetingLink": "https://teams.example/review", "status": "scheduled"}],
            "coach": {"name": "Coach", "bookingUrl": "https://book.example/coach"},
        }
        with mock.patch("learner_api.training_plan_dashboard.read_dashboard", return_value=payload) as read:
            response = self.get("schedule")
        self.assertEqual(response.status_code, 200)
        read.assert_called_once_with(self.learner, section="overview")
        body = json.loads(response.content)
        self.assertEqual(body["modules"], [{"id": "m1"}])
        self.assertEqual(body["sessions"], [{"id": "s1", "joinUrl": None, "start": "2026-09-04T08:00:00Z"}])
        self.assertEqual(body["reviews"], [{"eventKey": "e1", "meetingLink": None, "status": "scheduled"}])
        self.assertEqual(body["coach"], {"name": "Coach", "bookingUrl": None})
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_week_and_contract_use_the_learner_readers(self):
        with mock.patch("learner_api.overview_week.read_week", return_value={"weekStart": "2026-09-21"}) as week:
            self.assertEqual(json.loads(self.get("week").content), {"weekStart": "2026-09-21"})
        week.assert_called_once_with(self.learner)
        with mock.patch("learner_api.training_plan_dashboard.read_dashboard", return_value={"months": {}}) as read:
            self.assertEqual(json.loads(self.get("contract").content), {"months": {}})
        read.assert_called_once_with(self.learner, section="contract")

    def test_hours_returns_monthly_totals_only(self):
        summary = {
            "learner": {"id": 101, "aptem_id": 55, "name": "Learner", "coach_name": "Coach"},
            "months": [{"month": "2026-08", "source": "lms", "training_plan_target": 10, "not_accepted_hours": 1,
                        "actual_hours": 7, "student_signature": {"name": "x"}, "row_count": 4}],
        }
        with mock.patch("old_otjh.service.resolve_record", return_value={"id": 101}), \
                mock.patch("learner_api.monthly_log_sources.profile", return_value={}), \
                mock.patch("learner_api.monthly_logs.summary_data", return_value=summary) as summary_data:
            response = self.get("hours")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(summary_data.call_args.args[0]["_view_as"])
        self.assertEqual(json.loads(response.content), {
            "learner": {"aptem_id": 55},
            "months": [{"month": "2026-08", "source": "lms", "training_plan_target": 10,
                        "not_accepted_hours": 1, "actual_hours": 7}],
        })

    def test_another_employers_learner_is_refused(self):
        self.learner.employer_id = 10
        with mock.patch("learner_api.training_plan_dashboard.read_dashboard") as read:
            response = self.get("schedule")
        self.assertEqual(response.status_code, 403)
        read.assert_not_called()

    def test_an_employer_cannot_name_another_employer(self):
        with mock.patch("learner_api.training_plan_dashboard.read_dashboard") as read:
            response = self.get("schedule", employer_id=8)
        self.assertEqual(response.status_code, 404)
        read.assert_not_called()

    def test_learners_are_refused(self):
        self.account = SimpleNamespace(role="learner", subject_id=101)
        self.assertEqual(self.get("schedule").status_code, 403)

    def test_staff_may_read_any_employers_learner(self):
        self.account = SimpleNamespace(role="staff", subject_id=None)
        with mock.patch("learner_api.overview_week.read_week", return_value={}):
            self.assertEqual(self.get("week", employer_id=9).status_code, 200)

    def test_unknown_part_missing_learner_and_writes_are_rejected(self):
        self.assertEqual(self.get("detail").status_code, 404)
        self.assertEqual(self.get("week", learner_id=999).status_code, 404)
        self.assertEqual(self.get("week", method="post").status_code, 405)


class EmployerPortalDocumentsTests(SimpleTestCase):
    """GET /learner_api/employer-portal/<employer_id>/documents/"""

    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role="employer", subject_id=9)
        self.queried = []
        learners = [
            SimpleNamespace(pk=101, username="Aya Test", programme="Final Test", learner_type="commercial"),
            SimpleNamespace(pk=102, username="Ben Test", programme="Data L4", learner_type="apprenticeship"),
        ]

        def filter_learners(**kwargs):
            self.queried.append(kwargs)
            return SimpleNamespace(order_by=lambda *fields: learners)

        model = SimpleNamespace(all_learners=SimpleNamespace(filter=filter_learners))
        reviews = {101: [{"kind": "review", "eventKey": "e1", "label": "Progress Review", "signable": True, "signed": False}]}
        documents = {102: [{"kind": "document", "id": "d1", "label": "ILR", "signable": True, "signed": True}]}
        patches = [
            mock.patch("login.permissions.authenticate_request", side_effect=lambda request: self.account),
            mock.patch.object(employer_portal, "_employer_or_404",
                              return_value=(SimpleNamespace(pk=9, full_name="Test Employer"), None)),
            mock.patch.object(employer_portal, "SOURCE_MODELS", {"apprenticeship": model}),
            mock.patch.object(employer_portal, "_review_signing_rows", side_effect=lambda kind, pk: reviews.get(pk, [])),
            mock.patch.object(employer_portal, "_document_signing_rows", side_effect=lambda kind, pk: documents.get(pk, [])),
            mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def get(self, employer_id=9, method="get"):
        request = getattr(self.factory, method)("/documents/")
        return employer_portal.employer_portal_documents(request, employer_id=employer_id)

    def test_lists_every_learners_items_with_their_owner(self):
        response = self.get()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.queried, [{"employer_id": 9}])
        body = json.loads(response.content)
        self.assertEqual(body["employer"], {"id": "9", "name": "Test Employer"})
        self.assertEqual(body["outstandingTotal"], 1)
        self.assertEqual(body["items"], [
            {"kind": "review", "eventKey": "e1", "label": "Progress Review", "signable": True, "signed": False,
             "learner": {"id": "101", "kind": "commercial", "name": "Aya Test", "programme": "Final Test"}},
            {"kind": "document", "id": "d1", "label": "ILR", "signable": True, "signed": True,
             "learner": {"id": "102", "kind": "apprenticeship", "name": "Ben Test", "programme": "Data L4"}},
        ])

    def test_an_employer_cannot_list_another_employers_documents(self):
        self.assertEqual(self.get(employer_id=8).status_code, 404)
        self.assertEqual(self.queried, [])

    def test_learners_are_refused_and_writes_rejected(self):
        self.assertEqual(self.get(method="post").status_code, 405)
        self.account = SimpleNamespace(role="learner", subject_id=101)
        self.assertEqual(self.get().status_code, 403)


class _Cursor:
    """Answers each execute() with the next canned result set, recording the calls."""

    def __init__(self, results, calls):
        self.results, self.calls = list(results), calls

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, sql, params=None):
        self.calls.append((sql, params))
        self.current = self.results.pop(0) if self.results else []

    def fetchall(self):
        return self.current

    def fetchone(self):
        return self.current[0] if self.current else None


class EmployerPortalAssignmentsTests(SimpleTestCase):
    """The employer's Assignments tab and its file links."""

    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(role="employer", subject_id=9)
        self.learner = SimpleNamespace(pk=101, employer_id=9)
        self.calls = []
        self.results = []
        connection = SimpleNamespace(cursor=lambda: _Cursor(self.results, self.calls))
        patches = [
            mock.patch("login.permissions.authenticate_request", side_effect=lambda request: self.account),
            mock.patch.object(employer_portal, "_employer_or_404", return_value=(SimpleNamespace(pk=9), None)),
            mock.patch.object(employer_portal, "SOURCE_MODELS", {"commercial": _model(self.learner)}),
            mock.patch("django.db.connections", {"enrolment": connection}),
            mock.patch("learner_api.evidence_storage.azure_configured", return_value=True),
            mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def request(self, path="/", **query):
        return self.factory.get(path, query)

    def test_lists_lms_and_legacy_assignments_without_marks_or_reports(self):
        from datetime import datetime, timezone as tz
        self.results.extend([
            [("comp-1", "Marketing plan", "Aya Modual", "Week 3", "accepted", datetime(2026, 9, 1, tzinfo=tz.utc), None)],
            [("f0000000-0000-0000-0000-000000000001", "plan.docx", "comp-1", None)],
        ])
        legacy_row = {"evidence_id": 77, "aptem_id": 5, "component_id": 1, "evidence_name": "Old essay.pdf",
                      "component_name": "Legacy module", "evidence_status": "Referred", "file_blob": "b/essay.pdf",
                      "report_blob": "b/report.pdf", "feedbacks": "[]", "submission_date": None, "activity_date": None,
                      "learner_name": "Aya", "programme_name": "Final Test", "run_id": 1}
        with mock.patch("learner_api.legacy_assignments.classified_rows", return_value=[legacy_row]):
            response = employer_portal.employer_portal_learner_assignments(
                self.request(), employer_id=9, kind="commercial", learner_id=101)
        self.assertEqual(response.status_code, 200)
        body = json.loads(response.content)["assignments"]
        self.assertEqual(body[0], {
            "id": "lms:comp-1", "source": "lms", "title": "Marketing plan", "moduleTitle": "Aya Modual",
            "weekTitle": "Week 3", "status": "accepted", "submittedAt": "2026-09-01T00:00:00+00:00",
            "files": [{"source": "lms", "id": "f0000000-0000-0000-0000-000000000001", "name": "plan.docx"}],
        })
        self.assertEqual(body[1]["source"], "aptem")
        self.assertEqual(body[1]["status"], "referred")
        # The learner's upload only: the assessor's report is not offered.
        self.assertEqual(body[1]["files"], [{"source": "aptem", "id": "77", "activityId": "aptem:5:evidence:77", "name": "Old essay.pdf"}])
        # Drafts are excluded and the learner is the one in the URL, checked above.
        submissions_sql, params = self.calls[0]
        self.assertIn("status <> 'draft'", submissions_sql)
        self.assertEqual(params, ["commercial", "101"])
        self.assertNotIn("coach_feedback", submissions_sql)
        self.assertNotIn("quality_score", submissions_sql)

    def test_file_link_requires_an_approved_file_on_a_submitted_assignment(self):
        self.results.append([("commercial/101/comp-1/f.docx", "plan.docx")])
        with mock.patch("learner_api.evidence_storage.get_download_sas", return_value="https://sas.example/f") as sas:
            response = employer_portal.employer_portal_assignment_file(
                self.request(), employer_id=9, kind="commercial", learner_id=101,
                file_id="f0000000-0000-0000-0000-000000000001")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"url": "https://sas.example/f"})
        sql, params = self.calls[0]
        self.assertIn("f.status = 'approved'", sql)
        self.assertIn("s.status <> 'draft'", sql)
        self.assertEqual(params, ["f0000000-0000-0000-0000-000000000001", "commercial", "101"])
        sas.assert_called_once()

    def test_unknown_file_is_not_found(self):
        self.results.append([])
        response = employer_portal.employer_portal_assignment_file(
            self.request(), employer_id=9, kind="commercial", learner_id=101,
            file_id="f0000000-0000-0000-0000-000000000009")
        self.assertEqual(response.status_code, 404)

    def test_legacy_link_opens_the_learner_file_and_checks_the_evidence(self):
        row = {"evidence_id": 77, "evidence_name": "Old essay.pdf", "file_blob": "b/essay.pdf"}
        with mock.patch("learner_api.legacy_assignments.classified_rows", return_value=[row]) as rows, \
                mock.patch("learner_api.evidence_storage.get_download_sas", return_value="https://sas.example/e") as sas:
            ok = employer_portal.employer_portal_legacy_assignment_file(
                self.request(activityId="aptem:5:evidence:77"), employer_id=9, kind="commercial", learner_id=101, evidence_id="77")
            wrong = employer_portal.employer_portal_legacy_assignment_file(
                self.request(activityId="aptem:5:evidence:77"), employer_id=9, kind="commercial", learner_id=101, evidence_id="78")
        self.assertEqual(ok.status_code, 200)
        rows.assert_called_with("commercial", 101, "aptem:5:evidence:77")
        sas.assert_called_once_with("fetch-aptem-evidences", "b/essay.pdf", filename="Old essay.pdf")
        self.assertEqual(wrong.status_code, 404)

    def test_another_employers_learner_and_learner_accounts_are_refused(self):
        self.learner.employer_id = 10
        self.assertEqual(employer_portal.employer_portal_learner_assignments(
            self.request(), employer_id=9, kind="commercial", learner_id=101).status_code, 403)
        self.assertEqual(employer_portal.employer_portal_assignment_file(
            self.request(), employer_id=9, kind="commercial", learner_id=101,
            file_id="f0000000-0000-0000-0000-000000000001").status_code, 403)
        self.assertEqual(self.calls, [])
        self.learner.employer_id = 9
        self.account = SimpleNamespace(role="learner", subject_id=101)
        self.assertEqual(employer_portal.employer_portal_learner_assignments(
            self.request(), employer_id=9, kind="commercial", learner_id=101).status_code, 403)
