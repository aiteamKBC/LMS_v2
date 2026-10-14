"""Real Django adapter checks with no database or provider access."""
import importlib.util
import json
import sys
import types
import unittest
from datetime import datetime,timezone
from pathlib import Path
from unittest.mock import Mock,patch
import test_mobile_contract as base
from django.test import override_settings
from learner_api import mobile_rewards as views

ROOT=Path(__file__).resolve().parent.parent/"engagement_api"
package=types.ModuleType("engagement_api");package.__path__=[str(ROOT)]
sys.modules["engagement_api"]=package
from engagement_api.segment_rules import RewardError
service=base.fixture_module("engagement_api.shared_rewards",policy=Mock(),
    summary=Mock(),record_observations=Mock(),voucher_request=Mock(),set_leaderboard=Mock(),
    verify_bonus=Mock(),PILOT_MODULE=base.mobile.PILOT_MODULE_ID)
from engagement_api import shared_reward_views as staff_views


class RewardsFacadeTests(unittest.TestCase):
    setUp=base.MobileFacadeTests.setUp
    request=base.MobileFacadeTests.request

    def scoped(self):
        item=patch.object(views,"enabled",return_value=True);item.start();self.addCleanup(item.stop)
        for name in ("summary","record_observations","voucher_request","set_leaderboard"):
            handler=getattr(service,name);handler.reset_mock();handler.side_effect=None
            handler.return_value={"source":"lms"}
        def signed(token,**kwargs):
            if token!="server-token":raise base.TrackingSessionError("invalid")
            return {"sessionId":"signed-1","startedAt":datetime(2026,10,5,tzinfo=timezone.utc),
                    "countingMode":self.mode,"verifiedSeconds":0}
        base.timer.verify_tracking_session.side_effect=signed

    def observation(self,**updates):
        return {"trackingToken":"server-token","componentId":self.audio["componentId"],"mode":"audio",
                "eventId":"signed-1:1","sequence":1,"intervals":[],**updates}

    def test_observation_identity_kind_and_mode_come_from_server(self):
        self.scoped()
        result=views.observations(self.request("POST",self.observation()))
        self.assertEqual(result.status_code,200)
        args=service.record_observations.call_args.kwargs
        self.assertEqual((args["learner_id"],args["profile_id"]),("501",991))
        self.assertEqual(args["tracking"]["activityKind"],"component")
        self.assertEqual(args["tracking"]["learnerKind"],"apprenticeship")
        self.assertEqual(base.timer.verify_tracking_session.call_args.kwargs["learner_id"],501)

    def test_observations_reject_inactive_or_wrong_token_mode_and_extra_identity(self):
        self.scoped()
        for updates in ({"learnerId":"502"},{"trackingToken":"wrong"},{"mode":"reading"}):
            self.assertGreaterEqual(views.observations(self.request("POST",self.observation(**updates))).status_code,400)
        self.mode="visible_page"
        self.assertEqual(views.observations(self.request("POST",self.observation())).status_code,400)
        self.mode="active_playback"
        base.Profile.objects.filter.return_value.exists.return_value=False
        self.assertEqual(views.observations(self.request("POST",self.observation())).status_code,409)
        service.record_observations.assert_not_called()

    def test_quiz_uses_canonical_quiz_id_not_component_or_client_id(self):
        self.scoped();self.mode="active_quiz"
        response=views.observations(self.request("POST",self.observation(componentId="PMP-QUIZ-1",mode="quiz")))
        self.assertEqual(response.status_code,200)
        self.assertEqual(service.record_observations.call_args.kwargs["tracking"]["activityId"],"77")

    def test_other_assigned_course_study_does_not_expand_pmp_rewards(self):
        self.scoped()
        self.plan.append({"moduleId":"RISK-M01","moduleTitle":"Risk"})
        self.detail["components"].append({**self.audio,"moduleId":"RISK-M01","componentId":"RISK-AUDIO"})
        response=views.observations(self.request("POST",self.observation(componentId="RISK-AUDIO")))
        self.assertEqual(response.status_code,404)
        self.assertEqual(json.loads(response.content)["code"],"module_not_assigned")
        service.record_observations.assert_not_called()
        base.timer.verify_tracking_session.assert_not_called()

    def test_standalone_quiz_never_persists_a_synthetic_reward_component(self):
        self.scoped();self.mode="active_quiz"
        self.quiz_component["componentId"]=None
        catalogue=json.loads(base.mobile.catalogue(self.request()).content)
        quiz=next(item for item in catalogue["components"] if item["mobileMode"]=="quiz")
        audio=next(item for item in catalogue["components"] if item["mobileMode"]=="audio")
        self.assertFalse(quiz["rewardObservationsSupported"])
        self.assertTrue(audio["rewardObservationsSupported"])
        response=views.observations(self.request("POST",self.observation(componentId=quiz["componentId"],mode="quiz")))
        self.assertEqual(response.status_code,404)
        service.record_observations.assert_not_called()
        base.timer.verify_tracking_session.assert_not_called()
        response=base.mobile.submit_quiz(self.request("POST",{
            "trackingToken":"server-token","timeTakenSeconds":0,"answers":{"10":[12]}}),quiz["componentId"])
        self.assertEqual(response.status_code,200)
        self.assertEqual(base.quizzes.submit_quiz_attempt.call_args.kwargs,{"quiz_id":77})

    def test_entitlement_and_learning_gate_cover_all_reward_views(self):
        self.scoped()
        self.detail["learningAccess"]={"blocked":True}
        for view,body in ((views.summary,None),(views.voucher_request,{"requestId":"a","amountGbp":1}),
                          (views.leaderboard,{"optedIn":True,"displayName":"Alias"}),
                          (views.observations,self.observation())):
            response=view(self.request("GET" if body is None else "POST",body))
            self.assertEqual(response.status_code,403)
        self.detail["learningAccess"]={"blocked":False};self.detail["components"]=[]
        self.assertEqual(views.summary(self.request()).status_code,404)

    def test_voucher_and_alias_save_exact_response_and_no_override(self):
        self.scoped()
        expected={"source":"lms","learnerId":"501","moduleId":base.mobile.PILOT_MODULE_ID,
            "request":{"requestId":"r1","claimId":"19","amountGbp":1,"points":100,"status":"pending","requestedAt":"2026-10-05T12:00:00Z"},"duplicate":False}
        service.voucher_request.return_value=expected
        response=views.voucher_request(self.request("POST",{"requestId":"r1","amountGbp":1}))
        self.assertEqual(json.loads(response.content),expected)
        self.assertEqual(service.voucher_request.call_args.kwargs["learner_id"],"501")
        self.assertEqual(views.leaderboard(self.request("POST",{"optedIn":True,"displayName":"Alias","learnerId":"502"})).status_code,400)

    def test_service_failure_keeps_safe_code_and_security_header_required(self):
        self.scoped();service.voucher_request.side_effect=RewardError("insufficient_points")
        response=views.voucher_request(self.request("POST",{"requestId":"r1","amountGbp":1}))
        self.assertEqual(response.status_code,409)
        self.assertEqual(json.loads(response.content)["code"],"insufficient_points")
        req=self.request("POST",{"requestId":"r1","amountGbp":1});del req.META["HTTP_X_REQUESTED_WITH"]
        self.assertEqual(views.voucher_request(req).status_code,403)

    @override_settings(KBC_SHARED_REWARDS_READY=False)
    def test_default_disabled_capabilities_do_not_touch_reward_database(self):
        with patch.object(views,"connections") as database:
            self.assertFalse(views.enabled())
            database.__getitem__.assert_not_called()
        capabilities=json.loads(base.mobile.session(self.request()).content)["capabilities"]
        self.assertFalse(capabilities["timeObservations"]);self.assertFalse(capabilities["customPointsPolicy"])

    def test_enabled_session_advertises_only_real_reward_capabilities(self):
        self.scoped()
        capabilities=json.loads(base.mobile.session(self.request()).content)["capabilities"]
        self.assertTrue(capabilities["timeObservations"]);self.assertTrue(capabilities["customPointsPolicy"])
        self.assertFalse(capabilities["offlineHoursSync"])

    @override_settings(KBC_SHARED_REWARDS_READY=True)
    def test_future_policy_does_not_advertise_capabilities(self):
        from datetime import timedelta
        from unittest.mock import MagicMock
        db=MagicMock()
        service.policy.return_value={"enabled":True,"starts_at":datetime.now(timezone.utc)+timedelta(days=1)}
        with patch.object(views,"connections",{"default":db}):
            self.assertFalse(views.enabled())

    @override_settings(KBC_SHARED_REWARDS_READY=True)
    def test_staff_verification_cannot_be_called_by_learner(self):
        service.verify_bonus.reset_mock()
        response=staff_views.verify_bonus(self.request("POST",{}))
        self.assertEqual(response.status_code,403)
        service.verify_bonus.assert_not_called()

    @override_settings(KBC_SHARED_REWARDS_READY=True)
    def test_staff_verification_binds_staff_and_target_kind_and_requires_assignment(self):
        self.account.role="staff";self.account.subject_type="staff"
        base.Source.all_learners.filter.return_value.first.return_value=self.source
        service.verify_bonus.reset_mock();service.verify_bonus.return_value={"verified":True}
        payload={"learnerId":"501","opportunity":"career-planner","verificationId":"v1",
                 "evidenceReference":"evidence1","completionDate":"2026-10-05"}
        response=staff_views.verify_bonus(self.request("POST",payload))
        self.assertEqual(response.status_code,200)
        args=service.verify_bonus.call_args.kwargs
        self.assertEqual((args["staff_id"],args["learner_id"],args["learner_kind"]),("9","501","apprenticeship"))
        self.detail["learningAccess"]={"blocked":True}
        self.assertEqual(staff_views.verify_bonus(self.request("POST",payload)).status_code,403)
        self.detail["learningAccess"]={"blocked":False}
        self.detail["components"]=[]
        self.assertEqual(staff_views.verify_bonus(self.request("POST",payload)).status_code,404)

    @override_settings(KBC_SHARED_REWARDS_READY=True)
    def test_staff_verification_cannot_supply_points_or_skip_write_header(self):
        self.account.role="admin";self.account.subject_type="staff"
        self.assertEqual(staff_views.verify_bonus(self.request("POST",{"points":20000})).status_code,400)
        req=self.request("POST",{});del req.META["HTTP_X_REQUESTED_WITH"]
        self.assertEqual(staff_views.verify_bonus(req).status_code,403)


if __name__=="__main__":
    unittest.main(verbosity=2)
