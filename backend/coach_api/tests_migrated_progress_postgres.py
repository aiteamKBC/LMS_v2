"""Real row-lock races on a verified, explicitly selected disposable Neon branch.

No flush: only uniquely named synthetic fixtures are inserted and removed.
Run with USE_SECURITY_TEST_BRANCH=1 and the guarded EnrolmentTestRunner.
"""
from concurrent.futures import ThreadPoolExecutor
from copy import deepcopy
from threading import Event
from types import SimpleNamespace
from unittest import SkipTest
from unittest.mock import patch
from uuid import uuid4

from django.conf import settings
from django.db import connections, transaction
from django.test import Client, SimpleTestCase

from . import migrated_progress as service, views
from .migrated_completion import complete, sign, submit
from .migrated_summary_binding import answer_version
from .migrated_templates import snapshot_for
from .models import ImportedReviewInstance, MigratedReviewSignature, MigratedReviewTemplate
from .test_migrated_progress import FORM, OWNER, SNAPSHOT
from .tests_migrated_completion import PNG


class MigratedProgressPostgresRaces(SimpleTestCase):
    databases = {"default", "enrolment"}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if connections["default"].vendor != "postgresql" or not getattr(settings, "USE_SECURITY_TEST_BRANCH", False):
            raise SkipTest("Requires an explicitly verified disposable PostgreSQL branch")
        # The runner verifies before setup; repeat before these autocommit fixtures.
        from login.test_runner import _verify_security_test_branch
        _verify_security_test_branch(settings)

    def setUp(self):
        key = "progress-race-" + uuid4().hex
        self.template = MigratedReviewTemplate.objects.create(scope="PROGRAMME", programme_key=key,
            review_family="PR", name="Synthetic progress race", definition_json=deepcopy(FORM), is_active=True)
        self.addCleanup(lambda: MigratedReviewTemplate.objects.filter(pk=self.template.pk).delete())
        source_id = -int(uuid4().int % 10**12)
        with connections["default"].cursor() as cursor:
            cursor.execute('INSERT INTO "Learner".reviews (id, learner_id, aptem_review_id, review_type, status) '
                           'VALUES (%s, %s, %s, %s, %s)',
                           [source_id, -73421, key, "Progress Review", "Scheduled"])
        def remove_source():
            with connections["default"].cursor() as cursor:
                cursor.execute('DELETE FROM "Learner".reviews WHERE id = %s AND aptem_review_id = %s', [source_id, key])
        self.addCleanup(remove_source)
        self.overlay = ImportedReviewInstance.objects.create(event_key="imported-review:" + key,
            owner_email=OWNER, learner_id=-73421, source_review_id=source_id,
            migrated_template=self.template, template_snapshot=snapshot_for(self.template),
            status="in-progress", answers={"note": "Initial answer"},
            signature_requirements={"advisor": True, "participant": True, "employer": True})
        self.addCleanup(lambda: ImportedReviewInstance.objects.filter(pk=self.overlay.pk).delete())
        self.addCleanup(lambda: MigratedReviewSignature.objects.filter(overlay_id=self.overlay.pk).delete())
        self.definition = {"migratedForm": True, "migratedProgrammeKey": key,
            "instance": {"id": self.overlay.event_key, "learnerId": self.overlay.learner_id},
            "historicalReview": {"id": str(self.overlay.source_review_id), "type": "Progress Review"}}
        reader = patch.object(views, "_imported_review_definition", side_effect=lambda *a, **kw: deepcopy(self.definition))
        reader.start()
        self.addCleanup(reader.stop)
        self.context = service.resolve_context(OWNER, self.overlay.event_key)

    def race(self, mutation):
        attempting_lock = Event()

        def calculate():
            connection = connections["default"]
            def observe(execute, sql, params, many, context):
                if "FOR UPDATE" in sql.upper():
                    attempting_lock.set()
                return execute(sql, params, many, context)
            try:
                with connection.execute_wrapper(observe):
                    service.persist_snapshot(OWNER, self.overlay.event_key, self.context, SNAPSHOT)
                return "saved"
            except service.ProgressError as error:
                return error.status
            finally:
                connections.close_all()

        with ThreadPoolExecutor(max_workers=1) as pool:
            with transaction.atomic():
                locked = ImportedReviewInstance.objects.select_for_update().get(pk=self.overlay.pk)
                future = pool.submit(calculate)
                self.assertTrue(attempting_lock.wait(10), "Calculation did not reach the row lock")
                self.assertFalse(future.done(), "Calculation bypassed a held PostgreSQL row lock")
                mutation(locked)
            self.assertEqual(future.result(timeout=15), 409)
        self.overlay.refresh_from_db()

    def test_duplicate_calculation_is_serialized_and_second_is_rejected(self):
        self.race(lambda locked: service.persist_snapshot(OWNER, self.overlay.event_key, self.context, SNAPSHOT))
        self.assertEqual(self.overlay.progress_snapshot, SNAPSHOT)
        self.assertNotEqual(answer_version(self.overlay), self.context.version)

    def test_submit_wins_and_late_calculation_cannot_write(self):
        self.race(lambda locked: submit(locked, {"note": "Submitted answer"}))
        self.assertEqual(self.overlay.status, "awaiting-signature")
        self.assertIsNone(self.overlay.progress_snapshot)
    def test_signature_and_completion_win_and_late_calculation_cannot_write(self):
        def finish(locked):
            submit(locked, {"note": "Signed answer"})
            for role in ("advisor", "participant", "employer"):
                sign(locked, role, account=SimpleNamespace(pk=-1, display_name="Synthetic signer", email=OWNER), signature=PNG)
            complete(locked)
        self.race(finish)
        self.assertEqual(self.overlay.status, "completed")
        self.assertEqual(self.overlay.migrated_signatures.count(), 3)
        self.assertIsNone(self.overlay.progress_snapshot)

    def test_answer_save_wins_without_losing_the_answer(self):
        def save(locked):
            locked.answers = {"note": "Newer answer"}
            locked.save(update_fields=["answers", "updated_at"])
        self.race(save)
        self.assertEqual(self.overlay.answers, {"note": "Newer answer"})
        self.assertIsNone(self.overlay.progress_snapshot)

    def test_summary_write_wins_without_losing_summary_metadata(self):
        def save(locked):
            locked.meeting_intelligence = {"summaryStatus": "edited", "summary": {"overview": "Newer summary"}}
            locked.save(update_fields=["meeting_intelligence", "updated_at"])
        self.race(save)
        self.assertEqual(self.overlay.meeting_intelligence["summary"]["overview"], "Newer summary")
        self.assertIsNone(self.overlay.progress_snapshot)


class MigratedProgressPostgresAuthorization(SimpleTestCase):
    """Autocommit HTTP checks with real sessions and scoped fixture cleanup.

    Request-end connection cleanup conflicts with TestCase's enclosing atomic
    block. Exercise the existing security cases without that extra transaction.
    """
    databases = {"default", "enrolment"}

    @classmethod
    def setUpClass(cls):
        super().setUpClass()
        if connections["default"].vendor != "postgresql" or not getattr(settings, "USE_SECURITY_TEST_BRANCH", False):
            raise SkipTest("Requires an explicitly verified disposable PostgreSQL branch")
        from login.test_runner import _verify_security_test_branch
        _verify_security_test_branch(settings)

    def run_security_case(self, name):
        from .tests_security import CoachAuthorizationSecurityTests
        case = CoachAuthorizationSecurityTests(name)
        case.setUp()
        try:
            getattr(case, name)()
        finally:
            case.tearDown()

    def test_anonymous_requests(self):
        self.run_security_case("test_every_coach_route_rejects_anonymous_requests_before_view_work")

    def test_learner_requests(self):
        self.run_security_case("test_every_coach_route_rejects_a_learner_session")

    def test_employer_admin_view_as_and_csrf(self):
        from .tests_security import CoachAuthorizationSecurityTests
        case = CoachAuthorizationSecurityTests()
        case.setUp()
        try:
            route = "/coach_api/migrated-reviews/imported-review%3Asynthetic/progress"
            case._authenticate(case._make_non_staff_account(role="employer"))
            self.assertEqual(case._request("POST", route, {"progressVersion": "v1"}).status_code, 403)
            case._authenticate(case._make_staff_account(email="progress-admin@kbc.invalid", access="super-admin"))
            response = case._request("POST", route, {"viewAsCoach": "progress-coach@kbc.invalid", "progressVersion": "v1"})
            self.assertEqual(response.status_code, 403)
            self.assertEqual(response.json()["code"], "coach_view_as_read_only")
            case._authenticate(case._make_staff_account(email="progress-coach@kbc.invalid", access="coach"))
            strict = Client(enforce_csrf_checks=True, SERVER_NAME="localhost")
            strict.cookies = case.client.cookies
            self.assertEqual(strict.post(route, {"progressVersion": "v1"}, content_type="application/json").status_code, 403)
        finally:
            case.tearDown()

    def test_authenticated_coach_calculates_with_csrf_using_the_owned_overlay(self):
        from . import migrated_progress_views as endpoint
        from .tests_security import CoachAuthorizationSecurityTests
        case = CoachAuthorizationSecurityTests()
        fixture = MigratedProgressPostgresRaces()
        case.setUp()
        try:
            fixture.setUp()
            case.client = Client(enforce_csrf_checks=True, SERVER_NAME="localhost")
            case._authenticate(case._make_staff_account(email=OWNER, access="coach"))
            csrf = case.client.get("/coach_api/csrf").json()["csrfToken"]
            with patch.object(endpoint, "calculate_snapshot", return_value=SNAPSHOT) as calculator, \
                 patch("coach_api.auth._invalidate_dashboard_after_mutation", side_effect=lambda view, request, response, owner: response):
                response = case.client.post(
                    "/coach_api/migrated-reviews/" + fixture.overlay.event_key + "/progress",
                    {"progressVersion": fixture.context.version, "learnerId": -99999},
                    content_type="application/json", HTTP_X_CSRFTOKEN=csrf,
                )
            self.assertEqual(response.status_code, 200, response.content)
            self.assertEqual(calculator.call_args.args[0].learner_id, fixture.overlay.learner_id)
            self.assertEqual(calculator.call_args.args[1], OWNER)
            fixture.overlay.refresh_from_db()
            self.assertEqual(fixture.overlay.progress_snapshot, SNAPSHOT)
            self.assertEqual(fixture.overlay.answers, {"note": "Initial answer"})
        finally:
            fixture.doCleanups()
            case.tearDown()
