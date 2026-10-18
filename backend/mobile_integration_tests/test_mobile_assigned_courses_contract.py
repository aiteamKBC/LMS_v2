"""Assigned-course identity, media admission and canonical delegation regressions.

All repositories and canonical writers are synthetic test doubles. This suite
does not load application settings, connect to a database or mutate learners.
"""
import json
import unittest
from unittest.mock import patch

import test_mobile_contract as base

mobile = base.mobile


class AssignedCoursesTests(unittest.TestCase):
    setUp = base.MobileFacadeTests.setUp
    request = base.MobileFacadeTests.request
    body = base.MobileFacadeTests.body
    finish = base.MobileFacadeTests.finish

    def assign(self, module_id="RISK-M01", title="Risk"):
        self.plan.append({"moduleId": module_id, "moduleTitle": title})
        self.detail["week"].append({"moduleId": module_id, "module": title,
                                   "weekId": module_id + "-W01", "week": "Week 1"})
        return {**self.audio, "moduleId": module_id, "module": title,
                "weekId": module_id + "-W01", "componentId": module_id + "-AUDIO"}

    def test_same_titles_keep_distinct_courses_and_empty_assignments_visible(self):
        other = self.assign("PMP-COPY", "PMP")
        self.detail["components"].append(other)
        self.plan.append({"moduleId": "EMPTY-M01", "moduleTitle": "Empty course"})
        data = self.body(mobile.catalogue(self.request()))
        self.assertEqual(data["schemaVersion"], 2)
        self.assertEqual(data["catalogueScope"], "assigned")
        self.assertEqual(data["courses"], [
            {"moduleId": mobile.PILOT_MODULE_ID, "title": "PMP", "availableActivityCount": 2},
            {"moduleId": "PMP-COPY", "title": "PMP", "availableActivityCount": 1},
            {"moduleId": "EMPTY-M01", "title": "Empty course", "availableActivityCount": 0}])
        self.assertEqual(len(data["components"]), 3)
        self.assertEqual(data["modules"], ["PMP", "Empty course"])

    def test_explicit_empty_effective_plan_cannot_recover_old_content_or_progress(self):
        self.plan.clear()
        self.detail["componentProgress"] = [{"componentId": "PMP-AUDIO-1", "passed": True}]
        data = self.body(mobile.catalogue(self.request()))
        self.assertEqual((data["courses"], data["components"], data["weeks"]), ([], [], []))
        self.assertEqual(self.body(mobile.progress(self.request()))["completedComponentIds"], [])
        self.assertEqual(mobile.complete_component(self.request("POST", self.finish()), "PMP-AUDIO-1").status_code, 404)
        base.components.submit_component_progress.assert_not_called()

    def test_non_pmp_audio_uses_canonical_writer_for_both_learner_kinds(self):
        audio = self.assign()
        self.detail["components"].append(audio)
        for kind in ("apprenticeship", "commercial"):
            with self.subTest(kind=kind):
                self.source.learner_type = kind
                response = mobile.complete_component(self.request("POST", self.finish(),
                    query="?learnerId=999&kind=other"), audio["componentId"])
                self.assertEqual(response.status_code, 200)
                child = base.components.submit_component_progress.call_args.args[0]
                payload = json.loads(child.body)
                self.assertEqual(dict(child.GET), {"kind": [kind], "learnerId": ["501"]})
                self.assertEqual(base.components.submit_component_progress.call_args.kwargs,
                                 {"component_id": "RISK-M01-AUDIO"})
                self.assertEqual((payload["module"], payload["componentTitle"]), ("Risk", "Stakeholders"))
                self.assertEqual(payload["timeEntrySource"], "timer")
                self.assertEqual(payload["timeTakenSeconds"], 20)

    def test_non_pmp_video_has_canonical_timer_and_completion(self):
        video = {**self.assign(), "componentId": "RISK-VIDEO", "type": "video", "audioUrl": None,
                 "videoUrl": "/media/recording.mp4"}
        self.detail["components"].append(video)
        start = mobile.start_learning_session(self.request("POST", {"componentId": "RISK-VIDEO", "mode": "video"}))
        self.assertEqual(start.status_code, 200)
        child = base.timer.start_time_tracking.call_args.args[0]
        self.assertEqual(json.loads(child.body), {"activityKind": "video", "activityId": "RISK-VIDEO", "countingMode": "active_playback"})
        result = mobile.complete_video(self.request("POST", self.finish()), "RISK-VIDEO")
        self.assertEqual(result.status_code, 200)
        self.assertEqual(base.videos.submit_video_progress.call_args.kwargs, {"component_id": "RISK-VIDEO"})

    def test_standalone_quiz_uses_stable_mobile_identity_and_real_quiz_writer(self):
        self.assign()
        quiz = {**self.quiz_component, "componentId": None, "moduleId": "RISK-M01", "module": "Risk", "weekId": "RISK-M01-W01"}
        self.detail["components"].append(quiz)
        def exposed():
            return [x for x in self.body(mobile.catalogue(self.request()))["components"] if x["moduleId"] == "RISK-M01"][0]
        item = exposed()
        self.assertEqual(item["componentId"], exposed()["componentId"])
        self.assertTrue(item["componentId"].startswith("mobile-quiz-"))
        self.assertNotIn("_standaloneQuiz", item)
        self.mode = "active_quiz"
        self.assertEqual(mobile.quiz(self.request(), item["componentId"]).status_code, 200)
        start = self.body(mobile.start_learning_session(self.request("POST", {"componentId": item["componentId"], "mode": "quiz"})))
        self.assertEqual(start["activityId"], "77")
        result = mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12, 13]})), item["componentId"])
        self.assertEqual(result.status_code, 200)
        self.assertEqual(base.quizzes.submit_quiz_attempt.call_args.kwargs, {"quiz_id": 77})
        self.assertNotIn(item["componentId"], base.quizzes.submit_quiz_attempt.call_args.args[0].body.decode())

    def test_quiz_publication_gate_hides_and_refuses_every_action(self):
        self.published_quiz_ids.clear()
        data = self.body(mobile.catalogue(self.request()))
        self.assertEqual([x["componentId"] for x in data["components"]], ["PMP-AUDIO-1"])
        for response in (mobile.quiz(self.request(), "PMP-QUIZ-1"),
                         mobile.start_learning_session(self.request("POST", {"componentId": "PMP-QUIZ-1", "mode": "quiz"})),
                         mobile.submit_quiz(self.request("POST", self.finish(answers={"10": [12]})), "PMP-QUIZ-1")):
            self.assertEqual(response.status_code, 404)
        base.timer.start_time_tracking.assert_not_called()
        base.quizzes.quiz_detail.assert_not_called()
        base.quizzes.submit_quiz_attempt.assert_not_called()

    def test_type_filter_cannot_be_bypassed_by_media_attached_to_assignment_or_session(self):
        for kind in ("assignment", "live_session", "powerpoint", "reflection"):
            self.detail["components"].append({**self.audio, "componentId": "HIDDEN-" + kind, "type": kind})
        self.detail["components"].append({**self.audio, "componentId": "NO-AUDIO", "audioUrl": None, "resourceUrl": "/brief.pdf"})
        self.detail["components"].append({**self.audio, "componentId": "UNSAFE", "audioUrl": "javascript:alert(1)"})
        data = self.body(mobile.catalogue(self.request()))
        self.assertEqual([x["componentId"] for x in data["components"]], ["PMP-AUDIO-1", "PMP-QUIZ-1"])
        for cid in ["HIDDEN-" + kind for kind in ("assignment", "live_session", "powerpoint", "reflection")] + ["NO-AUDIO", "UNSAFE"]:
            self.assertEqual(mobile.start_learning_session(self.request("POST", {"componentId": cid, "mode": "audio"})).status_code, 404)
            self.assertEqual(mobile.complete_component(self.request("POST", self.finish()), cid).status_code, 404)
        base.timer.start_time_tracking.assert_not_called()
        base.components.submit_component_progress.assert_not_called()

    def test_catalogue_does_not_expose_unsupported_resources_or_session_fields(self):
        self.audio.update({"liveSessionUrl": "https://teams.example/secret", "resourceUrl": "/brief.pdf",
                           "fileName": "secret.pdf", "sessionDate": "2026-10-01", "teamsLiveSessionId": "secret"})
        data = self.body(mobile.catalogue(self.request()))
        for key in ("liveSessionUrl", "resourceUrl", "fileName", "sessionDate", "teamsLiveSessionId", "contentHtml"):
            self.assertNotIn(key, data["components"][0])

    def test_progress_selector_uses_assigned_id_and_only_supported_saved_activity(self):
        self.detail["components"].append(self.assign())
        self.detail["components"].append({**self.audio, "moduleId": "RISK-M01", "componentId": "RISK-ASSIGN", "type": "assignment"})
        self.detail["componentProgress"] = [{"componentId": cid, "passed": True} for cid in ("PMP-AUDIO-1", "RISK-M01-AUDIO", "RISK-ASSIGN", "OTHER-LEARNER")]
        data = self.body(mobile.progress(self.request(query="?moduleId=RISK-M01&learnerId=999")))
        self.assertEqual(data["moduleId"], "RISK-M01")
        self.assertEqual(data["completedComponentIds"], ["RISK-M01-AUDIO"])
        self.assertEqual([x["componentId"] for x in data["componentProgress"]], ["RISK-M01-AUDIO"])
        self.assertEqual(self.body(mobile.progress(self.request()))["moduleId"], mobile.PILOT_MODULE_ID)
        self.assertEqual(mobile.progress(self.request(query="?moduleId=UNASSIGNED")).status_code, 404)
        self.assertEqual(mobile.hours(self.request(query="?moduleId=UNASSIGNED")).status_code, 404)

    def test_non_pmp_only_learner_defaults_to_their_first_assigned_course(self):
        self.plan.clear()
        audio = self.assign()
        self.detail["components"] = [audio]
        self.assertEqual(self.body(mobile.progress(self.request()))["moduleId"], "RISK-M01")
        data = self.body(mobile.catalogue(self.request()))
        self.assertFalse(data["moduleScope"]["assigned"])
        self.assertEqual(data["courses"][0]["moduleId"], "RISK-M01")

    def test_inactive_profile_cannot_read_catalogue_activity_or_download(self):
        base.Profile.objects.filter.return_value.exists.return_value = False
        for response in (mobile.catalogue(self.request()), mobile.quiz(self.request(), "PMP-QUIZ-1"),
                         mobile.transcript(self.request(), "PMP-AUDIO-1"), mobile.download_android(self.request())):
            self.assertEqual(response.status_code, 409)
        self.cursor.execute.assert_not_called()

    def test_cross_learner_query_cannot_supply_missing_assignment(self):
        self.plan.clear()
        self.assertEqual(mobile.quiz(self.request(query="?learnerId=999&moduleId=" + mobile.PILOT_MODULE_ID), "PMP-QUIZ-1").status_code, 404)
        base.Source.all_learners.get.assert_called_with(pk=501)
        mobile.effective_training_plan.assert_called_with(self.source)
        base.quizzes.quiz_detail.assert_not_called()

    def test_non_pmp_transcript_checks_exact_assigned_module_week(self):
        self.detail["components"].append(self.assign())
        self.cursor.fetchone.return_value = ("Published transcript",)
        self.assertEqual(mobile.transcript(self.request(), "RISK-M01-AUDIO").status_code, 200)
        self.assertEqual(self.cursor.execute.call_args.args[1], ["RISK-M01-AUDIO", "RISK-M01", "RISK-M01-W01"])

    def test_session_advertises_only_the_enabled_reward_module(self):
        from learner_api import mobile_rewards
        for enabled in (False, True):
            with patch.object(mobile_rewards, "enabled", return_value=enabled):
                data = self.body(mobile.session(self.request()))
                self.assertEqual(data["rewardModuleIds"], [mobile.PILOT_MODULE_ID] if enabled else [])

    def test_quiz_progress_keeps_retained_component_identity_across_courses(self):
        self.assign()
        self.detail["components"].append({**self.quiz_component, "moduleId": "RISK-M01", "componentId": "RISK-QUIZ"})
        self.detail["quizAttempts"] = [
            {"quizId": 55, "componentId": "RISK-QUIZ", "passed": True},
            {"quizId": 77, "componentId": "PMP-QUIZ-1", "passed": True}]
        data = self.body(mobile.progress(self.request(query="?moduleId=RISK-M01")))
        self.assertEqual(data["completedComponentIds"], ["RISK-QUIZ"])
        self.assertEqual([row["quizId"] for row in data["quizAttempts"]], [55])
        self.detail["quizAttempts"] = [{"quizId": 77, "componentId": "PMP-QUIZ-1", "passed": True}]
        data = self.body(mobile.progress(self.request(query="?moduleId=RISK-M01")))
        self.assertEqual(data["completedComponentIds"], [])
        self.detail["quizAttempts"] = [{"quizId": 77, "passed": True}]
        self.assertEqual(self.body(mobile.progress(self.request(query="?moduleId=RISK-M01")))["completedComponentIds"], ["RISK-QUIZ"])

    def test_presentation_metadata_requires_exact_module_even_for_same_week_and_id(self):
        self.cursor.fetchall.return_value = [
            ("PMP-AUDIO-1", "PMP-W01", 9, 1, 2, "other", [], True, {}, None, {}, "UNASSIGNED", 1, 1)]
        data = self.body(mobile.catalogue(self.request()))
        self.assertNotIn("transcriptPath", data["components"][0])
        self.assertNotIn("displayOrder", data["components"][0])

