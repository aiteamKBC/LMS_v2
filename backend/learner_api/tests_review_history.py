import json
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import review_history
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


class LocalMonthlyCoachingHistoryTests(SimpleTestCase):
    def setUp(self):
        self.source = SimpleNamespace(pk=101, email='learner@example.invalid', aptem_id=None)
        self.model = Mock()
        self.model.all_learners.only.return_value.filter.return_value.first.return_value = self.source
        self.cursor = MagicMock()
        self.connection = MagicMock()
        self.connection.cursor.return_value.__enter__.return_value = self.cursor
        self.review = {
            'id': 62, 'aptem_review_id': 'IMPORTED-MCM-62',
            'review_name': 'Monthly Coaching Meeting', 'review_type': 'Monthly Coaching Meeting',
            'planned_scheduled_date': datetime(2026, 11, 4, 10),
            'completed_date': None, 'status': 'Not Scheduled', 'review_data': {},
        }
        self.cursor.description = [(column,) for column in self.review]
        self.account = SimpleNamespace(role='learner', subject_id=101)
        for target, value in (
            ('learner_api.review_history.SOURCE_MODELS',
             {'commercial': self.model, 'apprenticeship': self.model}),
            ('learner_api.review_history.connection', self.connection),
        ):
            patcher = patch(target, value)
            patcher.start()
            self.addCleanup(patcher.stop)
        for target, value in (
            ('login.permissions.authenticate_request', self.account),
            ('login.permissions._auth_gate_enabled', True),
        ):
            patcher = patch(target, return_value=value)
            mock = patcher.start()
            self.addCleanup(patcher.stop)
            if target.endswith('authenticate_request'):
                self.authenticate = mock

    def load(self, kind='commercial', *, pk=101, category='monthly-coaching'):
        request = RequestFactory().get('/reviews/history/', {'category': category})
        return review_history.learner_review_history(request, kind=kind, pk=pk)

    def saved_review(self):
        self.cursor.reset_mock()
        self.cursor.fetchone.return_value = (248,)
        self.cursor.fetchall.side_effect = [[tuple(self.review.values())], []]

    def test_local_mcm_remains_available_without_source_import_identity(self):
        for kind in ('commercial', 'apprenticeship'):
            for source_id in (None, '', 'legacy-missing'):
                with self.subTest(kind=kind, source_id=source_id):
                    self.source.aptem_id = source_id
                    self.saved_review()
                    response = self.load(kind)
                    self.assertEqual(response.status_code, 200)
                    body = json.loads(response.content)
                    self.assertEqual(body['learnerId'], 248)
                    self.assertEqual(len(body['reviews']), 1)
                    self.assertEqual(body['reviews'][0]['id'], '62')
                    self.assertEqual(body['reviews'][0]['aptemReviewId'], 'IMPORTED-MCM-62')
                    self.assertEqual(body['reviews'][0]['plannedDate'], '2026-11-04')
                    self.assertEqual(body['reviews'][0]['status'], 'not-scheduled')
                    calls = self.cursor.execute.call_args_list
                    self.assertEqual(calls[0].args[1], [101, kind])
                    self.assertEqual(calls[1].args[1], [248, list(review_history.REVIEW_TYPES['monthly-coaching'])])
                    self.assertEqual(calls[2].args[1], [[62]])

    def test_existing_import_identity_keeps_the_same_response(self):
        self.source.aptem_id = '501'
        self.saved_review()
        response = self.load()
        self.assertEqual(json.loads(response.content)['reviews'][0]['id'], '62')

    def test_learner_without_saved_mcms_keeps_an_empty_history(self):
        self.cursor.fetchone.return_value = (248,)
        self.cursor.fetchall.return_value = []
        response = self.load()
        self.assertEqual(json.loads(response.content), {
            'learnerId': 248, 'category': 'monthly-coaching', 'reviews': [],
        })

    def test_missing_or_ambiguous_profile_does_not_read_reviews(self):
        self.cursor.fetchone.return_value = None
        for matches in ([], [(248,), (249,)]):
            with self.subTest(matches=matches):
                self.cursor.reset_mock()
                self.cursor.fetchall.return_value = matches
                response = self.load()
                self.assertEqual(json.loads(response.content)['reviews'], [])
                self.assertEqual(self.cursor.execute.call_count, 2)
                self.assertTrue(all('FROM "Learner".learners' in call.args[0]
                                    for call in self.cursor.execute.call_args_list))

    def test_another_learner_cannot_read_the_local_mcms(self):
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind):
                self.assertEqual(self.load(kind, pk=102).status_code, 404)
        self.model.all_learners.only.assert_not_called()
        self.connection.cursor.assert_not_called()

    def test_anonymous_and_employer_requests_are_denied(self):
        for account, status in ((None, 401), (SimpleNamespace(role='employer'), 403)):
            with self.subTest(account=account):
                self.authenticate.return_value = account
                self.assertEqual(self.load().status_code, status)
        self.connection.cursor.assert_not_called()

    def test_staff_and_admin_can_view_the_owned_local_mcms(self):
        for role in ('staff', 'admin'):
            with self.subTest(role=role):
                self.authenticate.return_value = SimpleNamespace(role=role)
                self.saved_review()
                response = self.load()
                self.assertEqual(response.status_code, 200)
                self.assertEqual(json.loads(response.content)['reviews'][0]['id'], '62')

    def test_missing_source_returns_not_found(self):
        self.model.all_learners.only.return_value.filter.return_value.first.return_value = None
        self.assertEqual(self.load().status_code, 404)
        self.connection.cursor.assert_not_called()

    def test_local_read_failure_is_visible_instead_of_switching_to_curriculum(self):
        self.connection.cursor.side_effect = DatabaseError('Synthetic database failure')
        response = self.load()
        self.assertEqual(response.status_code, 503)
        self.assertEqual(json.loads(response.content)['error'], 'Could not load review history.')

    def test_other_review_categories_keep_their_existing_eligibility(self):
        for category in ('reviews', 'progress-review'):
            with self.subTest(category=category):
                self.assertEqual(json.loads(self.load(category=category).content)['reviews'], [])
        self.connection.cursor.assert_not_called()
