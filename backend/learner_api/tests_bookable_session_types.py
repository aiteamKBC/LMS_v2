"""What a learner can book, and what every bookable type has to carry with it.

    python manage.py test learner_api.tests_bookable_session_types

Monthly coaching and progress reviews are now bookable by the learner, not only
generated from the programme cycle. Adding a type to BOOKABLE_TYPES is the easy
half; the trap is everything keyed off the type elsewhere:

* EVENT_TITLES / EVENT_JSON_TYPES — the calendar's wording and its display kind.
* coach_api.BOOKED_EVENT_TITLES — membership there means "a learner booked
  this", which decides the event title, the invite wording, and (the part that
  silently breaks) whether the event is organised on the learner's mailbox so
  the coach receives an actual invite email rather than a diary entry nobody
  told them about.

A type that reaches the picker without an entry in all of those looks fine in
the modal and misbehaves after the booking, so these are asserted for every
bookable type rather than only the two being added.
"""
from django.test import SimpleTestCase

from coach_api.views import BOOKED_EVENT_TITLES, COACH_BOOKABLE_EVENT_TYPES

from .calendar import (
    BOOKABLE_TYPES,
    CANCELLABLE_TYPES,
    EVENT_JSON_TYPES,
    EVENT_TITLES,
    ONBOARDING_REVIEW_TYPES,
)

NEW_TYPES = ("mcr", "progress-review")


class BookableSessionTypeTests(SimpleTestCase):
    def test_a_learner_can_book_monthly_coaching_and_a_progress_review(self):
        for session_type in NEW_TYPES:
            self.assertIn(session_type, BOOKABLE_TYPES, session_type)

    def test_the_original_two_are_still_bookable(self):
        self.assertIn("catch-up", BOOKABLE_TYPES)
        self.assertIn("student-support", BOOKABLE_TYPES)

    def test_every_bookable_type_has_a_title_and_a_display_kind(self):
        for session_type in BOOKABLE_TYPES:
            self.assertIn(session_type, EVENT_TITLES, session_type)
            self.assertIn(session_type, EVENT_JSON_TYPES, session_type)

    def test_every_bookable_type_is_recognised_as_learner_booked(self):
        """The invite, and who gets it, hang off this membership."""
        for session_type in BOOKABLE_TYPES:
            self.assertIn(session_type, BOOKED_EVENT_TITLES, session_type)

    def test_the_two_wordings_of_a_title_agree(self):
        """The calendar and the meeting invite must not name it differently."""
        for session_type in BOOKABLE_TYPES:
            self.assertEqual(
                EVENT_TITLES[session_type], BOOKED_EVENT_TITLES[session_type], session_type,
            )

    def test_the_new_types_read_the_way_the_programme_names_them(self):
        self.assertEqual(EVENT_TITLES["mcr"], "Monthly Coaching")
        self.assertEqual(EVENT_TITLES["progress-review"], "Progress Review")
        # A progress review shows as a review in the calendar, not as coaching.
        self.assertEqual(EVENT_JSON_TYPES["progress-review"], "review")
        self.assertEqual(EVENT_JSON_TYPES["mcr"], "coaching")

    def test_a_bookable_session_can_be_cancelled(self):
        for session_type in NEW_TYPES:
            self.assertIn(session_type, CANCELLABLE_TYPES, session_type)

    def test_the_coach_side_picker_is_left_alone(self):
        """Coaches book from their own timetable; that list is separate."""
        self.assertEqual(COACH_BOOKABLE_EVENT_TYPES, ("catch-up", "student-support"))

    def test_onboarding_reviews_stay_out_of_the_coach_session_list(self):
        """They are booked against the case owner before a coach exists."""
        for session_type in ONBOARDING_REVIEW_TYPES:
            self.assertNotIn(session_type, BOOKABLE_TYPES, session_type)
