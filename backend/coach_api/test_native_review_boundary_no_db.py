"""Source-boundary regressions with synthetic identities and blocked real I/O."""
import json
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from datetime import date, datetime, timezone as dt_timezone
from inspect import unwrap
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase, override_settings
from django.utils import timezone

from coach_api import review_sources, views
from coach_api.test_review_source_separation import profile, source, booking, base_event, imported_row
from curriculum_api import review_instances as engine
from learner_api import calendar


class NativeReviewBoundaryTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.stack.enter_context(override_settings(TIME_ZONE="Europe/London"))
        self.stack.enter_context(timezone.override("Europe/London"))
        self.stack.enter_context(patch.object(timezone, "now", return_value=datetime(2026, 11, 18, 12, tzinfo=dt_timezone.utc)))
        # These pre-reconciliation fixtures have no explicit source mappings.
        mappings = self.stack.enter_context(patch("coach_api.reconciliation_schema.CompatibleReconciliationQuerySet.filter"))
        mappings.return_value.first.return_value = None
        mappings.return_value.select_related.return_value.first.return_value = None
        mappings.return_value.select_related.return_value.__iter__.return_value = iter(())
        self.person = profile()
        self.enrolment = source()
        self.enrolment.username = "Synthetic learner"
        profiles = self.stack.enter_context(patch("learner_api.models.LearnerProfile.objects.only"))
        profiles.return_value.filter.return_value.first.side_effect = lambda: self.person
        enrolments = self.stack.enter_context(patch("learner_api.models.EnrolmentUser.all_learners.only"))
        enrolments.return_value.filter.return_value.first.side_effect = lambda: self.enrolment
        self.enrolments = enrolments
        self.stack.enter_context(patch.object(views, "authenticated_coach_email", return_value="coach@example.invalid"))
        self.stack.enter_context(patch.object(views, "fetch_owner_active_learner_profiles", side_effect=lambda *_: [self.person]))
        self.graph = self.stack.enter_context(patch.object(views, "synchronize_reserved_calendar_event", side_effect=AssertionError("Unexpected Graph call")))
        self.factory = RequestFactory()

    def post(self, view, payload):
        return unwrap(view)(self.factory.post("/", data=json.dumps(payload), content_type="application/json"))

    def make_native(self):
        self.person.aptem_id = None
        self.enrolment.aptem_id = ""

    def test_canonical_policy_uses_positive_ids_and_rejects_conflicts(self):
        for enrolment_id, profile_id, expected in (
            ("901", 901, "aptem"), ("901", None, "aptem"), ("", 901, "aptem"),
            ("901", 902, "conflict"), ("", None, "curriculum"),
            ("0", -1, "curriculum"), ("invalid", 0, "curriculum"),
        ):
            with self.subTest(enrolment_id=enrolment_id, profile_id=profile_id):
                self.enrolment.aptem_id, self.person.aptem_id = enrolment_id, profile_id
                result = review_sources.native_review_creation_policy(self.person)
                self.assertEqual(result["reviewSource"], expected)
                self.assertEqual(result["canAddReview"], expected == "curriculum")

    def test_unavailable_identity_cannot_be_treated_as_native(self):
        self.make_native()
        self.enrolments.side_effect = DatabaseError("synthetic unavailable")
        with self.assertRaises(review_sources.ReviewCreationBlocked) as error:
            review_sources.require_native_review_creation(21)
        self.assertEqual(error.exception.code, "REVIEW_SOURCE_UNAVAILABLE")

    def test_templates_metadata_blocks_aptem_without_consulting_curriculum(self):
        with patch.object(engine, "list_enabled_review_templates") as templates:
            response = unwrap(views.coach_review_learner_addition_templates)(self.factory.get("/", {"learnerId": 21}))
        body = json.loads(response.content)
        self.assertEqual(response.status_code, 200)
        self.assertEqual((body["reviewSource"], body["canAddReview"], body["templates"]), ("aptem", False, []))
        templates.assert_not_called()

    def test_add_review_rejects_aptem_and_conflicts_before_any_write(self):
        with patch.object(engine, "create_learner_review_addition") as addition, patch.object(engine, "ensure_review_instance") as instance:
            for conflict in (False, True):
                self.person.aptem_id = 6302 if conflict else 6301
                response = self.post(views.coach_review_learner_additions_create, {
                    "learnerId": 21, "reviewTemplateId": "T-MCM", "targetDate": "2099-11-19",
                })
                self.assertEqual(response.status_code, 409)
                self.assertEqual(json.loads(response.content)["code"], "REVIEW_IDENTITY_CONFLICT" if conflict else "APTEM_REVIEW_SOURCE_ONLY")
            addition.assert_not_called()
            instance.assert_not_called()
        self.graph.assert_not_called()

    def test_add_review_keeps_caseload_ownership_gate(self):
        response = self.post(views.coach_review_learner_additions_create, {
            "learnerId": 999, "reviewTemplateId": "T-MCM", "targetDate": "2099-11-19",
        })
        self.assertEqual(response.status_code, 404)

    def test_native_add_review_still_creates_manual_occurrence(self):
        self.make_native()
        with patch.object(views, "resolve_curriculum_programme_id", return_value="P1"), \
             patch.object(engine, "list_enabled_review_templates", return_value=[{"id": "T-PR", "review_type_id": "PR", "name": "Progress Review"}]), \
             patch("curriculum_api.review_types.review_type_index", return_value={"PR": {"code": "progress_review"}}), \
             patch.object(engine, "create_learner_review_addition", return_value={"id": "ADD-1"}) as addition, \
             patch.object(engine, "ensure_review_instance", return_value={"id": "INSTANCE-1", "status": "not-scheduled"}) as instance:
            response = self.post(views.coach_review_learner_additions_create, {
                "learnerId": 21, "reviewTemplateId": "T-PR", "targetDate": "2099-11-19",
            })
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(addition.call_args.kwargs["learner_id"], 21)
        self.assertEqual(instance.call_args.kwargs["occurrence_ref"], "manual:ADD-1")
        self.graph.assert_not_called()

    def test_stale_native_link_cannot_materialize_an_aptem_instance(self):
        event = {"learnerId": "21", "reviewTemplateId": "T-MCM", "source": "mcr"}
        with patch.object(views.CoachCalendarEvent.objects, "filter") as records, \
             patch.object(views, "find_generated_timetable_event", return_value=(event, "Coach")), \
             patch.object(engine, "ensure_review_instance") as create:
            records.return_value.first.return_value = None
            response = self.post(views.coach_review_instance_for_event, {"eventKey": "review:21:T-MCM:1"})
        self.assertEqual(response.status_code, 409)
        self.assertEqual(json.loads(response.content)["code"], "APTEM_REVIEW_SOURCE_ONLY")
        create.assert_not_called()

    def test_existing_native_instance_link_is_read_without_source_or_writes(self):
        record = booking("review:21:T-MCM:1", review_instance_id="EXISTING", review_template_id="T-MCM")
        before = {field.attname: deepcopy(getattr(record, field.attname)) for field in record._meta.concrete_fields}
        with patch.object(views.CoachCalendarEvent.objects, "filter") as records, \
             patch.object(views, "find_generated_timetable_event") as generated, \
             patch.object(engine, "ensure_review_instance") as create:
            records.return_value.first.return_value = record
            response = self.post(views.coach_review_instance_for_event, {"eventKey": record.event_key})
            self.assertEqual(records.call_args.kwargs["owner_email__iexact"], "coach@example.invalid")
        self.assertEqual(json.loads(response.content), {"instanceId": "EXISTING"})
        self.assertEqual({field.attname: getattr(record, field.attname) for field in record._meta.concrete_fields}, before)
        generated.assert_not_called()
        create.assert_not_called()

    def test_stale_native_coach_booking_rejected_before_calendar_or_graph(self):
        event = {"learnerId": "21", "reviewTemplateId": "T-MCM", "source": "mcr", "targetDate": "2099-11-19"}
        with patch.object(views, "find_catchup_calendar_record", return_value=(None, "Coach")), \
             patch.object(views, "find_catchup_template_event", return_value=(None, "Coach")), \
             patch.object(views, "find_generated_timetable_event", return_value=(event, "Coach")), \
             patch.object(views.CoachCalendarEvent.objects, "filter") as records, \
             patch.object(views.CoachCalendarEvent.objects, "get_or_create") as create, \
             patch.object(views, "coach_learner_personal_calendar_conflicts") as personal_calendar:
            records.return_value.exclude.return_value.exclude.return_value.first.return_value = None
            # A stored but never-booked instance is not a historical booking exception.
            for stored in (None, booking("review:21:T-MCM:1", review_instance_id="UNBOOKED",
                                         scheduled_date=None, scheduled_time=None)):
                records.return_value.first.return_value = stored
                response = self.post(views.coach_timetable_schedule_event, {
                    "eventKey": "review:21:T-MCM:1", "scheduledDate": "2026-11-20", "scheduledTime": "10:00",
                })
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(json.loads(response.content)["code"], "APTEM_REVIEW_SOURCE_ONLY")
        create.assert_not_called()
        personal_calendar.assert_not_called()
        self.graph.assert_not_called()

    def test_existing_native_coach_booking_can_be_managed_without_regeneration(self):
        record = booking("review:21:T-MCM:1", review_instance_id="EXISTING", review_template_id="T-MCM")
        with patch.object(views, "find_catchup_calendar_record", return_value=(None, "Coach")), \
             patch.object(views, "find_catchup_template_event", return_value=(None, "Coach")), \
             patch.object(views, "find_generated_timetable_event", side_effect=DatabaseError("Imported source unavailable")), \
             patch.object(views.CoachCalendarEvent.objects, "filter") as records, \
             patch.object(views.CoachCalendarEvent.objects, "get_or_create", return_value=(record, False)), \
             patch.object(views, "resolve_review_display_title", return_value="Monthly Coaching"), \
             patch.object(views, "coach_learner_personal_calendar_conflicts", return_value=False), \
             patch.object(views, "persist_calendar_sync_reservation", side_effect=lambda row, **_: row), \
             patch.object(record, "save"), \
             patch.object(views, "overlay_calendar_record", return_value={"eventKey": record.event_key}), \
             patch.object(engine, "ensure_review_instance") as create:
            records.return_value.first.return_value = record
            records.return_value.exclude.return_value.exclude.return_value.first.return_value = record
            self.graph.side_effect = None
            self.graph.return_value = (record, "", True)
            response = self.post(views.coach_timetable_schedule_event, {
                "eventKey": record.event_key, "scheduledDate": "2026-11-20", "scheduledTime": "10:00",
            })
            self.assertEqual(response.status_code, 200, response.content)
            self.assertTrue(all(call.kwargs["owner_email__iexact"] == "coach@example.invalid" for call in records.call_args_list))
        self.assertEqual(record.review_instance_id, "EXISTING")
        self.assertEqual(record.graph_event_id, "synthetic-graph-id")
        create.assert_not_called()

    def learner_book(self, **changes):
        payload = {"sessionType": "mcr", "eventKey": "review:21:T-MCM:1",
                   "scheduledDate": "2026-11-20", "scheduledTime": "10:00", "durationMinutes": 60, **changes}
        request = self.factory.post("/", data=json.dumps(payload), content_type="application/json")
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = self.enrolment
        with patch.dict(calendar.SOURCE_MODELS, {"commercial": model, "apprenticeship": model}), \
             patch.object(calendar, "_calendar_profile", return_value=self.person):
            return unwrap(calendar.learner_calendar_book)(request, "commercial", 121)

    def test_all_learner_review_booking_types_refuse_native_keys_for_aptem(self):
        with patch.object(calendar, "coaching_events_for_learner", return_value=[]), \
             patch.object(views.CoachCalendarEvent.objects, "get_or_create") as create, \
             patch.object(views, "reserve_coach_calendar_booking") as reserve:
            for kind in ("mcr", "progress-review", "review"):
                response = self.learner_book(sessionType=kind)
                self.assertEqual(response.status_code, 409, response.content)
                self.assertEqual(json.loads(response.content)["code"], "APTEM_REVIEW_SOURCE_ONLY")
            create.assert_not_called()
            reserve.assert_not_called()
        self.graph.assert_not_called()

    def test_imported_mcm_invalid_dates_are_rejected_before_source_or_calendar_io(self):
        with patch.object(calendar, "coaching_events_for_learner") as source_events, \
             patch.object(views.CoachCalendarEvent.objects, "get_or_create") as create:
            for day, message in (("2026-11-19", "20th"), ("2026-12-07", "20th"),
                                 ("2026-11-21", "Saturdays or Sundays"),
                                 ("2026-12-25", "bank holidays"), ("2026-11-05", "already passed")):
                with self.subTest(day=day):
                    response = self.learner_book(eventKey="imported-review:A-401", scheduledDate=day)
                    self.assertEqual(response.status_code, 400)
                    self.assertIn(message, json.loads(response.content)["error"])
            source_events.assert_not_called()
            create.assert_not_called()
        self.graph.assert_not_called()

    def test_native_learner_booking_still_links_official_occurrence(self):
        self.make_native()
        event = {"learnerId": "21", "reviewTemplateId": "T-MCM", "source": "mcr", "targetDate": "2026-11-20", "status": "not-scheduled"}
        record = booking("review:21:T-MCM:1")
        def reserve(row, **_):
            row.review_instance_id = "NEW-INSTANCE"
            return row
        with patch.object(views, "find_generated_timetable_event", return_value=(event, "Coach")), \
             patch("learner_api.calendar_connections.booking_conflicts", return_value=False), \
             patch.object(views.CoachCalendarEvent.objects, "get_or_create", return_value=(record, True)), \
             patch.object(views, "require_review_template_for_first_linkage"), \
             patch.object(views, "persist_calendar_sync_reservation", side_effect=reserve) as reservation, \
             patch.object(calendar, "_mark_imported_review_scheduled") as imported, \
             patch.object(calendar, "_booking_response_event", side_effect=lambda row, _: {"reviewInstanceId": row.review_instance_id}):
            self.graph.side_effect = None
            self.graph.return_value = (record, "", True)
            response = self.learner_book()
        self.assertEqual(response.status_code, 201, response.content)
        self.assertEqual(record.review_template_id, "T-MCM")
        self.assertEqual(json.loads(response.content)["event"]["reviewInstanceId"], "NEW-INSTANCE")
        self.assertEqual(reservation.call_args.kwargs["review_event"], event)
        self.assertIsNone(imported.call_args.args[0])

    def test_imported_booking_keeps_exact_source_ids_for_all_three_families(self):
        for index, family in enumerate(("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)")):
            with self.subTest(family=family):
                event = base_event(imported_row(700 + index, family))
                record = booking(event["eventKey"], event_type=event["source"])
                with patch.object(calendar, "coaching_events_for_learner", return_value=[event]), \
                     patch("learner_api.calendar_connections.booking_conflicts", return_value=False), \
                     patch.object(views, "microsoft_graph_request", return_value={"value": []}) as outlook, \
                     patch.object(views.CoachCalendarEvent.objects, "filter") as existing, \
                     patch.object(views.CoachCalendarEvent.objects, "get_or_create", return_value=(record, True)) as create, \
                     patch("learner_api.imported_booking.reserve_imported_booking", side_effect=lambda row, *_args, **_kwargs: (row, True)) as reservation, \
                     patch.object(calendar, "_mark_imported_review_scheduled") as mark_imported, \
                     patch.object(calendar, "_booking_response_event", return_value=event), \
                     patch.object(calendar, "require_native_review_creation", side_effect=AssertionError("Imported booking reached Native creation")) as native:
                    existing.return_value.first.return_value = None
                    self.graph.side_effect = None
                    self.graph.return_value = (record, "", True)
                    response = self.learner_book(sessionType=event["source"], eventKey=event["eventKey"])
                self.assertEqual(response.status_code, 201, response.content)
                self.assertEqual(create.call_args.kwargs["event_key"], event["eventKey"])
                self.assertEqual(reservation.call_args.args[1]["importedReviewType"], family)
                self.assertEqual(reservation.call_args.args[1]["eventKey"], event["eventKey"])
                self.assertEqual(outlook.call_args.args[0], "GET")
                self.assertTrue(outlook.call_args.args[1].startswith("users/coach%40example.invalid/calendarView?"))
                self.assertEqual(mark_imported.call_args.args[0], str(700 + index))
                self.assertFalse(record.review_instance_id)
                native.assert_not_called()

    def test_two_empty_aptem_profiles_never_generate_virtual_mcms(self):
        # Synthetic equivalents of two active profiles with 16/12 configured MCMs.
        for index, count in enumerate((16, 12), 1):
            with self.subTest(count=count), \
                 patch.object(views, "fetch_aptem_review_events", return_value=([], set())), \
                 patch.object(views, "fetch_source_schedule_rows", return_value=({}, {})), \
                 patch.object(views, "resolve_curriculum_review_occurrences", return_value=[{"reviewTypeCode": "mcm"}] * count) as generate:
                person, enrolment = profile(None), source(900 + index)
                person._caseload_source = enrolment
                result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [person])
                self.assertEqual(result["events"], [])
                self.assertIn({"learnerId": "21", "code": "aptem_source_missing"}, result["reviewGenerationIssues"])
                self.assertEqual(calendar._generated_cycle_events(enrolment, person, set()), [])
                generate.assert_not_called()

    def test_source_read_failure_never_produces_virtual_native_reviews(self):
        self.person._caseload_source = None
        with patch.object(views, "fetch_caseload_aptem_ids", side_effect=DatabaseError("unavailable")), \
             patch.object(views, "resolve_curriculum_review_occurrences") as generate:
            with self.assertRaises(DatabaseError):
                views.resolve_coach_review_events("coach@example.invalid", "Coach", [self.person])
        generate.assert_not_called()

    def test_core_blocks_new_instances_and_additions_but_keeps_existing(self):
        with patch.object(engine, "ensure_review_instance_tables"), \
             patch.object(engine, "ensure_learner_review_additions_table"), \
             patch.object(engine, "find_review_instance", return_value=None) as existing, \
             patch.object(engine, "find_active_learner_review_addition", return_value=None), \
             patch.object(engine.curriculum_views, "insert_row") as insert:
            args = dict(learner_id=21, learner_kind="", programme_id="P1", occurrence_number=1, target_date=date(2099, 11, 19))
            with self.assertRaises(review_sources.ReviewCreationBlocked):
                engine.ensure_review_instance({"id": "T-MCM"}, **args)
            with self.assertRaises(review_sources.ReviewCreationBlocked):
                engine.create_learner_review_addition(review_template_id="T-MCM", programme_id="P1", learner_id=21, target_date=args["target_date"])
            existing.return_value = {"id": "EXISTING", "status": "scheduled", "definition_snapshot": {"frozen": True}}
            before = deepcopy(existing.return_value)
            self.assertEqual(engine.ensure_review_instance({"id": "T-MCM"}, **args), before)
            insert.assert_not_called()

    def test_native_core_preserves_pr_and_radar_distinct_instances(self):
        self.make_native()
        with patch.object(engine, "ensure_review_instance_tables"), \
             patch.object(engine, "find_review_instance", return_value=None), \
             patch.object(engine.curriculum_views, "unique_prefixed_id", side_effect=["INSTANCE-PR", "INSTANCE-RADAR"]), \
             patch.object(engine, "build_definition_snapshot", side_effect=lambda row: row), \
             patch.object(engine.curriculum_views, "json_db_value", side_effect=lambda value: value), \
             patch.object(engine.transaction, "atomic", side_effect=nullcontext), \
             patch.object(engine.curriculum_views, "insert_row", side_effect=lambda table, row: row):
            instances = [engine.ensure_review_instance({"id": template, "name": title}, learner_id=21,
                learner_kind="", programme_id="P1", occurrence_number=2, target_date=date(2099, 11, 19))
                for template, title in (("T-PR", "Progress Review"), ("T-RADAR", "Progress Review (+ Skills Radar)"))]
        self.assertNotEqual(instances[0]["id"], instances[1]["id"])
        self.assertEqual([row["review_template_id"] for row in instances], ["T-PR", "T-RADAR"])
        self.assertEqual([row["occurrence_number"] for row in instances], [2, 2])

    def test_durable_native_learner_booking_is_owned_and_not_relinked(self):
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = self.enrolment
        record = booking("review:21:T-MCM:1", review_instance_id="EXISTING", review_template_id="T-MCM")
        before = {field.attname: deepcopy(getattr(record, field.attname)) for field in record._meta.concrete_fields}
        with patch.dict(calendar.SOURCE_MODELS, {"commercial": model}), \
             patch.object(calendar, "_calendar_profile", return_value=self.person), \
             patch.object(calendar.CoachCalendarEvent.objects, "filter") as records, \
             patch.object(calendar, "coaching_events_for_learner", return_value=[]) as imported:
            records.return_value.first.return_value = record
            self.assertIs(calendar._learner_calendar_record("commercial", 121, record.event_key), record)
            imported.assert_not_called()
            self.assertEqual({field.attname: getattr(record, field.attname) for field in record._meta.concrete_fields}, before)
            record.learner_id = 999
            self.assertIsNone(calendar._learner_calendar_record("commercial", 121, record.event_key))
        self.graph.assert_not_called()

    def test_imported_calendar_key_keeps_imported_form_identity(self):
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = self.enrolment
        record = booking(review_instance_id="LEGACY-NATIVE-LINK", review_template_id="LEGACY-TEMPLATE")
        event = {**base_event(), "calendarEventKey": record.event_key}
        with patch.dict(calendar.SOURCE_MODELS, {"commercial": model}), \
             patch.object(calendar, "_calendar_profile", return_value=self.person), \
             patch.object(calendar.CoachCalendarEvent.objects, "filter") as records, \
             patch.object(calendar, "coaching_events_for_learner", return_value=[event]) as imported:
            records.return_value.first.return_value = record
            self.assertIs(calendar._learner_calendar_record("commercial", 121, record.event_key), record)
            self.assertEqual(record._imported_review_event, event)
            imported.assert_called_once()
        self.graph.assert_not_called()
