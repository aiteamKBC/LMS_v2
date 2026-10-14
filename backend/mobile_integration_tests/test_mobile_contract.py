"""Isolated facade contract/security tests.

Uses real Django HttpRequest/JsonResponse and mocked maintained LMS services.
No learner database, provider calls, account creation or production writes.
This is NOT an end-to-end LMS deployment test.
"""
import importlib.util
import json
import os
from pathlib import Path
import sys
import types
import unittest
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.conf import settings
if not settings.configured:
    settings.configure(DEFAULT_CHARSET="utf-8", SECRET_KEY="isolated-test-only",
                       KBC_MOBILE_API_ENABLED=True, KBC_MOBILE_CALENDAR_WRITES_ENABLED=False)
from django.db import DatabaseError
from django.http import JsonResponse
from django.test import RequestFactory, override_settings

ROOT = Path(__file__).resolve().parent
for name in ("login", "learner_api", "config"):
    module = types.ModuleType(name)
    module.__path__ = [str(ROOT.parent / name)]
    sys.modules[name] = module

def fixture_module(name, **members):
    module = types.ModuleType(name)
    for key, value in members.items():
        setattr(module, key, value)
    sys.modules[name] = module
    parent, _, leaf = name.rpartition(".")
    if parent in sys.modules:
        setattr(sys.modules[parent], leaf, module)
    return module

fixture_module("login.api_gate", refusal_for=Mock(return_value=None))
fixture_module("login.android_download_access", staff_download_allowed=Mock(return_value=False))
fixture_module("login.permissions", auth_gate_enabled=Mock(return_value=True))
fixture_module("login.sessions", authenticate_request=Mock(), session_unreadable=Mock(return_value=False))

class Source:
    class DoesNotExist(Exception):
        pass
    all_learners = Mock()
class Profile:
    objects = Mock()
fixture_module("learner_api.models", EnrolmentUser=Source, LearnerProfile=Profile)
fixture_module("learner_api.learner_detail", build_learner_detail=Mock())
fixture_module("learner_api.learning_plan", effective_training_plan=Mock())
rules_path = ROOT.parent / "learner_api" / "progress_rules.py"
rules_spec = importlib.util.spec_from_file_location("learner_api.progress_rules", rules_path)
rules = importlib.util.module_from_spec(rules_spec)
sys.modules["learner_api.progress_rules"] = rules
rules_spec.loader.exec_module(rules)
class TrackingSessionError(ValueError):
    pass
timer = fixture_module("learner_api.time_tracking", TrackingSessionError=TrackingSessionError,
                       verify_tracking_session=Mock(), start_time_tracking=Mock())
components = fixture_module("learner_api.components", submit_component_progress=Mock())
videos = fixture_module("learner_api.videos", submit_video_progress=Mock())
quizzes = fixture_module("learner_api.quizzes", quiz_detail=Mock(), submit_quiz_attempt=Mock(), _fetch_quiz=Mock())
calendar = fixture_module("learner_api.calendar", learner_calendar=Mock(),
                          learner_calendar_book=Mock(), learner_calendar_reschedule=Mock(),
                          learner_calendar_cancel=Mock())
fixture_module("learner_api.overview_week", overview_week=Mock())
fixture_module("learner_api.rewards_summary", learner_rewards_summary=Mock())
spec = importlib.util.spec_from_file_location("learner_api.mobile", ROOT.parent / "learner_api" / "mobile.py")
mobile = importlib.util.module_from_spec(spec)
sys.modules["learner_api.mobile"] = mobile
spec.loader.exec_module(mobile)

class MobileFacadeTests(unittest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.account = SimpleNamespace(pk=9, subject_id=501, role="learner",
                                       subject_type="learner", is_active=True, display_name="Test learner")
        self.source = SimpleNamespace(pk=501, learner_type="apprenticeship")
        self.profile = SimpleNamespace(pk=991, enrolment_id=501)
        Source.all_learners.reset_mock()
        Source.all_learners.get.side_effect = None
        Source.all_learners.get.return_value = self.source
        Profile.objects.filter.return_value.only.return_value = [self.profile]
        Profile.objects.filter.return_value.exists.return_value = True
        Profile.objects.filter.return_value.exists.side_effect = None
        mobile.authenticate_request.reset_mock()
        mobile.authenticate_request.side_effect = None
        mobile.authenticate_request.return_value = self.account
        mobile.session_unreadable.return_value = False
        mobile.auth_gate_enabled.return_value = True
        mobile.staff_download_allowed.reset_mock()
        mobile.staff_download_allowed.return_value = False
        mobile.refusal_for.reset_mock()
        mobile.refusal_for.return_value = None
        self.cursor = MagicMock()
        self.cursor.fetchall.return_value = []
        self.published_quiz_ids = {77}
        self.cursor.fetchall.side_effect = lambda: (
            [(qid,) for qid in self.published_quiz_ids]
            if "SELECT q.id" in self.cursor.execute.call_args.args[0]
            else self.cursor.fetchall.return_value)
        self.cursor.fetchone.return_value = None
        database = MagicMock()
        database.cursor.return_value.__enter__.return_value = self.cursor
        connection_patch = patch.object(mobile, "connections", {"enrolment": database})
        connection_patch.start()
        self.addCleanup(connection_patch.stop)
        self.audio = {"componentId": "PMP-AUDIO-1", "moduleId": mobile.PILOT_MODULE_ID, "weekId": "PMP-W01",
                      "module": "PMP", "week": "Week 1", "component": "Stakeholders",
                      "type": "reading", "audioUrl": "https://example.invalid/human.mp3",
                      "contentHtml": "<p>Full reading must not be sent</p>",
                      "ksbMappings": [{"code": "K1"}]}
        self.quiz_component = {"componentId": "PMP-QUIZ-1", "moduleId": mobile.PILOT_MODULE_ID,
                               "weekId": "PMP-W01", "module": "PMP", "week": "Week 1",
                               "component": "Quiz", "isQuiz": True, "type": "quiz",
                               "quizMeta": {"quizId": 77, "questions": 3}}
        self.detail = {"modules": ["PMP"], "week": [{"weekId": "PMP-W01", "moduleId": mobile.PILOT_MODULE_ID, "module": "PMP"}],
                       "components": [self.audio, self.quiz_component],
                       "learningAccess": {"blocked": False},
                       "quizAttempts": [], "videoProgress": [], "componentProgress": [],
                       "componentMarkingStatus": {}, "ksbs": [], "progressKsbCodes": []}
        mobile.build_learner_detail.return_value = self.detail
        self.plan = [{"moduleId": mobile.PILOT_MODULE_ID, "moduleTitle": "PMP"}]
        mobile.effective_training_plan.return_value = self.plan
        self.mode = "active_playback"
        quizzes._fetch_quiz.return_value = {"id": 77, "questions": [{"id": 10, "type": "multiple_choice", "answers": [{"id": 12}, {"id": 13}]}]}
        def verify(token, **kwargs):
            if token != "server-token":
                raise TrackingSessionError("Invalid signed token")
            return {"verifiedSeconds": min(30, int(kwargs["claimed_seconds"])),
                    "countingMode": self.mode}
        timer.verify_tracking_session.reset_mock()
        timer.verify_tracking_session.side_effect = verify
        timer.start_time_tracking.reset_mock()
        timer.start_time_tracking.side_effect = lambda req: JsonResponse(
            {"trackingToken": "server-token", "sessionId": "real-server-session",
             "startedAt": "2026-10-05T09:00:00Z",
             "countingMode": json.loads(req.body)["countingMode"]})
        for handler in (components.submit_component_progress, videos.submit_video_progress,
                        quizzes.quiz_detail, quizzes.submit_quiz_attempt,
                        calendar.learner_calendar, calendar.learner_calendar_book,
                        calendar.learner_calendar_reschedule, calendar.learner_calendar_cancel):
            handler.reset_mock()
            handler.side_effect = lambda *args, **kwargs: JsonResponse({"canonical": True})
        os.environ["API_REQUIRE_AUTH"] = "1"

    def request(self, method="GET", data=None, query=""):
        if method == "GET":
            return self.factory.get(mobile.BASE + "test/" + query)
        return self.factory.post(mobile.BASE + "test/" + query,
                                 data=json.dumps(data or {}), content_type="application/json",
                                 HTTP_X_REQUESTED_WITH="XMLHttpRequest")
    def body(self, response):
        return json.loads(response.content)
    def finish(self, **extra):
        return {"trackingToken": "server-token", "timeTakenSeconds": 20, **extra}

    @override_settings(KBC_MOBILE_API_ENABLED=False)
    def test_disabled_by_default_at_deployment(self):
        self.assertEqual(mobile.session(self.request()).status_code, 503)

    def test_anonymous_rejected(self):
        mobile.authenticate_request.return_value = None
        self.assertEqual(mobile.session(self.request()).status_code, 401)

    def test_android_download_streams_only_for_entitled_learner_types(self):
        import io
        for kind in ("apprenticeship", "commercial"):
            with self.subTest(kind=kind), patch("builtins.open", return_value=io.BytesIO(b"synthetic-apk")):
                self.source.learner_type = kind
                response = mobile.download_android(self.request())
                self.assertEqual(response.status_code, 200)
                self.assertEqual(b"".join(response.streaming_content), b"synthetic-apk")
                self.assertIn("attachment", response["Content-Disposition"])
                self.assertIn("no-store", response["Cache-Control"])
                response.close()

    def test_android_download_keeps_identity_and_entitlement_refusals(self):
        with patch("builtins.open") as apk:
            mobile.authenticate_request.return_value = None
            self.assertEqual(mobile.download_android(self.request()).status_code, 401)
            mobile.authenticate_request.return_value = self.account
            for role in ("staff", "employer"):
                self.account.role = role
                self.assertEqual(mobile.download_android(self.request()).status_code, 403)
            self.account.role = "learner"
            self.account.is_active = False
            self.assertEqual(mobile.download_android(self.request()).status_code, 401)
            self.account.is_active = True
            self.detail["learningAccess"]["blocked"] = True
            self.assertEqual(mobile.download_android(self.request()).status_code, 403)
            self.detail["learningAccess"]["blocked"] = False
            mobile.effective_training_plan.return_value = []
            self.assertEqual(mobile.download_android(self.request()).status_code, 403)
            apk.assert_not_called()

    def test_staff_installer_access_does_not_grant_learner_api_access(self):
        import io
        for role in ("admin", "staff"):
            with self.subTest(role=role):
                self.account.role = role
                self.account.subject_type = "staff"
                mobile.staff_download_allowed.return_value = True
                with patch("builtins.open", return_value=io.BytesIO(b"synthetic-apk")), patch.object(mobile, "_detail") as detail:
                    response = mobile.download_android(self.request())
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(b"".join(response.streaming_content), b"synthetic-apk")
                    response.close()
                    detail.assert_not_called()
                self.assertEqual(mobile.session(self.request()).status_code, 403)
                self.account.is_active = False
                with patch("builtins.open") as apk:
                    self.assertEqual(mobile.download_android(self.request()).status_code, 401)
                    apk.assert_not_called()
                self.account.is_active = True

    def test_auth_outage_is_not_signout(self):
        mobile.authenticate_request.return_value = None
        mobile.session_unreadable.return_value = True
        self.assertEqual(mobile.session(self.request()).status_code, 503)

    def test_staff_cannot_impersonate_a_learner(self):
        self.account.role = "admin"
        self.assertEqual(mobile.session(self.request(query="?learnerId=501")).status_code, 403)

    def test_inactive_account_rejected(self):
        self.account.is_active = False
        self.assertEqual(mobile.session(self.request()).status_code, 401)

    def test_global_auth_disable_does_not_open_facade(self):
        os.environ["API_REQUIRE_AUTH"] = "0"
        self.assertEqual(mobile.session(self.request()).status_code, 503)

    def test_database_failure_is_safe_503(self):
        Source.all_learners.get.side_effect = DatabaseError("must not leak connection detail")
        result = mobile.session(self.request())
        self.assertEqual(result.status_code, 503)
        self.assertNotIn("connection detail", result.content.decode())

    def test_session_uses_three_distinct_real_identity_namespaces(self):
        data = self.body(mobile.session(self.request(query="?learnerId=999")))
        self.assertEqual(data["user"]["id"], "501")
        self.assertEqual(data["user"]["accountId"], "9")
        self.assertEqual(data["user"]["learnerProfileId"], "991")
        Source.all_learners.get.assert_called_with(pk=501)

    def test_ambiguous_profile_fails_closed(self):
        Profile.objects.filter.return_value.only.return_value = [self.profile, self.profile]
        self.assertEqual(mobile.session(self.request()).status_code, 409)

    def test_unlinked_profile_never_uses_enrolment_id_as_profile_id(self):
        Profile.objects.filter.return_value.only.return_value = []
        self.assertIsNone(self.body(mobile.session(self.request()))["user"]["learnerProfileId"])
        self.assertEqual(mobile.progress(self.request()).status_code, 409)

    def test_no_mechanical_narration_or_reading_html_in_catalogue(self):
        self.audio["audioUrl"] = None
        result = self.body(mobile.catalogue(self.request()))
        self.assertEqual([x["componentId"] for x in result["components"]], ["PMP-QUIZ-1"])
        self.assertNotIn("contentHtml", json.dumps(result))
        self.assertFalse(result["components"][0]["mechanicalNarrationAllowed"])

    def test_catalogue_scrubs_unexpected_nested_quiz_answer_payload(self):
        self.quiz_component["quizMeta"]["questions"] = [{"correctAnswer": "secret"}]
        self.quiz_component["quizMeta"]["answers"] = ["secret"]
        result = self.body(mobile.catalogue(self.request()))
        self.assertNotIn("secret", json.dumps(result))

    def test_progress_preserves_canonical_totals_without_inventing_hours(self):
        self.detail.update({"plannedHours": "40", "completedHours": "3.25",
                            "targetHours": "9", "employer": "private-employer"})
        data = self.body(mobile.progress(self.request()))
        self.assertEqual(data["completedHours"], "3.25")
        self.assertNotIn("employer", data)
        self.assertNotIn("actualOtjh", data)

    def test_missing_totals_are_not_replaced_with_zero(self):
        data = self.body(mobile.progress(self.request()))
        self.assertNotIn("completedHours", data)
        self.assertNotIn("targetHours", data)

    def test_wrong_method_refused(self):
        self.assertEqual(mobile.session(self.request("POST")).status_code, 405)

    def test_write_security_header_required(self):
        request = self.factory.post(mobile.BASE, data="{}", content_type="application/json")
        self.assertEqual(mobile.start_learning_session(request).status_code, 403)

    def test_unassigned_activity_cannot_start_timer(self):
        request = self.request("POST", {"componentId": "OTHER-LEARNER-ACTIVITY", "mode": "audio"})
        self.assertEqual(mobile.start_learning_session(request).status_code, 404)
        timer.start_time_tracking.assert_not_called()

    def test_missing_component_id_rejected(self):
        self.detail["components"].append({"componentId": None})
        result = mobile.start_learning_session(self.request("POST", {"mode": "audio"}))
        self.assertEqual(result.status_code, 400)

    def test_quiz_timer_uses_server_resolved_quiz_id(self):
        result = mobile.start_learning_session(self.request("POST",
                 {"componentId": "PMP-QUIZ-1", "mode": "quiz"}))
        self.assertEqual(result.status_code, 200)
        data = self.body(result)
        self.assertEqual(data["activityId"], "77")
        self.assertEqual(data["completionPath"], mobile.BASE + "quizzes/PMP-QUIZ-1/submit/")
        child = timer.start_time_tracking.call_args.args[0]
        self.assertEqual(child.GET["learnerId"], "501")

    def test_programme_gate_is_applied_to_canonical_timer_path(self):
        mobile.refusal_for.return_value = JsonResponse({"code": "programme_not_started"}, status=403)
        result = mobile.start_learning_session(self.request("POST",
                 {"componentId": "PMP-AUDIO-1", "mode": "audio"}))
        self.assertEqual(result.status_code, 403)
        timer.start_time_tracking.assert_not_called()
        self.assertEqual(mobile.refusal_for.call_args.args[0], "/learner_api/time-tracking/start/")

    def test_audio_claim_is_capped_to_verified_server_duration(self):
        result = mobile.complete_component(self.request("POST", self.finish(timeTakenSeconds=999)),
                                           "PMP-AUDIO-1")
        self.assertEqual(result.status_code, 200)
        child = components.submit_component_progress.call_args.args[0]
        data = json.loads(child.body)
        self.assertEqual(data["timeTakenSeconds"], 30)
        self.assertEqual(data["timeEntrySource"], "timer")
        self.assertEqual(data["ksbs"], ["K1"])
        self.assertEqual(child.GET["learnerId"], "501")
        self.assertEqual(data["componentTitle"], "Stakeholders")

    def test_client_cannot_inject_ksbs_or_identity(self):
        for extra in ({"ksbs": ["K999"]}, {"learnerId": 999}, {"reportedTime": "100 hours"}):
            response = mobile.complete_component(self.request("POST", self.finish(**extra)),
                                                 "PMP-AUDIO-1")
            self.assertEqual(response.status_code, 400)
        components.submit_component_progress.assert_not_called()

    def test_invalid_and_boolean_durations_rejected(self):
        for duration in (-1, True, float("inf"), float("nan"), "999"):
            response = mobile.complete_component(
                self.request("POST", self.finish(timeTakenSeconds=duration)), "PMP-AUDIO-1")
            self.assertEqual(response.status_code, 400)
        components.submit_component_progress.assert_not_called()

    def test_invalid_token_and_wrong_mode_rejected(self):
        response = mobile.complete_component(
            self.request("POST", self.finish(trackingToken="fake")), "PMP-AUDIO-1")
        self.assertEqual(response.status_code, 400)
        self.mode = "visible_page"
        self.assertEqual(mobile.complete_component(self.request("POST", self.finish()),
                                                  "PMP-AUDIO-1").status_code, 400)
        components.submit_component_progress.assert_not_called()

    def test_existing_duplicate_receipt_refusal_is_preserved(self):
        components.submit_component_progress.side_effect = lambda *a, **k: JsonResponse(
            {"error": "This activity timing session has already been submitted."}, status=409)
        result = mobile.complete_component(self.request("POST", self.finish()), "PMP-AUDIO-1")
        self.assertEqual(result.status_code, 409)
        self.assertIn("already", self.body(result)["error"])

    def test_quiz_read_and_submit_use_current_lms_services(self):
        self.assertEqual(mobile.quiz(self.request(), "PMP-QUIZ-1").status_code, 200)
        self.assertEqual(quizzes.quiz_detail.call_args.kwargs["quiz_id"], 77)
        self.mode = "active_quiz"
        result = mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12]})),
                                    "PMP-QUIZ-1")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(quizzes.submit_quiz_attempt.call_args.kwargs["quiz_id"], 77)

    def test_meeting_read_uses_authenticated_learner(self):
        self.assertEqual(mobile.meetings(self.request(query="?learnerId=999")).status_code, 200)
        self.assertEqual(calendar.learner_calendar.call_args.kwargs["pk"], 501)
        child = calendar.learner_calendar.call_args.args[0]
        self.assertEqual(child.GET["learnerId"], "501")

    def test_meeting_writes_default_off(self):
        result = mobile.meeting_action(self.request("POST", {"eventKey": "example"}), "book")
        self.assertEqual(result.status_code, 409)
        calendar.learner_calendar_book.assert_not_called()

    @override_settings(KBC_MOBILE_CALENDAR_WRITES_ENABLED=True)
    def test_booking_target_cannot_be_overridden(self):
        response = mobile.meeting_action(self.request("POST", {"learnerId": 999}), "book")
        self.assertEqual(response.status_code, 400)
        calendar.learner_calendar_book.assert_not_called()

    def test_capabilities_do_not_claim_unimplemented_services(self):
        data = self.body(mobile.session(self.request()))
        for key in ("customPointsPolicy", "offlineHoursSync", "timeObservations",
                    "aiMarkingReports", "sharedBookingsSync", "crossDeviceTimerDeduplication"):
            self.assertFalse(data["capabilities"][key], key)


    def test_letter_answers_cannot_consume_an_attempt(self):
        self.mode = "active_quiz"
        response = mobile.submit_quiz(self.request("POST", self.finish(answers={"10": ["A"]})),
                                      "PMP-QUIZ-1")
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.body(response)["code"], "quiz_answer_mapping_required")
        quizzes.submit_quiz_attempt.assert_not_called()

    def test_unknown_question_and_option_ids_are_rejected(self):
        self.mode = "active_quiz"
        for answers in ({"999": [12]}, {"10": [999]}, {}, {"10": [True]}):
            response = mobile.submit_quiz(self.request("POST", self.finish(answers=answers)),
                                          "PMP-QUIZ-1")
            self.assertIn(response.status_code, (400, 409))
        quizzes.submit_quiz_attempt.assert_not_called()

    def test_single_choice_uses_one_canonical_scalar(self):
        self.mode = "active_quiz"
        quizzes._fetch_quiz.return_value["questions"][0]["type"] = "single_choice"
        invalid = mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12]})),
                                     "PMP-QUIZ-1")
        self.assertEqual(invalid.status_code, 400)
        quizzes.submit_quiz_attempt.assert_not_called()
        valid = mobile.submit_quiz(self.request("POST", self.finish(answers={"10": "12"})),
                                   "PMP-QUIZ-1")
        self.assertEqual(valid.status_code, 200)
        self.assertEqual(json.loads(quizzes.submit_quiz_attempt.call_args.args[0].body)["answers"],
                         {"10": 12})

    def test_duplicate_multiple_choice_options_are_rejected(self):
        self.mode = "active_quiz"
        response = mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12, 12]})),
                                      "PMP-QUIZ-1")
        self.assertEqual(response.status_code, 400)
        quizzes.submit_quiz_attempt.assert_not_called()

    def test_unsupported_question_type_never_silently_grades_as_single_choice(self):
        self.mode = "active_quiz"
        quizzes._fetch_quiz.return_value["questions"][0]["type"] = "matching"
        response = mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12]})),
                                      "PMP-QUIZ-1")
        self.assertEqual(response.status_code, 409)
        quizzes.submit_quiz_attempt.assert_not_called()

    def test_same_title_unassigned_copy_does_not_gain_entitlement(self):
        other = {**self.audio, "componentId": "COPY-AUDIO", "moduleId": "PMP-COPIED-DELIVERY"}
        self.detail["components"].append(other)
        self.detail["week"].append({"moduleId": "PMP-COPIED-DELIVERY", "weekId": "COPY-W01", "module": "PMP"})
        data = self.body(mobile.catalogue(self.request()))
        self.assertEqual(data["moduleScope"], {"moduleId": mobile.PILOT_MODULE_ID,
                         "title": "Stakeholder Management and Reporting", "assigned": True})
        self.assertEqual([x["componentId"] for x in data["components"]], ["PMP-AUDIO-1", "PMP-QUIZ-1"])
        self.assertEqual([x["weekId"] for x in data["weeks"]], ["PMP-W01"])
        self.assertNotIn("COPY-AUDIO", self.cursor.execute.call_args.args[1][1])
        self.assertEqual(mobile.start_learning_session(self.request("POST", {"componentId": "COPY-AUDIO", "mode": "audio"})).status_code, 404)
        self.assertEqual(mobile.complete_component(self.request("POST", self.finish()), "COPY-AUDIO").status_code, 404)
        timer.start_time_tracking.assert_not_called()
        components.submit_component_progress.assert_not_called()

    def test_unassigned_module_returns_empty_without_query_or_implicit_assignment(self):
        self.plan.clear()
        self.detail["components"] = [{**self.audio, "moduleId": "PMP-COPIED-DELIVERY"}]
        self.detail["week"] = [{"moduleId": "PMP-COPIED-DELIVERY", "weekId": "PMP-W01"}]
        data = self.body(mobile.catalogue(self.request()))
        self.assertFalse(data["moduleScope"]["assigned"])
        self.assertEqual((data["modules"], data["weeks"], data["components"]), ([], [], []))
        self.cursor.execute.assert_not_called()

    def test_other_module_quiz_cannot_be_read_or_submitted(self):
        self.quiz_component["moduleId"] = "PMP-COPIED-DELIVERY"
        self.assertEqual(mobile.quiz(self.request(), "PMP-QUIZ-1").status_code, 404)
        self.assertEqual(mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12]})), "PMP-QUIZ-1").status_code, 404)
        quizzes.quiz_detail.assert_not_called()
        quizzes.submit_quiz_attempt.assert_not_called()

    def test_presentation_uses_only_authorised_ids_and_same_week(self):
        self.cursor.fetchall.return_value = [
            ("PMP-AUDIO-1", "PMP-W01", 12, 1, 2, "PMP/M1W01P02/main", ["READING-2"], True, {}, None, {}, mobile.PILOT_MODULE_ID, 1, 1),
            ("PMP-QUIZ-1", "WRONG-WEEK", 99, 14, 7, "wrong", [], True, {}, None, {}, mobile.PILOT_MODULE_ID, 1, 1),
            ("UNASSIGNED", "PMP-W01", 13, 1, 2, "wrong", [], True, {}, None, {}, mobile.PILOT_MODULE_ID, 1, 1)]
        data = self.body(mobile.catalogue(self.request()))
        item = data["components"][0]
        self.assertEqual((item["displayOrder"], item["teachingWeek"], item["pointNumber"]), (12, 1, 2))
        self.assertTrue(item["transcriptAvailable"])
        self.assertEqual(item["sourceReadingComponentIds"], ["READING-2"])
        self.assertEqual(item["transcriptPath"], mobile.BASE + "components/PMP-AUDIO-1/transcript/")
        self.assertNotIn("displayOrder", data["components"][1])
        self.assertNotIn("transcript", item)
        self.assertEqual(self.cursor.execute.call_args.args[1], [[mobile.PILOT_MODULE_ID], ["PMP-AUDIO-1", "PMP-QUIZ-1"]])

    def test_audio_transcript_uses_exact_entitled_module_week_and_gate(self):
        self.cursor.fetchone.return_value = ("Alice: A definition. George: An example.",)
        response = mobile.transcript(self.request(), "PMP-AUDIO-1")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(self.body(response)["componentId"], "PMP-AUDIO-1")
        self.assertEqual(self.cursor.execute.call_args.args[1], ["PMP-AUDIO-1", mobile.PILOT_MODULE_ID, "PMP-W01"])
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.cursor.execute.reset_mock()
        mobile.refusal_for.return_value = JsonResponse({"code": "programme_not_started"}, status=403)
        self.assertEqual(mobile.transcript(self.request(), "PMP-AUDIO-1").status_code, 403)
        self.assertFalse(any("transcript'" in call.args[0] for call in self.cursor.execute.call_args_list))

    def test_missing_unassigned_and_non_audio_transcripts_are_not_fabricated(self):
        self.assertEqual(mobile.transcript(self.request(), "UNKNOWN").status_code, 404)
        self.assertEqual(mobile.transcript(self.request(), "PMP-QUIZ-1").status_code, 404)
        self.assertFalse(any("transcript'" in call.args[0] for call in self.cursor.execute.call_args_list))
        self.assertEqual(mobile.transcript(self.request(), "PMP-AUDIO-1").status_code, 404)
        self.cursor.fetchone.return_value = ("  ",)
        self.assertEqual(mobile.transcript(self.request(), "PMP-AUDIO-1").status_code, 404)

    def test_blocked_learning_retains_scope_but_hides_media_and_refuses_activity(self):
        self.detail["accessGate"] = {"blocked": True, "reasons": ["review_required"]}
        data = self.body(mobile.catalogue(self.request()))
        self.assertTrue(data["moduleScope"]["assigned"])
        self.assertEqual(data["components"], [])
        self.assertTrue(data["accessGate"]["blocked"])
        self.cursor.execute.assert_not_called()
        self.assertEqual(mobile.start_learning_session(self.request("POST", {"componentId": "PMP-AUDIO-1", "mode": "audio"})).status_code, 403)
        self.assertEqual(mobile.transcript(self.request(), "PMP-AUDIO-1").status_code, 403)
        timer.start_time_tracking.assert_not_called()

    def test_progress_projects_real_quiz_pass_and_coach_validation(self):
        self.audio["tutorValidationRequired"] = True
        self.detail["componentProgress"] = [{"kind": "component", "componentId": "PMP-AUDIO-1", "submittedAt": "2026-10-05T09:00:00Z"}]
        self.detail["quizAttempts"] = [{"kind": "quiz", "quizId": 77, "passed": False}, {"kind": "quiz", "quizId": 999, "passed": True}]
        self.detail["componentMarkingStatus"] = {"PMP-AUDIO-1": {"status": "submitted_for_tutor_review"}}
        data = self.body(mobile.progress(self.request()))
        self.assertEqual(data["submittedComponentIds"], ["PMP-AUDIO-1", "PMP-QUIZ-1"])
        self.assertEqual(data["completedComponentIds"], [])
        self.assertEqual(data["pendingReviewComponentIds"], ["PMP-AUDIO-1"])
        self.assertEqual(len(data["quizAttempts"]), 1)
        self.detail["quizAttempts"][0]["passed"] = True
        self.detail["componentMarkingStatus"]["PMP-AUDIO-1"]["status"] = "accepted"
        data = self.body(mobile.progress(self.request()))
        self.assertEqual(data["completedComponentIds"], ["PMP-AUDIO-1", "PMP-QUIZ-1"])
        self.assertEqual(data["pendingReviewComponentIds"], [])

    def test_failed_ungraded_record_and_unrelated_module_do_not_complete(self):
        self.detail["videoProgress"] = [{"kind": "video", "componentId": "PMP-AUDIO-1", "passed": False}, {"kind": "video", "componentId": "OTHER", "passed": True}]
        data = self.body(mobile.progress(self.request()))
        self.assertEqual(data["submittedComponentIds"], ["PMP-AUDIO-1"])
        self.assertEqual(data["completedComponentIds"], [])
        self.assertEqual(len(data["videoProgress"]), 1)

    def test_measured_hours_ignore_planned_manual_and_duplicate_sessions(self):
        row = {"kind": "component", "componentId": "PMP-AUDIO-1", "verifiedSeconds": 600,
               "timeTrackingSource": "signed_session_capped_active_playback:timer",
               "timeTrackingSessionId": "signed-session", "startedAt": "2026-10-05T08:00:00Z", "submittedAt": "2026-10-05T09:00:00Z"}
        self.detail["componentProgress"] = [row, dict(row),
             {"componentId": "PMP-AUDIO-1", "kind": "component", "expectedOtjh": 50, "reportedTime": "50 hours"},
             {**row, "timeTrackingSessionId": "manual", "timeTrackingSource": "signed_session_capped_active_playback:input", "verifiedSeconds": 900}]
        _, rows = mobile.project_progress(self.detail, mobile.PILOT_MODULE_ID)
        result = mobile.measured_time(rows, mobile.PILOT_MODULE_ID, datetime(2026, 10, 5, 10, tzinfo=timezone.utc))
        self.assertEqual(result["weeklySubmittedSeconds"], 600)
        self.assertEqual(result["moduleCompletedActivitySeconds"], 600)
        self.assertEqual(result["excludedUnmeasuredRows"], 2)
        self.assertIsNone(result["weeklyAcceptedOtjhSeconds"])
        self.assertFalse(result["crossDeviceOverlapReconciled"])

    def test_measured_hours_ignore_declared_date_and_preserve_pending_distinction(self):
        row = {"kind": "component", "componentId": "PMP-AUDIO-1", "verifiedSeconds": 600,
               "timeTrackingSource": "signed_session_capped_active_playback:timer",
               "timeTrackingSessionId": "pending-session", "startedAt": "2026-10-05T08:00:00Z", "submittedAt": "2026-10-05T09:00:00Z",
               "declaredCompletedAt": "2026-10-04T22:00:00Z"}
        self.audio["tutorValidationRequired"] = True
        self.detail["componentMarkingStatus"] = {"PMP-AUDIO-1": {"status": "submitted_for_tutor_review"}}
        self.detail["componentProgress"] = [row]
        _, rows = mobile.project_progress(self.detail, mobile.PILOT_MODULE_ID)
        result = mobile.measured_time(rows, mobile.PILOT_MODULE_ID, datetime(2026, 10, 5, 10, tzinfo=timezone.utc))
        self.assertEqual(result["weeklySubmittedSeconds"], 600)
        self.assertEqual(result["weeklyPendingReviewSeconds"], 600)
        self.assertEqual(result["moduleSubmittedSeconds"], 600)
        self.assertEqual(result["moduleCompletedActivitySeconds"], 0)

    def test_conflicting_session_durations_are_excluded_not_double_counted(self):
        row = {"verifiedSeconds": 600, "timeTrackingSource": "signed_session_capped_active_quiz",
               "timeTrackingSessionId": "same", "submittedAt": "2026-10-05T09:00:00Z"}
        result = mobile.measured_time([(row, True), ({**row, "verifiedSeconds": 999}, True)], mobile.PILOT_MODULE_ID)
        self.assertEqual(result["moduleSubmittedSeconds"], 0)
        self.assertEqual(result["excludedAmbiguousSessions"], 1)


    def test_authored_route_metadata_preserves_optional_false_and_never_infers_unknown(self):
        legacy = {"required": True, "optional": False, "countsTowardsRequiredCompletion": True,
                  "required_route_minutes": 12.5, "teachingWeek": 3,
                  "source_content_type": "quiz", "parent_activity_id": "M01-W03-KNOWLEDGE",
                  "answerKey": "never expose"}
        self.cursor.fetchall.return_value = [
            ("PMP-QUIZ-1", "PMP-W01", 12, None, None, None, None, False, json.dumps(legacy), None, {}, mobile.PILOT_MODULE_ID, 3, 3),
            ("PMP-AUDIO-1", "PMP-W01", 13, 3, 2, "PMP/audio", [], True, legacy, None,
             {"required": False, "optional": True, "countsTowardsRequiredCompletion": False}, mobile.PILOT_MODULE_ID, 3, 3)]
        data = self.body(mobile.catalogue(self.request()))
        audio, quiz = data["components"]
        self.assertFalse(audio["learningRoute"]["required"])
        self.assertTrue(audio["learningRoute"]["optional"])
        self.assertTrue(quiz["learningRoute"]["required"])
        self.assertEqual(quiz["learningRoute"]["requiredRouteMinutes"], 12.5)
        self.assertEqual(quiz["teachingWeek"], 3)
        self.assertEqual(quiz["sourceContentType"], "quiz")
        self.assertNotIn("answerKey", json.dumps(data))
        self.cursor.fetchall.return_value = [
            ("PMP-AUDIO-1", "PMP-W01", 1, None, None, None, None, False, "{bad", None, {}, mobile.PILOT_MODULE_ID, 1, 1)]
        self.assertNotIn("learningRoute", self.body(mobile.catalogue(self.request()))["components"][0])

    def test_direct_route_metadata_accepts_raw_json_text_and_preserves_typed_values(self):
        legacy = {"required": True, "optional": False, "required_route_minutes": 20,
                  "required_weekly_minutes": 45, "source_content_type": "reading"}
        direct = {"required": False, "optional": True, "countsTowardsRequiredCompletion": False,
                  "required_route_minutes": 12.5, "required_weekly_minutes": None,
                  "full_content_planned_minutes": 0, "plannedLearningMinutes": 30,
                  "source_content_type": "audio", "parent_activity_id": "LESSON-1",
                  "answerKey": "never expose"}
        expected_route = {"source": "canonical_settings", "required": False, "optional": True,
                          "countsTowardsRequiredCompletion": False, "requiredRouteMinutes": 12.5,
                          "requiredWeeklyMinutes": 45, "fullContentPlannedMinutes": 0,
                          "plannedLearningMinutes": 30, "requirement": "Optional"}
        for raw_direct in (direct, json.dumps(direct)):
            with self.subTest(raw_json=isinstance(raw_direct, str)):
                self.cursor.fetchall.return_value = [
                    ("PMP-AUDIO-1", "PMP-W01", 1, None, None, None, None, False,
                     json.dumps(legacy), "Optional", raw_direct, mobile.PILOT_MODULE_ID, 1, 1)]
                response = mobile.catalogue(self.request())
                self.assertEqual(response.status_code, 200)
                item = self.body(response)["components"][0]
                self.assertEqual(item["learningRoute"], expected_route)
                self.assertEqual(item["sourceContentType"], "audio")
                self.assertEqual(item["sourceParentActivityId"], "LESSON-1")
                self.assertNotIn("answerKey", json.dumps(item))

    def test_malformed_or_non_object_direct_metadata_is_ignored(self):
        for direct in ("{bad", "null", "[]", '"text"', "true", "3", [], True, 3):
            with self.subTest(direct=direct):
                self.cursor.fetchall.return_value = [
                    ("PMP-AUDIO-1", "PMP-W01", 1, None, None, None, None, False,
                     {}, None, direct, mobile.PILOT_MODULE_ID, 1, 1)]
                response = mobile.catalogue(self.request())
                self.assertEqual(response.status_code, 200)
                self.assertNotIn("learningRoute", self.body(response)["components"][0])

    def test_programme_otjh_never_becomes_weekly_measured_seconds(self):
        overview = sys.modules["learner_api.overview_week"].overview_week
        overview.reset_mock()
        overview.return_value = JsonResponse({"otjh": {"actual": 999, "planned": 1000}})
        data = self.body(mobile.hours(self.request(query="?learnerId=999")))
        self.assertEqual(data["source"], "lms")
        self.assertEqual(data["moduleId"], mobile.PILOT_MODULE_ID)
        self.assertEqual(data["canonicalProgrammeOtjh"]["actual"], 999)
        self.assertEqual(data["mobileMeasuredTime"]["weeklySubmittedSeconds"], 0)
        self.assertIsNone(data["mobileMeasuredTime"]["weeklyAcceptedOtjhSeconds"])
        self.assertEqual(overview.call_args.args[0].GET["section"], "home")
        self.assertEqual(overview.call_args.args[0].GET["learnerId"], "501")

    def test_cross_week_missing_bounds_and_overlaps_never_invent_weekly_time(self):
        now = datetime(2026, 10, 5, 10, tzinfo=timezone.utc)
        row = {"verifiedSeconds": 600, "timeTrackingSource": "signed_session_capped_active_quiz",
               "timeTrackingSessionId": "cross-week", "startedAt": "2026-10-04T22:55:00Z",
               "submittedAt": "2026-10-04T23:10:00Z"}
        missing = {**row, "timeTrackingSessionId": "missing", "startedAt": None}
        result = mobile.measured_time([(row, True), (missing, False)], mobile.PILOT_MODULE_ID, now)
        self.assertEqual(result["weeklySubmittedSeconds"], 0)
        self.assertEqual(result["moduleSubmittedSeconds"], 1200)
        self.assertEqual(result["unallocatedMeasuredSeconds"], 1200)
        a = {**row, "timeTrackingSessionId": "a", "startedAt": "2026-10-05T08:00:00Z",
             "submittedAt": "2026-10-05T09:00:00Z"}
        b = {**a, "timeTrackingSessionId": "b", "startedAt": "2026-10-05T08:30:00Z"}
        result = mobile.measured_time([(a, True), (b, True)], mobile.PILOT_MODULE_ID, now)
        self.assertEqual(result["moduleSubmittedSeconds"], 0)
        self.assertEqual(result["excludedOverlappingSessions"], 2)
        self.assertEqual(result["excludedOverlapSeconds"], 1200)

    def test_half_open_midnight_and_future_invalid_spans_stay_out_of_this_week(self):
        now = datetime(2026, 10, 5, 10, tzinfo=timezone.utc)
        row = {"verifiedSeconds": 600, "timeTrackingSource": "signed_session_capped_active_quiz",
               "timeTrackingSessionId": "boundary", "startedAt": "2026-10-04T22:50:00Z",
               "submittedAt": "2026-10-04T23:00:00Z"}
        result = mobile.measured_time([(row, True)], mobile.PILOT_MODULE_ID, now)
        self.assertEqual(result["weeklySubmittedSeconds"], 0)
        self.assertEqual(result["unallocatedMeasuredSeconds"], 0)
        future = {**row, "submittedAt": "2026-10-06T23:00:00Z"}
        result = mobile.measured_time([(future, True)], mobile.PILOT_MODULE_ID, now)
        self.assertEqual(result["weeklySubmittedSeconds"], 0)
        self.assertEqual(result["unallocatedMeasuredSeconds"], 600)

    def test_inactive_linked_profile_cannot_start_or_submit_unsaved_success(self):
        Profile.objects.filter.return_value.exists.return_value = False
        self.mode = "active_quiz"
        responses = [mobile.start_learning_session(self.request("POST", {"componentId": "PMP-AUDIO-1", "mode": "audio"})),
                     mobile.complete_component(self.request("POST", self.finish()), "PMP-AUDIO-1"),
                     mobile.complete_video(self.request("POST", self.finish()), "PMP-AUDIO-1"),
                     mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12]})), "PMP-QUIZ-1")]
        for response in responses:
            self.assertEqual(response.status_code, 409)
            self.assertEqual(self.body(response)["code"], "learner_profile_inactive")
        self.assertEqual(Profile.objects.filter.call_args.kwargs,
                         {"pk": 991, "enrolment_id": 501, "lifecycle_status": "active"})
        timer.start_time_tracking.assert_not_called()
        components.submit_component_progress.assert_not_called()
        videos.submit_video_progress.assert_not_called()
        quizzes.submit_quiz_attempt.assert_not_called()
        self.assertEqual(mobile.progress(self.request()).status_code, 409)

    def test_profile_deactivation_during_detail_hydration_stops_writer(self):
        Profile.objects.filter.return_value.exists.side_effect = [True, False]
        response = mobile.start_learning_session(self.request("POST", {"componentId": "PMP-AUDIO-1", "mode": "audio"}))
        self.assertEqual(response.status_code, 409)
        self.assertEqual(self.body(response)["code"], "learner_profile_inactive")
        timer.start_time_tracking.assert_not_called()

if __name__ == "__main__":
    unittest.main(verbosity=2)
