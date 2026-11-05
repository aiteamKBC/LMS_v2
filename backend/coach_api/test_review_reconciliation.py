"""Persisted synthetic bookings. External identity/source reads are controlled fixtures."""
import json
from contextlib import ExitStack, contextmanager
from copy import deepcopy
from datetime import date, time
from inspect import unwrap
from io import StringIO
from types import SimpleNamespace
from unittest.mock import patch

from django.core.management import call_command, CommandError
from django.db import connection, IntegrityError, transaction
from django.test import TransactionTestCase, RequestFactory

from curriculum_api import review_instances as engine, views as curriculum
from curriculum_api.tests_review_instances import ReviewInstancesTestCase
from coach_api import review_reconciliation as service, reconciliation_links as links, views, review_sources
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewTemplate, ReviewSourceReconciliation
from coach_api.migrated_reviews import candidate_definition
from coach_api.test_migrated_reviews import SOURCE


class ReviewReconciliationTests(TransactionTestCase):
    # Preview owns its READ ONLY transactions; TestCase's outer atomic cannot
    # represent that contract. Managed Coach rows flush; unmanaged rows below
    # are explicitly removed before their FK parents.
    databases = {"default", "enrolment"}
    available_apps = ["coach_api"]
    _ensure_programmes_table = ReviewInstancesTestCase._ensure_programmes_table
    _clear = ReviewInstancesTestCase._clear
    _create_review = ReviewInstancesTestCase._create_review
    _template_row = ReviewInstancesTestCase._template_row

    def setUp(self):
        ReviewInstancesTestCase.setUp(self)
        self.addCleanup(self.cleanup_persisted_graph)
        self.persist_identity_parents()
        engine._provision_review_instance_manual_overrides_table()
        engine._provision_review_instance_reopens_table()
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.actor = SimpleNamespace(pk=990, role="admin", is_active=True)
        self.account = self.stack.enter_context(patch("login.models.LoginAccount.objects.filter"))
        self.account.return_value.first.return_value = self.actor
        self.profile = SimpleNamespace(id=21, enrolment_id=121, aptem_id=9001, learner_type="apprenticeship")
        self.stack.enter_context(patch.object(service, "read_profile", return_value=(self.profile, review_sources.ReviewSource("aptem", 9001))))
        self.source = {"id": 501, "learner_id": 21, "aptem_review_id": "A501", "review_type": "Monthly Coaching Meeting",
                       "status": "Not Scheduled", "completed_date": None, "review_data": {"aptem_learner_id": 9001}}
        self.source_read = self.stack.enter_context(patch.object(service, "read_source", side_effect=lambda *a, **k: deepcopy(self.source)))
        self.definition = {"canInitialize": True, "readOnly": True, "historicalReview": {"id": 501, "type": "Monthly Coaching Meeting"},
                           "instance": {"id": "imported-review:A501", "learnerId": 21}, "sourceStatus": "Not Scheduled",
                           "migratedProgrammeKey": "id:PROG-A"}
        self.actual_definition = views._imported_review_definition
        self.stack.enter_context(patch.object(views, "_imported_review_definition", side_effect=lambda *a, **k: deepcopy(self.definition)))
        self.stack.enter_context(patch.object(views, "lock_learner_calendar"))
        self.stack.enter_context(patch.object(views, "authenticated_coach_email", return_value="coach@example.invalid"))
        self.actual_sync = views.synchronize_reserved_calendar_event
        self.stack.enter_context(patch.object(views, "synchronize_reserved_calendar_event", side_effect=AssertionError("Unexpected live transport")))
        self.stack.enter_context(patch.object(service, "dependency_counts", return_value={"attendance": 2, "assignmentReferences": 1, "artifacts": 0}))
        self.template_id = self._create_review("PROG-A", name="Synthetic MCM", interval=1, unit="months")
        self.record, self.instance = self.make_booking(1)
        MigratedReviewTemplate.objects.create(scope="GLOBAL", programme_key="", review_family="MCM", name="Synthetic MCM",
                                             definition_json=candidate_definition(deepcopy(SOURCE)), is_active=True)
        # Actual durable dependency rows, deliberately containing legacy keys.
        with connection.cursor() as cursor:
            cursor.execute('CREATE TABLE IF NOT EXISTS recon_test_dependencies (id integer primary key, kind text, calendar_id integer, payload text)')
            cursor.execute('DELETE FROM recon_test_dependencies')
            for i, kind in enumerate(("attendance", "attendance", "assignment", "artifact")):
                cursor.execute('INSERT INTO recon_test_dependencies VALUES (%s,%s,%s,%s)',
                               [i, kind, self.record.pk, json.dumps({"meetingKey": self.record.event_key, "status": "pending", "history": ["original"]})])

    def persist_identity_parents(self):
        from .tests_support.persisted_fixtures import review_identity, programme
        programme("PROG-A")
        self.persisted_identity = review_identity(
            source_ids=[(501, "A501", "Monthly Coaching Meeting"), (502, "A502", "Monthly Coaching Meeting")],
            aptem_id=9001, learner_kind="apprenticeship", programme_id="PROG-A", account_id=990,
        )
        from login.models import LoginAccount
        LoginAccount.objects.filter(pk=990).update(role="admin")

    def cleanup_persisted_graph(self):
        ReviewSourceReconciliation.objects.filter(learner_id=21).delete()
        ImportedReviewInstance.objects.filter(learner_id=21).delete()
        CoachCalendarEvent.objects.filter(learner_id=21).delete()
        MigratedReviewTemplate.objects.filter(name="Synthetic MCM").delete()
        self._clear()
        self.cleanup_identity_parents()

    def cleanup_identity_parents(self):
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM "Learner".reviews WHERE learner_id = %s', [21])
        from learner_api.models import LearnerProfile, EnrolmentUser
        from login.models import LoginAccount
        LearnerProfile.objects.using("default").filter(pk=21).delete()
        LoginAccount.objects.using("default").filter(pk=990).delete()
        EnrolmentUser.all_learners.using("default").filter(pk=121).delete()

    def make_booking(self, number):
        instance = engine.ensure_review_instance(self._template_row(self.template_id), learner_id=21, learner_kind="apprenticeship",
                                                programme_id="PROG-A", occurrence_number=number, target_date=date(2099, 11, 18),
                                                coach_email="coach@example.invalid")
        record = CoachCalendarEvent.objects.create(event_key=f"review:21:{self.template_id}:{number}",
                    owner_email="coach@example.invalid", learner_id=21, event_type="mcr", target_date=date(2099, 11, 18),
                    scheduled_date=date(2099, 11, 18), scheduled_time=time(10), status="scheduled", sync_state="synced",
                    review_instance_id=instance["id"], review_template_id=self.template_id, occurrence_number=number,
                    graph_event_id=f"graph-synthetic-{number}", meeting_link=f"https://example.invalid/meeting/{number}",
                    graph_organizer_email="organizer@example.invalid", idempotency_key=f"synthetic-operation-{number}")
        engine.link_calendar_event(instance["id"], record.pk)
        engine.mark_review_instance_scheduled(instance["id"])
        return record, engine.get_review_instance(instance["id"])

    def apply(self, **params):
        return service.apply(**{**dict(calendar_event_id=self.record.pk, source_review_id=501, actor_id=990, reason="Operator verified exact source occurrence"), **params})

    def snapshot(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT * FROM recon_test_dependencies ORDER BY id')
            dependencies = cursor.fetchall()
        return {"calendar": list(CoachCalendarEvent.objects.values()), "native": engine.get_review_instance(self.instance["id"]), "dependencies": dependencies}

    def test_apply_preserves_calendar_graph_native_and_all_dependency_rows(self):
        before = self.snapshot()
        result = self.apply()
        self.assertEqual(result["status"], "APPLIED")
        self.assertEqual(self.snapshot(), before)
        link = ReviewSourceReconciliation.objects.get()
        self.assertEqual((link.source_review_id, link.aptem_review_id, link.native_event_key), (501, "A501", self.record.event_key))
        self.assertEqual(link.overlay.status, "scheduled")
        event = {**service._source_event(self.profile, self.source), "reviewSource": "aptem", "sourceStatus": "not-scheduled"}
        bookings, overlays = review_sources.load_imported_links([event])
        resolved = review_sources.apply_imported_state(event, bookings[event["eventKey"]], overlays[event["eventKey"]])
        self.assertEqual(resolved["calendarEventKey"], self.record.event_key)
        self.assertEqual(resolved["formEventKey"], "imported-review:A501")
        self.assertIsNone(resolved["reviewInstanceId"])
        self.assertEqual(review_sources.booking_for_overlay(link.overlay).pk, self.record.pk)
        self.assertEqual(review_sources.standalone_review_records([self.record], [self.profile], {21}, linked_keys=[self.record.event_key]), [])

    def test_idempotent_after_imported_work_has_started(self):
        result = self.apply()
        ImportedReviewInstance.objects.update(status="in-progress", answers={"comment": "Synthetic work"})
        self.assertEqual(self.apply(), {"status": "APPLIED", "id": result["id"], "idempotent": True})
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 1)
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)

    def test_reject_wrong_learner_family_identity_or_completed_source(self):
        for change in ({"learner_id": 22}, {"review_type": "Progress Review"}, {"review_type": "Progress Review (+ Skills Radar)"},
                       {"review_data": {"aptem_learner_id": 777}}, {"status": "Completed"}, {"aptem_review_id": ""}):
            with self.subTest(change=change), patch.object(service, "read_source", return_value={**self.source, **change}):
                with self.assertRaises(service.ReconciliationConflict): self.apply()
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 0)
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)

    def test_unavailable_or_conflicting_identity_fails_closed(self):
        with patch.object(service, "read_profile", side_effect=service.ReconciliationConflict("identity conflict")):
            with self.assertRaises(service.ReconciliationConflict): self.apply()

    def test_any_native_answers_signatures_completion_or_progress_reject(self):
        for extra in ({"status": "completed"}, {"progress_snapshot": {"hours": 1}}, {"started_at": "2099-11-18"}):
            with self.subTest(extra=extra), patch.object(engine, "get_review_instance", return_value={**self.instance, **extra}):
                with self.assertRaises(service.ReconciliationConflict): self.apply()
        for getter in ("get_review_instance_answers", "get_review_instance_signatures"):
            with patch.object(engine, getter, return_value=[{"id": "existing-work"}]):
                with self.assertRaises(service.ReconciliationConflict): self.apply()
        self.record.review_responses = {"summary": "Work"}; self.record.save()
        with self.assertRaises(service.ReconciliationConflict): self.apply()

    def test_existing_imported_booking_conflicts_even_with_different_owner(self):
        CoachCalendarEvent.objects.create(event_key="imported-review:A501", learner_id=21, owner_email="other@example.invalid",
                                         event_type="mcr", target_date=date(2099, 11, 18))
        with self.assertRaisesRegex(service.ReconciliationConflict, "incompatible calendar"): self.apply()

    def test_competing_native_booking_and_different_source_rejected(self):
        second, _ = self.make_booking(2)
        self.apply()
        with self.assertRaises(service.ReconciliationConflict): self.apply(calendar_event_id=second.pk)
        with self.assertRaises(service.ReconciliationConflict): self.apply(source_review_id=502)

    def test_existing_overlay_reused(self):
        from .migrated_initialization import initialize_imported_review
        overlay, _ = initialize_imported_review(self.record.owner_email, self.definition)
        self.definition.update(migratedForm=True, canInitialize=False)
        self.apply()
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        self.assertEqual(ReviewSourceReconciliation.objects.get().overlay_id, overlay.pk)

    def test_preview_and_missing_explicit_id_never_write(self):
        before = self.snapshot()
        result = service.preview(calendar_event_id=self.record.pk, source_review_id=501, actor_id=990)
        self.assertEqual(result["status"], "PREVIEW")
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 0)
        with self.assertRaises(CommandError):
            call_command("reconcile_review_booking", actor_id=990, calendar_event_id=self.record.pk, apply=True, stdout=StringIO())

    def test_mapped_cancellation_is_controlled_conflict_before_graph(self):
        self.apply()
        before = self.snapshot()
        with patch.object(views, "delete_calendar_event_from_graph") as graph:
            with self.assertRaisesRegex(views.LearnerCalendarConflict, "reconciled"):
                views.cancel_reserved_calendar_event(self.record)
            graph.assert_not_called()
        self.assertEqual(self.snapshot(), before)

    def test_preview_reports_existing_overlay_work_as_conflict(self):
        from .migrated_initialization import initialize_imported_review
        overlay, _ = initialize_imported_review(self.record.owner_email, self.definition)
        overlay.answers = {"comment": "Existing work"}
        overlay.save()
        self.definition.update(migratedForm=True, canInitialize=False)
        result = service.preview(calendar_event_id=self.record.pk, source_review_id=501, actor_id=990)
        self.assertEqual(result["status"], "CONFLICT")
        self.assertEqual(result["changes"], [])
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 0)

    def test_rollback_if_final_mapping_validation_fails(self):
        before = self.snapshot()
        with patch.object(links, "validate_record", side_effect=service.ReconciliationConflict("late failure")):
            with self.assertRaises(service.ReconciliationConflict): self.apply()
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 0)
        self.assertEqual(self.snapshot(), before)

    def test_active_uniqueness_is_database_enforced(self):
        self.apply()
        link = ReviewSourceReconciliation.objects.get()
        values = {field.attname: getattr(link, field.attname) for field in link._meta.fields if not field.primary_key}
        with self.assertRaises(IntegrityError), transaction.atomic():
            ReviewSourceReconciliation.objects.create(**values)

    def test_open_legacy_meeting_returns_imported_form_and_old_writes_blocked(self):
        self.apply()
        request = RequestFactory().post("/", data=json.dumps({"eventKey": self.record.event_key}), content_type="application/json")
        response = unwrap(views.coach_review_instance_for_event)(request)
        self.assertEqual(json.loads(response.content)["instanceId"], "imported-review:A501")
        self.assertEqual(unwrap(views.coach_review_instance_answers)(request, self.instance["id"]).status_code, 409)
        for name, args in (("save_review_instance_answers", ({},)), ("save_review_instance_progress_snapshot", ({},)),
                           ("complete_review_instance", ())):
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, "reconciled"):
                getattr(engine, name)(self.instance, *args)
        with self.assertRaisesRegex(ValueError, "reconciled"):
            engine.record_review_instance_signature(self.instance, "advisor", signed_by="coach", signed_name="Synthetic", signature="x")

    def test_reschedule_reservation_keeps_origin_source_and_meeting(self):
        self.apply()
        origin = (self.record.pk, self.record.event_key, self.record.graph_event_id, self.record.meeting_link,
                  self.record.graph_organizer_email, self.record.operation_id, self.record.idempotency_key,
                  self.record.review_instance_id, self.record.review_template_id)
        self.record.scheduled_time = time(12)
        with patch.object(views, "england_non_delivery_reason", return_value=None), patch.object(views, "ensure_learner_calendar_available"):
            saved = views.persist_calendar_sync_reservation(self.record, review_event={"reviewSource": "aptem"})
        self.assertEqual(saved.scheduled_time, time(12))
        self.assertEqual((saved.pk, saved.event_key, saved.graph_event_id, saved.meeting_link, saved.graph_organizer_email,
                          saved.operation_id, saved.idempotency_key, saved.review_instance_id, saved.review_template_id), origin)
        self.assertEqual(links.for_calendar(saved).source_review_id, 501)
        self.assertEqual(engine.get_review_instance(self.instance["id"]), self.instance)
        with patch.object(views, "has_graph_credentials", return_value=True), \
             patch.object(views, "build_graph_event_payload", return_value={"subject": "MCM", "start": {}, "end": {}, "attendees": [{"emailAddress": {"address": "retained@example.invalid"}}]}), \
             patch.object(views, "apply_teams_meeting_options", return_value=(True, {}, [])), \
             patch.object(views, "microsoft_graph_request", return_value={"id": origin[2], "onlineMeeting": {"joinUrl": origin[3]}}) as graph:
            synced, warning, attempted = self.actual_sync(saved.pk, {"reviewSource": "aptem"})
        self.assertTrue(attempted)
        self.assertEqual(warning, "")
        self.assertEqual(graph.call_count, 1)
        self.assertEqual(graph.call_args.args, ("PATCH", "users/organizer%40example.invalid/events/graph-synthetic-1"))
        self.assertEqual(set(graph.call_args.kwargs["payload"]), {"subject", "start", "end"})
        self.assertEqual((synced.graph_event_id, synced.meeting_link, synced.operation_id), (origin[2], origin[3], origin[5]))

    def test_reverse_keeps_evidence_and_audit_then_allows_explicit_reapply(self):
        before = self.snapshot()
        result = self.apply()
        reversed_result = service.reverse(reconciliation_id=result["id"], actor_id=990, reason="Operator corrected selection")
        self.assertEqual(reversed_result["status"], "REVERSED")
        self.assertEqual(self.snapshot(), before)
        self.assertIsNone(links.for_calendar(self.record))
        self.assertEqual(ImportedReviewInstance.objects.count(), 1)
        self.assertEqual(ReviewSourceReconciliation.objects.get().reversed_by, 990)
        self.definition.update(migratedForm=True, canInitialize=False)
        self.apply()
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 2)

    def test_reverse_rejects_continuation_work_without_deleting_it(self):
        result = self.apply()
        ImportedReviewInstance.objects.update(answers={"comment": "Synthetic content"})
        with self.assertRaises(service.ReconciliationConflict):
            service.reverse(reconciliation_id=result["id"], actor_id=990, reason="Wrong selection")
        self.assertEqual(ReviewSourceReconciliation.objects.get().status, "APPLIED")

    def test_admin_required_and_reason_cannot_be_blank(self):
        self.account.return_value.first.return_value = None
        for func in (service.preview, service.apply):
            with self.assertRaises(PermissionError):
                func(calendar_event_id=self.record.pk, source_review_id=501, actor_id=88, **({"reason": "x"} if func == service.apply else {}))
        self.account.assert_called_with(pk=88, is_active=True, role="admin")
        self.account.return_value.first.return_value = self.actor
        with self.assertRaises(service.ReconciliationConflict): self.apply(reason="")

    def test_same_date_source_selection_uses_only_explicit_ids(self):
        # Both source rows may share all display dates/titles. No date selection
        # function participates; the requested internal/Aptem pair wins.
        self.source.update(id=502, aptem_review_id="A502", planned_scheduled_date=self.record.target_date)
        self.definition["historicalReview"]["id"] = 502
        self.definition["instance"]["id"] = "imported-review:A502"
        self.apply(source_review_id=502)
        self.assertEqual(ReviewSourceReconciliation.objects.get().source_review_id, 502)
        self.assertEqual(ImportedReviewInstance.objects.get().event_key, "imported-review:A502")
        self.assertTrue(any(call.args == (502,) for call in self.source_read.call_args_list))

    def test_learner_legacy_assignment_key_resolves_imported_occurrence(self):
        from learner_api import calendar
        self.apply()
        event = {**service._source_event(self.profile, self.source), "reviewSource": "aptem", "calendarEventKey": self.record.event_key}
        model = SimpleNamespace(all_learners=SimpleNamespace(filter=lambda **kwargs: SimpleNamespace(first=lambda: self.profile)))
        with patch.dict(calendar.SOURCE_MODELS, {"apprenticeship": model}), \
             patch.object(calendar, "_calendar_profile", return_value=self.profile), \
             patch.object(calendar, "coaching_events_for_learner", return_value=[event]):
            record = calendar._learner_calendar_record("apprenticeship", 121, self.record.event_key)
        self.assertEqual(record.pk, self.record.pk)
        self.assertEqual(record._imported_review_event["eventKey"], "imported-review:A501")

    def test_wrong_owner_cannot_open_or_write_legacy_review(self):
        self.apply()
        with patch.object(views, "authenticated_coach_email", return_value="unrelated@example.invalid"), \
             patch.object(views, "find_generated_timetable_event", return_value=(None, "")):
            factory = RequestFactory()
            request = factory.post("/", data=json.dumps({"eventKey": self.record.event_key}), content_type="application/json")
            self.assertEqual(unwrap(views.coach_review_instance_for_event)(request).status_code, 404)
            self.assertEqual(unwrap(views.coach_review_instance_answers)(request, self.instance["id"]).status_code, 404)

    def test_started_imported_form_blocks_reschedule_and_native_rematerialization(self):
        self.apply()
        ImportedReviewInstance.objects.update(status="in-progress")
        with self.assertRaises(views.LearnerCalendarConflict):
            views.sync_scheduled_review_instance(self.record)
        with self.assertRaisesRegex(ValueError, "reconciled"):
            engine.ensure_review_instance(self._template_row(self.template_id), learner_id=21, learner_kind="apprenticeship",
                                         programme_id="PROG-A", occurrence_number=1, target_date=self.record.target_date)

    def test_reconciled_form_starts_and_saves_to_imported_overlay_only(self):
        from .migrated_summary_binding import answer_version
        self.apply()
        self.definition.update(migratedForm=True, canInitialize=False, readOnly=False)
        factory = RequestFactory()
        request = factory.post("/", data=json.dumps({"status": "in-progress"}), content_type="application/json")
        response = unwrap(views.coach_review_instance_local_status)(request, "imported-review:A501")
        self.assertEqual(response.status_code, 200, response.content)
        overlay = ImportedReviewInstance.objects.get()
        self.assertEqual(overlay.status, "in-progress")
        self.record.refresh_from_db()
        self.assertEqual(self.record.status, "in-progress")
        answers = {"section-0:comment": "Synthetic imported answer"}
        request = factory.post("/", data=json.dumps({"answers": answers, "answerVersion": answer_version(overlay)}), content_type="application/json")
        response = unwrap(views.coach_review_instance_answers)(request, "imported-review:A501")
        self.assertEqual(response.status_code, 200, response.content)
        overlay.refresh_from_db()
        self.assertEqual(overlay.answers, answers)
        self.assertEqual(engine.get_review_instance(self.instance["id"]), self.instance)
        self.assertEqual(engine.get_review_instance_answers(self.instance["id"]), {})
        self.assertEqual(self.source["status"], "Not Scheduled")

    def test_preview_reports_conflict_without_writes(self):
        self.source["learner_id"] = 22
        result = service.preview(calendar_event_id=self.record.pk, source_review_id=501, actor_id=990)
        self.assertEqual(result["status"], "CONFLICT")
        self.assertEqual(result["changes"], [])
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)

    def test_migration_fields_and_constraints_match_runtime_model(self):
        from importlib import import_module
        from django.db.migrations.state import ModelState
        migration = import_module("coach_api.migrations.0025_review_source_reconciliation")
        operation = migration.Migration.operations[0]
        state = ModelState.from_model(ReviewSourceReconciliation)
        self.assertEqual({k: f.deconstruct()[1:] for k, f in operation.fields},
                         {k: f.deconstruct()[1:] for k, f in state.fields.items()})
        self.assertEqual(operation.options["constraints"], state.options["constraints"])

    @contextmanager
    def without_reconciliation_table(self):
        # Preserve the ledger while making the old schema visible to preview's
        # own transaction. No caller atomic may surround a read-only preview.
        table = connection.ops.quote_name(ReviewSourceReconciliation._meta.db_table)
        hidden = 'review_reconciliation_test_hidden'
        with connection.cursor() as cursor:
            cursor.execute(f'ALTER TABLE {table} RENAME TO {hidden}')
        try:
            yield
        finally:
            with connection.cursor() as cursor:
                cursor.execute(f'ALTER TABLE "Coach".{hidden} RENAME TO review_source_reconciliation')

    def test_old_schema_keeps_native_history_and_imported_reads_without_a_mapping(self):
        from .reconciliation_schema import reconciliation_schema_available
        from learner_api import calendar
        before = self.snapshot()
        with self.without_reconciliation_table():
            self.assertFalse(reconciliation_schema_available())
            self.assertIsNone(links.for_calendar(self.record))
            self.assertIsNone(links.for_native(self.instance["id"]))
            self.assertFalse(links.active_links().exists())
            self.assertEqual(links.active_links().count(), 0)
            self.assertEqual(links.records_for_key("imported-review:A501"), [])
            for kind in ("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"):
                event = service._source_event(self.profile, {**self.source, "review_type": kind})
                bookings, overlays = review_sources.load_imported_links([event])
                self.assertIsNone(bookings.get(event["eventKey"]))
                self.assertIsNone(overlays.get(event["eventKey"]))
            request = RequestFactory().post("/", data=json.dumps({"eventKey": self.record.event_key}), content_type="application/json")
            response = unwrap(views.coach_review_instance_for_event)(request)
            self.assertEqual(json.loads(response.content)["instanceId"], self.instance["id"])
            model = SimpleNamespace(all_learners=SimpleNamespace(filter=lambda **kw: SimpleNamespace(first=lambda: self.profile)))
            with patch.dict(calendar.SOURCE_MODELS, {"apprenticeship": model}), \
                 patch.object(calendar, "_calendar_profile", return_value=self.profile), \
                 patch.object(calendar, "coaching_events_for_learner", return_value=[]):
                saved = calendar._learner_calendar_record("apprenticeship", 121, self.record.event_key)
                self.assertEqual(saved.pk, self.record.pk)
            self.assertEqual(self.snapshot(), before)
        self.assertTrue(reconciliation_schema_available())

    def test_old_schema_refuses_reconciliation_without_sequence_overlay_or_evidence_writes(self):
        from .reconciliation_schema import ReconciliationSchemaNotDeployed
        before = self.snapshot()
        with self.without_reconciliation_table(), patch.object(views, "lock_learner_calendar") as sequence:
            for action in (
                lambda: self.apply(),
                lambda: service.preview(calendar_event_id=self.record.pk, source_review_id=501, actor_id=990),
                lambda: service.reverse(reconciliation_id=1, actor_id=990, reason="Explicit synthetic reversal"),
                lambda: service.candidates(calendar_event_id=self.record.pk, actor_id=990),
            ):
                with self.assertRaises(ReconciliationSchemaNotDeployed):
                    action()
            self.assertEqual(ImportedReviewInstance.objects.count(), 0)
            self.assertEqual(self.snapshot(), before)
            sequence.assert_not_called()

    def test_old_schema_native_lifecycle_still_uses_its_owned_durable_instance(self):
        with self.without_reconciliation_table():
            # The decorator must not block an otherwise valid Native write just
            # because the optional ledger has not been deployed yet.
            result = engine.save_review_instance_answers(self.instance, {})
            self.assertIsNotNone(result)
            self.assertEqual(engine.get_review_instance(self.instance["id"])["id"], self.instance["id"])

    def test_admin_cannot_reconcile_a_booking_outside_current_coach_caseload(self):
        before = self.snapshot()
        with patch.object(views, "_imported_review_definition", side_effect=self.actual_definition), \
             patch.object(views, "fetch_caseload_dashboard_profiles", return_value=[]) as caseload:
            with self.assertRaisesRegex(service.ReconciliationConflict, "canonical"):
                self.apply()
            caseload.assert_called_once_with(self.record.owner_email)
        self.assertEqual(ReviewSourceReconciliation.objects.count(), 0)
        self.assertEqual(ImportedReviewInstance.objects.count(), 0)
        self.assertEqual(self.snapshot(), before)
