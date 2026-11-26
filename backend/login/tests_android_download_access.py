"""Installer permission tests with synthetic accounts and no database access."""
from types import SimpleNamespace
from unittest.mock import patch
from django.test import SimpleTestCase
from learner_api.models import StaffUser
from .android_download_access import staff_download_allowed


class AndroidDownloadAccessTests(SimpleTestCase):
    def account(self, role="staff", subject_type="staff", active=True):
        return SimpleNamespace(role=role, subject_type=subject_type, subject_id=42, is_active=active)

    def test_active_admin_needs_no_learner_or_staff_profile(self):
        with patch.object(StaffUser.objects, "filter") as lookup:
            self.assertTrue(staff_download_allowed(self.account(role="admin")))
            lookup.assert_not_called()

    def test_coach_primary_and_additional_grants_use_canonical_access_rules(self):
        for primary, extra in (("coach", ""), ("tutor", "coach"), ("tutor", " coach, employer-admin ")):
            with self.subTest(primary=primary, extra=extra), patch.object(StaffUser.objects, "filter") as lookup:
                lookup.return_value.first.return_value = SimpleNamespace(access=primary, access_extra=extra)
                self.assertTrue(staff_download_allowed(self.account()))
                lookup.assert_called_once_with(pk=42)

    def test_inactive_anonymous_wrong_role_and_wrong_subject_are_denied_without_lookup(self):
        for account in (None, self.account(active=False), self.account(role="admin", active=False),
                        self.account(role="employer"), self.account(role="learner"),
                        self.account(subject_type="learner")):
            with self.subTest(account=account), patch.object(StaffUser.objects, "filter") as lookup:
                self.assertFalse(staff_download_allowed(account))
                lookup.assert_not_called()

    def test_missing_removed_or_unrelated_coach_grant_is_denied(self):
        for staff in (None, SimpleNamespace(access="tutor", access_extra=""),
                      SimpleNamespace(access="", access_extra=""), SimpleNamespace(access="caseowner", access_extra="tutor")):
            with self.subTest(staff=staff), patch.object(StaffUser.objects, "filter") as lookup:
                lookup.return_value.first.return_value = staff
                self.assertFalse(staff_download_allowed(self.account()))
