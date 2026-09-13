"""Header date storage and validation; no database access."""
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .mappers import ValidationError, restrict_to_self_writable, write_fields
from .models import EnrolmentUser
from .views import enrolment_user_detail


class HeaderDateTests(SimpleTestCase):
    def test_exact_database_columns(self):
        for attr, column in (("learner_start_date", "Learner_start_date"),
                             ("learner_end_date", "Learner_end_date")):
            self.assertEqual(EnrolmentUser._meta.get_field(attr).column, column)

    def test_valid_dates_and_clearing(self):
        self.assertEqual(write_fields({"learnerStartDate": "2028-02-29", "learnerEndDate": "2028-02-29"}),
                         {"learner_start_date": "2028-02-29", "learner_end_date": "2028-02-29"})
        self.assertEqual(write_fields({"learnerStartDate": "", "learnerEndDate": None}),
                         {"learner_start_date": None, "learner_end_date": None})

    def test_invalid_dates(self):
        for value in ("2027-02-29", "2028-13-01", "29/02/2028", "20280229", True):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                write_fields({"learnerStartDate": value})
        with self.assertRaises(ValidationError):
            write_fields({"learnerStartDate": "2028-03-01", "learnerEndDate": "2028-02-29"})

    def test_learner_cannot_edit_dates(self):
        allowed, rejected = restrict_to_self_writable({"learnerStartDate": "2028-02-29", "learnerEndDate": None})
        self.assertEqual(allowed, {})
        self.assertEqual(set(rejected), {"learnerStartDate", "learnerEndDate"})

    def update(self, payload):
        learner = SimpleNamespace(pk=501, id=501, learner_start_date="2028-01-01",
                                  learner_end_date="2028-12-31", save=Mock())
        request = RequestFactory().patch("/learner_api/enrolment-users/501/",
                                         data=json.dumps(payload), content_type="application/json")
        with patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "0"}), \
                patch("learner_api.views.EnrolmentUser") as model, \
                patch("learner_api.views.advance_learner"), \
                patch("learner_api.views.to_board", return_value={}):
            model.all_learners.filter.return_value.first.return_value = learner
            response = enrolment_user_detail(request, 501)
        return response, learner

    def test_patch_saves_only_requested_columns(self):
        response, learner = self.update({"learnerStartDate": "2028-02-29", "learnerEndDate": None})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(learner.learner_start_date, "2028-02-29")
        self.assertIsNone(learner.learner_end_date)
        learner.save.assert_called_once_with(update_fields=["learner_start_date", "learner_end_date"])

    def test_partial_patch_checks_stored_other_date(self):
        for payload in ({"learnerStartDate": "2029-01-01"}, {"learnerEndDate": "2027-12-31"}):
            with self.subTest(payload=payload):
                response, learner = self.update(payload)
                self.assertEqual(response.status_code, 400)
                learner.save.assert_not_called()
