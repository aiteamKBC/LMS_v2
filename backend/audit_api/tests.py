import datetime
import json
from unittest.mock import patch

from django.test import SimpleTestCase

from .views import _activity_category, _assignment_source_rows, _build_audit_payload, _build_student_source_data, _enrich_assignment_items_with_evidence_details, _group_months, _normalize_assignment_item, _normalize_attendance_item, _signoff_row


class AptemLmsAuditPayloadTests(SimpleTestCase):
    def setUp(self):
        super().setUp()
        today = patch("audit_api.views._today", return_value=datetime.date(2026, 12, 31))
        today.start()
        self.addCleanup(today.stop)
        attendance = patch("audit_api.views._fetch_kbc_attendance_items", return_value=[])
        attendance.start()
        self.addCleanup(attendance.stop)

    def build_row(self, **overrides):
        row = {
            "Learner_ID": 3221,
            "Learner_name": "Andrew Raslan",
            "Programme_name": "Level 6 Project Controls Professional",
            "Completed_OTJH": 341,
            "LMS_Summary": "",
            "Quiz_summary": "",
            "LMS_modules_details": json.dumps({
                "items": [
                    {
                        "Course ID": 10,
                        "Module/Course": "Project Context",
                        "Course Status": "completed",
                        "Course Started At": "2026-03-01 09:00:00",
                        "Course Completed At": "2026-03-03 12:00:00",
                        "Progress (%)": 50,
                        "Total Tracked Time Seconds": 3600,
                        "Quiz Attempts Count": 2,
                        "Latest Quiz Score (%)": 80,
                        "Tutor Name": "Coach One",
                        "Completed Material Titles": "Lecture 1: Intro | P1: Project Context | Lecture 2: Scope | Lecture 3: Risk",
                    }
                ]
            }),
            "Aptem_components": {
                "components": [
                    {
                        "name": "March Attendance",
                        "type": "OnlineLearning",
                        "status": "Completed",
                        "hours": 2.5,
                        "planned_hours": 3,
                        "start_date": "2026-03-01",
                        "end_date": "2026-03-04",
                    }
                ]
            },
        }
        row.update(overrides)
        return row

    def test_valid_aptem_lms_payload_groups_by_month_and_week(self):
        payload = _build_audit_payload(self.build_row())

        self.assertEqual(payload["learner"]["id"], 3221)
        self.assertEqual(payload["summary"]["components_completed"], 1)
        self.assertEqual(payload["summary"]["components_total"], 1)
        self.assertEqual(payload["summary"]["lms_progress"], 50)
        self.assertEqual(payload["summary"]["tracked_seconds"], 3600)
        self.assertEqual(payload["summary"]["quiz_attempts"], 2)
        self.assertEqual(payload["months"][0]["month_key"], "2026-03")
        self.assertEqual(payload["months"][0]["weeks"][0]["aptem_items"][0]["activity_name"], "March Attendance")
        self.assertEqual(payload["months"][0]["weeks"][0]["lms_items"][0]["course_module"], "Project Context")

    def test_student_source_data_combines_aptem_programme_and_lms_structure(self):
        payload = _build_student_source_data(self.build_row())

        self.assertEqual(payload["schema_version"], "learner-source-data-v6")
        self.assertEqual(payload["programme"]["learner"]["id"], 3221)
        self.assertEqual(payload["programme"]["name"], "Level 6 Project Controls Professional")
        self.assertEqual(payload["programme"]["source"], "Aptem")
        self.assertEqual(payload["programme"]["modules"][0]["name"], "Project Context")
        self.assertEqual(payload["programme"]["modules"][0]["source"], "LMS")
        month = payload["programme"]["modules"][0]["months"][0]
        self.assertEqual(month["aptem_components"][0]["name"], "March Attendance")
        populated_weeks = [week for week in month["weeks"] if week["lectures_or_components"]]
        self.assertGreater(len(populated_weeks), 1)
        self.assertIn("Lecture 1: Intro", populated_weeks[0]["lectures_or_components"])
        self.assertIn("Lecture 3: Risk", populated_weeks[-1]["lectures_or_components"])

    def test_empty_aptem_json_and_invalid_lms_json_return_warnings(self):
        payload = _build_audit_payload(self.build_row(Aptem_components={"components": []}, LMS_modules_details="{not json"))

        warning_codes = {warning["code"] for warning in payload["warnings"]}
        self.assertIn("no_aptem_data", warning_codes)
        self.assertIn("invalid_json", warning_codes)
        self.assertFalse(payload["source_status"]["has_aptem_data"])
        self.assertFalse(payload["source_status"]["has_lms_data"])

    def test_undated_and_invalid_date_range_are_preserved(self):
        payload = _build_audit_payload(self.build_row(
            Aptem_components={
                "components": [
                    {
                        "name": "Bad Date Activity",
                        "type": "Assignment",
                        "status": "InProgress",
                        "hours": 1,
                        "planned_hours": 2,
                        "start_date": "2026-04-10",
                        "end_date": "2026-04-01",
                    },
                    {"name": "Undated Activity", "type": "Review", "status": "NotStarted"},
                ]
            },
            LMS_modules_details=json.dumps({"items": []}),
        ))

        warning_codes = {warning["code"] for warning in payload["warnings"]}
        self.assertIn("invalid_date_range", warning_codes)
        self.assertIn("missing_relevant_date", warning_codes)
        undated_month = next(month for month in payload["months"] if month["month_key"] == "undated")
        self.assertEqual(undated_month["undated_items"][0]["activity_name"], "Undated Activity")

    def test_planned_hour_totals_dedupe_matching_source_rows(self):
        payload = _build_audit_payload(self.build_row(
            Aptem_components={
                "components": [
                    {"id": "a1", "name": "Activity", "status": "Completed", "planned_hours": 2, "end_date": "2026-03-01"},
                    {"id": "a1", "name": "Activity", "status": "Completed", "planned_hours": 2, "end_date": "2026-03-01"},
                ]
            },
            LMS_modules_details=json.dumps({"items": []}),
        ))

        self.assertEqual(payload["summary"]["total_programme_planned_hours"], 2.0)
        self.assertEqual(payload["months"][0]["summary"]["planned_hours"], 2.0)

    def test_future_months_are_not_shown_in_audit_timeline(self):
        months = _group_months(
            [
                {"id": "past", "source": "Aptem", "activity_name": "Past Activity", "status": "Completed", "relevant_date": "2026-07-01"},
                {"id": "future", "source": "Aptem", "activity_name": "Future Activity", "status": "NotStarted", "relevant_date": "2027-06-15"},
            ],
            [],
            today=datetime.date(2026, 7, 29),
        )

        self.assertEqual([month["month_key"] for month in months], ["2026-07"])
        self.assertEqual(months[0]["weeks"][0]["aptem_items"][0]["activity_name"], "Past Activity")

    def test_live_session_category_only_uses_attendance_rows(self):
        present = _normalize_attendance_item({"ID": 1521, "date": "2026-05-01", "Attendance": 1, "module": "Live session"}, 0)
        absent = _normalize_attendance_item({"ID": 1521, "date": "2026-05-08", "Attendance": 0, "module": "Live session"}, 1)
        lms_session = {
            "source": "LMS",
            "component_type": "LMS component",
            "component_name": "Summary revision session",
            "course_module": "Marketing",
        }

        self.assertEqual(present["status"], "Present")
        self.assertEqual(absent["status"], "Absent")
        self.assertEqual(_activity_category(present), "live_session")
        self.assertEqual(_activity_category(absent), "live_session")
        self.assertNotEqual(_activity_category(lms_session), "live_session")

    def test_assignment_json_rows_keep_hours_and_evidence_details(self):
        source_rows = _assignment_source_rows({
            "learner_id": 3582,
            "assignments": json.dumps([
                {
                    "raw": {
                        "Id": 27517,
                        "Status": "Completed",
                        "DueDate": "2025-08-30T00:00:00+01:00",
                        "ActualHours": 3,
                        "PlannedHours": 8,
                        "ComponentName": "August- Marketing Impact - Introduction to Marketing (Coach Led Assignment)",
                        "ComponentType": "Assignment",
                    },
                    "evidence": [{"kind": "File", "name": "Assessment.docx", "status": "Accepted"}],
                    "actual_hours": 3,
                    "planned_hours": 8,
                    "component_id": 27517,
                    "component_name": "August- Marketing Impact - Introduction to Marketing (Coach Led Assignment)",
                    "component_type": "Assignment",
                }
            ]),
        })
        item = _normalize_assignment_item(source_rows[0], 0)

        self.assertEqual(item["source_id"], "27517")
        self.assertEqual(item["activity_name"], "August- Marketing Impact - Introduction to Marketing (Coach Led Assignment)")
        self.assertEqual(item["status"], "Completed")
        self.assertEqual(item["actual_hours"], 3)
        self.assertEqual(item["planned_hours"], 8)
        self.assertEqual(item["hours_variance"], -5)
        self.assertEqual(item["relevant_date"], "2025-08-30")
        self.assertEqual(item["raw"]["evidence"][0]["name"], "Assessment.docx")

    def test_assignment_report_blob_gets_internal_azure_url(self):
        source_rows = _assignment_source_rows({
            "learner_id": 3582,
            "assignments": json.dumps([{
                "raw": {"Id": 27517, "ComponentName": "Assignment", "PlannedHours": 8},
                "evidence": [{
                    "kind": "File",
                    "name": "Assessment.docx",
                    "report_blob": "July 2025- Level 4 Marketing Executive/Ella Pennells-3582/9101-AssessmentReport.pdf",
                }],
            }]),
        })

        blob_url = source_rows[0]["evidence"][0]["assessment_report_blob_url"]
        self.assertIn("/audit_api/blob/?container=evidence-approved&blob=", blob_url)
        self.assertIn("9101-AssessmentReport.pdf", blob_url)

    def test_assignment_evidence_is_enriched_with_coach_feedback(self):
        item = _normalize_assignment_item({
            "raw": {"Id": 27517, "ComponentName": "Assignment", "PlannedHours": 8},
            "evidence": [{"kind": "File", "name": "Assessment.docx", "evidence_id": 9101}],
        }, 0)

        _enrich_assignment_items_with_evidence_details("3582", [item], {
            "3582": {
                "9101": {
                    "evidence_id": 9101,
                    "feedbacks": [{"id": 7218, "author": "Esraa Yasser", "date": "2025-09-02T09:26:01", "message": "<p>Great work.</p>"}],
                    "report_blob": "July 2025- Level 4 Marketing Executive/Ella Pennells-3582/9101-AssessmentReport.pdf",
                }
            }
        })

        evidence = item["raw"]["evidence"][0]
        self.assertEqual(evidence["feedbacks"][0]["author"], "Esraa Yasser")
        self.assertIn("assessment_report_blob_url", evidence)

    def test_signature_invalidation_message_when_snapshot_changes(self):
        row = _signoff_row({
            "id": 1,
            "signer_role": "learner",
            "signer_name": "Andrew Raslan",
            "review_confirmed": True,
            "signature_data": "data:image/png;base64,test",
            "signed_at": "2026-03-31T10:00:00Z",
            "snapshot_hash": "old",
            "audit_version": "v1",
        }, "new")

        self.assertTrue(row["is_stale"])
        self.assertIn("requires renewal", row["status_message"])
