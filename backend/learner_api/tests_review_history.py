from datetime import date, datetime

from django.test import SimpleTestCase

from .review_history import _iso_date, _iso_time, _normalise_status, _serialize_review


class ImportedReviewSerialisationTests(SimpleTestCase):
    def test_imported_aptem_dates_are_normalised(self):
        self.assertEqual(_iso_date("23 Jul 2026 at 10:05"), "2026-07-23")
        self.assertEqual(_iso_time("23 Jul 2026 at 10:05"), "10:05")
        self.assertEqual(_iso_date(date(2026, 7, 23)), "2026-07-23")
        self.assertEqual(_iso_date(datetime(2026, 7, 23, 9, 30)), "2026-07-23")

    def test_status_is_normalised_for_frontend_filters(self):
        self.assertEqual(_normalise_status("Not Scheduled"), "not-scheduled")
        self.assertEqual(_normalise_status("In Progress"), "in-progress")
        self.assertEqual(_normalise_status("InProgress"), "in-progress")

    def test_serializer_uses_source_metadata_when_date_columns_are_empty(self):
        row = {
            "id": 44,
            "aptem_review_id": "A-44",
            "review_name": "Monthly Coaching 4",
            "review_type": "Monthly Coaching Meeting",
            "reviewer_name": "",
            "planned_scheduled_date": None,
            "completed_date": None,
            "status": "Completed",
            "extraction_status": "complete",
            "review_data": '''{
                "source_metadata": {
                    "Planned / Scheduled Date": "23 Jul 2026 at 10:05",
                    "Completed Date": "23 Jul 2026",
                    "Reviewer": "Coach One"
                }
            }''',
        }
        sections = {44: [{"id": 9, "name": "Summary", "fields": [], "tables": [], "rawText": ""}]}

        result = _serialize_review(row, sections)

        self.assertEqual(result["plannedDate"], "2026-07-23")
        self.assertEqual(result["plannedTime"], "10:05")
        self.assertEqual(result["completedDate"], "2026-07-23")
        self.assertEqual(result["reviewerName"], "Coach One")
        self.assertEqual(result["status"], "completed")
        self.assertTrue(result["detailsAvailable"])
        self.assertEqual(result["sections"][0]["name"], "Summary")

    def test_serializer_falls_back_to_sections_embedded_in_review_data(self):
        row = {
            "id": 51,
            "aptem_review_id": "A-51",
            "review_name": "Progress Review",
            "review_type": "Progress Review",
            "reviewer_name": "Coach One",
            "learner_name": "Learner One",
            "planned_scheduled_date": None,
            "completed_date": None,
            "status": "In Progress",
            "extraction_status": "complete",
            "review_data": {
                "sections": [{
                    "section_name": "Progress Checks\nIncomplete",
                    "fields": [{"label": "Attendance", "value": "No"}],
                    "raw_text": "Attendance\nNo",
                }, {
                    "section_name": "Learner Information",
                    "fields": [{"label": "Manager:", "value": "Manager One"}],
                }],
            },
        }

        result = _serialize_review(row, {})

        self.assertTrue(result["detailsAvailable"])
        self.assertEqual(result["sections"][0]["name"], "Progress Checks\nIncomplete")
        self.assertEqual(result["sections"][0]["fields"][0]["value"], "No")
        self.assertEqual(result["managerName"], "Manager One")
