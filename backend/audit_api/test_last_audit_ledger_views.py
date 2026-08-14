from decimal import Decimal
from datetime import date

from django.test import SimpleTestCase

from .last_audit_ledger_views import (
    _activity_category,
    _activity_content_url,
    _activity_payload,
    _attendance_payload,
    _attendance_sheet_payload,
    _json_list,
    _parse_activity_ref,
    _quiz_attempt_payload,
    _session_key,
)
from .manual_ledger_views import _row_payload, _validate_new_row


class LastAuditLedgerMappingTests(SimpleTestCase):
    def test_ppt_mislabeled_as_video_is_not_returned_as_video(self):
        self.assertEqual(_activity_category({
            "activity_type": "video",
            "title": "P3-PPT-Root Cause Analysis and the 5 Whys",
        }), "reading+quiz")

    def test_regular_video_category_is_unchanged(self):
        self.assertEqual(_activity_category({
            "activity_type": "video",
            "title": "VID 3-Root Cause Analysis and the 5 Whys",
        }), "video")

    def test_existing_manual_lms_row_uses_corrected_ppt_category(self):
        payload = _row_payload({
            "id": 1,
            "aptem_id": 2,
            "learner_id": 3,
            "month": "2026-04",
            "category": "video",
            "source_ref": "la:118072:119856",
            "group_id": 118072,
            "activity_id": 119856,
            "title": "P2-PPT-Using Personas and Insight Gap Analysis",
            "activity_date": date(2026, 4, 22),
            "activity_time": None,
            "planned_hours": 0,
            "actual_hours": 0,
            "timestamp_label": "",
            "completion_note": None,
            "accepted": True,
            "created_by": None,
            "updated_by": None,
            "updated_at": None,
        })
        self.assertEqual(payload["category"], "reading+quiz")

    def test_new_manual_lms_ppt_row_cannot_be_saved_as_video(self):
        row = _validate_new_row({
            "month": "2026-04",
            "category": "video",
            "source_ref": "la:118072:119856",
            "title": "P2-PPT-Using Personas and Insight Gap Analysis",
            "actual_hours": 0,
        })
        self.assertEqual(row["category"], "reading+quiz")

    def test_json_months_are_normalized_from_database_text(self):
        self.assertEqual(_json_list('[{"month":"2026-08"}]'), [{"month": "2026-08"}])

    def test_pdf_office_wrapper_is_unwrapped_for_browser_preview(self):
        source = "https://files.example.test/material/view?id=12&token=abc"
        wrapped = (
            "https://view.officeapps.live.com/op/embed.aspx?src="
            "https%3A%2F%2Ffiles.example.test%2Fmaterial%2Fview%3Fid%3D12%26token%3Dabc"
        )
        self.assertEqual(_activity_content_url(None, wrapped, "pdf"), source)
        self.assertEqual(_activity_content_url(None, wrapped, "docx"), wrapped)

    def test_reading_only_activity_is_not_treated_as_a_quiz(self):
        payload = _quiz_attempt_payload({
            "activity_id": 126339,
            "aptem_id": 4609,
            "title": "Apprentice Charter",
            "quiz_id": None,
            "quiz_questions": None,
            "quiz_attempted": False,
            "quiz_attempt_number": 0,
            "quiz_answers": "[]",
        }, "la:101477:126339")
        self.assertFalse(payload["is_quiz"])
        self.assertEqual(payload["state"], "not_quiz")
        self.assertIsNone(payload["attempt"])

    def test_quiz_questions_are_merged_with_the_learner_answers(self):
        payload = _quiz_attempt_payload({
            "activity_id": 129118,
            "aptem_id": 15866,
            "title": "Campaign economics",
            "quiz_id": 129118,
            "quiz_body": "<p>Quiz description</p>",
            "quiz_questions": '''[{"question_id": 7, "question_body": "Pick one", "question_type": "single_choice", "options": [{"option_body": "A", "option_order": 1}, {"option_body": "B", "option_order": 2}]}]''',
            "quiz_attempted": True,
            "quiz_passed": True,
            "quiz_score": Decimal("100"),
            "quiz_maximum_score": Decimal("100"),
            "quiz_attempt_number": 1,
            "quiz_answers": '''[{"question_id": 7, "is_correct": true, "correct_answer": ["B"], "learner_answer": ["B"]}]''',
        }, "la:129004:129118")
        self.assertEqual(payload["state"], "attempted")
        self.assertEqual(payload["attempt"]["status"], "passed")
        question = payload["attempt"]["quiz_body"]["questions"][0]
        self.assertTrue(question["is_correct"])
        self.assertFalse(question["answer_options"][0]["is_selected"])
        self.assertTrue(question["answer_options"][1]["is_selected"])
        self.assertTrue(question["answer_options"][1]["is_correct"])

    def test_unattempted_quiz_has_an_explicit_state(self):
        payload = _quiz_attempt_payload({
            "activity_id": 89859,
            "aptem_id": 4609,
            "title": "Safeguarding quiz",
            "quiz_id": 89859,
            "quiz_questions": '[{"question_id": 1}]',
            "quiz_attempted": False,
            "quiz_attempt_number": 0,
            "quiz_answers": "[]",
        }, "la:89537:89859")
        self.assertTrue(payload["is_quiz"])
        self.assertEqual(payload["state"], "not_attempted")
        self.assertIsNone(payload["attempt"])
        self.assertNotIn("quiz_questions", payload)
        self.assertNotIn("quiz_answers", payload)
        self.assertNotIn("quiz_body", payload)

    def _row(self, **overrides):
        row = {
            "group_id": 10,
            "group_name": "Programme A",
            "activity_id": 20,
            "activity_type": "Reading+Quiz",
            "learner_id": 30,
            "aptem_id": 40,
            "learner_name": "Test Learner",
            "title": "Week 1 reading",
            "activity_date": date(2024, 9, 14),
            "status": "reading_viewed",
            "video_iframe_url": None,
            "reading_iframe_url": "https://example.test/reading",
            "reading_type": "pdf",
            "quiz_id": 21,
            "quiz_questions": '[{"question_id": 22}]',
            "configured_duration_min": None,
            "video_started": None,
            "video_completed": None,
            "reading_viewed": True,
            "quiz_attempted": False,
            "quiz_passed": False,
            "quiz_score": None,
            "quiz_maximum_score": None,
            "mapped_seconds": None,
            "mapped_hours": None,
        }
        row.update(overrides)
        return row

    def test_composite_activity_reference_round_trips(self):
        self.assertEqual(_parse_activity_ref("la:10:20"), (10, 20))
        self.assertEqual(_parse_activity_ref("20"), (None, 20))

    def test_unmapped_hours_are_explicitly_unavailable(self):
        payload = _activity_payload(self._row())
        self.assertEqual(payload["activity_id"], "la:10:20")
        self.assertEqual(payload["category"], "reading+quiz")
        self.assertFalse(payload["hours_mapped"])
        self.assertIsNone(payload["mapped_seconds"])
        self.assertEqual(payload["actual"], 0.0)
        self.assertEqual(payload["date"], "2024-09-14")
        self.assertEqual(payload["month"], "2024-09")
        self.assertEqual(payload["month_label"], "September 2024")

    def test_seconds_are_canonical_and_converted_only_for_output(self):
        payload = _activity_payload(
            self._row(mapped_seconds=5400, mapped_hours=Decimal("99.0"))
        )
        self.assertTrue(payload["hours_mapped"])
        self.assertEqual(payload["mapped_seconds"], 5400)
        self.assertEqual(payload["actual"], 1.5)

    def test_mapped_hours_is_supported_for_pre_seconds_rows(self):
        payload = _activity_payload(
            self._row(mapped_seconds=None, mapped_hours=Decimal("1.25"))
        )
        self.assertEqual(payload["mapped_seconds"], 4500)
        self.assertEqual(payload["actual"], 1.25)

    def test_quiz_incomplete_does_not_erase_the_activity(self):
        payload = _activity_payload(
            self._row(status="reading_viewed", quiz_attempted=False, quiz_passed=False)
        )
        self.assertEqual(payload["status"], "reading_viewed")
        self.assertFalse(payload["completed"])
        self.assertTrue(payload["reading_viewed"])

    def test_reading_only_completion_uses_aptem_reading_viewed(self):
        payload = _activity_payload(self._row(
            quiz_id=None,
            quiz_questions=None,
            status="reading_viewed",
            reading_viewed=True,
        ))
        self.assertEqual(payload["category"], "reading")
        self.assertTrue(payload["has_reading"])
        self.assertFalse(payload["has_quiz"])
        self.assertTrue(payload["completed"])

    def test_attendance_uses_lecture_name_and_source_date(self):
        payload = _attendance_payload({
            "source_key": "40_2026-08-05_group",
            "learner_id": 30,
            "aptem_id": 40,
            "learner_name": "Test Learner",
            "attendance_date": date(2026, 8, 5),
            "attendance_value": 1,
            "module": "Group A",
            "activity_hours": Decimal("2.5"),
            "attendance_status": "Present",
            "lecture_name": "L6: Market Competitiveness",
        })
        self.assertEqual(payload["activity_id"], "att:40_2026-08-05_group")
        self.assertEqual(payload["activity"], "L6: Market Competitiveness")
        self.assertEqual(payload["activity_subtitle"], "Group A")
        self.assertEqual(payload["date"], "2026-08-05")
        self.assertEqual(payload["month"], "2026-08")
        self.assertEqual(payload["category"], "attendance")
        self.assertEqual(payload["actual"], 2.5)
        self.assertTrue(payload["completed"])

    def test_session_key_drops_the_leading_learner_id(self):
        # Both the raw source_key and its "att:" ref reduce to the same session.
        self.assertEqual(
            _session_key("40_2026-08-05_group_a"), "2026-08-05_group_a"
        )
        self.assertEqual(
            _session_key("att:1763_2025-05-02_ray_pcp"), "2025-05-02_ray_pcp"
        )
        self.assertIsNone(_session_key("no-underscore"))
        self.assertIsNone(_session_key(None))

    def _attendance_row(self, aptem_id, value, name, **overrides):
        row = {
            "source_key": f"{aptem_id}_2026-08-05_group_a",
            "learner_id": aptem_id + 1000,
            "aptem_id": aptem_id,
            "learner_name": name,
            "attendance_date": date(2026, 8, 5),
            "attendance_value": value,
            "module": "Group A",
            "activity_hours": Decimal("2.5") if value == 1 else Decimal("0"),
            "attendance_status": "Present" if value == 1 else "Absent",
            "lecture_name": "L6: Market Competitiveness",
        }
        row.update(overrides)
        return row

    def test_attendance_sheet_lists_attended_and_absent_learners(self):
        rows = [
            self._attendance_row(40, 1, "Ada Attended"),
            self._attendance_row(41, 1, "Ben Present"),
            self._attendance_row(42, 0, "Cara Absent"),
        ]
        payload = _attendance_sheet_payload(rows, "2026-08-05_group_a")
        self.assertEqual(payload["session"]["session_key"], "2026-08-05_group_a")
        self.assertEqual(payload["session"]["date"], "2026-08-05")
        self.assertEqual(payload["session"]["lecture_name"], "L6: Market Competitiveness")
        self.assertEqual(
            payload["counts"], {"assigned": 3, "attended": 2, "absent": 1}
        )
        self.assertEqual(payload["total"], 3)
        # The absent learner is present in the roster, flagged not-completed.
        absent = [item for item in payload["items"] if item["completed"] is False]
        self.assertEqual(len(absent), 1)
        self.assertEqual(absent[0]["learner_name"], "Cara Absent")
        self.assertEqual(absent[0]["timestamp_display"], "not attended")
