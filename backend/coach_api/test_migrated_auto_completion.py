"""Aptem signature completion with synthetic rows and no external services."""
from contextlib import contextmanager
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from datetime import date, time
from inspect import unwrap
from itertools import permutations
import json
from threading import Event
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch
from uuid import uuid4

from django.db import connections, transaction
from django.http import JsonResponse
from django.test import RequestFactory, TestCase, TransactionTestCase
from django.utils import timezone

from . import migrated_completion_views as endpoints
from .migrated_completion import requirements_for_family
from .models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewSignature, ReviewSourceReconciliation
from .tests_migrated_completion import PNG, SNAPSHOT


def review_fixture(family="MCM"):
    key = "imported-review:auto-" + uuid4().hex
    overlay = ImportedReviewInstance.objects.create(
        event_key=key, owner_email="coach@example.invalid", learner_id=17,
        source_review_id=-int(uuid4().int % 10**12),
        status="awaiting-signature", signature_requirements=requirements_for_family(family),
        template_snapshot=deepcopy(SNAPSHOT), answers={"answer": "Agreed next steps"},
    )
    booking = CoachCalendarEvent.objects.create(
        event_key=key, owner_email=overlay.owner_email, learner_id=17,
        event_type="mcr" if family == "MCM" else "progress-review",
        target_date=date(2026, 10, 19), scheduled_date=date(2026, 10, 19),
        scheduled_time=time(10), duration_minutes=60, status="awaiting-signature",
        graph_event_id="synthetic-existing-event", meeting_link="https://example.invalid/meeting",
    )
    return overlay, booking


def definition_for(overlay):
    return {"migratedForm": True, "instance": {"id": overlay.event_key, "learnerId": overlay.learner_id},
            "historicalReview": {"id": str(overlay.source_review_id)}}


@contextmanager
def source_identity(kind="apprenticeship", *, source_status="Scheduled"):
    profile = SimpleNamespace(id=17, enrolment_id=71, learner_type=kind)
    learner = SimpleNamespace(pk=71, employer_id=91)
    with patch.object(endpoints.LearnerProfile.objects, "filter") as profiles, \
         patch("coach_api.review_sources.enrolment_for_review_profile", return_value=learner), \
         patch("coach_api.views.get_learner_db_alias", return_value="enrolment"), \
         patch.object(connections["enrolment"], "cursor") as cursor:
        profiles.return_value.first.return_value = profile
        cursor.return_value.__enter__.return_value.fetchone.return_value = (source_status, None)
        yield


def sign_request(overlay, role, *, subject_id=None, signature=PNG):
    account = SimpleNamespace(pk=1, display_name="Synthetic signer", email=overlay.owner_email,
                              role={"advisor": "staff", "participant": "learner", "employer": "employer"}[role],
                              subject_id=subject_id if subject_id is not None else (91 if role == "employer" else 71))
    request = RequestFactory().post("/sign/", json.dumps({"signature": signature}), content_type="application/json")
    request.login_account = account
    if role == "advisor":
        with patch.object(endpoints, "_coach_review", return_value=(overlay.owner_email, definition_for(overlay))), \
             patch.object(endpoints, "_response", side_effect=lambda *args: JsonResponse({
                 "status": ImportedReviewInstance.objects.get(pk=overlay.pk).status})):
            return unwrap(endpoints.migrated_review_coach_sign)(request, overlay.event_key)
    with patch.object(endpoints, "authenticate_request", return_value=account):
        return endpoints.migrated_review_party_sign(request, overlay.event_key)


class MigratedAutoCompletionTests(TestCase):
    def test_every_signing_order_completes_only_on_the_last_required_signature(self):
        for family in ("MCM", "PR", "PR_SKILLS_RADAR"):
            roles = [role for role, required in requirements_for_family(family).items() if required]
            for order in permutations(roles):
                with self.subTest(family=family, order=order), source_identity():
                    overlay, booking = review_fixture(family)
                    identity = (booking.pk, booking.event_key, booking.graph_event_id, booking.meeting_link,
                                booking.scheduled_date, booking.scheduled_time, booking.duration_minutes)
                    for index, role in enumerate(order):
                        response = sign_request(overlay, role)
                        self.assertEqual(response.status_code, 200, response.content)
                        overlay.refresh_from_db()
                        booking.refresh_from_db()
                        final = index == len(order) - 1
                        expected = "completed" if final else "awaiting-signature"
                        self.assertEqual((overlay.status, booking.status), (expected, expected))
                        self.assertEqual(overlay.completed_at is not None, final)
                        self.assertEqual(booking.review_completed_at, overlay.completed_at)
                    self.assertEqual(overlay.migrated_signatures.count(), len(roles))
                    self.assertEqual(overlay.answers, {"answer": "Agreed next steps"})
                    self.assertEqual(identity, (booking.pk, booking.event_key, booking.graph_event_id, booking.meeting_link,
                                              booking.scheduled_date, booking.scheduled_time, booking.duration_minutes))

    def test_completing_one_review_does_not_change_another(self):
        overlay, booking = review_fixture()
        other, other_booking = review_fixture()
        with source_identity():
            for role in ("advisor", "participant"):
                self.assertEqual(sign_request(overlay, role).status_code, 200)
        other.refresh_from_db()
        other_booking.refresh_from_db()
        self.assertEqual(other.status, "awaiting-signature")
        self.assertEqual(other_booking.status, "awaiting-signature")
        self.assertFalse(other.migrated_signatures.exists())

    def test_saved_signature_requirements_control_completion(self):
        overlay, booking = review_fixture("PR")
        overlay.signature_requirements["employer"] = False
        overlay.save(update_fields=["signature_requirements"])
        with source_identity():
            for role in ("participant", "advisor"):
                self.assertEqual(sign_request(overlay, role).status_code, 200)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, "completed")

    def test_reconciled_mcm_updates_its_existing_booking_without_creating_another(self):
        overlay, booking = review_fixture()
        booking.event_key = "mcr:existing-" + uuid4().hex
        booking.review_instance_id = str(uuid4())
        booking.review_template_id = str(uuid4())
        booking.save(update_fields=["event_key", "review_instance_id", "review_template_id"])
        ReviewSourceReconciliation.objects.create(
            calendar_event_id=booking.pk, native_review_instance_id=booking.review_instance_id,
            native_template_id=booking.review_template_id, native_event_key=booking.event_key,
            source_review_id=overlay.source_review_id, aptem_review_id=overlay.event_key.removeprefix("imported-review:"),
            learner_id=overlay.learner_id, family="MCM", overlay=overlay,
            approved_by=1, approved_at=timezone.now(), reason="Synthetic reconciliation fixture",
        )
        original = (booking.pk, booking.event_key, booking.graph_event_id, booking.review_instance_id)
        with source_identity():
            for role in ("advisor", "participant"):
                self.assertEqual(sign_request(overlay, role).status_code, 200)
        booking.refresh_from_db()
        overlay.refresh_from_db()
        self.assertEqual((booking.status, overlay.status), ("completed", "completed"))
        self.assertEqual(booking.review_completed_at, overlay.completed_at)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)
        self.assertEqual(original, (booking.pk, booking.event_key, booking.graph_event_id, booking.review_instance_id))

    def test_calendar_failure_rolls_back_the_last_signature_and_completion(self):
        for final_role in ("participant", "advisor"):
            with self.subTest(final_role=final_role), source_identity():
                overlay, booking = review_fixture()
                first_role = "advisor" if final_role == "participant" else "participant"
                self.assertEqual(sign_request(overlay, first_role).status_code, 200)
                with patch.object(endpoints, "_mirror_status", side_effect=ValueError("Calendar mismatch")):
                    self.assertEqual(sign_request(overlay, final_role).status_code, 409)
                overlay.refresh_from_db()
                booking.refresh_from_db()
                self.assertEqual((overlay.status, booking.status), ("awaiting-signature", "awaiting-signature"))
                self.assertIsNone(overlay.completed_at)
                self.assertEqual(list(overlay.migrated_signatures.values_list("role", flat=True)), [first_role])

    def test_invalid_final_answers_do_not_save_a_partial_signature(self):
        overlay, booking = review_fixture()
        with source_identity():
            self.assertEqual(sign_request(overlay, "advisor").status_code, 200)
            overlay.answers = {}
            overlay.save(update_fields=["answers"])
            self.assertEqual(sign_request(overlay, "participant").status_code, 409)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, "awaiting-signature")

        self.assertEqual(overlay.migrated_signatures.count(), 1)

    def test_retries_cannot_duplicate_a_signature_or_change_completion_time(self):
        overlay, booking = review_fixture()
        with source_identity():
            for role in ("advisor", "participant"):
                self.assertEqual(sign_request(overlay, role).status_code, 200)
            overlay.refresh_from_db()
            completed_at = overlay.completed_at
            self.assertEqual(sign_request(overlay, "participant").status_code, 409)
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, "completed")
        self.assertEqual(overlay.completed_at, completed_at)
        self.assertEqual(overlay.migrated_signatures.count(), 2)

    def test_unrelated_parties_and_historical_reviews_cannot_sign(self):
        for kind in ("apprenticeship", "commercial"):
            for role in ("participant", "employer"):
                with self.subTest(kind=kind, role=role), source_identity(kind):
                    overlay, booking = review_fixture("PR")
                    self.assertEqual(sign_request(overlay, role, subject_id=999).status_code, 404)
                    self.assertFalse(overlay.migrated_signatures.exists())
            with source_identity(kind, source_status="Completed"):
                self.assertEqual(sign_request(overlay, "participant").status_code, 404)

    def test_both_learner_types_complete_from_their_own_last_signature(self):
        for kind in ("apprenticeship", "commercial"):
            with self.subTest(kind=kind), source_identity(kind):
                overlay, booking = review_fixture()
                self.assertEqual(sign_request(overlay, "advisor").status_code, 200)
                self.assertEqual(sign_request(overlay, "participant").status_code, 200)
                overlay.refresh_from_db()
                self.assertEqual(overlay.status, "completed")

    def test_invalid_signature_keeps_the_review_waiting(self):
        overlay, booking = review_fixture()
        with source_identity():
            self.assertEqual(sign_request(overlay, "participant", signature="invalid").status_code, 409)
        self.assertFalse(MigratedReviewSignature.objects.filter(overlay=overlay).exists())
        overlay.refresh_from_db()
        self.assertEqual(overlay.status, "awaiting-signature")

@skipUnless(connections["default"].vendor == "postgresql", "Requires a verified disposable PostgreSQL test database")
class MigratedAutoCompletionPostgresTests(TransactionTestCase):
    def test_concurrent_final_signers_complete_once_without_losing_either_signature(self):
        cases = (("MCM", "advisor", "participant"), ("MCM", "participant", "advisor"),
                 ("PR", "participant", "employer"))
        for family, first, last in cases:
            with self.subTest(family=family, first=first, last=last), source_identity():
                overlay, booking = review_fixture(family)
                if family == "PR":
                    self.assertEqual(sign_request(overlay, "advisor").status_code, 200)
                attempted = Event()

                def locked_signature(role):
                    account = SimpleNamespace(pk=1, display_name="Synthetic signer", email=overlay.owner_email,
                                              role="employer" if role == "employer" else "learner",
                                              subject_id=91 if role == "employer" else 71)
                    locked = endpoints._locked_overlay(overlay.owner_email, definition_for(overlay), lock_calendar=True) \
                        if role == "advisor" else endpoints._party_overlay(overlay.event_key, account, lock=True, lock_calendar=True)
                    endpoints._sign_and_complete(locked, role, account=account, signature=PNG)

                def last_signature():
                    def observe(execute, sql, params, many, context):
                        if "FOR UPDATE" in sql.upper():
                            attempted.set()
                        return execute(sql, params, many, context)
                    try:
                        with source_identity(), connections["default"].execute_wrapper(observe), transaction.atomic():
                            locked_signature(last)
                    finally:
                        connections.close_all()

                with ThreadPoolExecutor(max_workers=1) as pool:
                    with transaction.atomic():
                        locked_signature(first)
                        future = pool.submit(last_signature)
                        if not attempted.wait(5):
                            future.result(timeout=1)
                            self.fail("Second signer did not reach the booking locks")
                        self.assertFalse(future.done(), "Second signer bypassed the first transaction's locks")
                    future.result(timeout=10)
                overlay.refresh_from_db()
                booking.refresh_from_db()
                self.assertEqual((overlay.status, booking.status), ("completed", "completed"))
                self.assertEqual(overlay.completed_at, booking.review_completed_at)
                self.assertEqual(overlay.migrated_signatures.count(), 3 if family == "PR" else 2)

