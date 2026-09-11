import io

from django.test import SimpleTestCase
from pptx import Presentation

from .pptx_generator import generate_progress_review_pptx
from .review_pack import NOT_AVAILABLE


def _sample_pack(**overrides) -> dict:
    pack = {
        "learner": {
            "learner_id": "42", "full_name": "Jordan Example", "email": "jordan@example.com",
            "programme": "Marketing Executive Level 4", "apprenticeship_standard": "Marketing Executive Level 4",
            "employer": "Acme Ltd", "role": NOT_AVAILABLE, "manager_name": "Sam Manager",
            "cohort": "Cohort A", "group": "Group 1", "coach": "Coach Casey",
            "programme_start_date": "2025-01-01", "planned_end_date": "2026-06-30", "active_status": True,
        },
        "review": {
            "review_id": "run-1", "review_number": 2, "review_date": "2026-06-15",
            "review_period_start": "2026-03-24", "review_period_end": "2026-06-15",
            "action_period_start": "2026-06-16", "action_period_end": "2026-09-07",
            "generated_by": "coach@kbc.example", "generated_at": "2026-06-15T10:00:00+00:00",
        },
        "attendance": {
            "attendance_percentage": 92, "monthly_summary": [{"month": "May 2026", "sessions": 4, "present": 4, "absent": 0, "late": 0}],
            "missed_sessions": 1, "catch_ups_completed": 1, "catch_ups_needed": 0, "engagement_notes": "Attendance is strong.",
        },
        "progress": {
            "current_programme_progress_percentage": 55, "target_progress_percentage": 60,
            "progress_variance": -5, "next_module": "Module 3: Digital Campaigns",
            "overdue_lms_activities": NOT_AVAILABLE, "action_notes": "Agree the next module with the coach.",
        },
        "otj": {
            "completed_otj_hours": 220.0, "required_otj_hours_to_date": 240.0, "variance": -20.0,
            "forecast_hours": 410.0, "minimum_required_hours": 400.0, "planned_hours": 450.0,
            "risk_status": "Need attention", "duplicate_or_weak_otj_warning": NOT_AVAILABLE,
        },
        "lms_modules": [
            {"module": "Module 1", "completion_percentage": 100, "components_done": 5, "components_total": 5},
            {"module": "Module 2", "completion_percentage": 60, "components_done": 3, "components_total": 5},
        ],
        "evidence": [
            {
                "evidence_title": "Campaign brief.pdf", "evidence_date": "2026-05-01", "evidence_type": "application/pdf",
                "evidence_status": "approved", "evidence_summary": "Wrote a campaign brief for a client launch.",
                "evidence_file_link": NOT_AVAILABLE, "image_or_screenshot_link": NOT_AVAILABLE,
                "manager_verification_status": "accepted", "ai_classification_summary": NOT_AVAILABLE,
                "ksb_mappings": ["K1", "S2"], "evidence_strength": "strong",
            },
        ],
        "assignments": [],
        "workplace_activities": [],
        "ksbs": {
            "knowledge_evidenced": [{"code": "K1", "description": "Understands marketing principles.", "coverage_percentage": 100}],
            "skills_evidenced": [],
            "behaviours_evidenced": [],
            "priority_next": [
                {"code": "S2", "description": "Applies data analysis.", "coverage_percentage": 40,
                 "accepted_count": 1, "how_to_evidence": "Capture a live workplace task.", "evidence_to_retain": "Brief and outcome."},
            ],
        },
        "epa": {
            "current_readiness": "62%", "multiple_choice_test_confidence": "70% average across 3 quiz attempt(s) to date.",
            "project_showcase_confidence": NOT_AVAILABLE, "professional_discussion_confidence": NOT_AVAILABLE,
            "portfolio_risks": ["No outstanding portfolio issues identified."],
            "evidence_admin_risks": ["1 KSB(s) below full coverage — see priority KSBs for detail."],
        },
        "actions": [
            {"title": "Close evidence admin", "detail": "Review pending uploads.", "owner": "Coach and learner", "due_by": "2026-06-16"},
        ],
        "manager_questions": [
            "What improvements have you seen in confidence, independence, or professional judgement?",
        ],
        "source_warnings": [],
    }
    pack.update(overrides)
    return pack


def _slide_texts(slide) -> str:
    parts = []
    for shape in slide.shapes:
        if shape.has_text_frame:
            parts.append(shape.text_frame.text)
    return "\n".join(parts)


class GenerateProgressReviewPptxTests(SimpleTestCase):
    def test_builds_exactly_eighteen_slides(self):
        data = generate_progress_review_pptx(_sample_pack(), fetch_image=lambda url: None)
        prs = Presentation(io.BytesIO(data))
        self.assertEqual(len(prs.slides), 18)

    def test_title_slide_carries_the_learner_and_programme(self):
        data = generate_progress_review_pptx(_sample_pack(), fetch_image=lambda url: None)
        prs = Presentation(io.BytesIO(data))
        text = _slide_texts(prs.slides[0])
        self.assertIn("Jordan Example", text)
        self.assertIn("Marketing Executive Level 4", text)
        self.assertIn("Acme Ltd", text)

    def test_missing_evidence_image_uses_a_placeholder_not_a_crash(self):
        pack = _sample_pack()
        pack["evidence"][0]["image_or_screenshot_link"] = "https://example.invalid/evidence.png"
        data = generate_progress_review_pptx(pack, fetch_image=lambda url: None)
        prs = Presentation(io.BytesIO(data))
        # Evidence detail slides are 8, 9, 10 (0-indexed 7, 8, 9).
        text = _slide_texts(prs.slides[7])
        self.assertIn("No evidence image available", text)

    def test_empty_pack_sections_render_without_crashing(self):
        pack = _sample_pack(
            evidence=[], assignments=[], workplace_activities=[],
            ksbs={"knowledge_evidenced": [], "skills_evidenced": [], "behaviours_evidenced": [], "priority_next": []},
            actions=[], manager_questions=[],
        )
        data = generate_progress_review_pptx(pack, fetch_image=lambda url: None)
        prs = Presentation(io.BytesIO(data))
        self.assertEqual(len(prs.slides), 18)
        # The evidence-detail fallback slide must say so rather than show nothing.
        text = _slide_texts(prs.slides[7])
        self.assertIn("No qualifying evidence", text)

    def test_not_available_values_are_shown_literally_not_blanked(self):
        data = generate_progress_review_pptx(_sample_pack(), fetch_image=lambda url: None)
        prs = Presentation(io.BytesIO(data))
        text = _slide_texts(prs.slides[4])  # EPA slide references project showcase confidence
        self.assertIn(NOT_AVAILABLE, text)
