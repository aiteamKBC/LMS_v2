import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock


spec = importlib.util.spec_from_file_location("aptem_sync_runner", Path(__file__).with_name("aptem_learner_sync.py"))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


class AptemSyncRunnerTests(unittest.TestCase):
    def setUp(self):
        self.environment = {"APTEM_SYNC_DATABASE_URL": "synthetic-private-connection",
                            "APTEM_SYNC_EXPECTED_DATABASE": "example",
                            "APTEM_SYNC_EXPECTED_BRANCH": "example-branch"}
        self.connect = MagicMock()
        self.cursor = self.connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        self.cursor.fetchone.return_value = ("example", "example-branch", "on")

    def result(self, *, status=0, review=None, stderr=""):
        return SimpleNamespace(returncode=status, stdout=json.dumps({
            "mode": "apply", "counts": {"local_records": 3, "changed": 1}, "review": review or {},
        }), stderr=stderr)

    def test_preflight_is_read_only_and_checks_the_actual_database_and_branch(self):
        runner.verify_target(self.environment, self.connect)
        self.assertIn("default_transaction_read_only=on", self.connect.call_args.kwargs["options"])
        self.assertIn("current_database()", self.cursor.execute.call_args.args[0])

    def test_wrong_target_prevents_any_application_process(self):
        for identity in (("wrong", "example-branch", "on"), ("example", "wrong", "on"),
                         ("example", "example-branch", "off")):
            with self.subTest(identity=identity):
                self.cursor.fetchone.return_value = identity
                execute = MagicMock()
                with self.assertRaises(runner.SyncFailure):
                    runner.run_cycle(self.environment, execute, self.connect)
                execute.assert_not_called()

    def test_missing_configuration_does_not_connect(self):
        with self.assertRaises(runner.SyncFailure):
            runner.verify_target({}, self.connect)
        self.connect.assert_not_called()

    def test_driver_failure_does_not_expose_private_details(self):
        self.connect.side_effect = RuntimeError("synthetic-private-password")
        with self.assertRaises(runner.SyncFailure) as caught:
            runner.verify_target(self.environment, self.connect)
        self.assertNotIn("synthetic-private-password", str(caught.exception))

    def test_command_updates_existing_records_in_the_verified_database(self):
        execute = MagicMock(return_value=self.result())
        _, outcome = runner.run_cycle(self.environment, execute, self.connect)
        self.assertEqual(outcome, "applied")
        self.assertEqual(execute.call_args.args[0][-3:], ["sync_aptem_learner_details", "--apply", "--all"])
        runtime = execute.call_args.kwargs["env"]
        self.assertEqual(runtime["ENROLMENT_DATABASE_URL"], self.environment["APTEM_SYNC_DATABASE_URL"])
        self.assertEqual(runtime["CACHE_URL"], "")

    def test_committed_missing_source_result_remains_explicitly_partial(self):
        report, outcome = runner.cycle_result(self.result(status=1, review={"missing_source": 2},
                                             stderr="CommandError: Partial sync: valid changes committed"))
        self.assertEqual(outcome, "source-review")
        self.assertEqual(report["review"], {"missing_source": 2})

    def test_identity_and_date_conflicts_are_not_downgraded_to_missing_source(self):
        for review in ({"ambiguous_aptem_id": 1}, {"missing_source": 2, "invalid_date_range": 1}):
            with self.subTest(review=review), self.assertRaises(runner.SyncFailure):
                runner.cycle_result(self.result(status=1, review=review, stderr="CommandError: Partial sync:"))

    def test_failure_without_a_committed_report_cannot_be_treated_as_success(self):
        for process in (SimpleNamespace(returncode=1, stdout="", stderr="private driver detail"),
                        self.result(status=1, review={"missing_source": 2}),
                        self.result(status=2, review={"missing_source": 2}, stderr="CommandError: Partial sync:")):
            with self.subTest(process=process), self.assertRaises(runner.SyncFailure):
                runner.cycle_result(process)


if __name__ == "__main__":
    unittest.main()
