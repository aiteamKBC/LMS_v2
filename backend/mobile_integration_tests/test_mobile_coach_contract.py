"""Hermetic coach facade, real role decorators and canonical read arithmetic.

Session/model/database boundaries are in-memory fixtures; no application
settings, provider, database, learner writer or notification is invoked.
"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import subprocess
import types
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import test_mobile_contract as base
from django.http import JsonResponse
from django.test import override_settings

ROOT = Path(__file__).resolve().parents[1]
PACKAGE = "_mobile_coach_contract"


def fixture(name, **members):
    module = types.ModuleType(name)
    module.__dict__.update(members)
    sys.modules[name] = module
    parent, _, leaf = name.rpartition(".")
    if parent in sys.modules:
        setattr(sys.modules[parent], leaf, module)
    return module


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, ROOT / path)
    module = importlib.util.module_from_spec(spec)
    sys.modules[name] = module
    spec.loader.exec_module(module)
    return module


class Rows(list):
    def annotate(self, **fields):
        for row in self:
            if "coach_email_key" in fields:
                row.coach_email_key = row.coach_email.strip().lower()
        return self

    def filter(self, **fields):
        def matches(row):
            for key, value in fields.items():
                field, _, op = key.partition("__")
                found = getattr(row, field, None)
                if op == "in":
                    valid = found in value
                elif op == "lt":
                    valid = found < value
                else:
                    valid = found == value
                if not valid:
                    return False
            return True
        return Rows(row for row in self if matches(row))

    def only(self, *args):
        return self

    def order_by(self, field):
        return Rows(sorted(self, key=lambda row: getattr(row, field.lstrip("-")), reverse=field.startswith("-")))

    def first(self):
        return self[0] if self else None

    def exists(self):
        return bool(self)


class CoachContract(unittest.TestCase):
    request = base.MobileFacadeTests.request
    body = base.MobileFacadeTests.body

    def setUp(self):
        base.MobileFacadeTests.setUp(self)
        modules = patch.dict(sys.modules)
        modules.start()
        self.addCleanup(modules.stop)
        setting = override_settings(USE_TZ=True, KBC_SHARED_REWARDS_READY=False)
        setting.enable()
        self.addCleanup(setting.disable)
        self.account.role = "staff"
        self.account.subject_type = "staff"
        self.account.subject_id = 73
        self.staff = SimpleNamespace(pk=73, id=73, email=" COACH@Example.test ",
                                     username="Coach", access="coach", access_extra="")
        self.profile.__dict__.update(id=991, full_name="Synthetic learner", learner_type="apprenticeship",
            programme="Programme", cohort="Class", cohort_id="COHORT-A", lifecycle_status="active",
            coach_email=" coach@example.TEST ")
        self.source.__dict__.update(id=501, username="Synthetic learner")
        self.profiles, self.sources = Rows([self.profile]), Rows([self.source])
        self.staff_model = SimpleNamespace(objects=Rows([self.staff]))
        models = fixture("learner_api.models", EnrolmentUser=base.Source, LearnerProfile=base.Profile,
                         StaffUser=self.staff_model, Employer=Mock())
        fixture(PACKAGE, __path__=[str(ROOT / "learner_api")], mobile=base.mobile)
        sys.modules[PACKAGE + ".models"] = models
        source_manager = patch.object(base.Source, "all_learners", self.sources)
        profile_manager = patch.object(base.Profile, "objects", self.profiles)
        source_manager.start(); profile_manager.start()
        self.addCleanup(source_manager.stop); self.addCleanup(profile_manager.stop)

        # Real login grant union and both maintained authorization decorators.
        fixture("login.models", ROLE_ADMIN="admin", ROLE_STAFF="staff", ROLE_LEARNER="learner",
                ROLE_EMPLOYER="employer", SUBJECT_CHOICES=(), SUBJECT_EMPLOYER="employer",
                SUBJECT_LEARNER="learner", SUBJECT_STAFF="staff", LoginAccount=Mock())
        fixture("login.security", normalize_email=lambda value: str(value or "").strip().lower())
        identity = load("login.identity", "login/identity.py")
        permissions = load("login.permissions", "login/permissions.py")
        fixture("coach_api", __path__=[str(ROOT / "coach_api")])
        self.auth = load("coach_api.auth", "coach_api/auth.py")

        class ServiceError(Exception):
            pass
        fixture("old_otjh", __path__=[])
        fixture("old_otjh.repository", query=Mock(side_effect=AssertionError("Unexpected database read")))
        fixture("old_otjh.service", ServiceError=ServiceError)
        fixture(PACKAGE + ".active_users", completed_hours_value_from_progress=Mock())
        load(PACKAGE + ".monthly_log_sources", "learner_api/monthly_log_sources.py")
        fixture(PACKAGE + ".ksb_exclusions", not_excluded_sql=Mock())
        fixture(PACKAGE + ".current_learning", current_records=Mock(), current_records_bulk=Mock(),
                is_unsynchronised_direct_save=Mock(), source_payload_metadata=lambda value: value or {})
        self.canonical = load(PACKAGE + ".canonical_learning", "learner_api/canonical_learning.py")
        self.owner = {"id": 991, "enrolment_id": 501}
        self.canonical.require_profile = Mock(return_value=self.owner)
        self.records = [
            {"id": 1, "accepted": True, "actual_seconds": 3600, "kind": "component"},
            {"id": 2, "accepted": False, "actual_seconds": 1800, "kind": "quiz", "passed": False},
        ]
        self.canonical.entries_for = Mock(return_value=self.records)
        self.summaries = {501: {"profile_id": 991, "actual": 1, "planned": 12,
                                 "start_date": "2026-01-01", "end_date": "2026-12-31"}}
        self.canonical.otjh_summary_bulk = Mock(side_effect=lambda ids: {
            key: self.summaries.get(key) for key in ids})
        fixture("engagement_api", __path__=[])
        self.points = Mock(return_value={"learnerId": "501", "earned": 50, "committed": 10, "balance": 40})
        fixture("engagement_api.services", points_summary=self.points)
        self.shared = Mock(return_value={"moduleId": base.mobile.PILOT_MODULE_ID,
            "policy": {"enabled": True}, "study": {"acceptedStudySeconds": 30},
            "leaderboard": {"optedIn": False, "displayName": "", "entries": []},
            "voucherRequests": [{"email": "must-not-be-returned@example.test"}]})
        fixture("engagement_api.shared_rewards", summary=self.shared)
        sys.modules[PACKAGE + ".quizzes"] = base.quizzes
        self.media = load(PACKAGE + ".mobile_coach_media", "learner_api/mobile_coach_media.py")
        self.facade = load(PACKAGE + ".mobile_coach", "learner_api/mobile_coach.py")

    def call(self, handler="learner", *, profile_id=991, method="GET", query="", **kwargs):
        req = self.request(method=method)
        if query:
            from django.http import QueryDict
            req.GET = QueryDict(query)
        route = getattr(self.facade, handler)
        return route(req, **({} if handler == "learners" else {"profile_id": profile_id}), **kwargs)

    def test_primary_and_additional_coach_grants_use_server_identity(self):
        for primary, extra in [("coach", ""), ("tutor", "Coach")]:
            with self.subTest(primary=primary):
                self.staff.access, self.staff.access_extra = primary, extra
                response = self.call()
                self.assertEqual(response.status_code, 200)
                data = self.body(response)
                self.assertEqual(data["coachAccountId"], "9")
                self.assertEqual(data["learner"]["profileId"], "991")
                self.assertEqual(data["learner"]["learnerId"], "501")
                self.assertTrue(data["readOnly"])
                self.assertEqual(response["Cache-Control"], "private, no-store")

    def test_revoke_coach_grant_blocks_subsequent_reads(self):
        self.assertEqual(self.call().status_code, 200)
        self.staff.access, self.staff.access_extra = "tutor", ""
        self.assertEqual(self.call().status_code, 403)

    def test_learner_inactive_and_anonymous_sessions_denied(self):
        for attribute, value, expected in [("role", "learner", 403), ("is_active", False, 401)]:
            with self.subTest(attribute=attribute), patch.object(self.account, attribute, value):
                self.assertEqual(self.call().status_code, expected)
        with patch.object(base.mobile, "authenticate_request", return_value=None):
            self.assertEqual(self.call().status_code, 401)

    def test_noncoach_and_implicit_superadmin_denied(self):
        for grant in ("tutor", "super-admin", ""):
            self.staff.access = grant
            self.assertEqual(self.call().status_code, 403)

    def test_post_and_other_mutating_methods_never_enter_a_read(self):
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            self.assertEqual(self.call(method=method).status_code, 405)
        self.canonical.require_profile.assert_not_called()

    def test_crosslearner_and_source_id_as_profile_id_are_404(self):
        for key in (1000, 501):
            self.assertEqual(self.call(profile_id=key).status_code, 404)
        self.canonical.require_profile.assert_not_called()

    def test_reassignment_revokes_every_selected_route_before_material_or_points(self):
        self.profile.coach_email = "another@example.test"
        with patch.object(self.media, "stream") as stream:
            for route, extra in (("learner", {}), ("catalogue", {}), ("progress", {}),
                    ("quiz", {"component_id": "PMP-QUIZ-1"}),
                    ("transcript", {"component_id": "PMP-AUDIO-1"}),
                    ("media", {"component_id": "PMP-AUDIO-1"})):
                with self.subTest(route=route):
                    self.assertEqual(self.call(route, **extra).status_code, 404)
            stream.assert_not_called()
        self.points.assert_not_called()
        self.canonical.require_profile.assert_not_called()

    def test_ambiguous_unlinked_and_mismatched_canonical_bridge_fail_closed(self):
        with patch.object(self.profile, "enrolment_id", None):
            self.assertEqual(self.call().status_code, 404)
        self.canonical.require_profile.side_effect = self.canonical.ServiceError("ambiguous")
        self.assertEqual(self.call().status_code, 404)
        self.canonical.require_profile.side_effect = None
        self.canonical.require_profile.return_value = {"id": 501}
        self.assertEqual(self.call().status_code, 404)

    def test_commercial_source_identity_is_not_guessed_from_programme(self):
        self.source.learner_type = "commercial"
        self.assertEqual(self.body(self.call())["learner"]["learnerKind"], "commercial")
        self.source.learner_type = "unknown"
        self.assertEqual(self.call().status_code, 404)

    def test_owner_injection_duplicate_and_unrecognised_query_refused(self):
        for value in ("learnerId=5", "owner_email=other@example.test", "status=active", "moduleId=a&moduleId=b"):
            self.assertIn(self.call(query=value).status_code, (400, 403))

    def test_detail_distinguishes_accepted_and_recorded_hours_and_keeps_points_canonical(self):
        data = self.body(self.call())
        self.assertEqual(data["hours"]["acceptedOtjhHours"], 1)
        self.assertEqual(data["hours"]["recordedLearningHours"], 1.5)
        self.assertEqual(data["hours"]["plannedOtjhHours"], 12)
        self.assertEqual(data["hours"]["period"]["startDate"], "2026-01-01")
        self.assertEqual(data["performance"]["completedActivities"], 1)
        self.assertEqual(data["performance"]["totalActivities"], 2)
        self.assertEqual(data["performance"]["scope"], "programme-records")
        self.assertEqual(data["points"]["committed"], 10)
        self.points.assert_called_once_with("501")

    def test_missing_targets_are_null_not_zero_and_empty_performance_has_no_percentage(self):
        self.summaries[501]["planned"] = None
        self.records.clear()
        data = self.body(self.call())
        self.assertIsNone(data["hours"]["plannedOtjhHours"])
        self.assertIsNone(data["performance"]["completionPercent"])
        self.assertEqual(data["hours"]["recordedLearningHours"], 0)

    def test_canonical_recorded_seconds_rejects_negative_and_nonfinite_values(self):
        self.records[:] = [{"actual_seconds": value} for value in (-1, "NaN", "Infinity", "invalid", None, 900)]
        self.assertEqual(self.body(self.call())["hours"]["recordedLearningHours"], .25)

    def test_no_plan_activation_hydration_snapshot_or_learner_write_on_preview(self):
        self.call("catalogue")
        base.mobile.build_learner_detail.assert_called_with(
            self.source, 501, compact=True, read_only=True, quiz_view=True)
        base.timer.start_time_tracking.assert_not_called()
        base.components.submit_component_progress.assert_not_called()
        base.videos.submit_video_progress.assert_not_called()
        base.quizzes.submit_quiz_attempt.assert_not_called()

    def test_catalogue_preserves_canonical_ids_and_rebinds_protected_media(self):
        self.audio["audioUrl"] = "/learner_api/media/google-drive/abcdefghijk123/"
        data = self.body(self.call("catalogue"))
        self.assertEqual(data["learner"]["learnerId"], "501")
        self.assertEqual(data["courses"][0]["moduleId"], base.mobile.PILOT_MODULE_ID)
        row = data["components"][0]
        self.assertEqual(row["componentId"], "PMP-AUDIO-1")
        self.assertEqual(row["audioUrl"], "/learner_api/mobile/coach/learners/991/components/PMP-AUDIO-1/media/")
        self.assertFalse(row["rewardObservationsSupported"])

    def test_unsupported_and_unpublished_materials_hidden_and_direct_quiz_refused(self):
        self.published_quiz_ids.clear()
        self.detail["components"].append({"componentId": "TASK", "moduleId": base.mobile.PILOT_MODULE_ID,
                                          "type": "assignment", "audioUrl": "/audio.mp3"})
        data = self.body(self.call("catalogue"))
        self.assertEqual([row["componentId"] for row in data["components"]], ["PMP-AUDIO-1"])
        self.assertEqual(self.call("quiz", component_id="PMP-QUIZ-1").status_code, 404)
        self.assertEqual(self.call("media", component_id="TASK").status_code, 404)

    def test_removed_course_and_same_title_other_component_denied(self):
        self.plan.clear()
        self.assertEqual(self.body(self.call("catalogue"))["courses"], [])
        self.assertEqual(self.call("quiz", component_id="PMP-QUIZ-1").status_code, 404)
        self.assertEqual(self.call("progress", query="moduleId=unassigned").status_code, 404)

    def test_inactive_learner_can_be_monitored_but_not_reactivated_or_studied(self):
        self.profile.lifecycle_status = "former"
        self.assertEqual(self.call().status_code, 200)
        self.assertEqual(self.call("catalogue").status_code, 409)
        self.assertEqual(self.profile.lifecycle_status, "former")

    def test_current_access_gate_blocks_material_and_media_before_stream(self):
        self.detail["learningAccess"] = {"blocked": True}
        with patch.object(self.media, "stream") as stream:
            self.assertEqual(self.call("media", component_id="PMP-AUDIO-1").status_code, 403)
            stream.assert_not_called()
        self.assertEqual(self.body(self.call("catalogue"))["components"], [])

    def test_quiz_preview_contains_authorized_answer_keys_but_never_submits(self):
        base.quizzes._fetch_quiz.return_value = {"id": 77, "title": "Quiz", "questions": [
            {"id": 5, "type": "single_choice", "explanation": "Why", "answers": [
                {"id": 8, "text": "Choice", "isCorrect": True}]}]}
        data = self.body(self.call("quiz", component_id="PMP-QUIZ-1"))
        self.assertTrue(data["questions"][0]["answers"][0]["isCorrect"])
        self.assertEqual(data["componentId"], "PMP-QUIZ-1")
        self.assertEqual(data["learner"]["profileId"], "991")
        base.quizzes._fetch_quiz.assert_called_with(77)
        base.quizzes.submit_quiz_attempt.assert_not_called()

    def test_course_progress_preserves_saved_score_timestamp_and_exact_scope(self):
        self.detail["quizAttempts"] = [{"quizId": 77, "passed": False, "grade": .4,
            "achievedScore": 4, "totalScore": 10, "submittedAt": "2026-10-13T09:00:00Z"},
            {"quizId": 999, "passed": True}]
        data = self.body(self.call("progress", query="moduleId=" + base.mobile.PILOT_MODULE_ID))
        self.assertEqual(len(data["quizAttempts"]), 1)
        self.assertEqual(data["quizAttempts"][0]["achievedScore"], 4)
        self.assertEqual(data["moduleId"], base.mobile.PILOT_MODULE_ID)
        self.assertEqual(data["mobileMeasuredTime"]["basis"], "saved_signed_active_seconds")
        self.assertEqual(data["scope"], "course-mobile-activities")

    def test_shared_rewards_preserves_opt_in_privacy_and_omits_private_claim_data(self):
        with override_settings(KBC_SHARED_REWARDS_READY=True):
            data = self.body(self.call())
            self.assertFalse(data["sharedRewards"]["leaderboard"]["optedIn"])
            self.assertEqual(data["sharedRewards"]["leaderboard"]["entries"], [])
            self.assertNotIn("voucherRequests", data["sharedRewards"])
            self.shared.assert_called_once_with(learner_id="501", module_id=base.mobile.PILOT_MODULE_ID)
            self.plan.clear()
            self.assertIsNone(self.body(self.call())["sharedRewards"])

    def test_roster_batches_canonical_hours_and_avoids_material_hydration(self):
        base.mobile.build_learner_detail.reset_mock()
        data = self.body(self.call("learners"))
        self.assertEqual(data["learners"][0]["profileId"], "991")
        self.assertEqual(data["learners"][0]["learnerId"], "501")
        self.canonical.otjh_summary_bulk.assert_called_once_with([501])
        self.canonical.require_profile.assert_not_called()
        base.mobile.build_learner_detail.assert_not_called()
        self.assertIsNone(data["nextBefore"])

    def test_roster_excludes_mismatched_bridge_without_guessing(self):
        self.summaries[501]["profile_id"] = 501
        self.assertEqual(self.body(self.call("learners"))["learners"], [])

    def test_roster_page_cursor_is_bounded_stable_and_validated(self):
        for i in range(1000, 1101):
            self.profiles.append(SimpleNamespace(**{**self.profile.__dict__, "pk": i, "id": i, "enrolment_id": i + 1000}))
        first = self.body(self.call("learners"))
        self.assertEqual(first["nextBefore"], "1001")
        self.assertEqual(len(self.canonical.otjh_summary_bulk.call_args.args[0]), 100)
        second = self.body(self.call("learners", query="before=" + first["nextBefore"]))
        self.assertIsNone(second["nextBefore"])
        self.assertEqual(second["learners"][0]["profileId"], "991")
        for cursor in ("0", "-1", "1 OR 1=1", "9999999999999999999999"):
            self.assertEqual(self.call("learners", query="before=" + cursor).status_code, 400)

    def test_media_passes_only_verified_component_and_range_request(self):
        with patch.object(self.media, "stream", return_value=JsonResponse({"ok": True})) as stream:
            self.assertEqual(self.call("media", component_id="PMP-AUDIO-1").status_code, 200)
            self.assertEqual(stream.call_args.args[1]["componentId"], "PMP-AUDIO-1")
            self.assertEqual(self.call("media", component_id="NOT-ASSIGNED").status_code, 404)
            self.assertEqual(stream.call_count, 1)


@unittest.skipUnless(os.environ.get("KBC_MOBILE_ISOLATED_DB_CONFIG"),
                     "Explicit isolated PostgreSQL fixture config required")
class CoachPostgresContract(unittest.TestCase):
    def test_real_postgres_ownership_hours_and_get_read_only_boundary(self):
        result = subprocess.run([sys.executable, str(Path(__file__).with_name("coach_postgres_probe.py"))],
            capture_output=True, text=True, timeout=45, env=dict(os.environ))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        receipt = json.loads(result.stdout.strip().splitlines()[-1])
        self.assertEqual(receipt["status"], "PASS")
        self.assertTrue(receipt["fixtureRolledBack"])
        self.assertGreater(receipt["readOnlySqlStatements"], 20)


if __name__ == "__main__":
    unittest.main()
