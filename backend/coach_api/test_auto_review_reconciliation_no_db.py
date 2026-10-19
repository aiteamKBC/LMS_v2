"""Business-window and batch safety without permitting any database IO."""
from contextlib import nullcontext
from copy import deepcopy
from datetime import date
from io import StringIO
from pathlib import Path
import subprocess
import sys
from types import SimpleNamespace as NS
from unittest.mock import patch, MagicMock

from django.core.management import call_command, CommandError
from django.test import SimpleTestCase

from . import auto_review_reconciliation as auto
from .review_sources import ReviewSource


class AutoReconciliationPolicyTests(SimpleTestCase):
    def setUp(self):
        self.record = NS(pk=11, learner_id=21, review_instance_id="native-11", target_date=date(2099, 10, 1),
                         scheduled_date=date(2099, 11, 2), owner_email="coach@example.invalid")
        self.profile = NS(pk=21, id=21, enrolment_id=121)
        self.instance = {"id": "native-11", "learner_id": 21, "calendar_event_id": 11,
                         "target_date": date(2099, 12, 1), "status": "scheduled"}
        self.source = {"id": 501, "aptem_review_id": "A501", "learner_id": 21,
                       "review_type": "Monthly Coaching Meeting", "planned_scheduled_date": date(2099, 11, 29),
                       "status": "Not Scheduled", "completed_date": None,
                       "review_data": {"aptem_learner_id": 9001, "live_odata": {"LearnerId": 9001}}}
        self.patch("canonical.require_same_database")
        self.patch("canonical.require_operator")
        self.patch("read_only_databases", side_effect=lambda: nullcontext())
        self.schema = self.patch("reconciliation_schema_available", return_value=True)
        self.inventory = self.patch("_inventory", return_value=[(self.record, self.profile, ReviewSource("aptem", 9001), False)])
        self.sources = self.patch("_sources", return_value=[self.source])
        self.patch("CoachCalendarEvent.objects.filter", return_value=[])
        query = MagicMock()
        query.__iter__.return_value = iter([])
        self.patch("ImportedReviewInstance.objects.filter", return_value=query)
        self.booking = self.patch("linked_booking", return_value=None)
        self.patch("links.for_native", return_value=None)
        self.patch("links.for_calendar", return_value=None)
        self.patch("canonical._source_event", return_value={})
        self.inspect = self.patch("canonical._inspect", return_value=())
        p = patch("curriculum_api.review_instances.get_review_instance", return_value=self.instance)
        self.native = p.start()
        self.addCleanup(p.stop)
        p = patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[self.profile])
        p.start()
        self.addCleanup(p.stop)

    def patch(self, name, **kwargs):
        p = patch("coach_api.auto_review_reconciliation." + name, **kwargs)
        result = p.start()
        self.addCleanup(p.stop)
        return result

    def result(self):
        return auto.evaluate_auto_reconciliation()[0]

    def test_month_union_and_source_family_preserve_ambiguity(self):
        for month in (10, 11, 12):
            with self.subTest(month=month):
                self.source["planned_scheduled_date"] = date(2099, month, 28)
                self.assertEqual(self.result()["classification"], "AUTO_ELIGIBLE")
        other = {**self.source, "id": 502, "status": "Completed", "completed_date": date(2099, 12, 29)}
        self.sources.return_value = [self.source, other]
        self.inspect.reset_mock()
        self.assertEqual(self.result()["classification"], "AMBIGUOUS")
        self.inspect.assert_not_called()
        self.sources.return_value = [{**other, "review_type": "Progress Review"}]
        self.assertEqual(self.result()["classification"], "NO_CANDIDATE")

    def test_programme_title_email_and_ordinal_do_not_select(self):
        self.source.update(program_id=1, program_name="Different programme", occurrence_number=20)
        second = {**self.source, "id": 502, "program_id": 2, "occurrence_number": 1}
        self.sources.return_value = [self.source, second]
        self.assertEqual(self.result()["classification"], "AMBIGUOUS")

    def test_wrong_learner_or_disagreeing_capture_is_rejected(self):
        for change in ({"learner_id": 22}, {"review_data": {"aptem_learner_id": 9002}},
                       {"review_data": {"aptem_learner_id": 9001, "live_odata": {"LearnerId": 9002}}}):
            with self.subTest(change=change):
                self.sources.return_value = [{**self.source, **change}]
                self.assertEqual(self.result()["classification"], "INVALID_OWNERSHIP")

    def test_imported_calendar_includes_unbooked_placeholder(self):
        for status in ("scheduled", "not-scheduled"):
            with self.subTest(status=status):
                self.booking.return_value = NS(pk=22, status=status)
                row = self.result()
                self.assertEqual(row["classification"], "IMPORTED_CALENDAR_CONFLICT")
                self.assertEqual(row["existing_imported_calendar_id"], 22)

    def test_changed_current_coach_cannot_claim_imported_continuation(self):
        with patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[]):
            self.assertEqual(self.result()["classification"], "INVALID_OWNERSHIP")
        self.inspect.assert_not_called()

    def test_inconsistent_existing_calendar_mapping_is_not_reported_eligible(self):
        with patch.object(auto.links, "for_calendar", side_effect=auto.ReviewIdentityConflict("Changed Native identity")):
            self.assertEqual(self.result()["classification"], "NATIVE_ALREADY_MAPPED")
        self.inspect.assert_not_called()

    def test_canonical_failures_block_and_missing_schema_never_eligible(self):
        for code in ("LIFECYCLE_CONFLICT", "OVERLAY_CONFLICT", "INVALID_NATIVE_STATE", "SOURCE_REUSE_CONFLICT"):
            with self.subTest(code=code):
                self.inspect.side_effect = auto.canonical.ReconciliationConflict("Blocked synthetic state", code=code)
                self.assertEqual(self.result()["classification"], code)
        self.inspect.side_effect = None
        self.schema.return_value = False
        self.assertEqual(self.result()["classification"], "SCHEMA_MISSING")

    def test_source_reuse_blocks_every_selecting_native_before_inspection(self):
        second = NS(**{**vars(self.record), "pk": 12, "review_instance_id": "native-12"})
        self.inventory.return_value.append((second, self.profile, ReviewSource("aptem", 9001), False))
        self.native.side_effect = lambda identity: {**self.instance, "id": identity,
                                                   "calendar_event_id": 12 if identity == "native-12" else 11}
        rows = auto.evaluate_auto_reconciliation()
        self.assertEqual([row["classification"] for row in rows], ["SOURCE_REUSE_CONFLICT"] * 2)
        self.inspect.assert_not_called()

    def test_default_batch_and_cli_never_apply(self):
        before = deepcopy(self.source)
        with patch.object(auto, "_apply_pair", side_effect=AssertionError("Unexpected write")):
            result = auto.run_batch(actor_id=990)
            self.assertEqual(result["mode"], "dry-run")
            self.assertEqual(result["counts"], {"AUTO_ELIGIBLE": 1})
            out = StringIO()
            call_command("auto_reconcile_legacy_aptem_reviews", actor_id=990, stdout=out)
            self.assertIn('"dry-run"', out.getvalue())
        self.assertEqual(self.source, before)

    def test_apply_requires_count_and_reason_and_does_not_hide_reuse_with_subset(self):
        self.patch("require_reconciliation_schema")
        with patch.object(auto, "_apply_pair") as writer:
            for kwargs in ({}, {"reason": "Reviewed", "expected_count": 2}, {"expected_count": 1}):
                with self.subTest(kwargs=kwargs), self.assertRaises(ValueError):
                    auto.run_batch(actor_id=990, apply=True, **kwargs)
            writer.assert_not_called()
        with self.assertRaises(ValueError):
            auto.run_batch(actor_id=990, calendar_event_ids=[316, 317])

    def test_independent_pair_failure_is_reported_without_aborting_remaining_pairs(self):
        rows = [{"classification": "AUTO_ELIGIBLE", "calendar_event_id": n} for n in (11, 12)]
        self.patch("require_reconciliation_schema")
        with patch.object(auto, "evaluate_auto_reconciliation", return_value=rows), \
             patch.object(auto, "_apply_pair", side_effect=[ValueError("Changed"), {"status": "APPLIED", "id": 1}]):
            result = auto.run_batch(actor_id=990, apply=True, expected_count=2, reason="Reviewed")
        self.assertEqual([r["status"] for r in result["outcomes"]], ["BLOCKED", "APPLIED"])

    def test_rerun_with_remaining_manual_cases_returns_existing_mappings_without_writes(self):
        rows = [{"classification": "ALREADY_RECONCILED", "calendar_event_id": 11},
                {"classification": "AMBIGUOUS", "calendar_event_id": 12}]
        self.patch("require_reconciliation_schema")
        with patch.object(auto, "evaluate_auto_reconciliation", return_value=rows), \
             patch.object(auto, "_apply_pair") as writer:
            result = auto.run_batch(actor_id=990, apply=True, expected_count=1, reason="Repeat reviewed batch")
        self.assertEqual(result["counts"], {"ALREADY_RECONCILED": 1, "AMBIGUOUS": 1})
        writer.assert_not_called()

    def test_command_startup_guard_and_apply_flags(self):
        from config.management_safety import reconciliation_command
        with patch("sys.argv", ["manage.py", "auto_reconcile_legacy_aptem_reviews"]):
            self.assertTrue(reconciliation_command())
        with self.assertRaises(CommandError):
            call_command("auto_reconcile_legacy_aptem_reviews", actor_id=990, apply=True,
                         expected_count=0, reason="Reviewed", calendar_event_ids=[316], stdout=StringIO())

    def test_cold_default_command_has_no_startup_or_application_writes(self):
        probe = Path(__file__).with_name("tests_support") / "auto_reconciliation_command_probe.py"
        for mode in ("old", "new"):
            with self.subTest(mode=mode):
                result = subprocess.run([sys.executable, "-B", str(probe), mode], capture_output=True, text=True, timeout=40)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                self.assertIn('"mode": "dry-run"', result.stdout)
                self.assertIn('"forbidden_attempts": 0', result.stdout)

    def test_effective_database_port_equivalence_does_not_accept_other_targets(self):
        config = {"ENGINE": "postgresql", "HOST": "synthetic.invalid", "NAME": "synthetic", "USER": "synthetic", "PORT": "5432"}
        with patch.object(auto.canonical, "connection", NS(vendor="postgresql", settings_dict=config)), \
             patch.object(auto.canonical, "connections", {"enrolment": NS(settings_dict={**config, "PORT": ""})}), \
             patch.dict(auto.canonical.os.environ, {"PGPORT": ""}):
            # The policy fixture patches this function; explicitly use its
            # original module code via a captured reference below instead.
            REQUIRE_SAME_DATABASE()
            with patch.dict(auto.canonical.os.environ, {"PGPORT": "5433"}):
                with self.assertRaises(auto.canonical.ReconciliationConflict):
                    REQUIRE_SAME_DATABASE()
        for key, value in (("PORT", "5433"), ("HOST", "other.invalid"), ("NAME", "other"), ("USER", "other")):
            with self.subTest(key=key), patch.object(auto.canonical, "connection", NS(vendor="postgresql", settings_dict=config)), \
                 patch.object(auto.canonical, "connections", {"enrolment": NS(settings_dict={**config, key: value})}):
                with self.assertRaises(auto.canonical.ReconciliationConflict):
                    REQUIRE_SAME_DATABASE()


REQUIRE_SAME_DATABASE = auto.canonical.require_same_database
