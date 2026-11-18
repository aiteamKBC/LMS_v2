import json
from types import SimpleNamespace
from unittest import mock
from uuid import uuid4

from django.test import RequestFactory, SimpleTestCase

from .views import (
    _ilr_contact,
    _ilr_postcodes_for_learners,
    _postcode_area,
    _postcode_ordered_candidates,
    deep_dive_ilr_contact,
    deep_dive_record_detail,
    deep_dive_record_summaries,
)


class IlrContactTests(SimpleTestCase):
    @mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"})
    @mock.patch("qms_api.views._ilr_contact", return_value={"uln": "1000000001", "postcode": "CT1 1AA"})
    @mock.patch("qms_api.views.DeepDiveRecord.objects.get")
    @mock.patch("login.permissions.authenticate_request")
    def test_endpoint_is_staff_only(self, authenticate, get_record, read_contact):
        request = RequestFactory().get("/qms_api/deep-dive/records/example/ilr/")
        record_id = uuid4()
        get_record.return_value = SimpleNamespace(id=record_id)

        authenticate.return_value = SimpleNamespace(role="staff")
        response = deep_dive_ilr_contact(request, record_id)
        self.assertEqual(response.status_code, 200)
        self.assertIn(b'"postcode": "CT1 1AA"', response.content)

        authenticate.return_value = SimpleNamespace(role="learner")
        self.assertEqual(deep_dive_ilr_contact(request, record_id).status_code, 403)
        authenticate.return_value = None
        self.assertEqual(deep_dive_ilr_contact(request, record_id).status_code, 401)
        self.assertEqual(read_contact.call_count, 1)
        self.assertEqual(get_record.call_count, 1)

    @mock.patch("qms_api.views.connections")
    @mock.patch("enrolment_api.models.WizardPlr")
    @mock.patch("learner_api.models.EnrolmentUser")
    def test_uses_record_uln_before_linked_email(self, learner_model, plr_model, connections):
        record = SimpleNamespace(uln="1000000001", lms_learner_id=42, raw={})
        learner_model.all_learners.filter.return_value.only.return_value.first.return_value = SimpleNamespace(email="another@example.test")
        plr_model.objects.filter.return_value.values_list.return_value.first.return_value = "1000000001"
        cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ("1000000001", "CT1 1AA")

        self.assertEqual(_ilr_contact(record), {"uln": "1000000001", "postcode": "CT1 1AA"})
        self.assertEqual(cursor.execute.call_args.args[1], ["1000000001"])
        self.assertIn('"Audit".ilr_learning_deliveries', cursor.execute.call_args.args[0])
        self.assertIn("where uln = %s", cursor.execute.call_args.args[0])

    @mock.patch("qms_api.views.connections")
    @mock.patch("enrolment_api.models.WizardPlr")
    @mock.patch("learner_api.models.EnrolmentUser")
    def test_uses_linked_learner_uln_when_workbook_uln_is_blank(self, learner_model, plr_model, connections):
        record = SimpleNamespace(uln="", lms_learner_id=42, raw={"email": "stale@example.test"})
        learner_model.all_learners.filter.return_value.only.return_value.first.return_value = SimpleNamespace(email="current@example.test")
        plr_model.objects.filter.return_value.values_list.return_value.first.return_value = "1000000002"
        cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = ("1000000002", "CT2 2BB")

        self.assertEqual(_ilr_contact(record), {"uln": "1000000002", "postcode": "CT2 2BB"})
        self.assertEqual(cursor.execute.call_args.args[1], ["1000000002"])

    @mock.patch("qms_api.views.connections")
    @mock.patch("enrolment_api.models.WizardPlr")
    @mock.patch("learner_api.models.EnrolmentUser")
    def test_conflicting_linked_uln_does_not_expose_other_learner(self, learner_model, plr_model, connections):
        record = SimpleNamespace(uln="1000000001", lms_learner_id=42, raw={})
        learner_model.all_learners.filter.return_value.only.return_value.first.return_value = SimpleNamespace(email="learner@example.test")
        plr_model.objects.filter.return_value.values_list.return_value.first.return_value = "1000000002"

        self.assertEqual(_ilr_contact(record), {"uln": None, "postcode": None})
        connections.__getitem__.assert_not_called()

    @mock.patch("qms_api.views.connections")
    def test_email_fallback_requires_one_unique_ilr_uln(self, connections):
        record = SimpleNamespace(uln="", lms_learner_id=None, raw={"email": "shared@example.test"})
        cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = None

        self.assertEqual(_ilr_contact(record), {"uln": None, "postcode": None})
        self.assertEqual(cursor.execute.call_args.args[1], ["shared@example.test"])
        self.assertIn("learner_count = 1", cursor.execute.call_args.args[0])

    @mock.patch("qms_api.views.connections")
    def test_no_identity_does_not_query_ilr(self, connections):
        record = SimpleNamespace(uln="", lms_learner_id=None, raw={})

        self.assertEqual(_ilr_contact(record), {"uln": None, "postcode": None})
        connections.__getitem__.assert_not_called()


class PostcodeSyncTests(SimpleTestCase):
    def test_area_uses_leading_letters_of_the_ilr_pattern(self):
        self.assertEqual(_postcode_area("CT1 1AA"), "CT")
        self.assertEqual(_postcode_area("sw1a 2aa"), "SW")
        self.assertIsNone(_postcode_area("postcode missing"))

    @mock.patch("qms_api.views.connections")
    @mock.patch("enrolment_api.models.WizardPlr")
    def test_bulk_lookup_uses_uln_then_unambiguous_email(self, plr_model, connections):
        learners = [
            SimpleNamespace(id=1, email="one@example.test"),
            SimpleNamespace(id=2, email="two@example.test"),
            SimpleNamespace(id=3, email="shared@example.test"),
            SimpleNamespace(id=4, email="shared@example.test"),
            SimpleNamespace(id=5, email="conflict@example.test"),
        ]
        plr_model.objects.filter.return_value.values_list.return_value = [(1, "1000000001")]
        cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            ("1000000001", "one@example.test", "CT1 1AA"),
            ("1000000002", "two@example.test", "CT1 2BB"),
            ("1000000003", "shared@example.test", "CT2 1CC"),
            ("1000000004", "conflict@example.test", "CT3 1DD"),
            ("1000000005", "conflict@example.test", "CT4 1EE"),
        ]

        self.assertEqual(_ilr_postcodes_for_learners(learners), {1: "CT1 1AA", 2: "CT1 2BB"})
        self.assertIn('"Audit".ilr_learning_deliveries', cursor.execute.call_args.args[0])
        self.assertEqual(cursor.execute.call_args.args[1][0], ["1000000001"])

    def test_candidates_stay_grouped_and_fill_from_next_area(self):
        learners = [SimpleNamespace(id=value) for value in (8, 3, 2, 4, 5, 6)]
        postcodes = {8: "ME1 2AA", 3: "CT2 2BB", 2: "CT1 1AA", 5: "ME1 1BB"}

        ordered = _postcode_ordered_candidates(learners, {"2"}, postcodes)

        self.assertEqual([learner.id for learner in ordered[:3]], [3, 5, 8])
        self.assertEqual([learner.id for learner in ordered[3:]], [4, 6])


class DeepDiveReadTests(SimpleTestCase):
    @mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"})
    @mock.patch("login.permissions.authenticate_request", return_value=SimpleNamespace(role="staff"))
    @mock.patch("qms_api.views.DeepDiveRecord.objects.all")
    @mock.patch("qms_api.views._lms_summary_context", return_value={})
    @mock.patch("qms_api.views._lms_context", side_effect=AssertionError("Detail sources loaded for table"))
    @mock.patch("qms_api.views._reviewer_names", return_value={})
    @mock.patch("qms_api.views._serialize", return_value={"id": "synthetic"})
    def test_summary_list_skips_detail_only_reads(self, serialize, reviewers, full_context, summary_context, records, authenticate):
        records.return_value.__getitem__.return_value = [SimpleNamespace(lms_learner_id=42)]

        response = deep_dive_record_summaries(RequestFactory().get("/qms_api/deep-dive/records/summary/"))

        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["count"], 1)
        summary_context.assert_called_once()
        full_context.assert_not_called()

    @mock.patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"})
    @mock.patch("qms_api.views.DeepDiveRecord.objects.get")
    @mock.patch("qms_api.views._lms_context", return_value={})
    @mock.patch("qms_api.views._reviewer_names", return_value={})
    @mock.patch("qms_api.views._serialize", return_value={"id": "synthetic", "operational": {"mcm": {"last": "recorded"}}})
    @mock.patch("login.permissions.authenticate_request")
    def test_full_detail_remains_staff_only(self, authenticate, serialize, reviewers, context, get_record):
        record_id = uuid4()
        get_record.return_value = SimpleNamespace(lms_learner_id=42)
        request = RequestFactory().get("/qms_api/deep-dive/records/detail/")

        authenticate.return_value = SimpleNamespace(role="learner")
        self.assertEqual(deep_dive_record_detail(request, record_id).status_code, 403)
        get_record.assert_not_called()
        authenticate.return_value = SimpleNamespace(role="staff")
        response = deep_dive_record_detail(request, record_id)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["record"]["operational"]["mcm"]["last"], "recorded")
        context.assert_called_once()
