from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management.base import CommandError
from django.test import SimpleTestCase

from coach_api.management.commands import cleanup_named_test_review_events as module


def _record(event_id):
    expected = module.APPROVED_TEST_EVENTS[event_id]
    return SimpleNamespace(
        id=event_id,
        learner_id=expected["learner_id"],
        event_key=expected["event_key"],
        event_type="mcr",
        status="scheduled",
        target_date=date.fromisoformat(expected["target_date"]),
        scheduled_date=date.fromisoformat(expected["scheduled_date"]),
        scheduled_time=time.fromisoformat(expected["scheduled_time"]),
        review_template_id="",
        review_instance_id="",
        review_completed_at=None,
        manager_signed_at=None,
        review_responses={},
        graph_event_id=f"graph-{event_id}",
        graph_web_link=f"https://example.test/events/{event_id}",
        meeting_link=f"https://example.test/meetings/{event_id}",
        sync_state="synced",
    )


class NamedTestReviewCleanupTests(SimpleTestCase):
    def setUp(self):
        self.command = module.Command()
        self.records = [_record(event_id) for event_id in sorted(module.APPROVED_TEST_EVENTS)]

    def test_allowlist_is_exact_and_preserves_official_events(self):
        self.assertEqual(set(module.APPROVED_TEST_EVENTS), {128, 137, 144})
        self.assertEqual(module.OFFICIAL_EVENTS_TO_PRESERVE, {154, 160})
        self.command._guard_approved_identity(self.records)

    def test_identity_change_aborts(self):
        self.records[0].scheduled_time = time(9, 30)
        with self.assertRaisesMessage(CommandError, "changed since the production audit"):
            self.command._guard_approved_identity(self.records)

    def test_external_link_without_graph_id_aborts(self):
        self.records[0].graph_event_id = ""
        with self.assertRaisesMessage(CommandError, "cannot be cancelled safely"):
            self.command._guard_external_addressability(self.records)

    @patch.object(module.Command, "_report", return_value=[])
    @patch.object(module.Command, "_guard_no_recorded_activity")
    @patch.object(module.Command, "_guard_no_curriculum_linkage")
    @patch.object(module.Command, "_guard_approved_identity")
    @patch.object(module.Command, "_candidates")
    @patch.object(module.Command, "_cancel_external")
    @patch.object(module.Command, "_delete_local")
    def test_dry_run_never_calls_graph_or_deletes(
        self, delete_local, cancel_external, candidates, identity, linkage, activity, report
    ):
        candidates.return_value = self.records
        self.command.handle(dry_run=True, cancel_external=False, apply=False)
        cancel_external.assert_not_called()
        delete_local.assert_not_called()

    @patch.object(module.Command, "_report")
    @patch.object(module.Command, "_guard_no_recorded_activity")
    @patch.object(module.Command, "_guard_no_curriculum_linkage")
    @patch.object(module.Command, "_guard_approved_identity")
    @patch.object(module.Command, "_candidates")
    @patch.object(module.Command, "_guard_backup")
    @patch.object(module.Command, "_cancel_external")
    @patch.object(module.Command, "_delete_local")
    def test_graph_failure_prevents_local_delete(
        self, delete_local, cancel_external, backup, candidates, identity, linkage, activity, report
    ):
        candidates.return_value = self.records
        report.return_value = self.records
        cancel_external.return_value = ({128: "FAILED"}, [(self.records[0], "failure")])
        with self.assertRaisesMessage(CommandError, "No local rows were deleted"):
            self.command.handle(dry_run=False, cancel_external=False, apply=True)
        backup.assert_called_once()
        cancel_external.assert_called_once()
        delete_local.assert_not_called()
