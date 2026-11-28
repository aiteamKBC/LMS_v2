"""The fourth onboarding review: ULN Privacy Notice & Learner Acknowledgement.

It is booked, filled in and signed exactly like the other three, and it is one
of the reviews every party must sign before the learner moves to Delivery.

SimpleTestCase with the database layer mocked: nothing here queries a database.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from coach_api import models as coach_models
from coach_api import views as coach_views
from learner_api import calendar, learning_plan, review_form, review_tables

TYPE = "uln-privacy"
LABEL = "ULN Privacy Notice & Learner Acknowledgement"


class SameAsTheOtherReviewsTests(SimpleTestCase):
    def test_is_an_onboarding_review_everywhere_the_others_are(self):
        self.assertIn(TYPE, calendar.ONBOARDING_REVIEW_TYPES)
        self.assertEqual(calendar.ONBOARDING_REVIEW_TYPES, learning_plan.ONBOARDING_REVIEW_TYPES)
        self.assertIn(TYPE, calendar.REVIEW_FORM_TYPES)
        self.assertIn(TYPE, calendar.CANCELLABLE_TYPES)
        self.assertEqual(calendar.ONBOARDING_REVIEW_LABELS[TYPE], LABEL)
        self.assertEqual(calendar.EVENT_JSON_TYPES[TYPE], "review")

    def test_the_coach_calendar_treats_it_as_a_learner_booked_review(self):
        # The Graph invite subject and timetable colour come from these.
        self.assertEqual(coach_views.BOOKED_EVENT_TITLES[TYPE], LABEL)
        self.assertIn(TYPE, coach_views.LEARNER_BOOKED_EVENT_TYPES)
        self.assertEqual(coach_views.BOOKED_EVENT_JSON_TYPES[TYPE], "review")

    def test_a_retried_booking_cannot_create_a_second_meeting(self):
        constraint = next(
            c for c in coach_models.CoachCalendarEvent._meta.constraints
            if c.name == "coach_calendar_booking_seq_uniq"
        )
        covered = dict(constraint.condition.children)["event_type__in"]
        for review_type in calendar.ONBOARDING_REVIEW_TYPES:
            self.assertIn(review_type, covered)

    def test_its_recordings_have_their_own_container(self):
        from django.conf import settings

        self.assertEqual(settings.AZURE_RECORDING_CONTAINERS_BY_TYPE[TYPE], "recordings-uln-privacy")


class FormTests(SimpleTestCase):
    def test_renders_the_notice_then_the_acknowledgement(self):
        self.assertEqual(review_form.sections_for(TYPE), ("ulnPrivacyNotice", "learnerAcknowledgement"))

    def test_the_learner_coach_and_employer_all_sign_it(self):
        review = SimpleNamespace(review_type=TYPE, employer_signature_required=None)
        self.assertTrue(review_form.employer_signature_required(review))
        self.assertEqual(review_form.SIGNATURE_PARTIES, ("learner", "admin", "employer"))

    def test_its_answers_reach_their_own_detail_table(self):
        model, fields = review_tables.MAPPINGS[TYPE]
        self.assertEqual(model._meta.db_table, 'enrolment"."Review_ULN_Privacy')
        self.assertEqual(fields, {
            "privacy_notice_read": ("ulnPrivacyNotice", "noticeRead"),
            "learner_acknowledged": ("learnerAcknowledgement", "acknowledged"),
        })


class DeliveryGateTests(SimpleTestCase):
    """The learner moves to Delivery only once all four reviews are signed."""

    def complete(self, signed_types):
        rows = [SimpleNamespace(review_type=t) for t in signed_types]
        queryset = MagicMock()
        queryset.exclude.return_value = rows
        with patch("learner_api.models.EnrolmentReview.objects.filter", return_value=queryset), \
                patch.object(learning_plan, "_fully_signed", return_value=True):
            return learning_plan.onboarding_complete("apprenticeship", 41)

    def test_the_original_three_are_no_longer_enough(self):
        self.assertFalse(self.complete(["eligibility-review", "workspace", "training-plan"]))

    def test_all_four_complete_onboarding(self):
        self.assertTrue(self.complete(["eligibility-review", "workspace", "training-plan", TYPE]))
