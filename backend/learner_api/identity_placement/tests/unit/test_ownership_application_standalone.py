"""Ownership orchestration tests without Django or database access."""

import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

BACKEND = Path(__file__).resolve().parents[4]
sys.path.insert(0, str(BACKEND))

from learner_api.identity_placement.application.authorize_ownership import (
    coach_owns_learner,
    staff_owns_learner,
)


class StaffOwnershipTests(unittest.TestCase):
    def test_exact_linked_enrolment_is_required(self):
        account = SimpleNamespace(
            role="staff",
            subject_type="staff",
            subject_id=56,
            email="staff@example.test",
        )
        read = Mock(return_value=56)
        self.assertTrue(staff_owns_learner(account, 56, read_linked_enrolment=read))
        read.return_value = 19
        self.assertFalse(staff_owns_learner(account, 56, read_linked_enrolment=read))
        read.return_value = None
        self.assertFalse(staff_owns_learner(account, 56, read_linked_enrolment=read))

    def test_missing_identity_does_not_call_the_reader(self):
        read = Mock()
        account = SimpleNamespace(role="staff", subject_type="staff", email="")
        self.assertFalse(staff_owns_learner(account, 56, read_linked_enrolment=read))
        read.assert_not_called()


class CoachOwnershipTests(unittest.TestCase):
    def test_current_coach_identity_and_exact_caseload_are_both_required(self):
        account = SimpleNamespace(role="staff", subject_type="staff", subject_id=31)
        coach_email = Mock(return_value="coach@example.test")
        caseload = Mock(return_value=True)
        self.assertTrue(
            coach_owns_learner(
                account,
                56,
                read_authorized_coach_email=coach_email,
                caseload_contains=caseload,
            )
        )
        caseload.assert_called_once_with("coach@example.test", 56)

    def test_missing_coach_access_fails_before_caseload_lookup(self):
        account = SimpleNamespace(role="staff", subject_type="staff", subject_id=31)
        caseload = Mock()
        self.assertFalse(
            coach_owns_learner(
                account,
                56,
                read_authorized_coach_email=lambda _staff_id: None,
                caseload_contains=caseload,
            )
        )
        caseload.assert_not_called()


if __name__ == "__main__":
    unittest.main()
