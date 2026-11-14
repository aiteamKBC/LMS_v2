"""Active imports need a validated learning owner, without writes on reads.

All persistence and external boundaries are mocked; these tests use no database.
"""
from io import StringIO
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.db import DatabaseError
from django.core.management.base import CommandError
from django.test import RequestFactory, SimpleTestCase
from old_otjh.service import ServiceError

from . import active_users, canonical_learning, learning_plan, views
from .models import EnrolmentUser
from .tests_invitation_readiness import learner


class MissingLearningIdentityTests(SimpleTestCase):
    def setUp(self):
        self.source = learner(programme_status="Active", aptem_id="000123")
        self.profile = SimpleNamespace(pk=9001, enrolment_id=self.source.pk, aptem_id=123)
        self.source_model = self.enterContext(patch.object(active_users, "EnrolmentUser"))
        self.source_model.all_learners.select_for_update.return_value.get.return_value = self.source
        self.source_model.all_learners.annotate.return_value.filter.return_value.exclude.return_value.exists.return_value = False
        self.profiles = self.enterContext(patch.object(active_users, "LearnerProfile"))
        self.profiles.objects.filter.return_value.first.return_value = None
        self.atomic = self.enterContext(patch.object(active_users.transaction, "atomic"))
        self.legacy = self.enterContext(patch(
            "learner_api.identity.learner_profile_for_source", return_value=None
        ))
        self.sync = self.enterContext(patch.object(active_users, "sync_active_user", return_value=self.profile))
        self.validate = self.enterContext(patch.object(canonical_learning, "require_profile", return_value={"id": 9001}))

    def test_missing_active_profile_is_created_and_validated_by_enrolment_id(self):
        self.assertIs(active_users.ensure_active_learner_profile(self.source), self.profile)
        self.source_model.all_learners.select_for_update.return_value.get.assert_called_once_with(pk=132)
        self.sync.assert_called_once_with(self.source)
        self.validate.assert_called_once_with(132)

    def test_existing_profile_is_not_rebuilt_on_retries(self):
        self.profiles.objects.filter.return_value.first.return_value = self.profile
        self.assertIs(active_users.ensure_active_learner_profile(self.source), self.profile)
        self.sync.assert_not_called()
        self.legacy.assert_not_called()
        self.validate.assert_called_once_with(132)

    def test_non_active_enrolments_never_gain_a_delivery_profile(self):
        for status in ("Delivery", "Onboarding", "Withdrawn", "Completed", "On break"):
            with self.subTest(status=status):
                self.source.programme_status = status
                self.assertIsNone(active_users.ensure_active_learner_profile(self.source))
        self.sync.assert_not_called()
        self.validate.assert_not_called()

    def test_duplicate_enrolment_email_is_not_linked_or_created(self):
        self.source_model.all_learners.annotate.return_value.filter.return_value.exclude.return_value.exists.return_value = True
        with self.assertRaisesMessage(DatabaseError, "email identity needs review"):
            active_users.ensure_active_learner_profile(self.source)
        self.sync.assert_not_called()

    def test_conflicting_legacy_aptem_identity_is_not_overwritten(self):
        self.legacy.return_value = SimpleNamespace(aptem_id=456)
        with self.assertRaisesMessage(DatabaseError, "identity needs review"):
            active_users.ensure_active_learner_profile(self.source)
        self.sync.assert_not_called()

    def test_failed_creation_is_an_error_not_success(self):
        self.sync.return_value = None
        with self.assertRaisesMessage(DatabaseError, "Could not create"):
            active_users.ensure_active_learner_profile(self.source)
        self.validate.assert_not_called()

    def test_validation_failure_escapes_the_atomic_block_for_rollback(self):
        self.validate.side_effect = ServiceError("Conflict", "identity_review_required", 409)
        with self.assertRaisesMessage(DatabaseError, "identity needs review"):
            active_users.ensure_active_learner_profile(self.source)
        error_type = self.atomic.return_value.__exit__.call_args.args[0]
        self.assertIs(error_type, DatabaseError)


class ActiveProfileAptemTests(SimpleTestCase):
    def sync(self, value, existing=None):
        source = learner(programme_status="Active", aptem_id=value)
        with patch("learner_api.apprenticeship_agreement._group_dates", return_value=(None, None, None)), \
             patch("learner_api.coach_assignment.source_coach_id", return_value=None), \
             patch.object(active_users.transaction, "atomic"), \
             patch("learner_api.placement_links.placement_profile", return_value=existing), \
             patch.object(active_users, "hydrate_source_training_plan", return_value=source.learning_plan), \
             patch.object(active_users, "LearnerProfile") as model, \
             patch.object(active_users, "replace_training_plan"), \
             patch.object(active_users, "refresh_learner_ksb_snapshot"):
            result = active_users.sync_active_user(source)
        return result, model

    def test_imported_aptem_id_is_copied_as_a_normalised_bigint(self):
        for value in (123, "000123", " 123 "):
            with self.subTest(value=value):
                result, model = self.sync(value)
                self.assertIs(result, model.objects.create.return_value)
                self.assertEqual(model.objects.create.call_args.kwargs["aptem_id"], 123)
                self.assertEqual(model.objects.create.call_args.kwargs["enrolment_id"], 132)

    def test_missing_source_id_preserves_a_legacy_profile_id(self):
        existing = SimpleNamespace(aptem_id=456, save=Mock())
        self.sync(None, existing)
        self.assertEqual(existing.aptem_id, 456)
        self.assertNotIn("aptem_id", existing.save.call_args.kwargs["update_fields"])

    def test_invalid_source_id_cannot_create_an_unusable_owner(self):
        for value in ("bad-id", "0", "-1", "9223372036854775808"):
            with self.subTest(value=value):
                result, model = self.sync(value)
                self.assertIsNone(result)
                model.objects.create.assert_not_called()


class ActiveIdentityWritePathTests(SimpleTestCase):
    def test_native_creation_with_active_status_provisions_the_owner(self):
        source = learner(programme_status="Active")
        with patch.object(views, "validate_placement"), \
             patch.object(views, "cohort_delivery_window", return_value=(None, None, None)), \
             patch.object(views.transaction, "atomic"), \
             patch.object(EnrolmentUser.all_learners, "create", return_value=source), \
             patch.object(views, "sync_active_user"), \
             patch.object(views, "placement_profile", return_value=SimpleNamespace(pk=9001)), \
             patch.object(views, "advance_learner"), \
             patch.object(views, "to_list_row", return_value={}), \
             patch.object(views, "_send_platform_invitation", return_value={}), \
             patch.object(active_users, "ensure_active_learner_profile") as ensure:
            views._create_enrolment_user(RequestFactory().post("/"), {"programme_id": "PROGRAMME-1"})
        ensure.assert_called_once_with(source)

    def test_plan_save_repairs_missing_active_owner_without_replacing_hydrated_children(self):
        source = learner(programme_status="Active")
        with patch.object(learning_plan, "EnrolmentUser"), \
             patch("learner_api.models.LearnerProfile") as profiles, \
             patch.object(active_users, "ensure_active_learner_profile") as ensure, \
             patch.object(active_users, "replace_training_plan") as replace:
            profiles.objects.only.return_value.filter.return_value.first.return_value = None
            self.assertEqual(learning_plan.sync_learning_plan_mirror(source, strict=True), 1)
        ensure.assert_called_once_with(source)
        replace.assert_not_called()

    def test_draft_plan_save_does_not_create_an_active_owner(self):
        source = learner(programme_status="Delivery")
        with patch.object(learning_plan, "EnrolmentUser"), \
             patch("learner_api.models.LearnerProfile") as profiles, \
             patch.object(active_users, "ensure_active_learner_profile") as ensure, \
             patch.object(active_users, "replace_training_plan"):
            profiles.objects.only.return_value.filter.return_value.first.return_value = None
            learning_plan.sync_learning_plan_mirror(source, strict=True)
        ensure.assert_not_called()

    def test_audit_import_ensures_new_and_existing_active_identities(self):
        from .management.commands import import_audit_learners as importer
        source = learner(programme_status="Active")
        snapshot = {"learner_name": "Synthetic Learner", "learner_email": "learner@example.test",
                    "lms_learner_name": "", "programme_name": "Associate Project Manager Level 4",
                    "planned_hours_total": 100, "aptem_id": 123}
        for existing in ({}, {"learner@example.test": 132}):
            with self.subTest(existing=bool(existing)):
                command = importer.Command(stdout=StringIO(), stderr=StringIO())
                with patch.object(command, "_snapshot_rows", return_value=[snapshot]), \
                     patch.object(command, "_known_programmes", return_value={snapshot["programme_name"]}), \
                     patch.object(command, "_existing_emails", return_value=existing), \
                     patch.object(importer.transaction, "atomic"), \
                     patch.object(importer, "connections", {"enrolment": MagicMock()}), \
                     patch("learner_api.models.EnrolmentUser") as model, \
                     patch.object(active_users, "ensure_active_learner_profile") as ensure:
                    model.objects.create.return_value = source
                    model.all_learners.get.return_value = source
                    command.handle(apply=True)
                ensure.assert_called_once_with(source)


class ScopedIdentityRepairTests(SimpleTestCase):
    def run_command(self, apply, *, linked=False, status="Active"):
        from .management.commands import repair_missing_learner_profiles as repair
        source = learner(programme_status=status)
        command = repair.Command(stdout=StringIO())
        with patch.object(repair.transaction, "atomic"), \
             patch.object(repair, "EnrolmentUser") as model, \
             patch.object(repair, "LearnerProfile") as profiles, \
             patch.object(repair, "ensure_active_learner_profile") as ensure:
            query = model.all_learners.filter.return_value.order_by.return_value
            query.__iter__.return_value = iter([source])
            query.select_for_update.return_value.__iter__.return_value = iter([source])
            profiles.objects.filter.return_value.exists.return_value = linked
            command.handle(learner=[132], apply=apply)
        model.all_learners.filter.assert_called_once_with(pk__in=[132])
        return source, ensure, command.stdout.getvalue()

    def test_dry_run_reports_only_and_never_syncs(self):
        _, ensure, output = self.run_command(False)
        ensure.assert_not_called()
        self.assertIn("Dry run", output)

    def test_apply_targets_only_the_selected_missing_owner(self):
        source, ensure, output = self.run_command(True)
        ensure.assert_called_once_with(source)
        self.assertIn("Repaired 1 learner(s)", output)

    def test_repeat_does_not_rebuild_existing_profile_or_history(self):
        _, ensure, output = self.run_command(True, linked=True)
        ensure.assert_not_called()
        self.assertIn("already linked; unchanged", output)

    def test_non_active_selection_is_refused(self):
        with self.assertRaisesMessage(CommandError, "is not Active"):
            self.run_command(True, status="Delivery")

    def test_unknown_selected_id_prevents_all_repairs(self):
        from .management.commands import repair_missing_learner_profiles as repair
        command = repair.Command(stdout=StringIO())
        with patch.object(repair.transaction, "atomic"), \
             patch.object(repair, "EnrolmentUser") as model, \
             patch.object(repair, "ensure_active_learner_profile") as ensure:
            model.all_learners.filter.return_value.order_by.return_value.select_for_update.return_value.__iter__.return_value = iter([])
            with self.assertRaisesMessage(CommandError, "not found"):
                command.handle(learner=[132], apply=True)
        ensure.assert_not_called()

    def test_negative_id_is_refused_before_database_access(self):
        from .management.commands import repair_missing_learner_profiles as repair
        with patch.object(repair, "EnrolmentUser") as model:
            with self.assertRaisesMessage(CommandError, "positive integers"):
                repair.Command().handle(learner=[-1], apply=True)
        model.all_learners.filter.assert_not_called()
