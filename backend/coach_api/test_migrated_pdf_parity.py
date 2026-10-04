"""Synthetic PDF layout, frozen-data and authoritative-download regressions."""
from copy import deepcopy
import base64
from datetime import datetime, timezone
from inspect import unwrap
from io import BytesIO
import hashlib
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch

import fitz
from PIL import Image
from django.test import RequestFactory, SimpleTestCase, TestCase

from curriculum_api.review_pdf import build_mcm_pdf
from curriculum_api.tests_review_pdf import progress_review_definition, saved_snapshot, SAMPLE_INFORMATION
from . import migrated_completion_views as endpoints
from .migrated_completion import build_pdf, ensure_document, requirements_for_family, validate_signature_image
from .migrated_review_pdf import PROVENANCE, pdf_family, review_pdf_data, stored_pdf_response
from .models import ImportedReviewInstance, MigratedReviewDocument, MigratedReviewSignature


FIXTURES = json.loads((Path(__file__).parent / "fixtures" / "migrated_pdf_parity.json").read_text(encoding="utf-8"))
AT = datetime(2026, 10, 4, 14, 30, tzinfo=timezone.utc)
CONTEXT = dict(learner_name="Sample learner", learner_email="learner@example.invalid",
               programme="Sample programme", scheduled_date="2026-10-04", coach_name="Sample coach")


class FrozenReview(SimpleNamespace):
    @property
    def migrated_template(self):
        raise AssertionError("PDF read the mutable master template")

    @property
    def meeting_intelligence(self):
        raise AssertionError("PDF read internal AI/transcript provenance")


def sample_review(family="MCM"):
    fixture = deepcopy(FIXTURES[family])
    rules = requirements_for_family(family)
    signatures = [SimpleNamespace(role=role, signer_name=f"Sample {label}", signed_at=AT,
                                  signature=fixture["mark"])
                  for role, label in (("advisor", "coach"), ("participant", "learner"), ("employer", "employer"))
                  if rules[role]]
    relation = Mock()
    relation.all.return_value = signatures
    return FrozenReview(pk=42, event_key="imported-review:SAMPLE", owner_email="coach@example.invalid",
                        learner_id=17, source_review_id=83, status="completed", completed_at=AT,
                        template_snapshot=fixture["snapshot"], answers=fixture["answers"],
                        progress_snapshot=fixture["progress"], signature_requirements=rules,
                        migrated_signatures=relation)


def document(review):
    return fitz.open(stream=build_pdf(review, **CONTEXT), filetype="pdf")


def text_of(pdf):
    return "\n".join(page.get_text() for page in pdf)


def spans(page):
    return [span for block in page.get_text("dict")["blocks"] if block["type"] == 0
            for line in block["lines"] for span in line["spans"]]


class MigratedPdfPresentationTests(SimpleTestCase):
    def test_all_families_use_native_geometry_branding_typography_and_page_numbers(self):
        reference = fitz.open(stream=build_mcm_pdf(progress_review_definition(saved_snapshot()), SAMPLE_INFORMATION), filetype="pdf")
        native_header = next(s for s in spans(reference[0]) if s["text"] == "Review")
        for family in FIXTURES:
            with self.subTest(family=family):
                pdf = document(sample_review(family))
                self.assertGreaterEqual(len(pdf), 2)
                for number, page in enumerate(pdf, 1):
                    self.assertEqual(page.rect, reference[0].rect)
                    header = next(s for s in spans(page) if s["text"] == "Review")
                    for key in ("origin", "font", "size", "color"):
                        self.assertEqual(header[key], native_header[key])
                    self.assertTrue(page.get_images(), "KBC logo must repeat")
                    self.assertIn(f"Page {number}", page.get_text())
                    provenance = next(s for s in spans(page) if s["text"] == PROVENANCE)
                    self.assertEqual(provenance["size"], 7)
                self.assertNotIn("LMS Generated Migrated Review", text_of(pdf))

    def test_saved_metadata_summary_and_signature_order_for_each_family(self):
        for family in FIXTURES:
            with self.subTest(family=family):
                pdf = document(sample_review(family))
                text = text_of(pdf)
                for value in ("Sample learner", "Sample programme", "Review Planned Date:",
                              "Review Completed Date:", "04/10/2026", "Advisor", "Participant",
                              "Name: Sample coach", "Name: Sample learner", "04/10/2026 15:30 (Europe/London)"):
                    self.assertIn(value, text)
                self.assertEqual(text.count("Final saved meeting summary."), 1)
                self.assertLess(text.index("Meeting Summary"), text.index("Action due date"))
                self.assertNotIn("No Summary Generated", text)
                self.assertNotIn("RAG Status", text)
                signatures = text_of(fitz.open(stream=build_pdf(sample_review(family), **CONTEXT), filetype="pdf"))
                if family != "MCM":
                    self.assertLess(signatures.index("Name: Sample coach"), signatures.index("Name: Sample employer"))
                    self.assertLess(signatures.index("Name: Sample employer"), signatures.index("Name: Sample learner"))
                else:
                    self.assertNotIn("Name: Sample employer", text)
                self.assertNotIn("Name: Sample coach", pdf[0].get_text())

    def test_static_conditional_date_choice_and_multiline_values(self):
        pdf = document(sample_review())
        text = text_of(pdf)
        self.assertIn("Reflection guidance\nDiscuss progress and agree achievable next steps.", text)
        static_region = text.split("Reflection guidance", 1)[1].split("Learning reflection", 1)[0]
        self.assertNotIn("Not recorded", static_region)
        for value in ("Follow-up detail", "Arrange another practice session.", "20/10/2026", "Coaching", "Support required? yes", "Second reflection line <escaped>."):
            self.assertIn(value, text)
        self.assertNotIn("Hidden branch", text)
        self.assertLess(text.index("First reflection line."), text.index("Second reflection line"))

    def test_no_branch_is_rendered_when_not_selected(self):
        review = sample_review()
        review.answers["conditional"] = "no"
        review.answers.pop("visible")
        review.answers["hidden"] = "The no branch is selected."
        text = text_of(document(review))
        self.assertIn("The no branch is selected.", text)
        self.assertNotIn("Follow-up detail", text)

    def test_frozen_array_order_and_radar_family_are_preserved(self):
        review = sample_review("PR_SKILLS_RADAR")
        review.template_snapshot["sections"][0]["order"] = 99
        definition, _ = review_pdf_data(review, {}, **CONTEXT)
        self.assertEqual(definition["template"]["reviewFamily"], "PR_SKILLS_RADAR")
        self.assertEqual(pdf_family(review, "MCM"), "PR_SKILLS_RADAR")
        text = text_of(document(review))
        self.assertLess(text.index("Learning & reflection"), text.index("Skills Radar\n"))
        self.assertIn("Communication and collaboration", text)
        self.assertIn("Confident in practical collaboration.", text)

    def test_legacy_family_uses_source_without_master_template_access(self):
        review = sample_review("PR_SKILLS_RADAR")
        review.template_snapshot.pop("templateSource")
        self.assertEqual(pdf_family(review, "PR_SKILLS_RADAR"), "PR_SKILLS_RADAR")
        review.signature_requirements = {}
        content = build_pdf(review, **CONTEXT, source_family="PR_SKILLS_RADAR")
        self.assertIn("Skills Radar", text_of(fitz.open(stream=content, filetype="pdf")))

    def test_progress_is_stored_and_uses_the_exact_native_graphics(self):
        for family in ("PR", "PR_SKILLS_RADAR"):
            with self.subTest(family=family):
                review = sample_review(family)
                native = progress_review_definition(deepcopy(review.progress_snapshot))
                native_pdf = fitz.open(stream=build_mcm_pdf(native, SAMPLE_INFORMATION), filetype="pdf")
                migrated_pdf = document(review)
                native_page = next(page for page in native_pdf if "Learning Plan Progress" in page.get_text())
                migrated_page = next(page for page in migrated_pdf if "Learning Plan Progress" in page.get_text())
                # The whole progress section (caption, donut, bars, markers,
                # labels, variance and borders), excluding subsequent content.
                clip = fitz.Rect(56, 242, 793, 546)
                self.assertEqual(native_page.get_pixmap(clip=clip).samples,
                                 migrated_page.get_pixmap(clip=clip).samples)
                for value in ("28%", "64%", "73%", "23% Above", "28% Below", "18/10/2024", "Synthetic KSB standard"):
                    self.assertIn(value, text_of(migrated_pdf))

    def test_missing_snapshot_and_unavailable_ksb_are_safe(self):
        for family in ("PR", "PR_SKILLS_RADAR"):
            review = sample_review(family)
            review.progress_snapshot = None
            self.assertIn("No progress snapshot was calculated for this review.", text_of(document(review)))
            review.progress_snapshot = deepcopy(FIXTURES[family]["progress"])
            review.progress_snapshot["ksbProgress"] = {"available": False, "reason": "No stored KSB baseline."}
            self.assertIn("No stored KSB baseline.", text_of(document(review)))

    def test_rendering_reads_no_live_services_or_models_and_does_not_mutate_state(self):
        review = sample_review("PR")
        before = deepcopy((review.template_snapshot, review.answers, review.progress_snapshot, review.signature_requirements))
        with patch("learner_api.review_progress_snapshot.build_progress_snapshot", side_effect=AssertionError("Live progress")), \
             patch("requests.sessions.Session.request", side_effect=AssertionError("Network call")), \
             patch("coach_api.models.MigratedReviewTemplate.objects.get", side_effect=AssertionError("Master lookup")):
            first, second = document(review), document(review)
        self.assertEqual(before, (review.template_snapshot, review.answers, review.progress_snapshot, review.signature_requirements))
        self.assertEqual([p.get_text("dict") for p in first], [p.get_text("dict") for p in second])
        self.assertEqual([p.get_pixmap().samples for p in first], [p.get_pixmap().samples for p in second])

    def test_long_answers_and_summary_flow_without_overlapping_footer_or_signatures(self):
        for family in FIXTURES:
            with self.subTest(family=family):
                review = sample_review(family)
                review.answers["long"] = "\n".join(f"Reflection line {i:02}: practice and next steps." for i in range(85))
                review.answers["summary"] = "\n".join(f"Summary line {i:02}: agreed actions and ownership." for i in range(80))
                pdf = document(review)
                text = text_of(pdf)
                for label, count in (("Reflection", 85), ("Summary", 80)):
                    for index in range(count):
                        self.assertEqual(text.count(f"{label} line {index:02}:"), 1)
                self.assertGreaterEqual(len(pdf), 6)
                for page in pdf:
                    body_spans = [s for s in spans(page) if s["text"] != "Review" and not s["text"].startswith("Page ") and s["text"] != PROVENANCE]
                    for span in body_spans:
                        x0, y0, x1, y1 = span["bbox"]
                        self.assertGreaterEqual(x0, 55)
                        self.assertLessEqual(x1, page.rect.width - 55)
                        self.assertGreaterEqual(y0, 85)
                        self.assertLessEqual(y1, page.rect.height - 42)
                    # Font metric boxes include unused ascender/descender
                    # space; Native's 9pt font has 11pt baseline spacing.
                    # Check actual answer-line origins instead of treating
                    # overlapping font metric boxes as overlapping ink.
                    answer_lines = [s for s in body_spans if s["text"].startswith(("Reflection line", "Summary line"))]
                    for left, right in zip(answer_lines, answer_lines[1:]):
                        self.assertGreaterEqual(right["origin"][1] - left["origin"][1], 10.99)
                    if "Name: Sample coach" in page.get_text():
                        self.assertNotIn("Summary line", page.get_text())
                    for name in ("coach", "learner", "employer"):
                        if f"Name: Sample {name}" in page.get_text():
                            self.assertIn("04/10/2026 15:30 (Europe/London)", page.get_text())

    def test_incomplete_review_or_missing_required_signature_still_refused(self):
        review = sample_review("PR")
        review.migrated_signatures.all.return_value.pop()
        with self.assertRaisesRegex(ValueError, "Required signatures"):
            build_pdf(review, **CONTEXT)
        review.status = "awaiting-signature"
        with self.assertRaisesRegex(ValueError, "completed"):
            build_pdf(review, **CONTEXT)

    def test_long_paragraph_and_unbroken_word_wrap_inside_answer_cell(self):
        review = sample_review()
        review.answers["long"] = ("Practice reflection with agreed next steps. " * 75) + "LAST_PARAGRAPH_WORD"
        review.answers["summary"] = ("x" * 1800) + "ENDTOKEN"
        pdf = document(review)
        text = text_of(pdf)
        self.assertEqual(text.count("LAST_PARAGRAPH_WORD"), 1)
        self.assertEqual(text.count("ENDTOKEN"), 1)
        lines = [span for page in pdf for span in spans(page)
                 if "Practice reflection" in span["text"] or span["text"].startswith("xxxx")]
        self.assertGreater(len(lines), 20)
        for span in lines:
            self.assertGreaterEqual(span["bbox"][0], 63)
            self.assertLessEqual(span["bbox"][2], 779)

    def test_download_filenames_follow_native_prefix_and_sanitize_identifier(self):
        for family in FIXTURES:
            review = sample_review(family)
            review.pk = '42/"\r\nunsafe'
            response = stored_pdf_response(review, SimpleNamespace(pdf_bytes=b"saved"))
            prefix = "Monthly-Coaching-Meeting" if family == "MCM" else "Progress-Review"
            self.assertEqual(response["Content-Disposition"], f'attachment; filename="{prefix}-42unsafe.pdf"')
            self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_existing_migrated_signature_size_limit_is_preserved(self):
        buffer = BytesIO()
        Image.new("1", (4000, 2001), 0).save(buffer, format="PNG")
        signature = "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()
        validate_signature_image(signature)
        review = sample_review()
        review.migrated_signatures.all.return_value[0].signature = signature
        pdf = document(review)
        page = next(page for page in pdf if "Name: Sample coach" in page.get_text())
        image = next(item for item in page.get_images() if item[2:4] == (4000, 2001))
        rectangle = page.get_image_rects(image[0])[0]
        self.assertAlmostEqual(rectangle.width / rectangle.height, 4000 / 2001, places=4)


class MigratedPdfStoredDocumentTests(TestCase):
    def setUp(self):
        sample = sample_review("PR")
        self.review = ImportedReviewInstance.objects.create(
            event_key=sample.event_key, owner_email=sample.owner_email, learner_id=sample.learner_id,
            source_review_id=sample.source_review_id, template_snapshot=sample.template_snapshot,
            answers=sample.answers, progress_snapshot=sample.progress_snapshot,
            signature_requirements=sample.signature_requirements, status="completed", completed_at=AT,
        )
        for signature in sample.migrated_signatures.all():
            MigratedReviewSignature.objects.create(overlay=self.review, signer_account_id=1, **vars(signature))

    def test_first_generation_stores_pdf_and_hash_then_reuses_it(self):
        document = ensure_document(self.review, **CONTEXT)
        self.assertTrue(bytes(document.pdf_bytes).startswith(b"%PDF"))
        self.assertEqual(document.sha256, hashlib.sha256(bytes(document.pdf_bytes)).hexdigest())
        self.review.answers["short"] = "Later in-memory change cannot rewrite the document"
        with patch("coach_api.migrated_completion.build_pdf", side_effect=AssertionError("Regeneration")):
            again = ensure_document(self.review, **CONTEXT)
        self.assertEqual(again.pk, document.pk)
        self.assertEqual(bytes(again.pdf_bytes), bytes(document.pdf_bytes))
        self.assertEqual(MigratedReviewDocument.objects.count(), 1)

    def test_two_downloads_reuse_generated_bytes_for_coach_and_both_parties(self):
        from .review_pdf import coach_mcm_pdf

        saved = ensure_document(self.review, **CONTEXT)
        original = bytes(saved.pdf_bytes)
        definition = {"migratedForm": True, "pdf": {"available": True}}
        with patch("coach_api.migrated_completion.build_pdf", side_effect=AssertionError("Regeneration")), \
             patch.object(endpoints, "ensure_document", side_effect=AssertionError("Download generated")), \
             patch("coach_api.views._imported_review_definition", return_value=definition), \
             patch("coach_api.auth.authenticated_coach_email", return_value=self.review.owner_email), \
             patch.object(endpoints, "authenticated_coach_email", return_value=self.review.owner_email), \
             patch("learner_api.aptem_review_pdf.original_review_pdf", side_effect=AssertionError("Historical route")):
            for attempt in range(2):
                coach = unwrap(coach_mcm_pdf)(RequestFactory().get("/"), self.review.event_key)
                self.assertEqual(coach.status_code, 200)
                self.assertEqual(coach.content, original)
                for role in ("learner", "employer"):
                    with self.subTest(role=role, attempt=attempt), \
                         patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                         patch.object(endpoints, "_party_overlay", return_value=self.review):
                        response = endpoints.migrated_review_party_pdf(RequestFactory().get("/"), self.review.event_key)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response.content, original)
                        self.assertEqual(hashlib.sha256(response.content).hexdigest(), saved.sha256)
        self.assertEqual(list(MigratedReviewDocument.objects.values_list("pk", flat=True)), [saved.pk])
        saved.refresh_from_db()
        self.assertEqual(bytes(saved.pdf_bytes), original)
        self.assertEqual(saved.sha256, hashlib.sha256(original).hexdigest())

    def test_pre_completion_cannot_download_even_if_a_document_and_all_signatures_exist(self):
        from .review_pdf import coach_mcm_pdf

        saved = ensure_document(self.review, **CONTEXT)
        with patch("coach_api.views._imported_review_definition", return_value={"migratedForm": True, "pdf": {"available": True}}), \
             patch("coach_api.auth.authenticated_coach_email", return_value=self.review.owner_email), \
             patch.object(endpoints, "authenticated_coach_email", return_value=self.review.owner_email), \
             patch.object(endpoints, "_coach_review", return_value=(self.review.owner_email, {
                 "instance": {"id": self.review.event_key, "learnerId": self.review.learner_id},
                 "historicalReview": {"id": str(self.review.source_review_id)},
             })), \
             patch.object(endpoints, "ensure_document", side_effect=AssertionError("Download generated")):
            for status in ("not-scheduled", "scheduled", "in-progress", "awaiting-signature"):
                self.review.status = status
                self.review.save(update_fields=["status"])
                with self.subTest(status=status):
                    response = unwrap(coach_mcm_pdf)(RequestFactory().get("/"), self.review.event_key)
                    self.assertEqual(response.status_code, 409)
                    response = unwrap(endpoints.migrated_review_generate_pdf)(RequestFactory().post("/"), self.review.event_key)
                    self.assertEqual(response.status_code, 409)
                    for role in ("learner", "employer"):
                        with patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                             patch.object(endpoints, "_party_overlay", return_value=self.review):
                            response = endpoints.migrated_review_party_pdf(RequestFactory().get("/"), self.review.event_key)
                            self.assertEqual(response.status_code, 404)
        saved.refresh_from_db()
        self.assertEqual(saved.sha256, hashlib.sha256(bytes(saved.pdf_bytes)).hexdigest())

    def test_generation_failure_keeps_completion_and_explicit_retry_is_idempotent(self):
        definition = {"migratedForm": True, "instance": {"id": self.review.event_key, "learnerId": self.review.learner_id},
                      "historicalReview": {"id": str(self.review.source_review_id)}}
        with patch.object(endpoints, "_coach_review", return_value=(self.review.owner_email, definition)), \
             patch.object(endpoints, "_pdf_context", return_value=CONTEXT), \
             patch("coach_api.migrated_completion.build_pdf", side_effect=[RuntimeError("Synthetic render failure"), b"%PDF-retry"]) as render:
            def post():
                return unwrap(endpoints.migrated_review_generate_pdf)(RequestFactory().post("/"), self.review.event_key)

            self.assertEqual(post().status_code, 503)
            self.review.refresh_from_db()
            self.assertEqual(self.review.status, "completed")
            self.assertEqual(self.review.completed_at, AT)
            self.assertFalse(MigratedReviewDocument.objects.exists())
            first, second = post(), post()
            self.assertEqual((first.status_code, second.status_code), (200, 200))
            self.assertEqual(json.loads(first.content)["documentId"], json.loads(second.content)["documentId"])
            self.assertEqual(render.call_count, 2)  # One failed render, one successful render.
        self.assertEqual(MigratedReviewDocument.objects.count(), 1)
        saved = MigratedReviewDocument.objects.get(overlay=self.review)
        self.assertEqual(bytes(saved.pdf_bytes), b"%PDF-retry")
        self.assertEqual(saved.sha256, hashlib.sha256(b"%PDF-retry").hexdigest())

    def test_completed_party_download_without_document_returns_clear_conflict(self):
        for role in ("learner", "employer"):
            with self.subTest(role=role), \
                 patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                 patch.object(endpoints, "_party_overlay", return_value=self.review), \
                 patch.object(endpoints, "ensure_document", side_effect=AssertionError("Download generated")):
                response = endpoints.migrated_review_party_pdf(RequestFactory().get("/"), self.review.event_key)
                self.assertEqual(response.status_code, 409)
                self.assertEqual(json.loads(response.content)["detail"], "The LMS PDF has not been generated yet.")
        self.assertFalse(MigratedReviewDocument.objects.exists())

    def test_admin_view_as_can_read_the_selected_coachs_stored_document(self):
        from .review_pdf import coach_mcm_pdf

        saved = ensure_document(self.review, **CONTEXT)
        account = SimpleNamespace(role="admin", subject_type="staff", subject_id=1)
        admin = SimpleNamespace(id=1, access="super-admin", email="admin@example.invalid", username="Admin")
        coach = SimpleNamespace(id=2, email=self.review.owner_email)
        with patch("login.permissions.authenticate_request", return_value=account), \
             patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"})), \
             patch("coach_api.auth.StaffUser.objects.filter") as staff_rows, \
             patch("coach_api.auth._staff_access", return_value="super-admin"), \
             patch("coach_api.auth._find_coach_staff", return_value=coach), \
             patch("coach_api.views._imported_review_definition", return_value={"migratedForm": True, "pdf": {"available": True}}), \
             patch.object(endpoints, "ensure_document", side_effect=AssertionError("Read-only download generated")):
            staff_rows.return_value.only.return_value.first.return_value = admin
            request = RequestFactory().get("/?viewAsCoach=" + self.review.owner_email)
            request.login_account = account
            response = coach_mcm_pdf(request, self.review.event_key)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.content, bytes(saved.pdf_bytes))

    def test_old_pdf_is_unchanged_for_coach_learner_and_employer_downloads(self):
        original = b"%PDF-original-portrait-migrated-document"
        saved = MigratedReviewDocument.objects.create(overlay=self.review, pdf_bytes=original,
                                                     sha256=hashlib.sha256(original).hexdigest())
        factory = RequestFactory()
        with patch("coach_api.migrated_completion.build_pdf", side_effect=AssertionError("Regeneration")):
            self.assertEqual(ensure_document(self.review).pk, saved.pk)
            with patch.object(endpoints, "authenticated_coach_email", return_value=self.review.owner_email):
                coach = endpoints.migrated_review_pdf_response(factory.get("/"), self.review.event_key, {})
            for role in ("learner", "employer"):
                with patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                     patch.object(endpoints, "_party_overlay", return_value=self.review):
                    response = endpoints.migrated_review_party_pdf(factory.get("/"), self.review.event_key)
                self.assertEqual(response.content, original)
                self.assertEqual(response["Content-Disposition"], coach["Content-Disposition"])
        self.assertEqual(coach.content, original)
        saved.refresh_from_db()
        self.assertEqual(bytes(saved.pdf_bytes), original)
        self.assertEqual(saved.sha256, hashlib.sha256(original).hexdigest())

    def test_missing_document_and_wrong_coach_remain_refused(self):
        request = RequestFactory().get("/")
        for owner, status in ((self.review.owner_email, 409), ("other@example.invalid", 409)):
            with patch.object(endpoints, "authenticated_coach_email", return_value=owner):
                self.assertEqual(endpoints.migrated_review_pdf_response(request, self.review.event_key, {}).status_code, status)

    def test_party_download_still_requires_authentication_ownership_and_completion(self):
        request = RequestFactory().get("/")
        with patch.object(endpoints, "authenticate_request", return_value=None):
            self.assertEqual(endpoints.migrated_review_party_pdf(request, self.review.event_key).status_code, 401)
        for role in ("learner", "employer"):
            for overlay in (None, SimpleNamespace(status="awaiting-signature")):
                with patch.object(endpoints, "authenticate_request", return_value=SimpleNamespace(role=role)), \
                     patch.object(endpoints, "_party_overlay", return_value=overlay):
                    self.assertEqual(endpoints.migrated_review_party_pdf(request, self.review.event_key).status_code, 404)


class MigratedPdfAccessTests(SimpleTestCase):
    def test_pdf_review_date_uses_saved_booking_date_or_source_target(self):
        review = sample_review()
        definition = {"instance": {"targetDate": "2026-10-05"}, "historicalReview": {"type": "Monthly Coaching Meeting"}}
        with patch.object(endpoints.CoachCalendarEvent.objects, "filter") as calendars:
            for calendar, expected in ((None, "2026-10-05"), (SimpleNamespace(scheduled_date=None), "2026-10-05"),
                                       (SimpleNamespace(scheduled_date=AT.date()), AT.date())):
                calendars.return_value.first.return_value = calendar
                self.assertEqual(endpoints._pdf_context(review, definition)["scheduled_date"], expected)

    def test_pdf_context_keeps_source_identity_gates_without_loading_form_services(self):
        from . import views

        review = sample_review("PR_SKILLS_RADAR")
        profile = SimpleNamespace(id=17, aptem_id=101, _caseload_source=SimpleNamespace(aptem_id=101),
                                  programme_id="P-42", programme="Sample programme", username="Sample learner",
                                  email="learner@example.invalid")
        columns = ["id", "learner_id", "aptem_review_id", "review_name", "review_type",
                   "reviewer_name", "learner_name", "planned_scheduled_date", "completed_date",
                   "status", "review_data", "extraction_status", "last_error"]
        row = [83, 17, "SAMPLE", "Progress Review (+ Skills Radar)", "Progress Review (+ Skills Radar)",
               "Sample coach", "Sample learner", None, None, "Scheduled", {"sections": []}, "partial", None]
        with patch.object(views, "fetch_caseload_dashboard_profiles", return_value=[profile]), \
             patch.object(views, "connections") as connections, \
             patch.object(views, "_sections_by_review", return_value={}), \
             patch.object(views.ImportedReviewInstance.objects, "filter") as overlays, \
             patch.object(views, "resolve_migrated_template", side_effect=AssertionError("Master resolution")), \
             patch.object(views, "_imported_review_progress_snapshot", side_effect=AssertionError("Live progress")), \
             patch.object(views.curriculum_review_instances, "progress_review_rag_history", side_effect=AssertionError("RAG lookup")), \
             patch("requests.sessions.Session.request", side_effect=AssertionError("Network call")):
            cursor = connections["default"].cursor.return_value.__enter__.return_value
            cursor.description = [(column,) for column in columns]
            cursor.fetchall.return_value = [row]
            overlays.return_value.first.return_value = review
            result = views._imported_review_definition(review.owner_email, review.event_key, pdf_only=True)
            self.assertTrue(result["migratedForm"])
            self.assertEqual(result["learnerName"], "Sample learner")
            overlays.assert_called_with(owner_email__iexact=review.owner_email, event_key=review.event_key)
            for attribute, replacement in (("learner_id", 99), ("source_review_id", 99)):
                original = getattr(review, attribute)
                setattr(review, attribute, replacement)
                self.assertIsNone(views._imported_review_definition(review.owner_email, review.event_key, pdf_only=True))
                setattr(review, attribute, original)
            row[9] = "Completed"
            self.assertFalse(views._imported_review_definition(review.owner_email, review.event_key, pdf_only=True)["migratedForm"])

    def test_generate_route_requests_only_authorized_pdf_context(self):
        request = RequestFactory().post("/")
        with patch.object(endpoints, "_coach_review", return_value=("coach@example.invalid", None)) as resolve:
            response = unwrap(endpoints.migrated_review_generate_pdf)(request, "imported-review:SAMPLE")
        self.assertEqual(response.status_code, 404)
        resolve.assert_called_once_with(request, "imported-review:SAMPLE", pdf_only=True)

    def test_real_party_gate_rejects_other_learner_employer_and_staff(self):
        review = sample_review("PR")
        profile = SimpleNamespace(enrolment_id=71)
        learner = SimpleNamespace(pk=71, employer_id=81)
        with patch.object(endpoints.ImportedReviewInstance.objects, "filter") as overlays, \
             patch.object(endpoints.LearnerProfile.objects, "filter") as profiles, \
             patch.object(endpoints.EnrolmentUser.all_learners, "filter") as learners, \
             patch.object(endpoints, "connections") as connections:
            overlays.return_value.first.return_value = review
            profiles.return_value.first.return_value = profile
            learners.return_value.first.return_value = learner
            cursor = connections["default"].cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = ("Scheduled", None)
            for role, allowed in (("learner", 71), ("employer", 81)):
                self.assertIs(endpoints._party_overlay(review.event_key, SimpleNamespace(role=role, subject_id=allowed)), review)
                self.assertIsNone(endpoints._party_overlay(review.event_key, SimpleNamespace(role=role, subject_id=999)))
            self.assertIsNone(endpoints._party_overlay(review.event_key, SimpleNamespace(role="staff", subject_id=71)))
            cursor.fetchone.return_value = ("Completed", AT)
            self.assertIsNone(endpoints._party_overlay(review.event_key, SimpleNamespace(role="learner", subject_id=71)))

    def test_admin_view_as_cannot_generate_a_document(self):
        account = SimpleNamespace(role="admin", subject_type="staff", subject_id=1)
        staff = SimpleNamespace(id=1, access="super-admin", email="admin@example.invalid", username="Admin")
        with patch("login.permissions.authenticate_request", return_value=account), \
             patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"})), \
             patch("coach_api.auth.StaffUser.objects.filter") as staff_rows, \
             patch("coach_api.auth._staff_access", return_value="super-admin"), \
             patch.object(endpoints, "_coach_review", side_effect=AssertionError("Authorization bypass")):
            staff_rows.return_value.only.return_value.first.return_value = staff
            request = RequestFactory().post("/?viewAsCoach=coach@example.invalid")
            request.login_account = account
            response = endpoints.migrated_review_generate_pdf(request, "imported-review:SAMPLE")
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "coach_view_as_read_only")
