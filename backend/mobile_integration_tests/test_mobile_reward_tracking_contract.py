"""Browser timing and staff policy boundaries; synthetic identities only."""
import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch
import test_mobile_rewards_contract as rewards
import test_mobile_contract as base
from learner_api import reward_tracking
from engagement_api import learning_policy_views
from engagement_api.learning_policy import DEFAULTS
from engagement_api.segment_rules import RewardError

class BrowserTrackingTests(rewards.RewardsFacadeTests):
    # Keep inherited scope/security regression coverage.
    def body(self, **updates):
        return {"trackingToken":"server-token","activityKind":"component","activityId":"PMP-AUDIO-1",
                "eventId":"signed-1:1","sequence":1,"intervals":[],**updates}

    def test_browser_reading_uses_visible_time_and_server_identity(self):
        self.scoped();self.mode="visible_page"
        with patch.object(reward_tracking,"record_observations",return_value={"source":"lms"}) as record:
            result=reward_tracking.observations(self.request("POST",self.body()))
        self.assertEqual(result.status_code,200)
        self.assertEqual(record.call_args.kwargs["learner_id"],"501")
        self.assertEqual(record.call_args.kwargs["tracking"]["countingMode"],"visible_page")

    def test_browser_other_learner_or_unassigned_activity_never_records(self):
        self.scoped()
        with patch.object(reward_tracking,"record_observations") as record:
            for updates in ({"learnerId":"502"},{"activityId":"unknown"},{"trackingToken":"wrong"}):
                response=reward_tracking.observations(self.request("POST",self.body(**updates)))
                self.assertGreaterEqual(response.status_code,400)
            record.assert_not_called()

    def test_browser_policy_gate_is_not_bypassed(self):
        self.scoped()
        self.detail["learningAccess"]={"blocked":True}
        with patch.object(reward_tracking,"record_observations") as record:
            response=reward_tracking.observations(self.request("POST",self.body()))
            self.assertEqual(response.status_code,403);record.assert_not_called()

    def test_staff_cannot_capture_learner_activity(self):
        self.scoped();self.account.role="staff"
        with patch.object(reward_tracking,"record_observations") as record:
            self.assertEqual(reward_tracking.observations(self.request("POST",self.body())).status_code,403)
            record.assert_not_called()

class PolicyPermissionTests(unittest.TestCase):
    def request(self, headers=True, body=None):
        from django.test import RequestFactory
        return RequestFactory().post("/engagement_api/learning-points-policy/",
            data=json.dumps(body or {"expectedId":7,"settings":DEFAULTS}),content_type="application/json",
            **({"HTTP_X_REQUESTED_WITH":"XMLHttpRequest"} if headers else {}))

    def invoke(self, account, request, publish=None):
        with patch("engagement_api.permissions.authenticate_request",return_value=account),patch.object(
            learning_policy_views,"authenticate_request",return_value=account),patch.object(
            learning_policy_views,"publish",publish or (lambda settings,actor,expected:{"id":8})):
            return learning_policy_views.settings_view(request)

    def test_only_active_staff_and_admin_can_publish(self):
        for role in ("learner","coach","tutor","employer"):
            response=self.invoke(SimpleNamespace(role=role,pk=10,is_active=True),self.request())
            self.assertEqual(response.status_code,403)
        self.assertEqual(self.invoke(None,self.request()).status_code,401)
        for role in ("admin","staff"):
            response=self.invoke(SimpleNamespace(role=role,pk=10,is_active=True),self.request())
            self.assertEqual(response.status_code,200)
        self.assertEqual(self.invoke(SimpleNamespace(role="admin",pk=10,is_active=False),self.request()).status_code,401)

    def test_security_header_and_no_client_actor_override(self):
        account=SimpleNamespace(role="admin",pk=10,is_active=True)
        self.assertEqual(self.invoke(account,self.request(headers=False)).status_code,403)
        self.assertEqual(self.invoke(account,self.request(body={"expectedId":7,"settings":DEFAULTS,"actor":99})).status_code,400)

    def test_conflict_exposed_without_false_success(self):
        def fail(*args):raise RewardError("policy_changed_refresh_before_saving")
        response=self.invoke(SimpleNamespace(role="staff",pk=10,is_active=True),self.request(),fail)
        self.assertEqual(response.status_code,409)
        self.assertIn("policy_changed",json.loads(response.content)["code"])
