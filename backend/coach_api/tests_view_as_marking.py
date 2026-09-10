"""A super-admin may mark from a coach's workspace, under their own name.

The view-as guard refuses writes so that a decision is never recorded against
the coach whose workspace happens to be open. That protection is about
attribution, not about the write itself -- so a view that stamps the real actor
may write, and this covers the marker that says so plus the stamping it relies
on.
"""
from types import SimpleNamespace

from django.test import SimpleTestCase

from .auth import _SAFE_METHODS, attributed_write_view, is_coach_view_as, read_only_view


class MarkerTests(SimpleTestCase):
    def test_the_marking_endpoint_is_marked_as_an_attributed_write(self):
        from .views import coach_marking_queue

        self.assertTrue(getattr(coach_marking_queue, "coach_view_as_attributed", False))

    def test_it_is_not_claiming_to_be_read_only(self):
        # The two markers make different promises: read_only_view says the view
        # changes nothing, this one says it changes data but records who did it.
        from .views import coach_marking_queue

        self.assertFalse(getattr(coach_marking_queue, "coach_view_as_safe", False))

    def test_ai_feedback_stays_read_only_rather_than_attributed(self):
        # It genuinely writes nothing; it must not drift into the write bucket.
        from .ai_marking import coach_marking_ai_feedback

        self.assertTrue(getattr(coach_marking_ai_feedback, "coach_view_as_safe", False))
        self.assertFalse(
            getattr(coach_marking_ai_feedback, "coach_view_as_attributed", False)
        )

    def test_an_unmarked_write_view_is_still_refused(self):
        # The default has to stay "refused", or the guard stops protecting
        # anything the next endpoint forgets to think about.
        def plain_view(request):
            return None

        self.assertFalse(getattr(plain_view, "coach_view_as_safe", False))
        self.assertFalse(getattr(plain_view, "coach_view_as_attributed", False))

    def test_the_markers_are_independent(self):
        def a(request):
            return None

        def b(request):
            return None

        read_only_view(a)
        attributed_write_view(b)

        self.assertTrue(a.coach_view_as_safe)
        self.assertFalse(getattr(a, "coach_view_as_attributed", False))
        self.assertTrue(b.coach_view_as_attributed)
        self.assertFalse(getattr(b, "coach_view_as_safe", False))

    def test_patch_is_not_a_safe_method(self):
        # The premise of all of the above.
        self.assertNotIn("PATCH", _SAFE_METHODS)


class AttributionTests(SimpleTestCase):
    """Who the decision is recorded against."""

    def _attribute(self, *, view_as, admin, reviewed_by="Test Coach"):
        from .views import clean_text

        request = SimpleNamespace(coach_view_as=view_as, coach_view_as_admin=admin)
        if is_coach_view_as(request):
            name = clean_text(
                getattr(admin, "username", "") or getattr(admin, "email", "")
            ) or "Administrator"
            return f"{name} (for {reviewed_by})"[:255]
        return reviewed_by

    def test_an_admin_is_recorded_as_themselves(self):
        admin = SimpleNamespace(username="Demo Admin", email="admin@example.com")

        self.assertEqual(
            self._attribute(view_as=True, admin=admin),
            "Demo Admin (for Test Coach)",
        )

    def test_a_coach_in_their_own_workspace_is_unchanged(self):
        # The ordinary case: no view-as, no rewriting of their name.
        self.assertEqual(self._attribute(view_as=False, admin=None), "Test Coach")

    def test_an_admin_without_a_display_name_falls_back_to_their_email(self):
        admin = SimpleNamespace(username="", email="admin@example.com")

        self.assertEqual(
            self._attribute(view_as=True, admin=admin),
            "admin@example.com (for Test Coach)",
        )

    def test_an_unidentifiable_admin_is_still_distinguished_from_the_coach(self):
        # Never silently falls through to the coach's bare name -- that is the
        # exact outcome the guard exists to prevent.
        self.assertEqual(
            self._attribute(view_as=True, admin=None),
            "Administrator (for Test Coach)",
        )

    def test_the_stamp_fits_the_column(self):
        admin = SimpleNamespace(username="A" * 300, email="")

        self.assertLessEqual(len(self._attribute(view_as=True, admin=admin)), 255)
