"""Calendar-changing continuation must serialize with reconciliation first."""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import views


class ImportedContinuationLockOrderTests(SimpleTestCase):
    def setUp(self):
        self.definition = {
            "instance": {"id": "imported-review:synthetic", "learnerId": 21},
            "historicalReview": {"id": 501},
        }
        self.overlay = SimpleNamespace(
            learner_id=21, source_review_id=501,
            template_snapshot={"sections": [{"title": "Synthetic"}]},
        )

    def test_parent_locks_precede_overlay_and_locked_identity_is_rechecked(self):
        order = []
        query = MagicMock()
        query.first.return_value = self.overlay
        locked = query.select_for_update.return_value
        locked.first.side_effect = lambda: order.append("overlay") or self.overlay
        with patch.object(views.ImportedReviewInstance.objects, "filter", return_value=query), \
             patch.object(views, "lock_learner_calendar", side_effect=lambda *a: order.append("learner")) as learner, \
             patch("coach_api.review_sources.booking_for_overlay", side_effect=lambda *a, **k: order.append("calendar")) as calendar:
            result = views._owned_migrated_overlay(
                "coach@example.invalid", self.definition, lock=True, lock_calendar=True,
            )
            self.assertIs(result, self.overlay)
            self.assertEqual(order, ["learner", "calendar", "overlay"])
            learner.assert_called_once_with(21)
            calendar.assert_called_once_with(self.overlay, lock=True)
            # A stale initial identity cannot authorize the row re-read later.
            locked.first.side_effect = None
            locked.first.return_value = SimpleNamespace(
                learner_id=22, source_review_id=501, template_snapshot=self.overlay.template_snapshot,
            )
            self.assertIsNone(views._owned_migrated_overlay(
                "coach@example.invalid", self.definition, lock=True, lock_calendar=True,
            ))

    def test_missing_or_wrong_owned_source_never_acquires_parent_locks(self):
        for overlay in (None, SimpleNamespace(
            learner_id=21, source_review_id=502, template_snapshot=self.overlay.template_snapshot,
        )):
            with self.subTest(overlay=overlay), \
                 patch.object(views.ImportedReviewInstance.objects, "filter") as query, \
                 patch.object(views, "lock_learner_calendar") as learner, \
                 patch("coach_api.review_sources.booking_for_overlay") as calendar:
                query.return_value.first.return_value = overlay
                self.assertIsNone(views._owned_migrated_overlay(
                    "coach@example.invalid", self.definition, lock=True, lock_calendar=True,
                ))
                learner.assert_not_called()
                calendar.assert_not_called()

    def test_passive_reads_and_overlay_only_writers_do_not_lock_calendar(self):
        with patch.object(views.ImportedReviewInstance.objects, "filter") as query, \
             patch.object(views, "lock_learner_calendar") as learner, \
             patch("coach_api.review_sources.booking_for_overlay") as calendar:
            query.return_value.first.return_value = self.overlay
            query.return_value.select_for_update.return_value.first.return_value = self.overlay
            for lock in (False, True):
                self.assertIs(views._owned_migrated_overlay(
                    "coach@example.invalid", self.definition, lock=lock,
                ), self.overlay)
            learner.assert_not_called()
            calendar.assert_not_called()
