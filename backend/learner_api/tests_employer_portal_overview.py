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
        week.assert_called_once_with(self.learner, dashboard_kind="commercial")
        with mock.patch("learner_api.training_plan_dashboard.read_dashboard", return_value={"months": {}}) as read:
            self.assertEqual(json.loads(self.get("contract").content), {"months": {}})
        read.assert_called_once_with(self.learner, section="contract")

    def test_hours_returns_monthly_totals_only(self):
        summary = {
            "learner": {"id": 101, "aptem_id": 55, "name": "Learner", "coach_name": "Coach", "planned_end_date": "2027-07-31"},
            "months": [{"month": "2026-08", "source": "lms", "training_plan_target": 10, "not_accepted_hours": 1,
                        "actual_hours": 7, "student_signature": {"name": "x"}, "row_count": 4}],
            "training_plan_totals": {"accepted_hours": 7, "planned_hours": 120},
        }
        with mock.patch("old_otjh.service.resolve_record", return_value={"id": 101}), \
                mock.patch("learner_api.monthly_log_sources.profile", return_value={}), \
                mock.patch("learner_api.monthly_logs.summary_data", return_value=summary) as summary_data:
            response = self.get("hours")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(summary_data.call_args.args[0]["_view_as"])
        self.assertEqual(json.loads(response.content), {
            "learner": {"aptem_id": 55, "planned_end_date": "2027-07-31"},
            "months": [{"month": "2026-08", "source": "lms", "training_plan_target": 10,
                        "not_accepted_hours": 1, "actual_hours": 7}],
            "training_plan_totals": {"accepted_hours": 7, "planned_hours": 120},
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

    def progress_reviews(self, method="get", employer_id=9, learner_id=101, **parts):
        request = getattr(self.factory, method)("/progress-reviews/")
        return employer_portal.employer_portal_progress_reviews(
            request, employer_id=employer_id, kind="commercial", learner_id=learner_id, **parts,
        )

    def test_progress_reviews_use_the_learner_source_and_employer_template_visibility(self):
        events = [
            {"id": "owned", "eventKey": "owned", "source": "progress-review", "reviewTypeCode": "progress_review", "reviewInstanceId": "instance-a", "sequence": 1, "meetingLink": "https://teams.example/join"},
            {"id": "hidden", "eventKey": "hidden", "source": "progress-review", "reviewTypeCode": "progress_review", "reviewTemplateId": "hidden-template"},
            {"id": "future", "eventKey": "future", "source": "progress-review", "reviewTypeCode": "progress_review", "reviewTemplateId": "visible-template", "sequence": 2},
            {"id": "mcm", "eventKey": "mcm", "source": "mcr", "reviewTypeCode": "mcm"},
            {"id": "archived", "eventKey": "archived", "source": "progress-review", "importedReview": {"id": "88", "sections": []}},
        ]
        profile = SimpleNamespace(pk=55)
        definition = {"instance": {"id": "instance-a", "status": "awaiting-signature"},
                      "template": {"visibleTo": {"employer": True}}, "signatures": {"employer": {"required": True, "signed": False}}}
        def snapshot(template):
            return {"visibleTo": {"employer": template["id"] == "visible-template"}, "sections": [], "signatures": {"employer": False}}
        with mock.patch("learner_api.calendar._calendar_profile", return_value=profile), \
                mock.patch("learner_api.calendar.coaching_events_for_learner", return_value=events) as source, \
                mock.patch.object(employer_portal.review_instances, "get_review_instance", return_value={"id": "instance-a", "learner_id": 55}), \
                mock.patch.object(employer_portal.review_instances, "find_review_instance", return_value=None), \
                mock.patch.object(employer_portal.review_instances, "review_instance_form_definition", return_value=definition), \
                mock.patch("curriculum_api.reviews.get_review_template_row", side_effect=lambda template_id, **kwargs: {"id": template_id}), \
                mock.patch.object(employer_portal.review_instances, "build_definition_snapshot", side_effect=snapshot):
            response = self.progress_reviews()
        source.assert_called_once_with(self.learner, profile)
        self.assertEqual(response.status_code, 200)
        payload = json.loads(response.content)
        self.assertEqual({event["eventKey"] for event in payload["events"]}, {"owned", "future", "archived"})
        owned = next(event for event in payload["events"] if event["eventKey"] == "owned")
        self.assertFalse(owned["employerSigned"])
        self.assertTrue(owned["employerSignatureRequired"])
        self.assertEqual(owned["meetingLink"], "")
        self.assertEqual(owned["status"], "awaiting-signature")
        self.assertIsNone(payload["definitions"]["future"]["instance"])
        self.assertFalse(payload["definitions"]["future"]["signatures"]["employer"]["required"])
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_progress_review_detail_rejects_another_instance_even_when_source_ids_collide(self):
        event = {"id": "other", "eventKey": "other", "reviewTypeCode": "progress_review", "reviewInstanceId": "instance-b"}
        with mock.patch("learner_api.calendar._calendar_profile", return_value=SimpleNamespace(pk=55)), \
                mock.patch("learner_api.calendar.coaching_events_for_learner", return_value=[event]), \
                mock.patch.object(employer_portal.review_instances, "get_review_instance", return_value={"id": "instance-b", "learner_id": 101}), \
                mock.patch.object(employer_portal.review_instances, "review_instance_form_definition") as render:
            response = self.progress_reviews(event_key="other")
        self.assertEqual(response.status_code, 404)
        render.assert_not_called()

    def test_progress_review_history_and_download_use_the_owned_event_only(self):
        event = {"id": "archived", "eventKey": "archived", "source": "progress-review", "importedReview": {"id": "88", "sections": []}}
        with mock.patch("learner_api.calendar._calendar_profile", return_value=SimpleNamespace(pk=55)), \
                mock.patch("learner_api.calendar.coaching_events_for_learner", return_value=[event]), \
                mock.patch("curriculum_api.review_pdf.learner_information", return_value={}), \
                mock.patch("learner_api.aptem_review_pdf.original_review_pdf", return_value=b"%PDF-saved-original"):
            detail = self.progress_reviews(event_key="archived")
            pdf = self.progress_reviews(event_key="archived", as_pdf=True)
            denied = self.progress_reviews(event_key="another-learners-review", as_pdf=True)
        self.assertEqual(json.loads(detail.content)["event"]["importedReview"]["id"], "88")
        self.assertEqual(pdf.status_code, 200)
        self.assertEqual(pdf.content, b"%PDF-saved-original")
        self.assertEqual(denied.status_code, 404)

    def test_progress_review_ownership_permissions_and_read_only_guard(self):
        with mock.patch("learner_api.calendar.coaching_events_for_learner") as read:
            self.assertEqual(self.progress_reviews(method="post").status_code, 405)
            self.assertEqual(self.progress_reviews(employer_id=8).status_code, 404)
            self.assertEqual(self.progress_reviews(learner_id=999).status_code, 404)
            self.learner.employer_id = 10
            self.assertEqual(self.progress_reviews().status_code, 403)
            self.learner.employer_id = 9
            self.account = SimpleNamespace(role="learner", subject_id=101)
            self.assertEqual(self.progress_reviews().status_code, 403)
            read.assert_not_called()

    def test_progress_review_migrated_signatures_are_scoped_to_the_resolved_profile(self):
        event = {"id": "imported-review:88", "eventKey": "imported-review:88", "source": "progress-review",
                 "reviewTypeCode": "progress_review", "migratedForm": True}
        with mock.patch("learner_api.calendar._calendar_profile", return_value=SimpleNamespace(pk=55)), \
                mock.patch("learner_api.calendar.coaching_events_for_learner", return_value=[event]), \
                mock.patch.object(employer_portal.ImportedReviewInstance.objects, "filter") as lookup, \
                mock.patch.object(employer_portal, "signature_states", return_value={"employer": {"signed": True, "required": True}}):
            lookup.return_value.first.return_value = SimpleNamespace(event_key=event["eventKey"])
            response = self.progress_reviews()
        lookup.assert_called_once_with(event_key="imported-review:88", learner_id=55)
        row = json.loads(response.content)["events"][0]
        self.assertTrue(row["employerSigned"])
        self.assertTrue(row["employerSignatureRequired"])

    def logs(self, method="get", employer_id=9, learner_id=101, **parts):
        request = getattr(self.factory, method)("/monthly-logs/")
        return employer_portal.employer_portal_monthly_logs(
            request, employer_id=employer_id, kind="commercial", learner_id=learner_id, **parts,
        )

    def test_monthly_logs_share_the_learner_sources_and_are_read_only(self):
        from learner_api import journal_sources
        profile = {"id": 55, "aptem_id": 42, "name": "Learner", "programme": "Marketing"}
        payload = {"learner": {"name": "Learner"}, "months": [{"month": "2026-09"}]}

        def summary(record, **kwargs):
            self.assertTrue(journal_sources.enabled())
            self.assertTrue(record["_view_as"])
            self.assertEqual(record["id"], 101)
            self.assertEqual(record["_canonical_profile"], profile)
            self.assertEqual(kwargs, {"include_open": True})
            return payload

        self.account = SimpleNamespace(role="staff", subject_id=None)
        with mock.patch("learner_api.canonical_learning.require_profile", return_value=profile), \
                mock.patch("learner_api.monthly_logs.summary_data", side_effect=summary):
            response = self.logs()
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {**payload, "read_only": True, "csrf_token": ""})
        self.assertFalse(journal_sources.enabled())
        self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_monthly_log_detail_keeps_hours_and_rewrites_evidence_links(self):
        payload = {"month": "2026-09", "actual_hours": 7.5, "training_plan_target": 10,
                   "rows": [{"documents": [{"url": "/learner_api/monthly-logs/101/canonical-documents/5/"}]}]}
        with mock.patch("learner_api.canonical_learning.require_profile", return_value={}), \
                mock.patch("learner_api.monthly_logs.detail_data", return_value=payload) as read:
            response = self.logs(month="2026-09")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(read.call_args.kwargs, {"include_open": True})
        self.assertEqual(read.call_args.args[1], "2026-09")
        body = json.loads(response.content)
        self.assertEqual(body["actual_hours"], 7.5)
        self.assertEqual(body["training_plan_target"], 10)
        self.assertEqual(body["rows"][0]["documents"][0]["url"],
                         "/learner_api/employer-portal/9/learner/commercial/101/monthly-logs/canonical-documents/5/")

    def test_monthly_log_content_uses_the_shared_activity_reader(self):
        from django.http import JsonResponse
        payload = {"id": 4, "parts": [{"id": 6, "url": "/learner_api/monthly-logs/101/2026-09/activities/4/materials/6/"}]}
        with mock.patch("learner_api.canonical_learning.require_profile", return_value={}), \
                mock.patch("learner_api.monthly_logs.content_response", return_value=JsonResponse(payload)) as read:
            response = self.logs(month="2026-09", row_id=4)
        self.assertEqual(read.call_args.args[1:], ("2026-09", 4))
        self.assertEqual(json.loads(response.content)["parts"][0]["url"],
                         "/learner_api/employer-portal/9/learner/commercial/101/monthly-logs/2026-09/activities/4/materials/6/")

    def test_monthly_log_materials_and_documents_use_owned_readers(self):
        from django.http import HttpResponse
        for parts, helper, args in [
            ({"month": "2026-09", "row_id": 4, "material_id": 6}, "material_response", ("2026-09", 4, 6)),
            ({"file_id": 5, "document_source": "canonical"}, "canonical_document_response", (101, 5)),
            ({"file_id": "file-id"}, "document_response", (101, "file-id")),
        ]:
            with self.subTest(helper=helper), \
                    mock.patch("learner_api.canonical_learning.require_profile", return_value={}), \
                    mock.patch(f"learner_api.monthly_logs.{helper}", return_value=HttpResponse(b"file")) as read:
                self.assertEqual(self.logs(**parts).content, b"file")
                self.assertEqual(read.call_args.args[-len(args):], args)

    def test_monthly_log_reads_and_files_refuse_unowned_learners_and_writes(self):
        with mock.patch("learner_api.canonical_learning.require_profile") as profile:
            for parts in ({}, {"month": "2026-09"}, {"month": "2026-09", "row_id": 4}, {"file_id": 5}):
                self.learner.employer_id = 10
                self.assertEqual(self.logs(**parts).status_code, 403)
                self.learner.employer_id = 9
                self.assertEqual(self.logs(employer_id=8, **parts).status_code, 404)
                self.assertEqual(self.logs(method="post", **parts).status_code, 405)
            self.assertEqual(self.logs(learner_id=999).status_code, 404)
            profile.assert_not_called()

    def test_monthly_logs_preserve_missing_identity_and_activity_errors(self):
        from old_otjh.service import ServiceError
        with mock.patch("learner_api.canonical_learning.require_profile", side_effect=ServiceError("Identity needs review", "identity", 409)):
            self.assertEqual(self.logs().status_code, 409)
        with mock.patch("learner_api.canonical_learning.require_profile", return_value={}), \
                mock.patch("learner_api.monthly_logs.content_response", side_effect=ServiceError("Activity not found", "not_found", 404)):
            self.assertEqual(self.logs(month="2026-09", row_id=4).status_code, 404)


class EmployerPortalLearnerDetailTests(SimpleTestCase):
    def test_returns_the_learners_organization_for_the_dashboard_header(self):
        learner = SimpleNamespace(
            pk=101, employer_id=9, username="Lee Learner", email="", phone_number="",
            programme="Programme", cohort="Cohort", employer="Test Employer",
            organization="Test Organization", programme_status="Active", onboarding_status="",
            start_date="2026-08-03", end_date="2027-08-02",
        )
        employer = SimpleNamespace(pk=9, full_name="Employer User")
        request = RequestFactory().get("/learner/")
        account = SimpleNamespace(role="employer", subject_id=9)
        with mock.patch("login.permissions.authenticate_request", return_value=account), \
                mock.patch.object(employer_portal, "_employer_or_404", return_value=(employer, None)), \
                mock.patch.object(employer_portal, "SOURCE_MODELS", {"commercial": _model(learner)}), \
                mock.patch.object(employer_portal, "_review_signing_rows", return_value=[]), \
                mock.patch.object(employer_portal, "_document_signing_rows", return_value=[]), \
                mock.patch.object(employer_portal, "_performance", return_value={}), \
                mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}):
            response = employer_portal.employer_portal_learner(
                request, employer_id=9, kind="commercial", learner_id=101,
            )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["learner"]["organization"], "Test Organization")


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
