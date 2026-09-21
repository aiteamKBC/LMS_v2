"""No-Django safety tests for the confirmed Test cleanup allowlist.

Run: python -I backend/coach_api/test_cleanup_test_review_data_no_db.py
"""

import ast
import sys
import unittest
from contextlib import contextmanager
from datetime import date, time
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock


BACKEND = Path(__file__).resolve().parents[1]
SOURCE = BACKEND / "coach_api/management/commands/cleanup_test_review_data.py"


class CommandError(Exception):
    pass


class BaseCommand:
    def __init__(self):
        self.stdout = SimpleNamespace(write=Mock())
        self.style = SimpleNamespace(WARNING=lambda value: value, SUCCESS=lambda value: value)


def load_cleanup_namespace():
    tree = ast.parse(SOURCE.read_text(encoding="utf-8-sig"))
    wanted_assignments = {
        "BACKUP_RELATION", "APPROVED_TEST_EVENTS", "APPROVED_TEST_SUBMISSIONS",
        "INCOMPLETE_FINGERPRINT_EVENT_IDS", "AWAITING_OWNER_CONTENT_APPROVAL_EVENT_IDS",
    }
    nodes = []
    for node in tree.body:
        if isinstance(node, ast.FunctionDef) and node.name in {"_fingerprint", "_normalise"}:
            nodes.append(node)
        elif isinstance(node, ast.Assign):
            names = {target.id for target in node.targets if isinstance(target, ast.Name)}
            if names & wanted_assignments:
                nodes.append(node)
        elif isinstance(node, ast.ClassDef) and node.name == "Command":
            nodes.append(node)
    namespace = {
        "date": date,
        "time": time,
        "clean_text": lambda value: str(value or "").strip(),
        "BaseCommand": BaseCommand,
        "CommandError": CommandError,
        "CoachCalendarEvent": SimpleNamespace,
        "router": SimpleNamespace(db_for_write=lambda model: "default"),
    }
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(SOURCE), "exec"), namespace)
    return namespace


class RecordingCursor:
    """Records every statement _delete_local issues, executing none of them."""

    def __init__(self):
        self.statements = []
        self._rows = [(0,)]
        self.rowcount = 0

    def execute(self, sql, params=None):
        normalised = " ".join(sql.lower().split())
        self.statements.append((normalised, params))
        if normalised.startswith("select to_regclass"):
            self._rows = [("present",)]
        elif (
            normalised.startswith("select count(*)")
            and "learning_reflection_submissions" in normalised
            and "id::text = any(" in normalised
        ):
            # Surviving-submission check: every allowlisted row is still there,
            # because the repair updates rather than deletes.
            self._rows = [(len(params[0]),)]
        else:
            # Everything else (deleted targets, dangling pointers) is clean.
            self._rows = [(0,)]
        self.rowcount = 0

    def fetchone(self):
        return self._rows[0]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


@contextmanager
def _noop_atomic(using=None):
    yield


class FakeCalendarManager:
    def __init__(self, log):
        self.log = log

    def filter(self, **kwargs):
        log = self.log

        class QuerySet:
            def delete(self):
                log.append("CALENDAR_DELETE")
                return 4, {}

            def count(self):
                return 0

        return QuerySet()


#: Authoritative identity, transcribed from the owner's read-only production
#: verification on 2026-09-17. DELIBERATELY INDEPENDENT of the command's own
#: APPROVED_TEST_EVENTS: building the expected record from the allowlist under
#: test makes the assertion circular, so a fabricated value would pass. If
#: production really changes, update this table from a fresh read-only query --
#: never by copying whatever the command happens to contain.
AUTHORITATIVE_PRODUCTION_IDENTITY = {
    129: {
        "learner_id": 211, "learner_name": "Ayman Learner", "event_type": "mcr",
        "event_key": "mcr:211:2:2026-11-30", "target_date": date(2026, 11, 30),
        "status": "scheduled", "review_instance_id": "",
    },
    130: {
        "learner_id": 211, "learner_name": "Ayman Learner", "event_type": "mcr",
        "event_key": "mcr:211:3:2026-12-30", "target_date": date(2026, 12, 30),
        "status": "scheduled", "review_instance_id": "",
    },
    133: {
        "learner_id": 211, "learner_name": "Ayman Learner", "event_type": "mcr",
        "event_key": "mcr:211:4:2027-01-29", "target_date": date(2027, 1, 29),
        "status": "scheduled", "review_instance_id": "",
    },
    138: {
        "learner_id": 211, "learner_name": "Ayman Learner", "event_type": "mcr",
        "event_key": "review:211:REV-20260911222203147494:1",
        "target_date": date(2026, 11, 1), "status": "awaiting-signature",
        "review_instance_id": "REVI-20260914152144124774C6663F80EFCA",
    },
}

#: Same rule for the assignment submissions whose stale pointer is repaired.
AUTHORITATIVE_PRODUCTION_SUBMISSIONS = {
    "d14c4a32-8139-45c4-9b1e-92933ceb612d": ("499", "mcr:211:1:2026-10-31"),
    "77c76d01-be3d-4641-baa4-4917f2032d8b": ("101", "mcr:248:2:2026-09-22"),
    "bfffba78-3f83-4778-8edd-c6c853395072": ("101", "mcr:248:3:2026-10-05"),
    "d551505d-478d-4210-93aa-9798703f04ae": ("101", "mcr:248:1:2026-09-02"),
    "321c6951-5916-43b9-9b50-b80b7d2fe538": ("501", "mcr:647:1:2026-09-21"),
}


class CleanupAllowlistSafetyTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ns = load_cleanup_namespace()

    def record(self, event_id):
        """A synthetic row built from the AUTHORITATIVE table, never from the
        allowlist under test -- so a fabricated fingerprint fails here."""
        truth = AUTHORITATIVE_PRODUCTION_IDENTITY[event_id]
        return SimpleNamespace(id=event_id, **truth)

    def test_ayman_is_cleanup_only_and_all_four_ids_are_guarded(self):
        allowlist = self.ns["APPROVED_TEST_EVENTS"]
        self.assertTrue({129, 130, 133, 138}.issubset(allowlist))
        self.assertTrue(all(allowlist[event_id]["learner_id"] == 211
                            for event_id in (129, 130, 133, 138)))

    def test_real_reconciled_events_are_never_cleanup_targets(self):
        allowlist = self.ns["APPROVED_TEST_EVENTS"]
        self.assertTrue({146, 148, 149, 150, 151, 152, 156}.isdisjoint(allowlist))

    def test_unconfirmed_aya_candidates_are_not_cleanup_targets(self):
        allowlist = self.ns["APPROVED_TEST_EVENTS"]
        self.assertTrue({132, 134, 135, 136, 154, 160, 161, 167, 168, 169, 174}.isdisjoint(allowlist))

    def test_every_calendar_target_has_multiple_identity_guards(self):
        for event_id, fingerprint in self.ns["APPROVED_TEST_EVENTS"].items():
            with self.subTest(event_id=event_id):
                self.assertGreaterEqual(len(fingerprint), 4)
                self.assertIn("learner_id", fingerprint)
                self.assertIn("learner_name", fingerprint)
                self.assertIn("event_type", fingerprint)
                self.assertIn("status", fingerprint)

    def test_every_fingerprint_matches_authoritative_production_identity(self):
        """The allowlist must equal the independently recorded production truth.

        This is what catches a fabricated value: event 138 previously carried
        event_key 'mcr:211:5:2027-02-28' and target_date 2027-02-28, neither of
        which exists in production.
        """
        allowlist = self.ns["APPROVED_TEST_EVENTS"]
        self.assertEqual(set(allowlist), set(AUTHORITATIVE_PRODUCTION_IDENTITY))
        for event_id, truth in AUTHORITATIVE_PRODUCTION_IDENTITY.items():
            fingerprint = allowlist[event_id]
            for field in ("event_key", "target_date", "review_instance_id",
                          "learner_id", "learner_name", "event_type", "status"):
                if field == "review_instance_id" and not truth[field]:
                    # Unlinked rows have nothing to pin; the others must match.
                    continue
                with self.subTest(event_id=event_id, field=field):
                    self.assertIn(field, fingerprint)
                    self.assertEqual(fingerprint[field], truth[field])

    def test_event_138_pins_key_target_and_instance_exactly(self):
        fingerprint = self.ns["APPROVED_TEST_EVENTS"][138]
        self.assertEqual(fingerprint["event_key"], "review:211:REV-20260911222203147494:1")
        self.assertEqual(fingerprint["target_date"], date(2026, 11, 1))
        self.assertEqual(
            fingerprint["review_instance_id"], "REVI-20260914152144124774C6663F80EFCA",
        )

    def test_each_authoritative_field_change_is_rejected(self):
        """Changing event_key, target_date or review_instance_id must abort."""
        command = self.ns["Command"]()
        for field, wrong in (
            ("event_key", "mcr:211:5:2027-02-28"),
            ("target_date", date(2027, 2, 28)),
            ("review_instance_id", "__OWNER_VERIFY_EVENT_138_INSTANCE__"),
        ):
            with self.subTest(field=field):
                record = self.record(138)
                setattr(record, field, wrong)
                with self.assertRaisesRegex(CommandError, "fingerprint changed"):
                    command._guard_calendar_fingerprints([record])

    def test_all_five_stale_submissions_share_one_repair_policy(self):
        approved = self.ns["APPROVED_TEST_SUBMISSIONS"]
        self.assertEqual(set(approved), set(AUTHORITATIVE_PRODUCTION_SUBMISSIONS))
        for submission_id, (learner_id, meeting_key) in AUTHORITATIVE_PRODUCTION_SUBMISSIONS.items():
            with self.subTest(submission_id=submission_id):
                self.assertEqual(approved[submission_id]["learner_id"], learner_id)
                self.assertEqual(approved[submission_id]["meeting_key"], meeting_key)

    def test_submissions_are_identified_in_submission_id_space(self):
        """Never by calendar/mirror learner id (211, 248, 647)."""
        calendar_space = {"211", "248", "647"}
        for fingerprint in self.ns["APPROVED_TEST_SUBMISSIONS"].values():
            self.assertNotIn(fingerprint["learner_id"], calendar_space)

    def _run_delete_local(self):
        """Execute the real _delete_local against a recording cursor."""
        ns = load_cleanup_namespace()
        cursor = RecordingCursor()
        log = []
        ns["transaction"] = SimpleNamespace(atomic=_noop_atomic)
        ns["connections"] = {"default": SimpleNamespace(cursor=lambda: cursor)}
        ns["CoachCalendarEvent"] = SimpleNamespace(objects=FakeCalendarManager(log))
        ns["DEPENDENT_RELATIONS"] = ('"Coach".coach_meeting_attendance',)
        command = ns["Command"]()
        records = [
            SimpleNamespace(id=event_id, event_key=truth["event_key"])
            for event_id, truth in AUTHORITATIVE_PRODUCTION_IDENTITY.items()
        ]
        instances = [{"id": "REVI-20260914152144124774C6663F80EFCA"}]
        submissions = [{"id": key} for key in AUTHORITATIVE_PRODUCTION_SUBMISSIONS]

        def record_order(sql, params=None):
            normalised = " ".join(sql.lower().split())
            if "learning_reflection_submissions" in normalised and normalised.startswith("update"):
                log.append("POINTER_REPAIR")
            RecordingCursor.execute(cursor, sql, params)

        cursor.execute = record_order
        command._delete_local(records, instances, submissions, "default")
        return cursor, log

    def test_delete_local_never_deletes_a_submission(self):
        cursor, _log = self._run_delete_local()
        for sql, _params in cursor.statements:
            with self.subTest(sql=sql[:70]):
                self.assertFalse(
                    sql.startswith("delete") and "learning_reflection_submissions" in sql,
                    "learner assignment work must never be deleted",
                )

    def test_delete_local_clears_only_the_nested_meeting_key(self):
        cursor, _log = self._run_delete_local()
        repairs = [
            (sql, params) for sql, params in cursor.statements
            if sql.startswith("update") and "learning_reflection_submissions" in sql
        ]
        self.assertEqual(len(repairs), 1)
        sql, params = repairs[0]
        # jsonb_set rewrites one path and preserves the rest of full_submission.
        self.assertIn("jsonb_set", sql)
        self.assertIn("'{monthlyassignment,meetingkey}'", sql)
        self.assertIn("set full_submission = jsonb_set(", sql)
        # Only that one key is touched -- no wholesale full_submission replacement.
        self.assertNotIn("set full_submission = '", sql)
        # Guarded so a still-resolvable pointer is left alone.
        self.assertIn("not exists", sql)
        # Scoped to the reviewed allowlist, in SUBMISSION id space.
        self.assertEqual(sorted(params[0]), sorted(AUTHORITATIVE_PRODUCTION_SUBMISSIONS))

    def test_pointer_repair_runs_after_calendar_deletion(self):
        _cursor, log = self._run_delete_local()
        self.assertIn("CALENDAR_DELETE", log)
        self.assertIn("POINTER_REPAIR", log)
        self.assertLess(
            log.index("CALENDAR_DELETE"), log.index("POINTER_REPAIR"),
            "the repair's NOT EXISTS check must see the post-delete world, "
            "otherwise this run can leave the pointers it deleted dangling",
        )

    def test_delete_local_verifies_no_dangling_pointer_remains(self):
        cursor, _log = self._run_delete_local()
        verification = [
            sql for sql, _params in cursor.statements
            if sql.startswith("select count(*)") and "learning_reflection_submissions" in sql
        ]
        self.assertGreaterEqual(
            len(verification), 2,
            "expected post-delete checks for dangling pointers and surviving submissions",
        )

    def test_cleanup_source_repairs_only_stale_pointer(self):
        source = SOURCE.read_text(encoding="utf-8-sig")
        self.assertIn("jsonb_set", source)
        self.assertIn("KEEP_SUBMISSION_CLEAR_MEETING_KEY", source)
        self.assertNotIn('delete from "Learner".learning_reflection_submissions', source)

    def test_changed_fingerprint_aborts_the_batch(self):
        command = self.ns["Command"]()
        record = self.record(129)
        record.event_key = "mcr:211:999:changed"

        with self.assertRaisesRegex(CommandError, "fingerprint changed"):
            command._guard_calendar_fingerprints([record])

    def test_exact_fingerprints_pass(self):
        command = self.ns["Command"]()
        records = [self.record(event_id) for event_id in self.ns["APPROVED_TEST_EVENTS"]]
        command._guard_calendar_fingerprints(records)

    def test_dry_run_never_reaches_backup_graph_or_delete(self):
        command = self.ns["Command"]()
        command._calendar_records = Mock(return_value=[])
        command._guard_calendar_fingerprints = Mock()
        command._submission_rows = Mock(return_value=[])
        command._instances_and_counts = Mock(return_value=([], {}))
        command._report = Mock()
        command._guard_backup = Mock(side_effect=AssertionError("backup/write phase reached"))
        command._cancel_external = Mock(side_effect=AssertionError("Graph phase reached"))
        command._delete_local = Mock(side_effect=AssertionError("delete phase reached"))

        command.handle(dry_run=True, cancel_external=False, apply=False)

        command._guard_backup.assert_not_called()
        command._cancel_external.assert_not_called()
        command._delete_local.assert_not_called()

    def _stubbed_command(self):
        command = self.ns["Command"]()
        command._calendar_records = Mock(return_value=[])
        command._guard_calendar_fingerprints = Mock()
        command._submission_rows = Mock(return_value=[])
        command._instances_and_counts = Mock(return_value=([], {}))
        command._report = Mock()
        command._guard_backup = Mock(side_effect=AssertionError("backup phase reached"))
        return command

    def test_event_138_still_blocks_every_destructive_mode(self):
        """Identity is now complete, so the remaining block is owner sign-off
        on destroying 138's linked Review content."""
        self.assertIn(138, self.ns["AWAITING_OWNER_CONTENT_APPROVAL_EVENT_IDS"])
        for mode in ("cancel_external", "apply"):
            with self.subTest(mode=mode):
                command = self._stubbed_command()
                options = {"dry_run": False, "cancel_external": False, "apply": False}
                options[mode] = True
                with self.assertRaisesRegex(CommandError, "signs off"):
                    command.handle(**options)
                command._guard_backup.assert_not_called()

    def test_incomplete_fingerprint_gate_still_blocks_when_populated(self):
        command = self._stubbed_command()
        self.ns["INCOMPLETE_FINGERPRINT_EVENT_IDS"] = frozenset({999})
        try:
            with self.assertRaisesRegex(CommandError, "full reviewed fingerprints"):
                command.handle(dry_run=False, cancel_external=True, apply=False)
        finally:
            self.ns["INCOMPLETE_FINGERPRINT_EVENT_IDS"] = frozenset()
        command._guard_backup.assert_not_called()


if __name__ == "__main__":
    if not sys.flags.isolated:
        raise RuntimeError("Run with python -I to avoid application imports.")
    unittest.main()
