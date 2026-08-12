import datetime
import json
from unittest.mock import patch

from django.test import SimpleTestCase, override_settings

from .contract_documents import _safe_upload_filename
from .views import _activity_category, _assignment_source_rows, _build_audit_payload, _build_student_source_data, _enrich_assignment_items_with_evidence_details, _group_months, _normalize_assignment_item, _normalize_attendance_item, _parse_contract_azure_path, _signoff_row
from .learner_match_ledger_views import _contract_preview_url, _contract_signature_dates_from_text, _fetch_profile_source_row, _partition_evidence_items, _training_plan_from_audit, _validate_overlay_activity


class ContractAzurePathTests(SimpleTestCase):
    def test_parses_audited_contract_blob_path(self):
        container, blob_name = _parse_contract_azure_path(
            "az://kbcdocs/contracts/aptem_cv_contracts_probe/21148/agreement.docx"
        )

        self.assertEqual(container, "contracts")
        self.assertEqual(blob_name, "aptem_cv_contracts_probe/21148/agreement.docx")

    def test_rejects_non_contract_or_external_paths(self):
        invalid_paths = [
            "https://kentbusinesscollege.aptem.co.uk/document/1",
            "az://kbcdocs/evidence/aptem_cv_contracts_probe/21148/agreement.pdf",
            "az://kbcdocs/contracts/other_source/21148/agreement.pdf",
            "az://kbcdocs/contracts/aptem_cv_contracts_probe/../secret.pdf",
        ]

        for value in invalid_paths:
            with self.subTest(value=value), self.assertRaises(ValueError):
                _parse_contract_azure_path(value)


class EvidenceAzureManifestEndpointTests(SimpleTestCase):
    def test_rejects_invalid_learner_id_before_manifest_lookup(self):
        response = self.client.get(
            "/audit_api/evidence/43527/open",
            {"learner_id": "not-a-number"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "learner_id must be an integer.")

    def test_evidence_file_is_read_only(self):
        response = self.client.post("/audit_api/evidence/43527/open")

        self.assertEqual(response.status_code, 405)


class EvidenceDocumentManagementTests(SimpleTestCase):
    def test_archiving_original_evidence_does_not_promote_next_aptem_item(self):
        items = [
            {"id": "first", "date": "2026-05-19", "archived": True, "deleted": False, "uploaded": False},
            {"id": "next-aptem", "date": "2026-06-10", "archived": False, "deleted": False, "uploaded": False},
            {"id": "replacement", "date": "2026-08-11", "archived": False, "deleted": False, "uploaded": True},
        ]

        first_date, first_items, archived_items = _partition_evidence_items(items)

        self.assertEqual(first_date, "2026-08-11")
        self.assertEqual([item["id"] for item in first_items], ["replacement"])
        self.assertEqual([item["id"] for item in archived_items], ["first"])

    def test_upload_requires_an_evidence_file(self):
        response = self.client.post(
            "/audit_api/evidence/upload",
            {"learner_id": "4609", "evidence_date": "2026-08-11"},
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "An evidence file is required.")

    def test_date_update_requires_iso_date(self):
        response = self.client.patch(
            "/audit_api/evidence/43527/date",
            data=json.dumps({"learner_id": 18518, "evidence_date": "11/08/2026"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "evidence_date must use YYYY-MM-DD.")

    def test_archive_requires_boolean_state(self):
        response = self.client.patch(
            "/audit_api/evidence/43527/archive",
            data=json.dumps({"learner_id": 18518, "archived": "yes"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "archived must be true or false.")


class ContractDocumentManagementTests(SimpleTestCase):
    def test_upload_filename_removes_paths_and_unsafe_characters(self):
        self.assertEqual(
            _safe_upload_filename(r"..\unsafe folder\Learner<>Agreement.pdf"),
            "Learner_Agreement.pdf",
        )

    def test_upload_requires_a_file(self):
        response = self.client.post("/audit_api/contracts/upload", {"learner_id": "4609"})

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "A document file is required.")

    def test_archive_requires_boolean_state(self):
        response = self.client.patch(
            "/audit_api/contracts/4018/archive",
            data=json.dumps({"archived": "yes"}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "archived must be true or false.")

    def test_rename_requires_a_document_name(self):
        response = self.client.patch(
            "/audit_api/contracts/4018/name",
            data=json.dumps({"document_name": "   "}),
            content_type="application/json",
        )

        self.assertEqual(response.status_code, 400)
        self.assertEqual(response.json()["error"], "document_name is required.")


class AuditTrainingPlanTests(SimpleTestCase):
    def test_normalises_the_deployed_training_plan_shape(self):
        plan = _training_plan_from_audit([{
            "month": "May 2025",
            "date": "2025-05-01",
            "modules": [
                {"module": "LMS-Activity", "components": {"type": "Online training – external", "status": "Completed"}},
                {"module": "Review", "components": {"type": "Review", "status": "Not started"}},
            ],
        }])

        self.assertEqual(plan["total_modules"], 2)
        self.assertEqual(plan["completed_modules"], 1)
        self.assertEqual(plan["months"][0]["modules"][0]["name"], "LMS-Activity")

    def test_training_plan_preserves_the_complete_source_payload(self):
        source = [{
            "month": "September 2026",
            "date": "2026-09-01",
            "aptem_month_id": "month-9",
            "modules": [{
                "module": "Governance",
                "due_date": "2026-09-18",
                "components": {
                    "type": "Digital learning",
                    "status": "In progress",
                    "planned_hours": 4.5,
                },
            }],
        }]

        plan = _training_plan_from_audit(source)

        self.assertEqual(plan["raw"], source)
        self.assertEqual(plan["months"][0]["raw"], source[0])
        self.assertEqual(
            plan["months"][0]["modules"][0]["components"]["planned_hours"],
            4.5,
        )
        self.assertEqual(
            plan["months"][0]["modules"][0]["raw"]["due_date"],
            "2026-09-18",
        )
        self.assertEqual(plan["months"][0]["modules"][0]["name"], "Governance")
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


class LearnerMatchProfileTests(SimpleTestCase):
    def setUp(self):
        super().setUp()
        self.learner = {
            "aptem_id": 1234,
            "name": "Test Learner",
            "email": "test@example.com",
            "programme_name": "Level 6 Project Controls Professional",
            "coach": {"name": "Example Coach", "email": "coach@example.com"},
            "training_plan": [{
                "month": "July 2026",
                "date": "2026-07-01",
                "modules": [
                    {"module": "Introduction", "components": {"type": "Digital learning", "status": "Completed"}},
                    {"module": "Project plan", "components": {"type": "Assignment", "status": "Not started"}},
                ],
            }],
            "month_hours": {
                "2026-06": {"planned": 20.0, "completed": 18.5},
                "2026-07": {"planned": 12.0, "completed": 14.0},
            },
            "activities": [
                {
                    "id": "1234:one",
                    "activity_date": "2026-07-10",
                    "activity_period": "2026-07",
                    "activity_category": "video",
                    "activity_unit": "Introduction",
                    "plan_id": "one",
                    "month_unit": "July 2026",
                    "actual_lms_hours": 1.0,
                    "done": True,
                },
                {
                    "id": "1234:two",
                    "activity_date": "2026-06-03",
                    "activity_period": "2026-06",
                    "activity_category": "assignment",
                    "activity_unit": "Project plan",
                    "plan_id": "two",
                    "month_unit": "June 2026",
                    "actual_lms_hours": None,
                    "done": False,
                },
            ],
        }

    @patch("audit_api.learner_match_ledger_views._load_profile_sources")
    @patch("audit_api.learner_match_ledger_views._load_profile_learner")
    def test_profile_is_selected_by_request_learner(self, load_learner, load_sources):
        load_learner.return_value = self.learner
        load_sources.return_value = {
            "contracts": [{"id": "10", "document_name": "Training Plan", "status": "Verified"}],
            "skills_radar": [{"skill": "Communication", "knowledge": 2, "skill_score": 3, "behaviour": 2, "maximum": 8}],
            "certifications": [{"name": "PRINCE2"}],
            "employment": {"employer_name": "Example Ltd", "job_title": "Project Lead"},
            "programme_understanding": {
                "understanding_programme": "I understand the programme structure.",
                "career_development_progression": "It supports my progression.",
            },
            "programme_status": "OnBreak",
            "break_in_learning": {
                "has_break_in_learning": True,
                "last_learning_date": "2026-01-15",
                "expected_return_date": "2026-03-15",
                "has_return_to_learning": True,
                "return_to_learning_date": "2026-03-10",
                "revised_learning_planned_end_date": "2027-11-30",
            },
            "learning_delivery": {
                "planned_hours": 867,
                "start_date": "2024-10-01",
                "first_evidence_date": "2024-10-01",
                "first_evidence_items": [{
                    "id": "20",
                    "name": "Project plan evidence",
                    "component_name": "Day 1 Learning",
                    "kind": "File",
                    "status": "Accepted",
                    "file": "https://example.com/evidence/20",
                    "content": None,
                    "date": "2024-10-01",
                }],
            },
        }

        response = self.client.get(
            "/audit_api/match-ledger/learner-profile",
            {"learner": "test learner"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "Test Learner")
        self.assertEqual(payload["aptem_id"], "1234")
        self.assertEqual(payload["planned_hours"], 867)
        self.assertEqual(payload["learning_delivery"]["first_evidence_date"], "2024-10-01")
        self.assertEqual(payload["learning_delivery"]["first_evidence_items"][0]["name"], "Project plan evidence")
        self.assertEqual(payload["contracts"][0]["document_name"], "Training Plan")
        self.assertEqual(payload["skills_radar"][0]["maximum"], 8)
        self.assertEqual(payload["employment"]["employer_name"], "Example Ltd")
        self.assertEqual(payload["programme_status"], "OnBreak")
        self.assertEqual(payload["coach"]["name"], "Example Coach")
        load_sources.assert_called_once_with(1234, "test@example.com", "Test Learner")
        self.assertEqual(payload["break_in_learning"]["last_learning_date"], "2026-01-15")
        self.assertEqual(payload["break_in_learning"]["return_to_learning_date"], "2026-03-10")
        self.assertEqual(
            payload["programme_understanding"]["understanding_programme"],
            "I understand the programme structure.",
        )
        self.assertEqual(payload["training_plan"]["total_modules"], 2)
        self.assertEqual(payload["training_plan"]["completed_modules"], 1)

    @patch("audit_api.learner_match_ledger_views._load_profile_sources")
    @patch("audit_api.learner_match_ledger_views._fetch_profile_row")
    @patch("audit_api.learner_match_ledger_views._load_profile_learner", return_value=None)
    def test_profile_falls_back_to_all_programme_match_row(self, _load_learner, fetch_profile_row, load_sources):
        learner = {**self.learner, "aptem_id": 5678, "name": "Other Learner", "programme_name": "Other Programme"}
        fetch_profile_row.return_value = learner
        load_sources.return_value = {
            "contracts": [],
            "skills_radar": [],
            "certifications": [],
            "employment": None,
            "programme_understanding": {
                "understanding_programme": None,
                "career_development_progression": None,
            },
            "programme_status": "Active",
            "break_in_learning": {
                "has_break_in_learning": False,
                "last_learning_date": None,
                "expected_return_date": None,
                "has_return_to_learning": False,
                "return_to_learning_date": None,
                "revised_learning_planned_end_date": None,
            },
            "learning_delivery": {"planned_hours": 400},
        }

        response = self.client.get(
            "/audit_api/match-ledger/learner-profile",
            {"learner": "5678"},
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["name"], "Other Learner")
        self.assertEqual(payload["aptem_id"], "5678")
        self.assertEqual(payload["programme"], "Other Programme")
        self.assertEqual(payload["planned_hours"], 400)
        fetch_profile_row.assert_called_once_with("5678")

    @patch("audit_api.learner_match_ledger_views._fetch_profile_row", return_value=None)
    @patch("audit_api.learner_match_ledger_views._load_profile_learner", return_value=None)
    def test_unknown_learner_returns_404(self, _load_learner, _fetch_profile_row):
        response = self.client.get(
            "/audit_api/match-ledger/learner-profile",
            {"learner": "missing learner"},
        )

        self.assertEqual(response.status_code, 404)


class ContractPreviewUrlTests(SimpleTestCase):
    @override_settings(AZURE_STORAGE_ACCOUNT="kbcdocs", AZURE_STORAGE_KEY="test-key")
    @patch("audit_api.learner_match_ledger_views.generate_blob_sas", return_value="sig")
    def test_contract_preview_url_uses_azure_path_with_inline_disposition(self, generate_sas):
        url = _contract_preview_url(
            "az://kbcdocs/contracts/learners/Training%20Plan.pdf",
            "Training Plan.pdf",
        )

        self.assertEqual(
            url,
            "https://kbcdocs.blob.core.windows.net/contracts/learners/Training%20Plan.pdf?sig",
        )
        self.assertEqual(generate_sas.call_args.kwargs["container_name"], "contracts")
        self.assertEqual(generate_sas.call_args.kwargs["blob_name"], "learners/Training Plan.pdf")
        self.assertEqual(generate_sas.call_args.kwargs["content_type"], "application/pdf")
        self.assertEqual(
            generate_sas.call_args.kwargs["content_disposition"],
            'inline; filename="Training Plan.pdf"',
        )

    def test_contract_signature_dates_read_apprentice_date_from_document_text(self):
        dates = _contract_signature_dates_from_text(
            "Signatories: Apprentice: S. Molai Date: 14/03/2025 Employer: Example Ltd Date: 17/03/2025"
        )

        self.assertEqual(dates["learner_signed_date"], "2025-03-14")
        self.assertEqual(dates["fully_signed_date"], "2025-03-17")

    def test_contract_signature_dates_accept_iso_dates(self):
        dates = _contract_signature_dates_from_text(
            "Learner signature Date: 2026-06-01 Provider signature Date: 2026-06-03"
        )

        self.assertEqual(dates["learner_signed_date"], "2026-06-01")
        self.assertEqual(dates["fully_signed_date"], "2026-06-03")

    def test_contract_signature_dates_ignore_training_plan_schedule_dates(self):
        dates = _contract_signature_dates_from_text(
            "Planned review date 13/03/2028 Planned end date 13/09/2028 "
            "Signatures & Declarations Apprentice Employer Training Provider "
            "Name: Learner Name Name: Employer Name Name: Provider Name "
            "Signature: signed Signature: signed Signature: signed "
            "Date: 01/06/2026 Date: 01/06/2026 Date: 01/06/2026"
        )

        self.assertEqual(dates["learner_signed_date"], "2026-06-01")
        self.assertEqual(dates["fully_signed_date"], "2026-06-01")


class ProfileSourceFallbackTests(SimpleTestCase):
    def test_fetch_profile_source_row_builds_profile_shell_from_contract_source(self):
        class Cursor:
            def __enter__(self):
                return self

            def __exit__(self, *_args):
                return False

            def execute(self, *_args, **_kwargs):
                return None

            def fetchone(self):
                return (
                    4321,
                    "New Learner",
                    "new@example.com",
                    "Level 4 Example Programme",
                    "OnBreak",
                    json.dumps({"has_break_in_learning": True}),
                    "Coach Name",
                    "coach@example.com",
                )

        class Connection:
            def cursor(self):
                return Cursor()

        with patch("audit_api.learner_match_ledger_views.connections", {"enrolment": Connection()}):
            row = _fetch_profile_source_row("4321")

        self.assertEqual(row["aptem_id"], 4321)
        self.assertEqual(row["name"], "New Learner")
        self.assertEqual(row["programme_name"], "Level 4 Example Programme")
        self.assertTrue(row["has_break_in_learning"])
        self.assertEqual(row["coach"]["email"], "coach@example.com")
        self.assertEqual(row["training_plan"], [])
        self.assertEqual(row["activities"], [])


class ActivityOverlayValidationTests(SimpleTestCase):
    def validate(self, **overrides):
        activity = {
            "date": "2026-08-10",
            "category": "assignment",
            "activity": "Portfolio review",
            "planned": 1.25,
            "actual": 1.5,
            **overrides,
        }
        return _validate_overlay_activity(
            activity,
            aptem_id=92,
            learner_name="Test Learner",
            activity_id="audit:test",
        )

    def test_valid_activity_preserves_actual_values_and_derives_month(self):
        result = self.validate()
        self.assertEqual(result["month"], "2026-08")
        self.assertEqual(result["month_label"], "August 2026")
        self.assertEqual(result["planned"], 1.25)
        self.assertEqual(result["actual"], 1.5)
        self.assertEqual(result["timestamp_display"], "input")
        self.assertTrue(result["completed"])

    def test_timestamps_are_validated_and_displayed_without_changing_actual(self):
        result = self.validate(
            actual=0.75,
            timestamp_from="2026-08-10T09:15:00+01:00",
            timestamp_to="2026-08-10T10:00:00+01:00",
        )
        self.assertEqual(result["actual"], 0.75)
        self.assertEqual(result["timestamp_display"], "09:15–10:00")

    def test_negative_or_over_cap_hours_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "planned must be between"):
            self.validate(planned=-0.01)
        with self.assertRaisesRegex(ValueError, "actual must be between"):
            self.validate(actual=50.01)

    def test_invalid_category_date_and_timestamp_order_are_rejected(self):
        with self.assertRaisesRegex(ValueError, "category must be one of"):
            self.validate(category="unknown")
        with self.assertRaisesRegex(ValueError, "date must use"):
            self.validate(date="10/08/2026")
        with self.assertRaisesRegex(ValueError, "timestamp_to must be after"):
            self.validate(
                timestamp_from="2026-08-10T11:00:00",
                timestamp_to="2026-08-10T10:00:00",
            )
