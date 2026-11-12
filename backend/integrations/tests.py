from __future__ import annotations

import hashlib
import hmac
import json
import time
from unittest.mock import MagicMock, Mock, patch

from django.test import RequestFactory, SimpleTestCase

from .breathe import BreatheClient
from .normalizers import normalize_employee, normalize_leave
from .permissions import service_signature_valid
from .signatories import employer_can_sign_progress_review
from .services import detect_availability_conflicts
from .views import _in_actor_tenant


class _Response:
    def __init__(self, status_code=200, payload=None, headers=None):
        self.status_code = status_code
        self._payload = payload if payload is not None else {}
        self.headers = headers or {}
        self.ok = 200 <= status_code < 300

    def json(self):
        return self._payload


class BreatheClientTests(SimpleTestCase):
    def test_pagination_uses_link_header_and_api_key(self):
        session = Mock()
        session.request.side_effect = [
            _Response(payload={"employees": [{"id": "e1"}]}, headers={"Link": '<https://api.sandbox.breathehr.info/v1/employees?page=2>; rel="next"'}),
            _Response(payload={"employees": [{"id": "e2"}]}),
        ]
        client = BreatheClient("https://api.sandbox.breathehr.info", "sandbox-test", session=session)

        rows = list(client.list_resource("employees"))

        self.assertEqual([row["id"] for row in rows], ["e1", "e2"])
        self.assertEqual(session.request.call_count, 2)
        self.assertEqual(session.request.call_args_list[0].kwargs["headers"]["X-API-KEY"], "sandbox-test")

    def test_retryable_429_retries_with_bounded_sleep(self):
        session = Mock()
        session.request.side_effect = [_Response(status_code=429, headers={"Retry-After": "0"}), _Response(payload={"id": "account-1"})]
        sleeps = []
        client = BreatheClient("https://api.sandbox.breathehr.info", "sandbox-test", session=session, sleep=sleeps.append)

        self.assertEqual(client.account()["id"], "account-1")
        self.assertEqual(len(sleeps), 1)


class NormalizerTests(SimpleTestCase):
    def test_employee_normalizer_keeps_identity_and_contract_hours(self):
        row = normalize_employee({"id": 42, "first_name": "Amina", "last_name": "Khan", "email": "Amina@Example.test", "hours_per_week": "37.5", "department": "Operations"})

        self.assertEqual(row["external_employee_id"], "42")
        self.assertEqual(row["display_name"], "Amina Khan")
        self.assertEqual(row["external_email"], "amina@example.test")
        self.assertEqual(str(row["contracted_hours"]), "37.5")

    def test_leave_normalizer_discards_unapproved_rows_and_raw_reason(self):
        self.assertIsNone(normalize_leave({"id": "l1", "employee_id": "e1", "status": "pending", "reason": "private details"}))
        row = normalize_leave({"id": "l2", "employee_id": "e1", "status": "approved", "start_date": "2026-11-10", "end_date": "2026-11-11", "reason_type": "sickness"})

        self.assertEqual(row["reason_category"], "sickness")
        self.assertNotIn("private", row)


class ServiceSignatureTests(SimpleTestCase):
    def test_signature_requires_fresh_timestamp_and_exact_body(self):
        factory = RequestFactory()
        body = json.dumps({"resources": ["employees"]}).encode()
        timestamp = "1893456000"
        request = factory.post("/integrations_api/breathe/connections/x/sync", data=body, content_type="application/json")
        request.META["HTTP_X_INTEGRATION_TIMESTAMP"] = timestamp
        request.META["HTTP_X_INTEGRATION_SIGNATURE"] = "sha256=" + hmac.new(b"secret", f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()

        # The fixed timestamp is intentionally stale, so replay protection rejects it.
        self.assertFalse(service_signature_valid(request, secret="secret"))

    def test_signature_accepts_current_timestamp_and_rejects_body_tampering(self):
        factory = RequestFactory()
        body = b'{"resources":["employees"]}'
        timestamp = str(int(time.time()))
        request = factory.post("/integrations_api/breathe/connections/x/sync", data=body, content_type="application/json")
        request.META["HTTP_X_INTEGRATION_TIMESTAMP"] = timestamp
        request.META["HTTP_X_INTEGRATION_SIGNATURE"] = "sha256=" + hmac.new(b"secret", f"{timestamp}.".encode() + body, hashlib.sha256).hexdigest()

        self.assertTrue(service_signature_valid(request, secret="secret"))
        request._body = b'{"resources":["training_courses"]}'
        self.assertFalse(service_signature_valid(request, secret="secret"))

    @patch("integrations.views.IntegrationTenant")
    def test_employer_connection_scope_is_checked_against_tenant_owner(self, tenants):
        request = RequestFactory().get("/integrations_api/breathe/connections/x/status")
        request.integration_actor = type("Account", (), {"role": "employer", "subject_id": 7})()
        connection = type("Connection", (), {"tenant_id": "tenant-a"})()
        tenants.objects.filter.return_value.exists.return_value = False

        self.assertFalse(_in_actor_tenant(request, connection))
        tenants.objects.filter.assert_called_once_with(pk="tenant-a", employer_id=7, active=True)


class SignatoryGrantTests(SimpleTestCase):
    @patch("integrations.signatories.ManagerSignatoryGrant")
    @patch("integrations.signatories.IntegrationTenant")
    def test_connected_employer_requires_an_active_grant(self, tenants, grants):
        account = type("Account", (), {"role": "employer", "subject_id": 7, "id": 11})()
        tenant_query = MagicMock()
        tenant_query.values_list.return_value = ["tenant-a"]
        tenants.objects.filter.return_value = tenant_query
        grants.objects.filter.return_value.filter.return_value.filter.return_value.exists.return_value = False

        self.assertFalse(employer_can_sign_progress_review(account))

    @patch("integrations.signatories.IntegrationTenant")
    def test_unconnected_employer_keeps_existing_signing_flow(self, tenants):
        account = type("Account", (), {"role": "employer", "subject_id": 7, "id": 11})()
        tenant_query = MagicMock()
        tenant_query.values_list.return_value = []
        tenants.objects.filter.return_value = tenant_query

        self.assertTrue(employer_can_sign_progress_review(account))


class SchedulingConflictTests(SimpleTestCase):
    @patch("integrations.services.SchedulingConflict")
    @patch("integrations.services.AvailabilityBlock")
    def test_overlap_is_queued_for_review_without_rescheduling(self, blocks, conflicts):
        block = type("Block", (), {"tenant_id": "tenant-a", "id": "block-1"})()
        blocks.objects.filter.return_value.filter.return_value.first.return_value = block
        conflict = object()
        conflicts.objects.update_or_create.return_value = (conflict, True)

        rows = detect_availability_conflicts("connection-a", [{"session_ref": "session-1", "external_person_id": "employee-1", "starts_at": 10, "ends_at": 20}])

        self.assertEqual(rows, [conflict])
        defaults = conflicts.objects.update_or_create.call_args.kwargs["defaults"]
        self.assertEqual(defaults["status"], "pending")
        self.assertEqual(defaults["starts_at"], 10)
