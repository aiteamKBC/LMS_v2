from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.test import SimpleTestCase
from django.utils.dateparse import parse_datetime

from .time_tracking import (
    TrackingSessionError,
    component_access_is_open,
    issue_tracking_session,
    outside_uk_working_hours,
    verify_tracking_session,
)


class TimeTrackingSessionTests(SimpleTestCase):
    def setUp(self):
        self.session = issue_tracking_session(
            activity_kind="video",
            activity_id="COMP-1",
            learner_kind="apprenticeship",
            learner_id="230",
            counting_mode="active_playback",
            issued_at=datetime(2026, 7, 15, 12, 0, tzinfo=ZoneInfo("UTC")),
        )
        self.started_at = parse_datetime(self.session["startedAt"])

    def verify(self, **overrides):
        values = {
            "activity_kind": "video",
            "activity_id": "COMP-1",
            "learner_kind": "apprenticeship",
            "learner_id": "230",
            "claimed_seconds": 12,
            "submitted_at": self.started_at + timedelta(seconds=20),
        }
        values.update(overrides)
        return verify_tracking_session(self.session["trackingToken"], **values)

    def test_verified_time_is_active_counter_when_within_server_session(self):
        result = self.verify()
        self.assertEqual(result["claimedSeconds"], 12)
        self.assertEqual(result["serverSessionSeconds"], 20)
        self.assertEqual(result["verifiedSeconds"], 12)
        self.assertEqual(result["source"], "signed_session_capped_active_playback")

    def test_claim_cannot_exceed_signed_server_session(self):
        result = self.verify(claimed_seconds=999)
        self.assertEqual(result["verifiedSeconds"], 20)

    def test_token_cannot_be_reused_for_another_learner_or_activity(self):
        with self.assertRaisesRegex(TrackingSessionError, "does not match"):
            self.verify(learner_id="231")
        with self.assertRaisesRegex(TrackingSessionError, "does not match"):
            self.verify(activity_id="COMP-2")

    def test_tampered_token_is_rejected(self):
        tampered = self.session["trackingToken"] + "x"
        with self.assertRaisesRegex(TrackingSessionError, "invalid"):
            verify_tracking_session(
                tampered,
                activity_kind="video",
                activity_id="COMP-1",
                learner_kind="apprenticeship",
                learner_id="230",
                claimed_seconds=10,
            )

    def test_negative_or_non_numeric_claim_is_rejected(self):
        for value in (-1, "not-a-number"):
            with self.subTest(value=value), self.assertRaisesRegex(TrackingSessionError, "non-negative"):
                self.verify(claimed_seconds=value)

    def test_counting_mode_must_match_activity_kind(self):
        with self.assertRaisesRegex(TrackingSessionError, "not valid"):
            issue_tracking_session(
                activity_kind="quiz",
                activity_id="7",
                learner_kind="apprenticeship",
                learner_id="230",
                counting_mode="visible_page",
                issued_at=datetime(2026, 7, 15, 12, 0, tzinfo=ZoneInfo("UTC")),
            )

    def test_component_access_is_open_before_during_and_after_old_hours(self):
        self.assertTrue(component_access_is_open(datetime(2026, 1, 15, 6, 59, tzinfo=ZoneInfo("UTC"))))
        self.assertTrue(component_access_is_open(datetime(2026, 1, 15, 7, 0, tzinfo=ZoneInfo("UTC"))))
        self.assertTrue(component_access_is_open(datetime(2026, 1, 15, 18, 59, tzinfo=ZoneInfo("UTC"))))
        self.assertTrue(component_access_is_open(datetime(2026, 1, 15, 19, 0, tzinfo=ZoneInfo("UTC"))))

    def test_component_access_is_open_all_weekend(self):
        self.assertTrue(component_access_is_open(datetime(2026, 1, 17, 10, 0, tzinfo=ZoneInfo("UTC"))))
        self.assertTrue(component_access_is_open(datetime(2026, 7, 19, 10, 0, tzinfo=ZoneInfo("UTC"))))

    def test_outside_working_hours_uses_uk_weekdays_and_gmt_boundaries(self):
        self.assertTrue(outside_uk_working_hours(datetime(2026, 1, 15, 6, 59, tzinfo=ZoneInfo("UTC"))))
        self.assertFalse(outside_uk_working_hours(datetime(2026, 1, 15, 7, 0, tzinfo=ZoneInfo("UTC"))))
        self.assertFalse(outside_uk_working_hours(datetime(2026, 1, 15, 18, 59, tzinfo=ZoneInfo("UTC"))))
        self.assertTrue(outside_uk_working_hours(datetime(2026, 1, 15, 19, 0, tzinfo=ZoneInfo("UTC"))))

    def test_outside_working_hours_applies_bst_and_weekends(self):
        self.assertTrue(outside_uk_working_hours(datetime(2026, 7, 15, 5, 59, tzinfo=ZoneInfo("UTC"))))
        self.assertFalse(outside_uk_working_hours(datetime(2026, 7, 15, 6, 0, tzinfo=ZoneInfo("UTC"))))
        self.assertTrue(outside_uk_working_hours(datetime(2026, 7, 18, 12, 0, tzinfo=ZoneInfo("UTC"))))

    def test_tracking_can_start_and_submit_outside_the_old_window(self):
        started_at = datetime(2026, 1, 18, 22, 0, tzinfo=ZoneInfo("UTC"))
        session = issue_tracking_session(
            activity_kind="video",
            activity_id="COMP-1",
            learner_kind="apprenticeship",
            learner_id="230",
            counting_mode="active_playback",
            issued_at=started_at,
        )
        result = verify_tracking_session(
            session["trackingToken"],
            activity_kind="video",
            activity_id="COMP-1",
            learner_kind="apprenticeship",
            learner_id="230",
            claimed_seconds=10,
            submitted_at=started_at + timedelta(seconds=20),
        )
        self.assertEqual(result["verifiedSeconds"], 10)
