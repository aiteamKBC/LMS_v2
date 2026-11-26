"""Unit tests for the staff access grants.

    python manage.py test learner_api.tests_access_constants

No database: these assert the shape of the constants themselves.

Adding a grant means editing six places in ``constants.py`` — the value, the
canonical order, the label, the description, the landing route and the sidebar
key. Miss one and the failure is quiet and specific to that grant: a missing
landing route sends the account to ``/access-required`` even though it holds a
real grant, and a missing nav key renders a workspace with no sidebar. Both look
like "that role is broken" rather than "somebody forgot a dict entry", which is
what these tests exist to turn into a red line instead.
"""
from __future__ import annotations

from django.test import SimpleTestCase

from .constants import (
    ACCESS_CHOICES,
    ACCESS_DESCRIPTIONS,
    ACCESS_HOME_ROUTES,
    ACCESS_LABELS,
    ACCESS_NAV_ROLES,
    ACCESS_SUPER_ADMIN,
    ACCESS_TUTOR,
    NO_ACCESS_ROUTE,
    POSITION_CHOICES,
)


class AccessGrantShapeTests(SimpleTestCase):
    def test_every_grant_is_fully_described(self):
        """No grant may be half-added: all four maps must cover all of them."""
        for access in ACCESS_CHOICES:
            with self.subTest(access=access):
                self.assertIn(access, ACCESS_LABELS)
                self.assertIn(access, ACCESS_DESCRIPTIONS)
                self.assertIn(access, ACCESS_HOME_ROUTES)
                self.assertIn(access, ACCESS_NAV_ROLES)
                self.assertTrue(ACCESS_LABELS[access].strip())
                self.assertTrue(ACCESS_DESCRIPTIONS[access].strip())

    def test_no_map_describes_a_grant_that_does_not_exist(self):
        """The reverse direction: a removed grant must not linger in a map."""
        for name, mapping in (
            ("labels", ACCESS_LABELS),
            ("descriptions", ACCESS_DESCRIPTIONS),
            ("home routes", ACCESS_HOME_ROUTES),
            ("nav roles", ACCESS_NAV_ROLES),
        ):
            with self.subTest(mapping=name):
                self.assertEqual(set(mapping) - set(ACCESS_CHOICES), set())

    def test_landing_routes_are_real_looking_absolute_paths(self):
        for access, route in ACCESS_HOME_ROUTES.items():
            with self.subTest(access=access):
                self.assertTrue(route.startswith("/"), route)
                # A grant landing on the no-access screen is a contradiction:
                # that page exists to say "you have no grant".
                self.assertNotEqual(route, NO_ACCESS_ROUTE)

    def test_grants_are_unique_and_lower_case(self):
        self.assertEqual(len(ACCESS_CHOICES), len(set(ACCESS_CHOICES)))
        for access in ACCESS_CHOICES:
            self.assertEqual(access, access.lower())

    def test_super_admin_is_last_because_the_console_offers_them_in_order(self):
        self.assertEqual(ACCESS_CHOICES[-1], ACCESS_SUPER_ADMIN)


class TutorGrantTests(SimpleTestCase):
    """The grant added for the enrolment console's Create tutor form.

    Before it existed, ``/workspace/tutor`` and the tutor sidebar were built but
    no grant routed anyone to them, so a tutor account could only ever land on
    /access-required.
    """

    def test_tutor_is_a_grant(self):
        self.assertIn(ACCESS_TUTOR, ACCESS_CHOICES)

    def test_tutor_lands_in_the_tutor_workspace(self):
        self.assertEqual(ACCESS_HOME_ROUTES[ACCESS_TUTOR], "/workspace/tutor")

    def test_tutor_gets_the_tutor_sidebar(self):
        # Must match a key in the SPA's roleNavMap; 'tutor' is one.
        self.assertEqual(ACCESS_NAV_ROLES[ACCESS_TUTOR], "tutor")

    def test_tutor_is_not_an_administrator(self):
        """Only super-admin carries the platform-wide admin role."""
        from login.identity import role_for_staff

        self.assertEqual(role_for_staff("Tutor", ACCESS_TUTOR), "staff")
        self.assertEqual(role_for_staff("Tutor", ACCESS_SUPER_ADMIN), "admin")

    def test_tutor_is_a_selectable_position(self):
        """The API validates Position against this list, so the form's value
        has to be in it or every save is rejected."""
        self.assertIn("Tutor", POSITION_CHOICES)
