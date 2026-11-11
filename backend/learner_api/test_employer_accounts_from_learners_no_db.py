"""No-database checks for create_employer_accounts_from_learners."""
from __future__ import annotations

import inspect
import os
import unittest
from collections import defaultdict
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from learner_api.management.commands import create_employer_accounts_from_learners as mod
from learner_api.management.commands.create_employer_accounts_from_learners import (
    Command, plan_employers, split_name,
)


def learner(pk, email, name="Pat Example", phone="", org="", employer_id=None):
    return {"id": pk, "employer_email": email, "employer": name, "employer_phone": phone,
            "organization": org, "employer_id": employer_id}


class PlanEmployersTests(unittest.TestCase):
    def test_one_plan_per_email_case_and_space_insensitive(self):
        plans, review = plan_employers(
            [learner(1, "Boss@Example.com "), learner(2, "boss@example.com"), learner(3, "")],
            {}, {}, {},
        )
        self.assertEqual(review, {})
        self.assertEqual(len(plans), 1)
        self.assertEqual(plans[0]["email"], "boss@example.com")
        self.assertEqual(plans[0]["link_learner_ids"], [1, 2])
        self.assertIsNone(plans[0]["employer_id"])

    def test_existing_learner_link_is_never_changed(self):
        plans, _ = plan_employers([learner(1, "b@example.com", employer_id=7), learner(2, "b@example.com")],
                                  {}, {}, {})
        self.assertEqual(plans[0]["link_learner_ids"], [2])

    def test_reuses_existing_employer_with_same_email(self):
        plans, review = plan_employers([learner(1, "b@example.com")], {"b@example.com": [9]},
                                       {"b@example.com": [("employer", 9, True)]}, {})
        self.assertEqual(review, {})
        self.assertEqual(plans[0]["employer_id"], 9)

    def test_ambiguous_or_conflicting_rows_go_to_review(self):
        cases = [
            ([learner(1, "not-an-email")], {}, {}, "invalid_employer_email"),
            ([learner(1, "b@example.com")], {"b@example.com": [1, 2]}, {}, "several_employers_share_email"),
            ([learner(1, "b@example.com")], {}, {"b@example.com": [("staff", 3, True)]},
             "email_used_by_another_account"),
            ([learner(1, "b@example.com")], {}, {"b@example.com": [("employer", 3, False)]},
             "email_used_by_another_account"),
            ([learner(1, "b@example.com", "A One"), learner(2, "b@example.com", "B Two")], {}, {},
             "learners_disagree_on_employer_name"),
            ([learner(1, "b@example.com", "")], {}, {}, "employer_name_missing"),
        ]
        for rows, employers, accounts, reason in cases:
            with self.subTest(reason=reason):
                plans, review = plan_employers(rows, employers, accounts, {})
                self.assertEqual(plans, [])
                self.assertEqual(review, {reason: 1})

    def test_organisation_reused_by_name_or_planned_for_creation(self):
        plans, _ = plan_employers([learner(1, "a@example.com", org="Acme Ltd"),
                                   learner(2, "b@example.com", org="New Co")],
                                  {}, {}, {"acme ltd": [4]})
        by_email = {p["email"]: p for p in plans}
        self.assertEqual(by_email["a@example.com"]["organisation_id"], 4)
        self.assertEqual(by_email["b@example.com"]["organisation"], "New Co")
        self.assertIsNone(by_email["b@example.com"]["organisation_id"])

    def test_conflicting_organisation_still_creates_employer_without_group(self):
        plans, review = plan_employers([learner(1, "b@example.com", org="X"), learner(2, "b@example.com", org="Y")],
                                       {}, {}, {})
        self.assertEqual(review, {"learners_disagree_on_organisation": 1})
        self.assertEqual(plans[0]["organisation"], "")

    def test_split_name(self):
        self.assertEqual(split_name(" Mary  Ann Smith "), ("Mary Ann", "Smith"))
        self.assertEqual(split_name("Cher"), ("Cher", ""))
        self.assertEqual(split_name(""), ("", ""))


class ApplyTests(unittest.TestCase):
    def test_apply_creates_org_employer_account_and_links_without_invitation(self):
        org_manager, emp_manager, learner_manager = MagicMock(), MagicMock(), MagicMock()
        org_manager.using.return_value.create.return_value = SimpleNamespace(pk=50)
        employer = SimpleNamespace(pk=70)
        emp_manager.using.return_value.create.return_value = employer
        learner_manager.using.return_value.filter.return_value.update.return_value = 2
        plans = [
            {"email": "a@example.com", "employer_id": None, "name": "Pat Q Example", "phone": "0123",
             "organisation": "New Co", "organisation_id": None, "link_learner_ids": [1, 2]},
            {"email": "b@example.com", "employer_id": None, "name": "Sam Example", "phone": "",
             "organisation": "new co", "organisation_id": None, "link_learner_ids": [3]},
        ]
        counts = defaultdict(int)
        with patch.object(mod, "Organisation", SimpleNamespace(objects=org_manager)), \
                patch.object(mod, "Employer", SimpleNamespace(objects=emp_manager)), \
                patch.object(mod, "EnrolmentUser", SimpleNamespace(all_learners=learner_manager)), \
                patch.object(mod, "ensure_account", return_value=(object(), True)) as ensure:
            Command()._apply(plans, counts)

        org_manager.using.return_value.create.assert_called_once_with(name="New Co", group_type="Employer")
        first = emp_manager.using.return_value.create.call_args_list[0].kwargs
        self.assertEqual((first["first_name"], first["surname"], first["email"], first["mobile"]),
                         ("Pat Q", "Example", "a@example.com", "0123"))
        self.assertEqual((first["employer_group_ids"], first["employer_group_names"]), ([50], ["New Co"]))
        self.assertIsNone(emp_manager.using.return_value.create.call_args_list[1].kwargs["mobile"])
        ensure.assert_called_with("employer", 70, subject=employer)
        learner_manager.using.return_value.filter.assert_any_call(pk__in=[1, 2], employer_id__isnull=True)
        learner_manager.using.return_value.filter.return_value.update.assert_called_with(employer_id=70)
        self.assertEqual(counts["organisations_created"], 1)
        self.assertEqual(counts["employers_created"], 2)
        self.assertEqual(counts["accounts_created"], 2)

    def test_command_never_sends_or_records_an_invitation(self):
        source = inspect.getsource(mod)
        for forbidden in ("invite_subject", "send_invitation", "_send_platform_invitation", "send_mail",
                          "Invitation"):
            self.assertNotIn(forbidden, source.replace("No invitation", "").replace("no invitation", ""))

    def test_dry_run_is_default(self):
        parser = Command().create_parser("manage.py", "create_employer_accounts_from_learners")
        self.assertFalse(parser.parse_args([]).apply)


if __name__ == "__main__":
    unittest.main()
