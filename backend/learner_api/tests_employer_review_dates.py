"""Synthetic read-only regressions; every database/booking reader is mocked."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from coach_api.review_sources import ReviewIdentityConflict, load_imported_links
from learner_api import employer_review_dates


class ImportedDocumentDateTests(SimpleTestCase):
    def setUp(self):
        self.overlays = [
            SimpleNamespace(learner_id=21, source_review_id=407, event_key="imported-review:source-a"),
            SimpleNamespace(learner_id=22, source_review_id=408, event_key="imported-review:source-b"),
        ]
        self.rows = [
            (21, 407, "source-a", "2026-10-20", None, 101, "commercial", "Progress Review"),
            (22, 408, "source-b", None, "24 Oct 2026 at 09:00", 102, "apprenticeship", "Progress Review"),
        ]
        self.cursor = MagicMock()
        connections = MagicMock()
        connections.__getitem__.return_value.cursor.return_value.__enter__.return_value = self.cursor
        patches = [
            patch.object(employer_review_dates, "connections", connections),
            patch("coach_api.views.get_learner_db_alias", return_value="default"),
            patch.object(employer_review_dates, "load_imported_links", return_value=({}, {})),
        ]
        self.links = None
        for item in patches:
            self.links = item.start()
            self.addCleanup(item.stop)

    def lookup(self):
        self.cursor.fetchall.return_value = self.rows
        return employer_review_dates.imported_document_dates(self.overlays)

    def test_scheduled_appointment_wins_for_both_learner_kinds(self):
        self.links.return_value = ({
            "imported-review:source-a": SimpleNamespace(scheduled_date=date(2026, 11, 2)),
            "imported-review:source-b": SimpleNamespace(scheduled_date=date(2026, 11, 3)),
        }, {})
        self.assertEqual(self.lookup(), {(21, 407): "2026-11-02", (22, 408): "2026-11-03"})
        events = self.links.call_args.args[0]
        self.assertEqual([(item["learnerId"], item["enrolmentId"], item["learnerType"], item["reviewId"])
                          for item in events], [
            ("21", "101", "commercial", "407"), ("22", "102", "apprenticeship", "408"),
        ])
        self.assertEqual(self.links.call_args.kwargs, {"compact": True})

    def test_unbooked_reviews_use_the_imported_date_including_legacy_metadata(self):
        self.links.return_value = ({"imported-review:source-a": SimpleNamespace(scheduled_date=None)}, {})
        self.assertEqual(self.lookup(), {(21, 407): "2026-10-20", (22, 408): "2026-10-24"})
        self.cursor.execute.assert_called_once()
        self.assertEqual(self.cursor.execute.call_args.args[1], [[21, 22], [407, 408]])

    def test_missing_or_invalid_dates_are_not_replaced_with_completion_or_signature_dates(self):
        self.rows = [
            (21, 407, "source-a", None, None, 101, "commercial", "Progress Review"),
            (22, 408, "source-b", "not a date", None, 102, "apprenticeship", "Progress Review"),
        ]
        self.overlays[0].completed_at = date(2026, 10, 30)
        self.assertEqual(self.lookup(), {(21, 407): "", (22, 408): ""})

    def test_source_review_and_learner_must_both_match(self):
        self.rows = [
            (22, 407, "source-a", "2026-10-20", None, 102, "apprenticeship", "Progress Review"),
            (21, 999, "unrelated", "2026-10-21", None, 101, "commercial", "Progress Review"),
        ]
        self.assertEqual(self.lookup(), {})
        self.links.assert_called_once_with([], compact=True)

    def test_no_imported_reviews_requires_no_reads(self):
        self.assertEqual(employer_review_dates.imported_document_dates([]), {})
        self.cursor.execute.assert_not_called()
        self.links.assert_not_called()

    def test_conflicting_booking_identity_is_not_hidden_by_a_source_date(self):
        self.links.side_effect = ReviewIdentityConflict("Synthetic association conflict")
        with self.assertRaises(ReviewIdentityConflict):
            self.lookup()

    def test_unavailable_source_does_not_fabricate_a_date(self):
        self.cursor.execute.side_effect = DatabaseError("Synthetic read failure")
        with self.assertRaises(DatabaseError):
            self.lookup()
        self.links.assert_not_called()

    def test_current_and_legacy_bookings_resolve_by_identity_not_matching_dates(self):
        for index, overlay in enumerate(self.overlays):
            overlay.pk = index + 1
            overlay.owner_email = "coach@example.test"

        def booking(pk, learner_id, key, scheduled, idempotency=""):
            return SimpleNamespace(pk=pk, learner_id=learner_id, event_key=key,
                event_type="progress-review", owner_email="coach@example.test",
                review_instance_id=None, review_template_id=None,
                idempotency_key=idempotency, scheduled_date=scheduled)

        records = [
            booking(1, 21, "imported-review:source-a", date(2026, 11, 2)),
            booking(2, 102, "legacy-booking", date(2026, 11, 3),
                    "learner-book:progress-review:apprenticeship:102:2026-10:408"),
            booking(3, 21, "another-review", date(2026, 10, 20)),
        ]
        self.links.side_effect = load_imported_links
        with patch("coach_api.models.ImportedReviewInstance.objects.filter") as overlays, \
                patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=records), \
                patch("coach_api.reconciliation_links.active_links") as reconciliations:
            overlays.return_value.filter.return_value.only.return_value = self.overlays
            reconciliations.return_value.select_related.return_value = []
            self.assertEqual(self.lookup(), {(21, 407): "2026-11-02", (22, 408): "2026-11-03"})

    def test_mixed_monthly_and_progress_bookings_keep_their_actual_calendar_type(self):
        # The employer landing page reads all continuations, including MCMs
        # that do not request an employer signature. They must not break PRs.
        self.rows[0] = (*self.rows[0][:-1], "Monthly Coaching Meeting")
        for index, overlay in enumerate(self.overlays):
            overlay.pk, overlay.owner_email = index + 1, "coach@example.test"
        records = [SimpleNamespace(pk=index + 1, learner_id=overlay.learner_id,
            event_key=overlay.event_key, event_type="mcr" if index == 0 else "progress-review",
            owner_email=overlay.owner_email, review_instance_id=None, review_template_id=None,
            idempotency_key="", scheduled_date=date(2026, 11, index + 2))
            for index, overlay in enumerate(self.overlays)]
        self.links.side_effect = load_imported_links
        with patch("coach_api.models.ImportedReviewInstance.objects.filter") as overlays, \
                patch("coach_api.models.CoachCalendarEvent.objects.filter", return_value=records), \
                patch("coach_api.reconciliation_links.active_links") as reconciliations:
            overlays.return_value.filter.return_value.only.return_value = self.overlays
            reconciliations.return_value.select_related.return_value = []
            for review_type in ("Progress Review", "Progress Review (+ Skills Radar)", "Personal Support Plan"):
                self.rows[1] = (*self.rows[1][:-1], review_type)
                with self.subTest(review_type=review_type):
                    self.assertEqual(self.lookup(), {(21, 407): "2026-11-02", (22, 408): "2026-11-03"})
            # Older learner bookings use a separate key and the source
            # enrolment id. The MCM type also decides this legacy-key match.
            records[0].event_key, records[0].learner_id = "legacy-monthly-booking", 101
            records[0].idempotency_key = "learner-book:mcm:commercial:101:2026-10:407"
            self.assertEqual(self.lookup(), {(21, 407): "2026-11-02", (22, 408): "2026-11-03"})
