"""Scheduled continuation through real readers/writers with synthetic IO only."""
from contextlib import nullcontext
from datetime import date, time
from copy import copy, deepcopy
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import Mock

from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from . import views, migrated_completion_views, migrated_progress_views
from .migrated_completion import complete, requirements_for_family, submit
from .migrated_summary_binding import answer_version, populate_answer
from . import test_migrated_reviews as reader_fixtures


OWNER = "coach@example.invalid"
KEY = "imported-review:A-7"
FAMILIES = {"MCM": "Monthly Coaching Meeting", "PR": "Progress Review",
            "PR_SKILLS_RADAR": "Progress Review (+ Skills Radar)"}


class ScheduledContinuationTests(SimpleTestCase):
    _patch = reader_fixtures.MigratedPreviewTests._patch
    _set_source_status = reader_fixtures.MigratedPreviewTests._set_source_status
    _get = reader_fixtures.MigratedPreviewTests._get

    def setUp(self):
        reader_fixtures.MigratedPreviewTests.setUp(self)
        self.view_as.return_value = False
        self.factory = RequestFactory()
        self._patch("coach_api.reconciliation_links.active_links").return_value.select_related.return_value.first.return_value = None
        self._patch("coach_api.views.curriculum_review_instances.progress_review_rag_history", return_value=[])
        for name in ("ensure_review_instance", "save_review_instance_answers"):
            self._patch(f"coach_api.views.curriculum_review_instances.{name}", side_effect=AssertionError("Native write"))
        self._patch("coach_api.views.build_progress_snapshot", side_effect=AssertionError("GET calculated"))
        self._patch("coach_api.migrated_progress.build_progress_snapshot", side_effect=AssertionError("Implicit calculation"))
        self._patch("coach_api.views.transaction.atomic", side_effect=lambda: nullcontext())
        self.sync = self._patch("coach_api.migrated_template_sync.synchronize_definition_locked", return_value=False)
        self._patch("coach_api.migrated_completion_views.synchronize_definition_locked", side_effect=lambda *a: self.sync(*a))
        self._patch("coach_api.migrated_completion_views.authenticated_coach_email", return_value=OWNER)
        self._patch("coach_api.migrated_progress_views.authenticated_coach_email", return_value=OWNER)
        self.order = []
        self._patch("coach_api.views.lock_learner_calendar", side_effect=lambda *a: self.order.append("learner"))
        self.booking = self._patch("coach_api.review_sources.booking_for_overlay", side_effect=self._booking)
        self._patch("coach_api.migrated_completion_views.booking_for_overlay", side_effect=self._booking)
        self.calendar_updates = self._patch("coach_api.migrated_completion_views.CoachCalendarEvent.objects.filter")
        self.calendar_updates.return_value.__getitem__.return_value = []
        self._new_overlay("MCM")

    def _booking(self, overlay, *, lock=False):
        if lock:
            self.order.append("calendar")
        return self.calendar

    def _new_overlay(self, family):
        self._set_source_status("Not Scheduled")
        row = list(self.cursor.fetchall.return_value[0])
        row[3] = row[4] = FAMILIES[family]
        self.cursor.fetchall.return_value = [tuple(row)]
        snapshot = deepcopy(self.definition_json)
        snapshot["templateSource"] = {"id": 1, "family": family, "scope": "GLOBAL"}
        snapshot["sections"][0]["fields"][0]["semanticKey"] = "meeting_summary"
        self.saved = SimpleNamespace(
            pk=1, event_key=KEY, owner_email=OWNER, learner_id=21, source_review_id=407,
            status="scheduled", completed_at=None, updated_at=timezone.now(),
            template_snapshot=snapshot, migrated_template_id=1,
            migrated_template=SimpleNamespace(review_family=family, scope="GLOBAL", programme_key="", is_active=True),
            answers={}, progress_snapshot={"recorded": "frozen synthetic metrics"},
            meeting_intelligence={}, signature_requirements=requirements_for_family(family),
            migrated_signatures=Mock(), save=Mock(),
        )
        self.saved.migrated_signatures.all.return_value = []
        self.saved.migrated_signatures.exists.return_value = False
        self.saved.migrated_signatures.values_list.return_value = []
        self.overlays.return_value.first.return_value = self.saved
        self.overlays.return_value.select_for_update.return_value.first.side_effect = lambda: self.order.append("overlay") or self.saved
        self.calendar = SimpleNamespace(pk=91, event_key=KEY, learner_id=21, owner_email=OWNER,
            event_type="mcr" if family == "MCM" else "progress-review", status="scheduled",
            sync_state="synced", graph_event_id="synthetic-meeting", meeting_link="https://example.invalid/meeting", save=Mock(),
            scheduled_date=date(2026, 10, 20), scheduled_time=time(10), duration_minutes=60)
        self.answers = {"section-0:comment": "Coach's saved summary", "section-0:choice": "Good", "section-0:check": "no"}
        self.order.clear()
        self.calendar_updates.reset_mock()

    def _post(self, fn, **payload):
        return unwrap(fn)(self.factory.post("/", data=json.dumps(payload), content_type="application/json"), KEY)

    def _submit(self, **overrides):
        return self._post(migrated_completion_views.migrated_review_submit,
                          **{"answers": self.answers, "answerVersion": answer_version(self.saved), **overrides})

    def test_scheduled_get_save_summary_and_clear_stay_scheduled_for_all_families(self):
        for family in FAMILIES:
            with self.subTest(family=family):
                self._new_overlay(family)
                source = deepcopy(self.cursor.fetchall.return_value)
                definition = self._get()
                self.assertFalse(definition["readOnly"])
                self.assertTrue(definition["migratedForm"])
                self.assertEqual(definition["localStatus"], "scheduled")
                self.assertEqual(definition["sourceStatus"], "Not Scheduled")
                self.assertEqual(definition["progressSnapshot"], self.saved.progress_snapshot if family != "MCM" else None)
                self.saved.save.assert_not_called()
                for summary in ("Manual authoritative summary", ""):
                    answers = {**self.answers, "section-0:comment": summary}
                    response = self._post(views.coach_review_instance_answers, answers=answers,
                                          answerVersion=answer_version(self.saved))
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(self.saved.answers, answers)
                    self.assertEqual(self.saved.status, "scheduled")
                    self.saved.save.assert_called_with(update_fields=["answers", "meeting_intelligence", "updated_at"])
                    populate_answer(self.saved, self.saved.meeting_intelligence, "Later AI suggestion")
                    self.assertEqual(self.saved.answers["section-0:comment"], summary)
                self.assertEqual(self.cursor.fetchall.return_value, source)
                self.assertTrue(all(call.args[0].lstrip().startswith("SELECT") for call in self.cursor.execute.call_args_list))
                self.calendar.save.assert_not_called()

    def test_direct_submit_equals_optional_start_then_submit_and_signature_completion(self):
        for family in FAMILIES:
            evidence = []
            for start_first in (False, True):
                with self.subTest(family=family, start_first=start_first):
                    self._new_overlay(family)
                    source = deepcopy(self.cursor.fetchall.return_value)
                    snapshot = deepcopy(self.saved.template_snapshot)
                    progress = deepcopy(self.saved.progress_snapshot)
                    with self.assertRaises(ValueError):
                        complete(self.saved)
                    if start_first:
                        response = self._post(views.coach_review_instance_local_status, status="in-progress")
                        self.assertEqual(response.status_code, 200, response.content)
                        self.assertEqual(self.saved.status, "in-progress")
                    self.order.clear()
                    response = self._submit()
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(self.order[:3], ["learner", "calendar", "overlay"])
                    self.assertEqual(self.saved.status, "awaiting-signature")
                    self.calendar_updates.assert_any_call(pk=91)
                    self.calendar_updates.return_value.update.assert_called_once_with(status="awaiting-signature")
                    self.assertEqual(self.saved.template_snapshot, snapshot)
                    self.assertEqual(self.saved.progress_snapshot, progress)
                    self.assertEqual(self.saved.answers, self.answers)
                    self.assertEqual(self.saved.event_key, KEY)
                    self.assertEqual(self.calendar.event_key, KEY)
                    self.assertEqual(self.saved.source_review_id, 407)
                    self.assertEqual(self.cursor.fetchall.return_value, source)
                    with self.assertRaisesRegex(ValueError, "All required signatures"):
                        complete(self.saved)
                    self.saved.migrated_signatures.values_list.return_value = [r for r, needed in self.saved.signature_requirements.items() if needed]
                    complete(self.saved)
                    self.assertEqual(self.saved.status, "completed")
                    evidence.append((self.saved.answers, snapshot, progress, self.saved.signature_requirements,
                                     self.saved.source_review_id, self.saved.event_key, self.saved.status))
            self.assertEqual(len(evidence), 2)
            self.assertEqual(evidence[0], evidence[1])

    def test_submit_keeps_version_required_field_hidden_field_and_template_checks(self):
        cases = [({"answerVersion": "stale"}, 409, "ANSWER_CONFLICT"),
                 ({"answers": {}}, 400, "Required"),
                 ({"answers": {**self.answers, "section-0:check:yes:detail": "Hidden"}}, 400, "hidden conditional")]
        for payload, status, message in cases:
            with self.subTest(payload=payload):
                response = self._submit(**payload)
                self.assertEqual(response.status_code, status)
                self.assertIn(message, response.content.decode())
                self.assertEqual(self.saved.status, "scheduled")
                self.saved.save.assert_not_called()
        self.sync.return_value = True
        response = self._submit()
        self.assertEqual(response.status_code, 409)
        self.assertIn("template_sync_changed", response.content.decode())
        self.saved.save.assert_not_called()

    def test_unsupported_local_states_cannot_submit_or_bypass_frozen_answers(self):
        for status in ("not-scheduled", "awaiting-signature", "completed"):
            with self.subTest(status=status):
                self.saved.status = status
                with self.assertRaises(ValueError):
                    submit(self.saved, self.answers)
                self.assertIn(self._submit().status_code, (400, 409))
                if status != "not-scheduled":
                    self.assertEqual(self._post(views.coach_review_instance_answers, answers=self.answers,
                        answerVersion=answer_version(self.saved)).status_code, 409)
                self.saved.save.assert_not_called()

    def test_source_completed_by_status_or_date_cannot_enter_scheduled_flow(self):
        for status, completed in (("Completed", None), ("Not Scheduled", timezone.now())):
            with self.subTest(status=status, completed=bool(completed)):
                row = list(self.cursor.fetchall.return_value[0])
                row[8], row[9] = completed, status
                self.cursor.fetchall.return_value = [tuple(row)]
                definition = self._get()
                self.assertTrue(definition["readOnly"])
                self.assertFalse(definition["migratedForm"])
                self.assertFalse(definition["canInitialize"])
                self.assertEqual(self._submit().status_code, 409)
                self.assertEqual(self._post(views.coach_review_instance_answers, answers=self.answers).status_code, 409)
                self.saved.save.assert_not_called()

    def test_unowned_source_and_mismatched_overlay_are_rejected(self):
        self.saved.source_review_id = 999
        self.assertEqual(self._submit().status_code, 409)
        self.saved.save.assert_not_called()
        self._patch("coach_api.views.fetch_caseload_dashboard_profiles", return_value=[])
        self.assertEqual(self._submit().status_code, 409)
        self.saved.save.assert_not_called()

    def test_locked_state_rejects_concurrent_submit_or_changed_source_association(self):
        for change in ({"status": "awaiting-signature"}, {"source_review_id": 999}, {"learner_id": 999}):
            with self.subTest(change=change):
                locked = copy(self.saved)
                for key, value in change.items():
                    setattr(locked, key, value)
                self.overlays.return_value.select_for_update.return_value.first.side_effect = None
                self.overlays.return_value.select_for_update.return_value.first.return_value = locked
                response = self._submit()
                self.assertIn(response.status_code, (400, 409))
                self.saved.save.assert_not_called()
                self.calendar_updates.return_value.update.assert_not_called()

    def test_save_rejects_stale_version_and_frozen_locked_state(self):
        response = self._post(views.coach_review_instance_answers, answers=self.answers, answerVersion="stale")
        self.assertEqual(response.status_code, 409)
        self.assertIn("ANSWER_CONFLICT", response.content.decode())
        locked = copy(self.saved)
        locked.status = "awaiting-signature"
        self.overlays.return_value.select_for_update.return_value.first.side_effect = None
        self.overlays.return_value.select_for_update.return_value.first.return_value = locked
        response = self._post(views.coach_review_instance_answers, answers=self.answers,
                              answerVersion=answer_version(self.saved))
        self.assertEqual(response.status_code, 409)
        self.saved.save.assert_not_called()

    def test_admin_view_as_cannot_submit_scheduled_review(self):
        request = self.factory.post("/?viewAsCoach=coach%40example.invalid", data="{}", content_type="application/json")
        request.login_account = SimpleNamespace(role="admin", subject_type="staff", subject_id=99)
        self._patch("login.permissions.authenticate_request", return_value=request.login_account)
        self._patch("login.permissions._accesses_of", return_value=frozenset({"super-admin"}))
        self._patch("coach_api.auth.StaffUser.objects.filter").return_value.only.return_value.first.return_value = SimpleNamespace(id=99)
        self._patch("coach_api.auth._staff_access", return_value="super-admin")
        response = migrated_completion_views.migrated_review_submit(request, KEY)
        self.assertEqual(response.status_code, 403)
        self.assertEqual(json.loads(response.content)["code"], "coach_view_as_read_only")
        self.saved.save.assert_not_called()
        self.assertEqual(self.order, [])

    def test_scheduled_progress_is_explicit_versioned_and_does_not_start_or_submit(self):
        for family in ("PR", "PR_SKILLS_RADAR"):
            with self.subTest(family=family):
                self._new_overlay(family)
                self.saved.answers = deepcopy(self.answers)
                self.saved.progress_snapshot = None
                self._patch("coach_api.migrated_progress.ImportedReviewInstance.objects.select_for_update").return_value.filter.return_value.first.return_value = self.saved
                calculate = self._patch("coach_api.migrated_progress_views.calculate_snapshot", return_value={"calculation": 1})
                self.assertIsNone(self._get()["progressSnapshot"])
                calculate.assert_not_called()
                for number in (1, 2):
                    calculate.return_value = {"calculation": number}
                    response = self._post(migrated_progress_views.migrated_review_progress, progressVersion=answer_version(self.saved))
                    self.assertEqual(response.status_code, 200, response.content)
                    self.assertEqual(self.saved.progress_snapshot, {"calculation": number})
                    self.assertEqual(self.saved.status, "scheduled")
                    self.assertEqual(self.saved.answers, self.answers)
                    self.saved.save.assert_called_with(update_fields=["progress_snapshot", "updated_at"])
                self.assertEqual(calculate.call_count, 2)
                response = self._post(migrated_progress_views.migrated_review_progress, progressVersion="stale")
                self.assertEqual(response.status_code, 409)
                self.assertEqual(calculate.call_count, 2)
                self.assertEqual(self._get()["progressSnapshot"], {"calculation": 2})
