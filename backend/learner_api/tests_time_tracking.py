from datetime import timedelta

from django.test import SimpleTestCase
from django.utils.dateparse import parse_datetime

from .time_tracking import (
    TrackingSessionError,
    issue_tracking_session,
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
            )
