"""Explicit migrated snapshots: frozen reads, authorization and atomic writes."""
from copy import deepcopy
from datetime import date
from inspect import unwrap
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.middleware.csrf import CsrfViewMiddleware
from django.test import RequestFactory, SimpleTestCase, TestCase
from django.utils import timezone
from pypdf import PdfReader

from . import migrated_progress as service, migrated_progress_views as endpoint, views
from .migrated_completion import build_pdf, ensure_document, submit
from .migrated_completion_views import migrated_review_party_detail
from .migrated_summary_binding import answer_version
from .migrated_templates import snapshot_for
from .models import ImportedReviewInstance, MigratedReviewTemplate
from . import test_migrated_reviews as reader_fixtures
from .tests_migrated_completion import PNG, overlay as pdf_overlay

OWNER = "progress-coach@example.invalid"
FORM = {"sections": [{"key": "s", "title": "Discussion", "fields": [
    {"key": "note", "title": "Note", "aptemType": 1, "mandatory": False},
]}]}
SNAPSHOT = {
    "schemaVersion": 4, "formulaVersion": "stored_completed_hours_and_component_ksb_v4",
    "calculationMethod": "planned_hours", "calculatedFrom": "2025-01-02",
    "calculatedAt": "2026-10-04T10:00:00+00:00", "calculatedBy": OWNER,
    "actualHoursSource": "learner.completed_hours",
    "programmeProgress": {"actual": 28, "planned": 100, "expected": 30,
        "actualPercent": 28, "expectedPercent": 30, "variancePercent": -2, "varianceDirection": "below"},
    "offTheJobHours": {"actual": 64, "planned": 100, "expected": 52,
        "actualPercent": 64, "expectedPercent": 52, "variancePercent": 12, "varianceDirection": "above"},
    "ksbProgress": {"available": True, "title": "Synthetic KSB standard", "actualPercent": 73,
        "expectedPercent": 100, "variancePercent": -27, "varianceDirection": "below"},
}


class MigratedProgressPersistenceTests(TestCase):
    def setUp(self):
        self.template = MigratedReviewTemplate.objects.create(scope="GLOBAL", programme_key="",
            review_family="PR", name="Progress fixture", definition_json=deepcopy(FORM), is_active=True)
        self.overlay = ImportedReviewInstance.objects.create(event_key="imported-review:progress-fixture", owner_email=OWNER,
            learner_id=42, source_review_id=70000001, migrated_template=self.template,
            template_snapshot=snapshot_for(self.template), status="in-progress", answers={"note": "Saved answer"},
            meeting_intelligence={"summary": {"overview": "Saved summary"}},
            signature_requirements={"advisor": True, "participant": True, "employer": True})
        self.definition = {"migratedForm": True, "migratedProgrammeKey": "id:P-42",
            "instance": {"id": self.overlay.event_key, "learnerId": 42},
            "historicalReview": {"id": str(self.overlay.source_review_id), "type": "Progress Review"}}
        self.reader = patch.object(views, "_imported_review_definition", side_effect=lambda *a, **kw: {
            **self.definition, "progressSnapshot": ImportedReviewInstance.objects.get(pk=self.overlay.pk).progress_snapshot,
        })
        self.reader.start()
        self.addCleanup(self.reader.stop)

    def context(self):
        return service.resolve_context(OWNER, self.overlay.event_key)

    def post(self, *, version=None, calculate=None):
        request = RequestFactory().post("/", json.dumps({"progressVersion": version or answer_version(self.overlay)}),
            content_type="application/json")
        with patch.object(endpoint, "authenticated_coach_email", return_value=OWNER), \
             patch.object(endpoint, "calculate_snapshot", side_effect=calculate, return_value=deepcopy(SNAPSHOT)) as calculator:
            response = unwrap(endpoint.migrated_review_progress)(request, self.overlay.event_key)
        self.overlay.refresh_from_db()
        return response, calculator

    def test_calculate_and_recalculate_persist_only_snapshot_and_version(self):
        before = {key: deepcopy(getattr(self.overlay, key)) for key in
            ("answers", "template_snapshot", "meeting_intelligence", "signature_requirements", "status", "completed_at")}
        for status in ("not-scheduled", "scheduled", "in-progress"):
            for family in ("PR", "PR_SKILLS_RADAR"):
                with self.subTest(status=status, family=family):
                    self.definition["historicalReview"]["type"] = "Progress Review" if family == "PR" else "Progress Review (+ Skills Radar)"
                    self.overlay.template_snapshot["templateSource"]["family"] = family
                    self.overlay.status = status
                    self.overlay.save()
                    frozen_template = deepcopy(self.overlay.template_snapshot)
                    version = answer_version(self.overlay)
                    response, calculator = self.post()
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(self.overlay.progress_snapshot, SNAPSHOT)
                    self.assertNotEqual(answer_version(self.overlay), version)
                    self.assertEqual(self.overlay.status, status)
                    self.assertEqual(self.overlay.template_snapshot, frozen_template)
                    calculator.assert_called_once()
        for key in ("answers", "meeting_intelligence", "signature_requirements", "completed_at"):
            self.assertEqual(getattr(self.overlay, key), before[key])

    def test_uninitialized_invalid_family_lifecycle_and_assignment_refused(self):
        original = deepcopy(self.definition)
        cases = [({"migratedForm": False}, None),
                 ({"historicalReview": {"id": "70000001", "type": "Monthly Coaching Meeting"}}, None),
                 ({"historicalReview": {"id": "70000001", "type": "Unknown"}}, None),
                 ({}, "awaiting-signature"), ({}, "completed")]
        for changes, status in cases:
            self.definition = {**deepcopy(original), **changes}
            self.overlay.status = status or "in-progress"
            self.overlay.save()
            with self.subTest(changes=changes, status=status):
                response, calculator = self.post()
                self.assertEqual(response.status_code, 409)
                calculator.assert_not_called()
                self.assertIsNone(self.overlay.progress_snapshot)
        self.definition = original
        self.overlay.status = "in-progress"
        self.overlay.template_snapshot["templateSource"]["id"] = -1
        self.overlay.save()
        self.assertEqual(self.post()[0].status_code, 409)

    def test_wrong_coach_learner_and_source_associations_refused(self):
        with self.assertRaises(service.ProgressError):
            service.resolve_context("other@example.invalid", self.overlay.event_key)
        for key, value in (("learnerId", 43),):
            self.definition["instance"][key] = value
            self.assertEqual(self.post()[0].status_code, 409)
        self.definition["instance"]["learnerId"] = 42
        self.definition["historicalReview"]["id"] = "70000002"
        self.assertEqual(self.post()[0].status_code, 409)

    def test_stale_or_missing_version_never_calls_calculator(self):
        response, calculator = self.post(version="old")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "progress_conflict")
        calculator.assert_not_called()
        with self.assertRaises(service.ProgressError):
            service.require_version(None, answer_version(self.overlay))

    def test_failed_calculation_keeps_previous_snapshot(self):
        self.overlay.progress_snapshot = SNAPSHOT
        self.overlay.save()
        for error in (ValueError("Missing valid hours"), service.ProgressError("Missing individual start"), DatabaseError("unavailable")):
            with self.subTest(error=type(error).__name__):
                before = answer_version(self.overlay)
                response, _ = self.post(calculate=error)
                self.assertIn(response.status_code, (409, 503))
                self.assertEqual(self.overlay.progress_snapshot, SNAPSHOT)
                self.assertEqual(answer_version(self.overlay), before)

    def test_missing_target_schedule_returns_shared_error_and_preserves_snapshot(self):
        from learner_api.review_progress_snapshot import UnresolvedTrainingPlanTarget
        self.overlay.progress_snapshot = SNAPSHOT
        self.overlay.save()
        response, _ = self.post(calculate=UnresolvedTrainingPlanTarget({"unresolvedReasons": ["No authoritative week"]}))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["errors"]["targetSchedule"], ["No authoritative week"])
        self.assertEqual(self.overlay.progress_snapshot, SNAPSHOT)

    def test_refreshed_read_failure_rolls_back_snapshot(self):
        context = self.context()
        with patch.object(views, "_imported_review_definition", side_effect=[self.definition, None]):
            with self.assertRaises(service.ProgressError):
                service.persist_snapshot(OWNER, self.overlay.event_key, context, SNAPSHOT)
        self.overlay.refresh_from_db()
        self.assertIsNone(self.overlay.progress_snapshot)
        self.assertEqual(answer_version(self.overlay), context.version)

    def test_submission_is_optional_and_never_recalculates_existing_snapshot(self):
        with patch.object(service, "build_progress_snapshot", side_effect=AssertionError("Submit calculated")):
            for snapshot in (None, SNAPSHOT):
                self.overlay.status = "in-progress"
                self.overlay.progress_snapshot = deepcopy(snapshot)
                self.overlay.save()
                submit(self.overlay, {"note": "Submitted"})
                self.overlay.refresh_from_db()
                self.assertEqual(self.overlay.progress_snapshot, snapshot)

    def test_another_learner_overlay_is_untouched(self):
        other = ImportedReviewInstance.objects.create(event_key="imported-review:other-progress", owner_email=OWNER,
            learner_id=43, source_review_id=70000002, status="in-progress", progress_snapshot={"other": True})
        before = other.updated_at
        self.assertEqual(self.post()[0].status_code, 200)
        other.refresh_from_db()
        self.assertEqual(other.progress_snapshot, {"other": True})
        self.assertEqual(other.updated_at, before)

    def test_racing_answers_summary_submit_and_completion_prevent_snapshot_write(self):
        for change in ({"answers": {"note": "Other tab"}}, {"meeting_intelligence": {"summaryStatus": "edited"}},
                       {"status": "awaiting-signature"}, {"status": "completed"}):
            self.overlay.status = "in-progress"
            self.overlay.save()
            context = self.context()
            ImportedReviewInstance.objects.filter(pk=self.overlay.pk).update(**change, updated_at=timezone.now())
            with self.subTest(change=change), self.assertRaises(service.ProgressError):
                service.persist_snapshot(OWNER, self.overlay.event_key, context, SNAPSHOT)
            self.overlay.refresh_from_db()
            self.assertIsNone(self.overlay.progress_snapshot)
            for key, value in change.items():
                self.assertEqual(getattr(self.overlay, key), value)

    def test_duplicate_calculations_allow_only_first_version(self):
        first, second = self.context(), self.context()
        service.persist_snapshot(OWNER, self.overlay.event_key, first, SNAPSHOT)
        with self.assertRaises(service.ProgressError):
            service.persist_snapshot(OWNER, self.overlay.event_key, second, {"incorrect": True})
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.progress_snapshot, SNAPSHOT)

    def test_revalidation_catches_source_changes_without_overlay_version_change(self):
        context = self.context()
        self.definition["migratedForm"] = False
        with self.assertRaises(service.ProgressError):
            service.persist_snapshot(OWNER, self.overlay.event_key, context, SNAPSHOT)
        self.overlay.refresh_from_db()
        self.assertIsNone(self.overlay.progress_snapshot)


class MigratedProgressCalculatorTests(SimpleTestCase):
    def test_same_shared_calculator_and_individual_start_for_both_learner_types(self):
        from learner_api.review_progress_snapshot import build_progress_snapshot
        self.assertIs(service.build_progress_snapshot, build_progress_snapshot)
        context = service.ProgressContext(1, 42, 7, 21, "PR", "v1")
        profile, source = SimpleNamespace(pk=42), SimpleNamespace(learner_id=42)
        for commercial, enrolment in (({42: source}, {}), ({}, {42: source})):
            with self.subTest(commercial=bool(commercial)), \
                 patch.object(service.LearnerProfile.objects, "filter") as profiles, \
                 patch.object(views, "fetch_source_schedule_rows", return_value=(commercial, enrolment)), \
                 patch.object(views, "resolve_review_anchor_date", return_value=(date(2025, 1, 2), None)), \
                 patch.object(service, "build_progress_snapshot", return_value=SNAPSHOT) as calculator:
                profiles.return_value.first.return_value = profile
                self.assertEqual(service.calculate_snapshot(context, OWNER), SNAPSHOT)
                self.assertEqual(calculator.call_args.args, (source, profile))
                self.assertEqual(calculator.call_args.kwargs["learner_start_date"], date(2025, 1, 2))
                self.assertEqual(calculator.call_args.kwargs["calculated_by"], OWNER)

    def test_missing_individual_start_never_falls_back_to_cohort_date(self):
        with patch.object(service.LearnerProfile.objects, "filter") as profiles, \
             patch.object(views, "fetch_source_schedule_rows", return_value=({}, {})), \
             patch.object(views, "resolve_review_anchor_date", return_value=(None, "missing")), \
             patch.object(service, "build_progress_snapshot") as calculator:
            profiles.return_value.first.return_value = SimpleNamespace(pk=42)
            with self.assertRaises(service.ProgressError) as caught:
                service.calculate_snapshot(service.ProgressContext(1, 42, 7, 21, "PR", "v1"), OWNER)
            self.assertIn("learnerStartDate", caught.exception.errors)
            calculator.assert_not_called()

    def test_missing_learner_is_a_safe_not_found(self):
        with patch.object(service.LearnerProfile.objects, "filter") as profiles:
            profiles.return_value.first.return_value = None
            with self.assertRaises(service.ProgressError) as caught:
                service.calculate_snapshot(service.ProgressContext(1, 42, 7, 21, "PR", "v1"), OWNER)
            self.assertEqual(caught.exception.status, 404)

    def test_endpoint_keeps_csrf_protection(self):
        request = RequestFactory().post("/", "{}", content_type="application/json")
        response = CsrfViewMiddleware(lambda request: None).process_view(request, endpoint.migrated_review_progress, (), {})
        self.assertEqual(response.status_code, 403)

    def test_unauthenticated_and_participant_sessions_cannot_calculate(self):
        for account, expected in ((None, 401), (SimpleNamespace(role="learner", subject_type="learner"), 403),
                                  (SimpleNamespace(role="employer", subject_type="employer"), 403)):
            with self.subTest(expected=expected, account=account), \
                 patch("login.permissions.authenticate_request", return_value=account), \
                 patch.object(endpoint, "calculate_snapshot") as calculator:
                response = endpoint.migrated_review_progress(RequestFactory().post("/"), "imported-review:test")
                self.assertEqual(response.status_code, expected)
                calculator.assert_not_called()

    def test_admin_view_as_post_is_forbidden(self):
        account = SimpleNamespace(role="admin", subject_type="staff", subject_id=1)
        request = RequestFactory().post("/?viewAsCoach=" + OWNER, "{}", content_type="application/json")
        request.login_account = account
        with patch("login.permissions.authenticate_request", return_value=account), \
             patch("coach_api.auth.StaffUser.objects.filter") as staff, \
             patch("coach_api.auth._staff_access", return_value="super-admin"), \
             patch.object(endpoint, "calculate_snapshot") as calculator:
            staff.return_value.only.return_value.first.return_value = SimpleNamespace(access="super-admin")
            response = endpoint.migrated_review_progress(request, "imported-review:test")
            self.assertEqual(response.status_code, 403)
            calculator.assert_not_called()


class MigratedProgressReadTests(SimpleTestCase):
    setUp = reader_fixtures.MigratedPreviewTests.setUp
    _patch = reader_fixtures.MigratedPreviewTests._patch
    _set_source_status = reader_fixtures.MigratedPreviewTests._set_source_status
    _get = reader_fixtures.MigratedPreviewTests._get

    def test_initialized_get_is_null_or_exact_snapshot_without_calculation(self):
        self.view_as.return_value = False
        row = list(self.cursor.fetchall.return_value[0])
        row[3] = row[4] = "Progress Review"
        self.cursor.fetchall.return_value = [tuple(row)]
        saved = SimpleNamespace(learner_id=21, source_review_id=407, template_snapshot=self.definition_json,
            migrated_template_id=None, answers={}, status="in-progress", completed_at=None, updated_at=timezone.now(),
            migrated_signatures=SimpleNamespace(all=lambda: []), signature_requirements={"employer": True})
        self.overlays.return_value.first.return_value = saved
        self._patch("coach_api.views.curriculum_review_instances.progress_review_rag_history", return_value=[])
        with patch.object(views, "build_progress_snapshot", side_effect=AssertionError("GET calculated")), \
             patch.object(service, "build_progress_snapshot", side_effect=AssertionError("GET calculated")), \
             patch.object(views, "_imported_review_progress_snapshot", side_effect=AssertionError("Initialized fallback")):
            for snapshot in (None, SNAPSHOT):
                saved.progress_snapshot = deepcopy(snapshot)
                self.assertEqual(self._get()["progressSnapshot"], snapshot)
                self.profile.completed_hours = 99999
                self.assertEqual(self._get()["progressSnapshot"], snapshot)

    def test_historical_progress_parser_remains_independent(self):
        expected = {"imported": "source text"}
        with patch.object(views, "_imported_progress_snapshot_from_review", return_value=expected) as parser, \
             patch.object(views, "build_progress_snapshot", side_effect=AssertionError("Historical GET calculated")):
            self.assertEqual(views._imported_review_progress_snapshot(self.profile, {"source": "untouched"}, calculated_by=OWNER), expected)
            parser.assert_called_once_with({"source": "untouched"})


class MigratedProgressPdfPartyTests(SimpleTestCase):
    def test_pr_and_skills_radar_pdf_use_only_stored_progress_or_safe_placeholder(self):
        for family in ("PR", "PR_SKILLS_RADAR"):
            for snapshot in (None, SNAPSHOT):
                with self.subTest(family=family, calculated=bool(snapshot)):
                    signatures = [SimpleNamespace(role=role, signer_name="Synthetic signer", signed_at=timezone.now(), signature=PNG)
                                  for role in ("advisor", "participant", "employer")]
                    review = pdf_overlay(family, "completed", {"answer": "Saved answer"}, signatures)
                    review.completed_at, review.progress_snapshot = timezone.now(), deepcopy(snapshot)
                    with patch.object(service, "build_progress_snapshot", side_effect=AssertionError("PDF calculated")):
                        content = build_pdf(review, learner_name="Synthetic", learner_email="synthetic@example.invalid",
                            programme="Synthetic programme", scheduled_date="2026-10-04", coach_name="Synthetic coach")
                    text = "\n".join(page.extract_text() for page in PdfReader(BytesIO(content)).pages)
                    self.assertIn("Learning Progress", text)
                    if snapshot:
                        for value in ("28%", "64%", "73%", "Synthetic KSB standard"):
                            self.assertIn(value, text)
                    else:
                        self.assertIn("No progress snapshot was calculated", text)

    def test_existing_pdf_is_returned_without_regeneration(self):
        document = SimpleNamespace(pdf_bytes=b"original", sha256="original")
        with patch("coach_api.migrated_completion.MigratedReviewDocument.objects.filter") as rows, \
             patch("coach_api.migrated_completion.build_pdf", side_effect=AssertionError("Regenerated")):
            rows.return_value.first.return_value = document
            self.assertIs(ensure_document(pdf_overlay("PR", "completed")), document)

    def test_party_detail_preserves_snapshot_and_removes_calculation_controls(self):
        for role in ("learner", "employer"):
            with self.subTest(role=role), \
                 patch("coach_api.migrated_completion_views.authenticate_request", return_value=SimpleNamespace(role=role)), \
                 patch("coach_api.migrated_completion_views._party_overlay", return_value=SimpleNamespace(owner_email=OWNER)), \
                 patch.object(views, "_imported_review_definition", return_value={"migratedForm": True,
                     "progressSnapshot": deepcopy(SNAPSHOT), "canCalculateProgress": True, "progressVersion": "v1"}), \
                 patch.object(service, "build_progress_snapshot", side_effect=AssertionError("Party GET calculated")):
                response = migrated_review_party_detail(RequestFactory().get("/"), "imported-review:test")
                payload = json.loads(response.content)
                self.assertEqual(payload["progressSnapshot"], SNAPSHOT)
                self.assertTrue(payload["readOnly"])
                self.assertFalse(payload["canCalculateProgress"])
                self.assertNotIn("progressVersion", payload)
