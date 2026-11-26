"""Browser timing and staff policy boundaries; synthetic identities only."""
import json
import os
import unittest
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch
import test_mobile_rewards_contract as rewards
import test_mobile_contract as base
from learner_api import reward_tracking
from engagement_api import learning_policy_views
from engagement_api.learning_policy import DEFAULTS
from engagement_api.segment_rules import RewardError
from django.db import DatabaseError
from django.test import override_settings


class BrowserTrackingGateTests(unittest.TestCase):
    """Exercise the real request gates with isolated identity/persistence fixtures."""

    def setUp(self):
        base.MobileFacadeTests.setUp(self)
        rewards.RewardsFacadeTests.scoped(self)
        self.enterContext(override_settings(KBC_MOBILE_API_ENABLED=False, KBC_SHARED_REWARDS_READY=True))
        self.mode = "visible_page"
        self.audio.update(type="powerpoint")
        self.audio.pop("audioUrl")
        body = {"trackingToken": "server-token", "activityKind": "component",
                "activityId": self.audio["componentId"]}
        self.endpoints = (
            ("observations", reward_tracking.observations,
             {**body, "eventId": "signed-1:1", "sequence": 1, "intervals": []}),
            ("clock", reward_tracking.clock, body),
        )
        self.record = self.enterContext(patch.object(
            reward_tracking, "record_observations", return_value={"source": "lms"}))
        self.enterContext(patch.object(reward_tracking.timezone, "now",
            return_value=datetime(2026, 10, 5, 0, 10, tzinfo=timezone.utc)))

    def request(self, endpoint, body):
        return self.factory.post(f"/learner_api/time-tracking/{endpoint}/",
            data=json.dumps(body), content_type="application/json",
            HTTP_X_REQUESTED_WITH="XMLHttpRequest")

    def assert_rejected(self, status, code, *, updates=None):
        for name, view, body in self.endpoints:
            with self.subTest(endpoint=name):
                response = view(self.request(name, {**body, **(updates or {})}))
                self.assertEqual(response.status_code, status)
                self.assertEqual(json.loads(response.content)["code"], code)
                self.assertEqual(response["Cache-Control"], "private, no-store")
        self.record.assert_not_called()

    def test_browser_slide_timing_works_independently_of_mobile_flag_for_both_learner_types(self):
        for enabled in (False, True):
            for kind in ("commercial", "apprenticeship"):
                self.source.learner_type = kind
                with self.subTest(mobile_enabled=enabled, kind=kind), override_settings(KBC_MOBILE_API_ENABLED=enabled):
                    for name, view, body in self.endpoints:
                        response = view(self.request(name, body))
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(response["Cache-Control"], "private, no-store")
                        self.assertEqual(base.timer.verify_tracking_session.call_args.kwargs["learner_id"], 501)
                        self.assertEqual(base.timer.verify_tracking_session.call_args.kwargs["learner_kind"], kind)
                        expected = ({"source": "lms"} if name == "observations" else
                                    {"sessionId": "signed-1", "elapsedMilliseconds": 600000})
                        self.assertEqual(json.loads(response.content), expected)
                    args = self.record.call_args.kwargs
                    self.assertEqual((args["learner_id"], args["profile_id"]), ("501", 991))
                    self.assertEqual(args["component"]["type"], "powerpoint")
                    self.assertEqual(args["tracking"]["countingMode"], "visible_page")
        self.assertEqual(self.record.call_count, 4)

    def test_native_session_and_reward_writes_stay_disabled(self):
        for view, path, method in (
            (base.mobile.session, "/learner_api/mobile/session/", "GET"),
            (base.mobile.start_learning_session, "/learner_api/mobile/learning-sessions/start/", "POST"),
            (rewards.views.observations, "/learner_api/mobile/rewards/observations/", "POST"),
        ):
            with self.subTest(view=view.__name__):
                request = (self.factory.get(path) if method == "GET" else
                           self.factory.post(path, data="{}", content_type="application/json",
                                             HTTP_X_REQUESTED_WITH="XMLHttpRequest"))
                response = view(request)
                self.assertEqual(response.status_code, 503)
                self.assertEqual(json.loads(response.content)["code"], "mobile_disabled")
        base.mobile.authenticate_request.assert_not_called()
        self.record.assert_not_called()
        rewards.service.record_observations.assert_not_called()

    def test_anonymous_and_inactive_accounts_stay_rejected(self):
        with patch.object(base.mobile, "authenticate_request", return_value=None):
            self.assert_rejected(401, "unauthenticated")
        self.account.is_active = False
        self.assert_rejected(401, "unauthenticated")

    def test_other_roles_and_non_learner_subjects_stay_rejected(self):
        for role in ("admin", "staff", "coach", "tutor", "employer"):
            with self.subTest(role=role):
                self.account.role = role
                self.assert_rejected(403, "learner_only")
        self.account.role = "learner"
        self.account.subject_type = "staff"
        self.assert_rejected(403, "learner_only")

    def test_security_header_and_post_method_still_required(self):
        for name, view, body in self.endpoints:
            with self.subTest(endpoint=name):
                request = self.request(name, body)
                del request.META["HTTP_X_REQUESTED_WITH"]
                response = view(request)
                self.assertEqual(response.status_code, 403)
                self.assertEqual(json.loads(response.content)["code"], "csrf")
                response = view(self.factory.get(f"/learner_api/time-tracking/{name}/"))
                self.assertEqual(response.status_code, 405)
                self.assertEqual(json.loads(response.content)["code"], "method_not_allowed")
        base.mobile.authenticate_request.assert_not_called()
        self.record.assert_not_called()

    def test_disabled_auth_gates_still_fail_closed(self):
        with patch.object(base.mobile, "auth_gate_enabled", return_value=False):
            self.assert_rejected(503, "auth_gate_disabled")
        with patch.dict(os.environ, {"API_REQUIRE_AUTH": "0"}):
            self.assert_rejected(503, "auth_gate_disabled")
        base.mobile.authenticate_request.assert_not_called()

    def test_unassigned_activity_client_identity_and_wrong_token_stay_rejected(self):
        self.assert_rejected(404, "activity_not_assigned", updates={"activityId": "UNASSIGNED"})
        self.assert_rejected(400, "invalid_request", updates={"learnerId": "502"})
        self.assert_rejected(400, "invalid_tracking_session", updates={"trackingToken": "wrong"})

    def test_missing_or_inactive_profile_and_closed_learning_stay_rejected(self):
        profiles = base.Profile.objects.filter.return_value
        with patch.object(profiles, "only", return_value=[]):
            self.assert_rejected(409, "learner_profile_unlinked")
        with patch.object(profiles, "exists", return_value=False):
            self.assert_rejected(409, "learner_profile_inactive")
        self.detail["learningAccess"] = {"blocked": True}
        self.assert_rejected(403, "learning_access_blocked")

    def test_session_and_database_outages_stay_visible(self):
        with patch.object(base.mobile, "authenticate_request", return_value=None), \
                patch.object(base.mobile, "session_unreadable", return_value=True):
            self.assert_rejected(503, "auth_unavailable")
        with patch.object(base.mobile, "authenticate_request", side_effect=DatabaseError("synthetic")):
            self.assert_rejected(503, "lms_unavailable")

    def test_browser_reward_capability_respects_the_policy_start_instant(self):
        now = datetime(2026, 10, 5, 0, 10, tzinfo=timezone.utc)
        database = MagicMock()
        for start, expected in ((now - timedelta(seconds=1), True), (now, True),
                                (now + timedelta(seconds=1), False)):
            with self.subTest(start=start), patch.object(reward_tracking, "connections", {"default": database}), \
                    patch.object(reward_tracking, "policy", return_value={"enabled": True, "starts_at": start}):
                self.assertEqual(reward_tracking.capability(
                    self.request("start", {}), "component", self.audio["componentId"]), expected)

    def test_disabled_rewards_do_not_advertise_tracking_or_query_reward_storage(self):
        with override_settings(KBC_SHARED_REWARDS_READY=False), \
                patch.object(reward_tracking, "connections") as database:
            self.assertFalse(reward_tracking.capability(
                self.request("start", {}), "component", self.audio["componentId"]))
            database.__getitem__.assert_not_called()

    def test_start_response_explicitly_reports_disabled_rewards(self):
        # Execute the actual handler with an isolated timing issuer. Importing
        # the application module would load ORM dependencies unrelated to this contract.
        import ast
        path = base.ROOT.parent / "learner_api" / "time_tracking.py"
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        handler = next(node for node in tree.body if isinstance(node, ast.FunctionDef)
                       and node.name == "start_time_tracking")
        handler.decorator_list = []
        scope = {"json": json, "JsonResponse": base.JsonResponse,
                 "TrackingSessionError": base.TrackingSessionError,
                 "issue_tracking_session": MagicMock(return_value={"trackingToken": "synthetic"})}
        exec(compile(ast.Module(body=[handler], type_ignores=[]), str(path), "exec"), scope)
        with override_settings(KBC_SHARED_REWARDS_READY=False):
            for kind in ("commercial", "apprenticeship"):
                request = self.factory.post(f"/learner_api/time-tracking/start/?kind={kind}&learnerId=501",
                    data=json.dumps({"activityKind": "component", "activityId": "SLIDES", "countingMode": "visible_page"}),
                    content_type="application/json")
                response = scope["start_time_tracking"](request)
                self.assertEqual(response.status_code, 200)
                self.assertIs(json.loads(response.content)["rewardTracking"], False)

class BrowserTrackingTests(rewards.RewardsFacadeTests):
    # Keep inherited scope/security regression coverage.
    def body(self, **updates):
        return {"trackingToken":"server-token","activityKind":"component","activityId":"PMP-AUDIO-1",
                "eventId":"signed-1:1","sequence":1,"intervals":[],**updates}

    def test_disconnected_time_needs_review_without_fabricated_success_or_lost_draft(self):
        self.scoped()
        with patch.object(reward_tracking, 'record_observations', side_effect=RewardError('observation_outside_timing_lease')):
            response = reward_tracking.observations(self.request('POST', self.body()))
        self.assertEqual(response.status_code, 409)
        data = json.loads(response.content)
        self.assertEqual(data['code'], 'observation_outside_timing_lease')
        self.assertIn('Your draft is kept', data['error'])
        self.assertIn('contact support', data['error'])

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

    def test_restored_clock_is_server_based_read_only_and_owner_scoped(self):
        self.scoped()
        body = {"trackingToken": "server-token", "activityKind": "component", "activityId": "PMP-AUDIO-1"}
        with patch.object(reward_tracking.timezone, 'now', return_value=datetime(2026, 10, 5, 0, 10, tzinfo=timezone.utc)), \
                patch.object(reward_tracking, 'record_observations') as record:
            response = reward_tracking.clock(self.request('POST', body))
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content), {"sessionId": "signed-1", "elapsedMilliseconds": 600000})
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(base.timer.verify_tracking_session.call_args.kwargs['learner_id'], 501)
        record.assert_not_called()

    def test_clock_rejects_wrong_token_extra_identity_unassigned_and_staff(self):
        self.scoped()
        body = {"trackingToken": "server-token", "activityKind": "component", "activityId": "PMP-AUDIO-1"}
        for updates in ({"trackingToken": "wrong"}, {"learnerId": "502"}, {"activityId": "unknown"}):
            with self.subTest(updates=updates):
                self.assertGreaterEqual(reward_tracking.clock(self.request('POST', {**body, **updates})).status_code, 400)
        self.account.role = 'staff'
        self.assertEqual(reward_tracking.clock(self.request('POST', body)).status_code, 403)

    def test_clock_reports_the_verified_rejection_reason_without_recording_or_logging_tokens(self):
        self.scoped()
        body = {'trackingToken': 'private-synthetic-token', 'activityKind': 'component', 'activityId': 'PMP-AUDIO-1'}
        for code in ('expired_tracking_session', 'invalid_tracking_signature', 'tracking_identity_mismatch'):
            failure = base.TrackingSessionError('private-synthetic-token')
            failure.code = code
            with self.subTest(code=code), patch.object(reward_tracking, 'verify_tracking_session', side_effect=failure), \
                 patch.object(reward_tracking, 'record_observations') as record, \
                 patch.object(reward_tracking.logger, 'warning') as log:
                response = reward_tracking.clock(self.request('POST', body))
                payload = json.loads(response.content)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(payload['code'], code)
                self.assertIn('draft', payload['error'])
                self.assertNotIn('private-synthetic-token', payload['error'])
                log.assert_called_once_with('study_clock_rejected reason=%s', code)
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
