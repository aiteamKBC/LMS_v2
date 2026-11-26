"""No-database checks for the onboarding review booking identity.

A cancelled review keeps its idempotency key, so rebooking it must derive a new
one -- while a first booking's key, and every retry of one booking, stay fixed.
"""
from __future__ import annotations

import os
import unittest

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from learner_api.calendar import onboarding_review_idempotency_parts


class OnboardingRebookIdempotencyTests(unittest.TestCase):
    def test_first_booking_keeps_the_existing_identity(self):
        # Keys already stored for first bookings were built from exactly these.
        self.assertEqual(
            onboarding_review_idempotency_parts("apprenticeship", 670, "eligibility-review", 0),
            ["apprenticeship", "670", "eligibility-review"],
        )

    def test_rebooking_after_a_cancellation_is_a_new_identity(self):
        first = onboarding_review_idempotency_parts("apprenticeship", 670, "eligibility-review", 0)
        after_one = onboarding_review_idempotency_parts("apprenticeship", 670, "eligibility-review", 1)
        after_two = onboarding_review_idempotency_parts("apprenticeship", 670, "eligibility-review", 2)
        self.assertEqual(len({tuple(first), tuple(after_one), tuple(after_two)}), 3)

    def test_retries_of_one_rebooking_share_an_identity(self):
        # Same cancellation count -> same key -> the retry replays, no second meeting.
        self.assertEqual(
            onboarding_review_idempotency_parts("apprenticeship", 670, "workspace", 1),
            onboarding_review_idempotency_parts("apprenticeship", 670, "workspace", 1),
        )

    def test_scoped_to_learner_and_review_type(self):
        base = onboarding_review_idempotency_parts("apprenticeship", 670, "workspace", 1)
        self.assertNotEqual(base, onboarding_review_idempotency_parts("apprenticeship", 671, "workspace", 1))
        self.assertNotEqual(base, onboarding_review_idempotency_parts("apprenticeship", 670, "training-plan", 1))


if __name__ == "__main__":
    unittest.main()
