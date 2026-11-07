"""Aptem detail refreshes preserve plans, account security and identity scope."""

import json
from datetime import date
from contextlib import nullcontext
from io import StringIO
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.core.management.base import CommandError
from django.db import DatabaseError
from django.test import SimpleTestCase

from learner_api.aptem_learner_sync import aptem_id, imported_status, plan_update
from config.management_safety import reconciliation_command
from learner_api.management.commands.sync_aptem_learner_details import Command


def enrolment(**values):
    return SimpleNamespace(**{
        "pk": 71, "aptem_id": "10001", "username": "Example Learner",
        "programme_status": "Active", "learning_plan": {"preserve": True},
        "start_date": None, "end_date": None,
        **values,
    })


def profile(**values):
    return SimpleNamespace(**{
        "pk": 82, "enrolment_id": 71, "aptem_id": 10001,
        "full_name": "Example Learner", "programme_status": "Active",
        "lifecycle_status": "active", "coach_email": "coach@example.invalid",
        "training_plan_progress": [{"historical": True}], **values,
    })


def account(**values):
    return SimpleNamespace(**{
        "pk": 93, "subject_type": "learner", "subject_id": 71,
        "display_name": "Example Learner", "is_active": False,
        "password_hash": "synthetic-marker", **values,
    })


def source(**values):
    return {"aptem_id": "10001", "full_name": "Example Learner",
            "programme_status": "Active", **values}


class AptemDetailPlanTests(SimpleTestCase):
    def test_programme_dates_sync_for_every_state_including_active_and_unknown(self):
        for status in ("Active", "Withdrawn", "OnBreak", "Completed", "EnteredEpa",
                       "Onboarding", "ReadyToEnrol", "Future state", None):
            with self.subTest(status=status):
                plan = plan_update(source(programme_status=status, start_date=date(2025, 1, 2),
                                          end_date=date(2027, 8, 30)), enrolment(), profile())
                self.assertEqual(plan["enrolment"]["start_date"], "2025-01-02")
                self.assertEqual(plan["enrolment"]["end_date"], "2027-08-30")
                self.assertEqual(plan["profile"]["start_date"], date(2025, 1, 2))
                self.assertEqual(plan["profile"]["end_date"], date(2027, 8, 30))

    def test_missing_imported_end_never_clears_the_existing_end(self):
        plan = plan_update(source(programme_status="Withdrawn", start_date=date(2025, 1, 2), end_date=None),
                           enrolment(end_date="2027-08-30"), profile(end_date=date(2027, 8, 30)))
        self.assertEqual(plan["enrolment"]["start_date"], "2025-01-02")
        self.assertNotIn("end_date", plan["enrolment"])
        self.assertNotIn("end_date", plan["profile"])
        self.assertIn("missing_end_date", plan["preserved"])

    def test_omitted_dates_are_independent_of_status_and_name_updates(self):
        plan = plan_update(source(full_name="Updated Example"), enrolment(), profile())
        self.assertNotIn("start_date", plan["enrolment"])
        self.assertNotIn("end_date", plan["profile"])
        self.assertEqual(plan["preserved"], [])

    def test_invalid_date_cannot_write_half_of_an_untrusted_window(self):
        for invalid in ("bad", "2025-02-30", "2025-01-02junk", 0):
            with self.subTest(invalid=invalid):
                plan = plan_update(source(start_date=invalid, end_date=date(2027, 8, 30),
                                          full_name="Updated Example"), enrolment(), profile())
                self.assertEqual(plan["enrolment"], {"username": "Updated Example"})
                self.assertEqual(plan["profile"], {"full_name": "Updated Example"})
                self.assertIn("invalid_start_date", plan["review"])

    def test_reversed_or_zero_length_window_does_not_write_dates(self):
        for end in (date(2025, 1, 1), date(2025, 1, 2)):
            with self.subTest(end=end):
                plan = plan_update(source(start_date=date(2025, 1, 2), end_date=end), enrolment(), profile())
                self.assertEqual(plan["enrolment"], {})
                self.assertEqual(plan["profile"], {})
                self.assertIn("invalid_date_range", plan["review"])

    def test_partial_source_must_also_fit_the_preserved_existing_dates(self):
        plan = plan_update(source(start_date=date(2026, 1, 2), end_date=None),
                           enrolment(end_date="2025-12-31"), profile())
        self.assertEqual(plan["enrolment"], {})
        self.assertEqual(plan["profile"], {})
        self.assertIn("invalid_date_range", plan["review"])

    def test_unparseable_preserved_counterpart_is_reported(self):
        plan = plan_update(source(start_date=date(2025, 1, 2), end_date=None),
                           enrolment(end_date="unknown"), profile())
        self.assertEqual(plan["enrolment"], {})
        self.assertIn("unverifiable_existing_date_range", plan["review"])

    def test_equivalent_dates_are_not_rewritten_for_formatting(self):
        plan = plan_update(source(start_date=date(2025, 1, 2), end_date=date(2027, 8, 30)),
                           enrolment(start_date="02/01/2025", end_date="30 August 2027"),
                           profile(start_date=date(2025, 1, 2), end_date=date(2027, 8, 30)))
        self.assertEqual(plan["enrolment"], {})
        self.assertEqual(plan["profile"], {})

    def test_date_import_is_idempotent_and_leaves_review_anchors_and_progress_untouched(self):
        e = enrolment(learner_start_date="2024-01-02", learner_end_date="2028-03-04")
        p = profile(learner_start_date="2024-01-02", learner_end_date="2028-03-04")
        progress = p.training_plan_progress
        imported = source(start_date=date(2025, 1, 2), end_date=date(2027, 8, 30))
        first = plan_update(imported, e, p)
        for target, row in (("enrolment", e), ("profile", p)):
            for field, value in first[target].items():
                setattr(row, field, value)
        second = plan_update(imported, e, p)
        self.assertEqual(second["enrolment"], {})
        self.assertEqual(second["profile"], {})
        self.assertEqual(e.learner_start_date, "2024-01-02")
        self.assertEqual(p.learner_end_date, "2028-03-04")
        self.assertIs(p.training_plan_progress, progress)

    def test_explicit_withdrawal_reaches_both_local_statuses(self):
        plan = plan_update(source(programme_status="Withdrawn"), enrolment(), profile())
        self.assertEqual(plan["enrolment"], {"programme_status": "Withdrawn"})
        self.assertEqual(plan["profile"], {
            "programme_status": "Withdrawn", "lifecycle_status": "withdrawn",
        })

    def test_break_aliases_are_normalised_for_the_existing_lms_status_picker(self):
        for label in ("OnBreak", "On a break", "Break in Learning", "BIL",
                      "On maternity break", "On illness break", "On other break"):
            with self.subTest(label=label):
                plan = plan_update(source(programme_status=label), enrolment(), profile())
                self.assertEqual(plan["enrolment"], {"programme_status": "On break"})
                self.assertEqual(plan["profile"], {
                    "programme_status": "On break", "lifecycle_status": "on break",
                })

    def test_aptem_active_never_releases_an_uninvited_learner(self):
        for local in ("Delivery", "Onboarding", "Ready to enrol", "Fresh user", ""):
            with self.subTest(local=local):
                plan = plan_update(source(), enrolment(programme_status=local))
                self.assertNotIn("programme_status", plan["enrolment"])

    def test_aptem_active_never_reactivates_a_local_withdrawal_or_break(self):
        for local in ("Withdrawn", "On break"):
            with self.subTest(local=local):
                plan = plan_update(source(), enrolment(programme_status=local),
                                   profile(programme_status=local, lifecycle_status=local.casefold()))
                self.assertEqual(plan["enrolment"], {})
                self.assertEqual(plan["profile"], {})
                self.assertIn("local_lifecycle", plan["preserved"])

    def test_break_does_not_reopen_a_terminal_local_record(self):
        for local in ("Withdrawn", "Completed", "EnteredEpa", "NonStarter"):
            with self.subTest(local=local):
                plan = plan_update(source(programme_status="OnBreak"),
                                   enrolment(programme_status=local))
                self.assertNotIn("programme_status", plan["enrolment"])

    def test_a_stale_profile_is_corrected_even_when_enrolment_is_already_on_break(self):
        plan = plan_update(source(programme_status="OnBreak"),
                           enrolment(programme_status="On break"), profile())
        self.assertEqual(plan["enrolment"], {})
        self.assertEqual(plan["profile"]["programme_status"], "On break")

    def test_name_correction_reaches_existing_login_without_security_changes(self):
        plan = plan_update(source(full_name="Example New-Name"), enrolment(), profile(), account())
        self.assertEqual(plan["enrolment"], {"username": "Example New-Name"})
        self.assertEqual(plan["profile"], {"full_name": "Example New-Name"})
        self.assertEqual(plan["account"], {"display_name": "Example New-Name"})

    def test_empty_name_never_clears_a_name_but_does_not_hide_valid_withdrawal(self):
        plan = plan_update(source(full_name=None, programme_status="Withdrawn"),
                           enrolment(), profile(), account())
        self.assertNotIn("username", plan["enrolment"])
        self.assertNotIn("full_name", plan["profile"])
        self.assertEqual(plan["account"], {})
        self.assertEqual(plan["enrolment"]["programme_status"], "Withdrawn")
        self.assertIn("missing_name", plan["review"])

    def test_missing_or_unknown_status_never_becomes_active_or_withdrawn(self):
        for status in (None, "", " ", "Unrecognised future state"):
            with self.subTest(status=status):
                plan = plan_update(source(programme_status=status, full_name="Updated Example"),
                                   enrolment(), profile())
                self.assertEqual(plan["enrolment"], {"username": "Updated Example"})
                self.assertEqual(plan["profile"], {"full_name": "Updated Example"})
                self.assertTrue(plan["review"])

    def test_aptem_id_not_names_or_email_decides_the_match(self):
        plan = plan_update(source(aptem_id="10002", programme_status="Withdrawn"),
                           enrolment(), profile(), account())
        self.assertEqual(plan["review"], ["identity_mismatch"])
        self.assertFalse(any(plan[target] for target in ("enrolment", "profile", "account")))

    def test_existing_profile_id_can_anchor_a_missing_enrolment_id_without_backfilling_it(self):
        learner = enrolment(aptem_id=None)
        plan = plan_update(source(start_date=date(2025, 1, 2), end_date=date(2027, 8, 30)),
                           learner, profile())
        self.assertEqual(plan["enrolment"]["start_date"], "2025-01-02")
        self.assertNotIn("aptem_id", plan["enrolment"])
        self.assertIsNone(learner.aptem_id)
        self.assertEqual(plan["review"], [])

    def test_invalid_supplied_enrolment_id_is_not_hidden_by_the_profile_fallback(self):
        plan = plan_update(source(start_date=date(2025, 1, 2)), enrolment(aptem_id="invalid"), profile())
        self.assertEqual(plan["review"], ["identity_mismatch"])
        self.assertEqual(plan["enrolment"], {})

    def test_disagreeing_profile_identity_prevents_all_writes(self):
        for values in ({"aptem_id": 10002}, {"enrolment_id": 999}):
            with self.subTest(values=values):
                plan = plan_update(source(full_name="Updated Example"),
                                   enrolment(), profile(**values), account())
                self.assertEqual(plan["review"], ["profile_identity_mismatch"])
                self.assertFalse(any(plan[target] for target in ("enrolment", "profile", "account")))

    def test_existing_enrolment_bridge_is_sufficient_for_a_profile_with_no_legacy_aptem_id(self):
        plan = plan_update(source(programme_status="OnBreak"), enrolment(), profile(aptem_id=None))
        self.assertEqual(plan["profile"]["programme_status"], "On break")
        self.assertNotIn("aptem_id", plan["profile"])

    def test_another_roles_login_is_never_renamed(self):
        plan = plan_update(source(full_name="Updated Example"), enrolment(), profile(),
                           account(subject_type="staff"))
        self.assertEqual(plan["review"], ["account_identity_mismatch"])
        self.assertEqual(plan["account"], {})

    def test_repeating_the_import_is_a_noop_and_preserves_history_and_security(self):
        e, p, a = enrolment(), profile(), account()
        learning_plan, progress = e.learning_plan, p.training_plan_progress
        imported = source(full_name="Updated Example", programme_status="OnBreak")
        first = plan_update(imported, e, p, a)
        for target, row in (("enrolment", e), ("profile", p), ("account", a)):
            for field, value in first[target].items():
                setattr(row, field, value)
        second = plan_update(imported, e, p, a)
        self.assertFalse(any(second[target] for target in ("enrolment", "profile", "account")))
        self.assertIs(e.learning_plan, learning_plan)
        self.assertIs(p.training_plan_progress, progress)
        self.assertFalse(a.is_active)
        self.assertEqual(a.password_hash, "synthetic-marker")

    def test_aptem_id_is_strict_positive_bigint_and_canonical(self):
        self.assertEqual(aptem_id(" 0010001 "), "10001")
        for value in (None, "", "-1", "0", "123x", "١٢٣", "9223372036854775808"):
            with self.subTest(value=value):
                self.assertIsNone(aptem_id(value))

    def test_unrecognised_statuses_are_not_guessed(self):
        self.assertIsNone(imported_status("Early Leaver (funded)"))
        self.assertIsNone(imported_status("Not Eligible"))

    def test_completion_and_epa_follow_aptem_without_rewriting_history(self):
        for external, canonical in (("Completed", "Completed"), ("Entered EPA", "EnteredEpa")):
            with self.subTest(external=external):
                plan = plan_update(source(programme_status=external), enrolment(), profile())
                self.assertEqual(plan["enrolment"], {"programme_status": canonical})
                self.assertEqual(plan["profile"], {
                    "programme_status": canonical, "lifecycle_status": canonical.casefold(),
                })

    def test_imported_later_stage_does_not_release_local_onboarding_or_a_withdrawal(self):
        for external in ("Completed", "EnteredEpa", "Active"):
            for local in ("Delivery", "Onboarding", "Ready to enrol", "Withdrawn"):
                with self.subTest(external=external, local=local):
                    plan = plan_update(source(programme_status=external), enrolment(programme_status=local))
                    self.assertEqual(plan["enrolment"], {})
                    self.assertIn("local_lifecycle", plan["preserved"])

    def test_aptem_onboarding_cannot_restart_local_enrolment(self):
        plan = plan_update(source(programme_status="Onboarding"), enrolment())
        self.assertEqual(plan["enrolment"], {})
        self.assertEqual(plan["preserved"], ["local_lifecycle"])
        self.assertEqual(plan["review"], [])

    def test_detail_command_is_protected_from_application_startup_writers(self):
        with patch("sys.argv", ["manage.py", "sync_aptem_learner_details"]):
            self.assertTrue(reconciliation_command())
        with patch("sys.argv", ["manage.py", "runserver"]):
            self.assertFalse(reconciliation_command())


class AptemDetailCommandTests(SimpleTestCase):
    def test_watch_requires_an_explicit_apply_scope(self):
        with self.assertRaisesMessage(CommandError, "--watch requires --apply"):
            Command().handle(watch=True, apply=False, all_rows=True)

    def test_watch_cannot_poll_in_a_tight_loop(self):
        with self.assertRaisesMessage(CommandError, "at least 60"):
            Command().handle(watch=True, apply=True, all_rows=True, interval_seconds=1)

    def test_worker_retries_after_partial_sync_without_suppressing_the_error(self):
        command = Command(stdout=StringIO(), stderr=StringIO())
        with patch.object(command, "_once", side_effect=[CommandError("Partial sync: review required"), None]) as once, \
             patch("learner_api.management.commands.sync_aptem_learner_details.connections") as databases, \
             patch("learner_api.management.commands.sync_aptem_learner_details.time.sleep", side_effect=[None, KeyboardInterrupt]) as sleep:
            with self.assertRaises(KeyboardInterrupt):
                command.handle(watch=True, apply=True, all_rows=True, interval_seconds=900)
        self.assertEqual(once.call_count, 2)
        self.assertEqual(databases.close_all.call_count, 2)
        self.assertEqual(sleep.call_args.args, (900,))
        self.assertIn("Partial sync", command.stderr.getvalue())

    def test_source_reader_includes_non_active_import_without_inferring_from_absence(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.side_effect = [
            [("10001", "Example Active", "Active", date(2025, 1, 2), date(2027, 8, 30))],
            [("10002", "Example Withdrawn", "Withdrawn", date(2025, 1, 2), None)],
        ]
        with patch("learner_api.management.commands.sync_aptem_learner_details.connections", {"enrolment": connection}):
            rows = Command()._sources({"10001", "10002"}, lock=True)
        self.assertEqual([row["programme_status"] for row in rows], ["Active", "Withdrawn"])
        self.assertEqual(rows[0]["start_date"], date(2025, 1, 2))
        self.assertIsNone(rows[1]["end_date"])
        statements = [call.args[0] for call in cursor.execute.call_args_list]
        self.assertIn('"LMS"."Aptem_users"', statements[0])
        self.assertIn('"LMS"."non_active_users"', statements[1])
        self.assertTrue(all(sql.endswith("FOR SHARE") for sql in statements))
        self.assertTrue(all(call.args[1] == [[10001, 10002]] for call in cursor.execute.call_args_list))

    def run_command(self, *, records=None, sources=None, profiles=None, accounts=None,
                    write_error=None, **options):
        self.command = Command(stdout=StringIO(), stderr=StringIO())
        defaults = {"apply": False, "all_rows": False, "aptem_ids": []}
        defaults.update(options)
        with patch.object(self.command, "_records", return_value=records if records is not None else [enrolment()]) as read, \
             patch.object(self.command, "_sources", return_value=sources if sources is not None else [source(programme_status="OnBreak")]) as read_source, \
             patch.object(self.command, "_related", return_value=(profiles or [], accounts or [])), \
             patch.object(self.command, "_write", side_effect=write_error) as write, \
             patch("learner_api.management.commands.sync_aptem_learner_details.transaction.atomic", return_value=nullcontext()) as atomic, \
             patch("learner_api.management.commands.sync_aptem_learner_details.enqueue_coach_dashboard_refresh", return_value=True) as enqueue, \
             patch("learner_api.management.commands.sync_aptem_learner_details.transaction.on_commit") as committed:
            self.read, self.read_source, self.write = read, read_source, write
            self.atomic, self.committed = atomic, committed
            self.enqueue = enqueue
            self.command.handle(**defaults)
        return json.loads(self.command.stdout.getvalue())

    def test_dry_run_reports_changes_without_writes_or_locks(self):
        report = self.run_command(profiles=[profile()], accounts=[account()])
        self.assertEqual(report["mode"], "dry_run")
        self.assertEqual(report["counts"]["changed"], 1)
        self.write.assert_not_called()
        self.atomic.assert_not_called()
        self.read_source.assert_called_once_with(set(), lock=False)

    def test_apply_requires_explicit_scope_before_any_database_read(self):
        with self.assertRaisesMessage(CommandError, "--apply requires"):
            self.run_command(apply=True)
        self.read.assert_not_called()
        self.read_source.assert_not_called()

    def test_invalid_requested_id_fails_before_any_read(self):
        with self.assertRaisesMessage(CommandError, "positive bigint"):
            self.run_command(aptem_ids=["bad"])
        self.read.assert_not_called()

    def test_apply_locks_and_writes_only_the_requested_learner(self):
        other = enrolment(pk=72, aptem_id="10002")
        report = self.run_command(apply=True, aptem_ids=["10001"],
                                  records=[enrolment(), other], profiles=[profile()])
        self.assertEqual(report["counts"]["examined"], 1)
        self.assertEqual(self.write.call_count, 1)
        self.assertEqual(self.write.call_args.args[0].pk, 71)
        self.read.assert_called_once_with(lock=True)
        self.read_source.assert_called_once_with({"10001"}, lock=True)
        self.committed.assert_called_once()
        self.enqueue.assert_called_once_with("coach@example.invalid", reason="aptem-learner-details", using="enrolment")
        self.assertEqual(self.committed.call_args.kwargs, {"using": "enrolment"})

    def test_duplicate_local_aptem_id_is_not_resolved_by_first_match(self):
        with self.assertRaisesMessage(CommandError, "Partial sync"):
            self.run_command(apply=True, aptem_ids=["10001"],
                             records=[enrolment(), enrolment(pk=72, aptem_id="0010001")])
        self.write.assert_not_called()

    def test_profile_fallback_and_enrolment_id_cannot_claim_the_same_source(self):
        report = self.run_command(
            records=[enrolment(), enrolment(pk=72, aptem_id=None)],
            profiles=[profile(), profile(pk=83, enrolment_id=72, aptem_id=10001)],
        )
        self.assertEqual(report["review"], {"ambiguous_aptem_id": 2})
        self.write.assert_not_called()

    def test_scoped_profile_fallback_reaches_an_existing_active_learner(self):
        report = self.run_command(apply=True, aptem_ids=["10001"],
                                  records=[enrolment(aptem_id=None)], profiles=[profile()])
        self.assertEqual(report["counts"]["examined"], 1)
        self.assertEqual(self.write.call_count, 1)

    def test_duplicate_imported_aptem_id_is_rejected(self):
        report = self.run_command(sources=[source(), source(programme_status="Withdrawn")])
        self.assertEqual(report["review"], {"ambiguous_aptem_id": 1})
        self.write.assert_not_called()

    def test_duplicate_enrolment_to_profile_bridge_is_rejected(self):
        report = self.run_command(profiles=[profile(), profile(pk=83)])
        self.assertEqual(report["review"], {"ambiguous_local_identity": 1})
        self.write.assert_not_called()

    def test_empty_import_never_means_all_learners_withdrawn(self):
        with self.assertRaisesMessage(CommandError, "no learner was changed"):
            self.run_command(apply=True, all_rows=True, sources=[])
        self.write.assert_not_called()

    def test_missing_source_is_reported_without_guessing_a_status(self):
        report = self.run_command(sources=[source(aptem_id="10002")])
        self.assertEqual(report["review"], {"missing_source": 1})
        self.write.assert_not_called()

    def test_all_learners_comparison_counts_native_learners_without_importing_them(self):
        report = self.run_command(records=[enrolment(), enrolment(pk=72, aptem_id=None)])
        self.assertEqual(report["counts"]["local_records"], 2)
        self.assertEqual(report["counts"]["without_aptem_id"], 1)
        self.assertEqual(report["counts"]["examined"], 1)
        self.assertEqual(report["review"], {})

    def test_apply_reports_partial_success_with_nonzero_exit(self):
        with self.assertRaisesMessage(CommandError, "Partial sync"):
            self.run_command(apply=True, all_rows=True,
                             records=[enrolment(), enrolment(pk=72, aptem_id="10002")])
        self.assertEqual(self.write.call_count, 1)
        report = json.loads(self.command.stdout.getvalue())
        self.assertEqual(report["counts"]["changed"], 1)
        self.assertEqual(report["review"], {"missing_source": 1})

    def test_missing_requested_local_record_is_reported(self):
        report = self.run_command(aptem_ids=["10002"], sources=[source(aptem_id="10002")])
        self.assertEqual(report["review"], {"unmatched_requested_id": 1})

    def test_database_failure_is_not_fabricated_success_or_a_secret_in_output(self):
        with self.assertRaisesMessage(CommandError, "changes rolled back") as caught:
            self.run_command(apply=True, all_rows=True,
                             write_error=DatabaseError("synthetic private driver detail"))
        self.assertNotIn("private driver detail", str(caught.exception))
        self.assertEqual(self.command.stdout.getvalue(), "")

    def test_unchanged_import_does_not_touch_updated_at(self):
        report = self.run_command(apply=True, all_rows=True, sources=[source()],
                                  profiles=[profile()], accounts=[account()])
        self.assertEqual(report["counts"]["unchanged"], 1)
        self.write.assert_not_called()
        self.committed.assert_not_called()
        self.enqueue.assert_not_called()

    def test_write_does_not_create_accounts_or_rebuild_plans(self):
        e, p, a = enrolment(), profile(), account()
        plan = plan_update(source(full_name="Updated Example", programme_status="OnBreak"), e, p, a)
        with patch("learner_api.management.commands.sync_aptem_learner_details.EnrolmentUser") as enrolments, \
             patch("learner_api.management.commands.sync_aptem_learner_details.LearnerProfile") as profiles, \
             patch("learner_api.management.commands.sync_aptem_learner_details.LoginAccount") as accounts:
            Command._write(e, p, a, plan)
        enrolments.all_learners.using.return_value.filter.assert_called_once_with(pk=71)
        self.assertEqual(enrolments.all_learners.using.return_value.filter.return_value.update.call_args.kwargs,
                         {"username": "Updated Example", "programme_status": "On break"})
        self.assertEqual(set(profiles.objects.using.return_value.filter.return_value.update.call_args.kwargs),
                         {"full_name", "programme_status", "lifecycle_status", "updated_at"})
        self.assertEqual(set(accounts.objects.using.return_value.filter.return_value.update.call_args.kwargs),
                         {"display_name", "updated_at"})
        accounts.objects.create.assert_not_called()
