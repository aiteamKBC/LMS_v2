"""Database-free security regressions for component completion errors."""

import json
import inspect
from contextlib import ExitStack
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError, IntegrityError
from django.test import RequestFactory, SimpleTestCase
from django.utils import timezone

from learner_api import components


PUBLIC_ERROR = "Learner progress is temporarily unavailable. Please try again."
SENSITIVE_ERROR = (
    'syntax error at or near "Learner"; password=synthetic-secret; '
    'table "Learner"."Active_users"'
)


class _Objects:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error

    def get(self, **_kwargs):
        if self.error:
            raise self.error
        return self.result


class _FakeModel:
    DoesNotExist = type("DoesNotExist", (Exception,), {})
    objects = _Objects()


class ComponentCompletionSafeDatabaseErrorsTests(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.view = inspect.unwrap(components.submit_component_progress)
        self.source = SimpleNamespace(username="Synthetic Learner", programme="Programme")
        self.active = SimpleNamespace(training_plan_progress=[])

    def _request(self):
        return self.factory.post(
            "/learner_api/components/COMP-1/complete/?kind=apprenticeship&learnerId=42",
            data=json.dumps({"trackingToken": "synthetic-token", "componentTitle": "Activity"}),
            content_type="application/json",
        )

    def _core_patches(self, *, model_result=None, model_error=None):
        _FakeModel.objects = _Objects(model_result, model_error)
        stack = ExitStack()
        stack.enter_context(patch.object(components, "SOURCE_MODELS", {"apprenticeship": _FakeModel}))
        stack.enter_context(patch.object(components, "resolve_completion_instants", return_value=(None, None)))
        stack.enter_context(patch.object(components, "component_ksb_codes", return_value=[]))
        stack.enter_context(patch.object(components, "_component_meta", return_value=("activity", "Activity")))
        stack.enter_context(patch.object(components, "_completion_criteria", return_value=(True, {})))
        return stack

    @staticmethod
    def _payload(response):
        return json.loads(response.content.decode("utf-8"))

    def _assert_safe_502(self, response):
        self.assertEqual(response.status_code, 502)
        self.assertEqual(self._payload(response), {"error": PUBLIC_ERROR})
        self.assertNotIn("synthetic-secret", response.content.decode("utf-8"))
        self.assertNotIn("Active_users", response.content.decode("utf-8"))

    def test_learner_lookup_database_error_is_sanitized(self):
        with self._core_patches(model_error=DatabaseError(SENSITIVE_ERROR)), patch.object(
            components.logger, "error",
        ) as mock_log:
            response = self.view(self._request(), "COMP-1")

        self._assert_safe_502(response)
        self.assertNotIn(SENSITIVE_ERROR, repr(mock_log.call_args))

    def test_profile_lookup_database_error_is_sanitized(self):
        with self._core_patches(model_result=self.source), patch.object(
            components, "learner_profile_for_source", side_effect=DatabaseError(SENSITIVE_ERROR),
        ):
            response = self.view(self._request(), "COMP-1")

        self._assert_safe_502(response)

    def test_timing_session_database_error_is_a_stable_502(self):
        tracking = self._tracking()
        with self._ready_to_persist(), patch.object(
            components, "verify_tracking_session", return_value=tracking,
        ), patch.object(
            components, "tracking_session_already_used", side_effect=DatabaseError(SENSITIVE_ERROR),
        ):
            response = self.view(self._request(), "COMP-1")

        self._assert_safe_502(response)

    def test_progress_database_error_is_sanitized(self):
        with self._ready_to_persist(), patch.object(
            components, "save_progress_record", side_effect=DatabaseError(SENSITIVE_ERROR),
        ):
            response = self.view(self._request(), "COMP-1")

        self._assert_safe_502(response)

    def test_unknown_integrity_error_is_sanitized(self):
        with self._ready_to_persist(), patch.object(
            components, "save_progress_record", side_effect=IntegrityError(SENSITIVE_ERROR),
        ):
            response = self.view(self._request(), "COMP-1")

        self._assert_safe_502(response)

    def test_known_duplicate_timing_session_contract_is_unchanged(self):
        with self._ready_to_persist(), patch.object(
            components,
            "save_progress_record",
            side_effect=IntegrityError("learner_progress_tracking_session_uq"),
        ):
            response = self.view(self._request(), "COMP-1")

        self.assertEqual(response.status_code, 409)
        self.assertEqual(
            self._payload(response),
            {"error": "This activity timing session has already been submitted."},
        )

    def test_success_response_contract_is_unchanged(self):
        with self._ready_to_persist(), patch.object(
            components, "save_progress_record",
        ) as mock_save:
            response = self.view(self._request(), "COMP-1")

        self.assertEqual(response.status_code, 200)
        payload = self._payload(response)
        self.assertEqual(
            set(payload),
            {"record", "componentTitle", "componentType", "week", "module", "awaitingCoachValidation"},
        )
        self.assertEqual(payload["componentTitle"], "Activity")
        self.assertEqual(payload["componentType"], "activity")
        self.assertFalse(payload["awaitingCoachValidation"])
        mock_save.assert_called_once()

    def _ready_to_persist(self):
        stack = self._core_patches(model_result=self.source)
        stack.enter_context(patch.object(components, "learner_profile_for_source", return_value=self.active))
        stack.enter_context(patch.object(components, "verify_tracking_session", return_value=self._tracking()))
        stack.enter_context(patch.object(components, "tracking_session_already_used", return_value=False))
        stack.enter_context(patch.object(components, "requires_tutor_validation", return_value=False))
        return stack

    @staticmethod
    def _tracking():
        return {
            "sessionId": "session-1",
            "startedAt": timezone.now(),
            "source": "signed_session",
            "calculation": "server_elapsed",
            "claimedSeconds": 60,
            "serverSessionSeconds": 60,
            "verifiedSeconds": 60,
        }
