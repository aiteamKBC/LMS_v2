"""Preparation remains readable without activation, DB writes or real email."""
import json
from datetime import date
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .apprenticeship_agreement import _group_dates
from .learner_progression import access_gate, advance_learner
from . import learner_detail, mappers
from .models import EnrolmentUser
from login import invitations


def learner(**overrides):
    fields = dict(pk=132, id=132, username="Prepared learner", email="learner@example.test",
                  phone_number="", programme="Programme", cohort="Oct 2025", group="Group",
                  learner_type="commercial", programme_status="Delivery", start_date=None,
                  end_date=None, practical_period_end_date=None, apprenticeship_end_date=None,
                  learning_plan=[{"moduleId": "M1", "moduleTitle": "Saved module", "weeks": []}],
                  training_plan=None, employer="", employer_id=None, aptem_id=None, save=Mock())
    fields.update(overrides)
    return SimpleNamespace(**fields)


class InvitationReadinessTests(SimpleTestCase):
    def setUp(self):
        for target, value in (
            ("learner_api.active_users.cohort_dates", (date(2025, 10, 1), None)),
            ("learner_api.learner_progression.timezone.localdate", date(2026, 9, 12)),
        ):
            patcher = patch(target, return_value=value)
            patcher.start()
            self.addCleanup(patcher.stop)

    def test_prepared_uninvited_learner_stays_delivery_with_correct_start_date(self):
        source = learner()
        with patch("learner_api.learner_progression._has_platform_invitation", return_value=False), \
                patch("learner_api.active_users.sync_active_user") as sync:
            gate = access_gate(source)
            self.assertIsNone(advance_learner(source))
        self.assertEqual(gate["reasons"], ["invitation"])
        self.assertEqual(gate["startDate"], "2025-10-01")
        self.assertEqual(source.programme_status, "Delivery")
        self.assertIsNone(source.start_date)
        source.save.assert_not_called()
        sync.assert_not_called()

    def test_successfully_invited_prepared_learner_can_activate(self):
        source = learner()
        with patch("learner_api.learner_progression._has_platform_invitation", return_value=True), \
                patch("learner_api.active_users.sync_active_user") as sync:
            self.assertEqual(access_gate(source)["reasons"], [])
            self.assertEqual(advance_learner(source), "Active")
        source.save.assert_called_once_with(update_fields=["programme_status"])
        sync.assert_called_once_with(source)

    def test_invitation_does_not_bypass_missing_plan_or_future_start(self):
        cases = [dict(learning_plan=[]), dict(start_date="2099-01-01"), dict(cohort="")]
        for fields in cases:
            with self.subTest(fields=fields), \
                    patch("learner_api.learner_progression._has_platform_invitation", return_value=True):
                source = learner(**fields)
                self.assertIsNone(advance_learner(source))
                source.save.assert_not_called()

    def test_existing_active_learners_are_never_demoted_or_resynced(self):
        source = learner(programme_status="Active", learning_plan=[], cohort="")
        with patch("learner_api.learner_progression._has_platform_invitation") as invited, \
                patch("learner_api.active_users.sync_active_user") as sync:
            self.assertIsNone(advance_learner(source))
            self.assertFalse(access_gate(source)["blocked"])
        self.assertEqual(source.programme_status, "Active")
        source.save.assert_not_called()
        sync.assert_not_called()
        invited.assert_not_called()

    def test_terminal_status_is_preserved_even_after_invitation(self):
        for status in ["Completed", "Withdrawn", "Break in learning"]:
            source = learner(programme_status=status)
            self.assertIsNone(advance_learner(source))
            source.save.assert_not_called()

    def test_individual_date_takes_precedence_over_cohort(self):
        source = learner(start_date="2024-11-04")
        self.assertEqual(_group_dates(source)[0], date(2024, 11, 4))

    def test_no_placement_does_not_invent_dates(self):
        self.assertEqual(_group_dates(learner(cohort="")), (None, None, "learner"))

    def test_complete_individual_dates_need_no_cohort_query(self):
        with patch("learner_api.active_users.cohort_dates") as query:
            result = _group_dates(learner(start_date="2025-03-01", end_date="2027-03-01"))
        self.assertEqual(result, (date(2025, 3, 1), date(2027, 3, 1), "learner"))
        query.assert_not_called()

    def test_summary_exposes_cohort_date_without_activating_or_saving(self):
        source = learner()
        with patch.object(EnrolmentUser.all_learners, "only") as query, \
                patch("learner_api.learner_progression._has_platform_invitation", return_value=False), \
                patch.object(learner_detail, "advance_learner") as advance:
            query.return_value.get.return_value = source
            response = learner_detail.learner_summary.__wrapped__(RequestFactory().get("/"), "commercial", 132)
        payload = json.loads(response.content)
        self.assertEqual(payload["programmeStartDate"], "2025-10-01")
        self.assertEqual(payload["programmeStatus"], "Delivery")
        self.assertFalse(payload["isActive"])
        self.assertEqual(payload["accessGate"]["reasons"], ["invitation"])
        advance.assert_not_called()
        source.save.assert_not_called()

    def test_saved_progress_and_ksbs_are_returned_without_claiming_active(self):
        source = learner()
        progress = [{"kind": "component", "componentId": "C1", "ksbs": ["K1"]}]
        profile = SimpleNamespace(lifecycle_status="delivery", training_plan_progress=progress,
                                  ksbs=[{"code": "K1"}], activity_feed_entries=Mock(return_value=[{"id": "saved"}]))
        with patch("learner_api.active_users.current_curriculum_ksb_items_for_learner", return_value=[]), \
                patch.object(mappers, "_component_marking_statuses", return_value={}), \
                patch.object(learner_detail, "learner_profile_for_source", return_value=profile) as resolve, \
                patch.object(learner_detail, "prefetch_related_objects"):
            saved = learner_detail._active_profile_for_source(source, source.pk)
            payload = mappers.to_learner_detail(source, saved)
        resolve.assert_called_once_with(source, source.pk)
        self.assertFalse(payload["isActive"])
        self.assertEqual(payload["programmeStatus"], "Delivery")
        self.assertEqual(payload["modules"], ["Saved module"])
        self.assertEqual(payload["componentProgress"], progress)
        self.assertEqual(payload["ksbs"], [{"code": "K1"}])
        self.assertEqual(payload["programmeStartDate"], "2025-10-01")


class InvitationReleaseTests(SimpleTestCase):
    def send(self, sent, subject_type="learner"):
        account = SimpleNamespace(id=7, subject_id=132, subject_type=subject_type,
                                  display_name="Prepared learner", email="learner@example.test")
        invitation = SimpleNamespace(save=Mock())
        with patch.object(invitations, "create_invitation", return_value=(invitation, "test-token")), \
                patch.object(invitations.email_azure, "invitation_message", return_value=("subject", "html", "text")), \
                patch.object(invitations.email_azure, "send_mail", return_value=(sent, "transport result")), \
                patch.object(invitations, "record"), \
                patch("learner_api.learner_progression.advance_learner_by_id") as advance:
            result = invitations.send_invitation(account)
        return invitation, result, advance

    def test_successful_send_rechecks_only_the_invited_learner(self):
        invitation, result, advance = self.send(True)
        self.assertIsNotNone(invitation.sent_at)
        self.assertTrue(result[1])
        advance.assert_called_once_with(132)

    def test_failed_email_never_activates_the_learner(self):
        invitation, result, advance = self.send(False)
        self.assertIsNone(invitation.sent_at)
        self.assertFalse(result[1])
        advance.assert_not_called()

    def test_staff_invitation_never_changes_learner_status(self):
        _, _, advance = self.send(True, subject_type="staff")
        advance.assert_not_called()
