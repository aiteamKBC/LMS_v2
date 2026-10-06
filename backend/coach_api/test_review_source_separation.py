"""Cross-role ownership with synthetic identities, mocks and isolated local tables."""
from copy import deepcopy
from datetime import date, datetime, time, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase, TestCase
from django.test.utils import CaptureQueriesContext
from django.db import connection
from contextlib import ExitStack
from hashlib import sha256

from coach_api import views
from coach_api.models import CoachCalendarEvent, ImportedReviewInstance, MigratedReviewDocument, MigratedReviewSignature
from coach_api.review_sources import (
    ReviewIdentityConflict, apply_imported_state, imported_identity, linked_booking,
    linked_overlay, number_imported_events, resolve_review_source, review_profile_for_source,
)
from learner_api import calendar, meeting_attendance
from learner_api.imported_review_calendar import imported_events_for_learner
from learner_api.review_history import _serialize_review


def profile(aptem_id=6301):
    return SimpleNamespace(id=21, enrolment_id=121, aptem_id=aptem_id,
        _caseload_source=SimpleNamespace(aptem_id=str(aptem_id) if aptem_id else ""),
        learner_type="commercial", username="Synthetic learner", email="old@example.invalid",
        programme="Programme", programme_id="P1", programme_status="Active", lifecycle_status="active", cohort="", cohort_id="",
        group_name="", group_id="", coach_name="Synthetic coach", coach_email="coach@example.invalid")


def source(aptem_id=6301):
    return SimpleNamespace(pk=121, aptem_id=str(aptem_id) if aptem_id else "", email="new@example.invalid", learner_type="commercial")


def imported_row(review_id=401, review_type="Monthly Coaching Meeting", status="Not Scheduled"):
    return dict(learner_id=21, id=review_id, aptem_review_id=f"A-{review_id}",
                review_type=review_type, review_name=f"Synthetic {review_type}", reviewer_name="Synthetic coach",
                learner_name="Synthetic learner", planned_scheduled_date=datetime(2026, 11, 18, 14),
                completed_date=None, status=status, review_data={"aptem_learner_id": "6301"},
                extraction_status="complete", last_error=None, has_review_sections=True, source_learner_id="6301")


def base_event(row=None):
    row = row or imported_row()
    review = _serialize_review(row, {})
    key = f"imported-review:{review['aptemReviewId']}"
    return {**imported_identity(review, 21), "id": key, "eventKey": key,
            "enrolmentId": "121", "learnerType": "commercial", "status": review["status"],
            "source": "mcr" if review["type"] == "Monthly Coaching Meeting" else "progress-review",
            "targetDate": review["plannedDate"], "date": review["plannedDate"], "title": review["name"],
            "scheduledDate": review["plannedDate"], "scheduledTime": review["plannedTime"], "sequence": 1}


def booking(key="imported-review:A-401", **changes):
    values = dict(id=301, learner_id=21, event_key=key, idempotency_key=key,
        owner_email="coach@example.invalid", owner_name="Synthetic coach", learner_email="historic@example.invalid",
        event_type="mcr", target_date=date(2026, 11, 18), scheduled_date=date(2026, 11, 19),
        scheduled_time=time(10), duration_minutes=60, status="scheduled", sync_state="synced",
        graph_event_id="synthetic-graph-id", meeting_link="https://example.invalid/teams", meeting_provider="Teams")
    return CoachCalendarEvent(**{**values, **changes})


def overlay(**changes):
    values = dict(id=8, learner_id=21, source_review_id=401, event_key="imported-review:A-401",
        owner_email="coach@example.invalid", status="completed", template_snapshot={"sections": [{"id": "summary"}]},
        completed_at=datetime(2026, 11, 19, 11, tzinfo=timezone.utc))
    return ImportedReviewInstance(**{**values, **changes})


class ReviewSourceSeparationTests(SimpleTestCase):
    def test_shared_identity_rule_includes_profile_fallback_and_rejects_conflicts(self):
        for current, imported, expected in [("6301", 6301, "aptem"), ("6333", 6333, "aptem"),
                                          ("", 6301, "aptem"), ("", None, "curriculum"),
                                          ("6301", 6333, "conflict")]:
            with self.subTest(current=current, imported=imported):
                self.assertEqual(resolve_review_source(current, imported).kind, expected)

    def test_email_mismatch_keeps_aptem_source_and_never_calls_native_generator(self):
        for aptem_id in (6301, 6333):
            with self.subTest(aptem_id=aptem_id), patch.object(views, "resolve_curriculum_review_occurrences") as generate:
                person, enrolment = profile(aptem_id), source(aptem_id)
                self.assertIs(review_profile_for_source(enrolment, person), person)
                self.assertEqual(views.resolve_effective_aptem_ids([person]), ({21: aptem_id}, set()))
                self.assertEqual(calendar._generated_cycle_events(enrolment, person, set()), [])
                generate.assert_not_called()

    @patch("learner_api.models.LearnerProfile")
    def test_missing_enrolment_link_uses_unique_aptem_id_without_email_or_writes(self, model):
        person = profile(); person.enrolment_id = None
        model.objects.filter.side_effect = [[], [person]]
        self.assertIs(review_profile_for_source(source()), person)
        self.assertEqual(model.objects.filter.call_args.kwargs, {"aptem_id": 6301})
        model.objects.update.assert_not_called()

    def test_same_email_does_not_override_true_aptem_conflict(self):
        person, enrolment = profile(6333), source(6301)
        person.email = enrolment.email
        with self.assertRaises(ReviewIdentityConflict):
            review_profile_for_source(enrolment, person)
        person._caseload_source = enrolment
        self.assertEqual(views.resolve_effective_aptem_ids([person]), ({}, {21}))

    def test_missing_imported_rows_do_not_fall_back_to_curriculum(self):
        with patch.object(calendar.CoachCalendarEvent.objects, "filter") as records, \
             patch("learner_api.imported_review_calendar.imported_events_for_learner", return_value=[]), \
             patch.object(calendar, "_generated_cycle_events") as native:
            records.return_value.order_by.return_value = []
            self.assertEqual(calendar.coaching_events_for_learner(source(), profile()), [])
            native.assert_not_called()

    def test_native_families_keep_template_identity_and_occurrence_numbers(self):
        for title, code in [("Monthly Coaching", "mcm"), ("Progress Review", "progress_review"),
                            ("Progress Review (+ Skills Radar)", "progress_review")]:
            with self.subTest(title=title), \
                 patch.object(views, "resolve_curriculum_programme_id", return_value="P1"), \
                 patch.object(views, "resolve_review_anchor_date", return_value=(date(2026, 1, 1), None)), \
                 patch.object(views, "resolve_schedule_window", return_value=(date(2026, 1, 1), date(2027, 1, 1))), \
                 patch.object(views, "resolve_curriculum_review_occurrences", return_value=[{
                     "reviewTemplateId": "REV-1", "reviewName": title, "reviewTypeCode": code,
                     "occurrenceNumber": 7, "targetDate": date(2026, 8, 1)}]), \
                 patch.object(views, "fetch_aptem_review_events") as imported:
                items = calendar._generated_cycle_events(source(None), profile(None), set())
                self.assertEqual(len(items), 1)
                self.assertEqual((items[0]["reviewTemplateId"], items[0]["occurrenceNumber"]), ("REV-1", 7))
                imported.assert_not_called()

    def test_same_date_rows_have_distinct_ids_and_stable_display_numbers(self):
        rows = [base_event(imported_row(402)), base_event(imported_row(401))]
        ordered = number_imported_events(rows)
        self.assertEqual([event["reviewId"] for event in ordered], ["401", "402"])
        self.assertEqual([event["sequence"] for event in ordered], [1, 2])
        self.assertEqual(len({event["eventKey"] for event in ordered}), 2)

    def test_bookings_link_by_source_identity_even_after_reschedule_and_email_change(self):
        event, record = base_event(), booking()
        self.assertIs(linked_booking(event, [record]), record)
        legacy = booking("old-booking", idempotency_key="learner-book:mcm:commercial:121:2026-11:401")
        self.assertIs(linked_booking(event, [legacy]), legacy)
        wrong = booking("same-date-other-review", idempotency_key="learner-book:mcm:commercial:121:2026-11:402")
        self.assertIsNone(linked_booking(event, [wrong]))
        with self.assertRaises(ReviewIdentityConflict):
            linked_booking(event, [record, legacy])

    def test_another_learner_cannot_borrow_a_key_or_overlay(self):
        event = base_event()
        with self.assertRaises(ReviewIdentityConflict):
            linked_booking(event, [booking(learner_id=99)])
        self.assertIsNone(linked_overlay(event, [overlay(learner_id=99)]))
        self.assertIsNone(linked_overlay(event, [overlay(source_review_id=999)]))

    def test_standalone_filter_keeps_native_id_collisions_and_unrelated_sessions(self):
        from coach_api.review_sources import standalone_review_records
        imported = booking('legacy-imported', learner_id=121,
            idempotency_key='learner-book:mcm:commercial:121:2026-11:401')
        native = booking('native-collision', learner_id=21,
            idempotency_key='learner-book:mcm:commercial:21:2026-11:901')
        support = booking('support', event_type='student-support')
        parallel = booking('parallel-native', idempotency_key='')
        self.assertEqual(standalone_review_records([imported, native, support, parallel], [profile()], {21}), [native, support])

    def test_local_completion_enriches_without_mutating_source_or_meeting(self):
        event, record, local = base_event(), booking(status="completed"), overlay()
        snapshot = lambda obj: {key: value for key, value in obj.__dict__.items() if key != "_state"}
        before = deepcopy((event, snapshot(record), snapshot(local)))
        result = views.overlay_calendar_record(event, record, local)
        self.assertEqual((result["sourceStatus"], result["status"]), ("not-scheduled", "completed"))
        self.assertEqual(result["calendarEventKey"], record.event_key)
        self.assertEqual(result["meetingLink"], record.meeting_link)
        self.assertEqual(result["sourcePlannedDate"], "2026-11-18")
        self.assertEqual(result["scheduledDate"], "2026-11-19")
        self.assertTrue(result["migratedForm"])
        self.assertEqual((event, snapshot(record), snapshot(local)), before)

    def test_historical_completed_keeps_original_lifecycle_and_read_only_form(self):
        event = base_event(imported_row(status="Completed"))
        result = apply_imported_state(event, booking(), overlay(status="in-progress"))
        self.assertEqual(result["status"], "completed")
        self.assertFalse(result["migratedForm"])

    def test_attendance_retains_internal_review_ledger_id_and_existing_calendar_key(self):
        event = apply_imported_state(base_event(), booking())
        with patch.object(meeting_attendance, "_calendar_profile", return_value=profile()), \
             patch.object(meeting_attendance, "coaching_events_for_learner", return_value=[event]):
            record = meeting_attendance.meeting_records(source(), "commercial")[0]
        self.assertEqual(record["id"], "imported-review:401")
        self.assertEqual(record["eventKey"], "imported-review:A-401")
        self.assertEqual(meeting_attendance.ledger_id(source(), record), "meeting-attendance:121:imported-review:401")

    def test_unbooked_imported_schedule_does_not_create_attendance_evidence(self):
        event = apply_imported_state(base_event(imported_row(status="Scheduled")))
        with patch.object(meeting_attendance, "_calendar_profile", return_value=profile()), \
             patch.object(meeting_attendance, "coaching_events_for_learner", return_value=[event]):
            record = meeting_attendance.meeting_records(source(), "commercial")[0]
        self.assertFalse(meeting_attendance.is_booked(record))

    def test_coach_and_learner_resolve_every_family_and_lifecycle_to_same_source_row(self):
        for review_type in ("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"):
            for status in ("Completed", "Scheduled", "Not Scheduled", "In Progress", "Awaiting Signature"):
                with self.subTest(review_type=review_type, status=status):
                    row = imported_row(review_type=review_type, status=status)
                    aptem_id = 6333 if status == "Scheduled" else 6301
                    row["review_data"]["aptem_learner_id"] = str(aptem_id)
                    row["source_learner_id"] = str(aptem_id)
                    cursor = MagicMock()
                    cursor.description = [(key,) for key in row]
                    cursor.fetchall.return_value = [tuple(row.values())]
                    with patch.object(views, "connections") as db, \
                         patch("learner_api.imported_review_calendar.connection"), \
                         patch("learner_api.imported_review_calendar._review_rows", return_value=[row]), \
                         patch("learner_api.imported_review_calendar._sections_by_review", return_value={}), \
                         patch("coach_api.models.ImportedReviewInstance.objects.filter") as overlays:
                        db["default"].cursor.return_value.__enter__.return_value = cursor
                        overlays.return_value.filter.return_value = []
                        coach, _ = views.fetch_aptem_review_events([profile(aptem_id)], {21: aptem_id},
                            owner_email="coach@example.invalid", owner_name="Synthetic coach")
                        learner = imported_events_for_learner(source(aptem_id), profile(aptem_id), aptem_id, [])
                    self.assertEqual(len(coach), 1)
                    self.assertEqual(len(learner), 1)
                    for key in ("eventKey", "reviewId", "aptemReviewId", "importedReviewType", "sourcePlannedDate", "status"):
                        self.assertEqual(coach[0][key], learner[0][key], key)
                    self.assertEqual(learner[0]["importedReview"]["id"], "401")
                    self.assertEqual(learner[0]["importedReview"]["type"], review_type)
                    self.assertIsNone(learner[0]["reviewInstanceId"])


class ImportedContinuationIdentityTests(TestCase):
    def test_dashboard_reuses_legacy_appointment_and_local_completion_once(self):
        from coach_api.dashboard_service import CoachDashboardService
        record = booking('legacy-calendar-key', learner_id=121,
            idempotency_key='learner-book:mcm:commercial:121:2026-11:401')
        record.save(force_insert=True)
        local = overlay(); local.save(force_insert=True)
        event = base_event()
        values = {
            'fetch_caseload_learner_profiles': [profile()], 'serialize_caseload_learner': {'id': '21'},
            'caseload_canonical_metrics': {}, 'caseload_dashboard_progress_projections': {},
            'caseload_audit_hour_totals': {}, 'caseload_evidenced_ksb_counts': {}, 'caseload_aptem_ids': {21: 6301},
            'curriculum_expected_otjh_by_component_id': {}, 'caseload_progress_history': {}, 'build_monthly_risk_history': [],
            'coach_staff_display_name': 'Synthetic coach',
            'resolve_coach_review_events': {'events': [event], 'aptemProfileIds': {21}},
            'fetch_calendar_event_records': {}, 'fetch_standalone_event_records': [record],
            'review_type_fields_by_template': {}, 'collect_tracked_live_session_events': [],
            'dashboard_attendance_rows': [], 'fetch_official_assigned_groups': [],
        }
        with patch.multiple(views, **{key: MagicMock(return_value=value) for key, value in values.items()}), \
             patch('coach_api.services.dashboard.service.dashboard_marking_projection', return_value={'items': []}):
            payload = CoachDashboardService(local.owner_email, today=date(2026, 11, 19)).build_live()
        self.assertEqual(len(payload['meetings']['events']), 1)
        result = payload['meetings']['events'][0]
        self.assertEqual((result['reviewId'], result['calendarEventKey'], result['status']),
                         ('401', record.event_key, 'completed'))
        self.assertEqual(result['sourceStatus'], 'not-scheduled')
        self.assertEqual(payload['learners'][0]['lastMcm'], '2026-11-19')

    def test_all_families_keep_booking_form_signatures_and_frozen_pdf_across_roles(self):
        from coach_api.review_sources import enrich_imported_events
        from coach_api import migrated_completion_views as endpoints
        for index, family in enumerate(("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"), 1):
            with self.subTest(family=family), ExitStack() as stack:
                row = imported_row(400 + index, family)
                event = base_event(row)
                key = event['eventKey']
                record = booking(key, id=300 + index, event_type=event['source'], status='completed')
                record.save(force_insert=True)
                local = overlay(id=index, event_key=key, source_review_id=row['id'], answers={'summary': 'Saved final answer'},
                    meeting_intelligence={'summaryStatus': 'ready', 'graphEventId': record.graph_event_id})
                local.save(force_insert=True)
                signature = MigratedReviewSignature.objects.create(overlay=local, role='participant', signer_account_id=121,
                    signer_name='Synthetic learner', signer_email='old@example.invalid', signature='frozen synthetic signature',
                    signed_at=datetime(2026, 11, 19, 11, tzinfo=timezone.utc))
                content = b'%PDF-1.4 frozen synthetic document'
                document = MigratedReviewDocument.objects.create(overlay=local, pdf_bytes=content, sha256=sha256(content).hexdigest())
                original = (record.pk, record.event_key, record.operation_id, record.idempotency_key, record.graph_event_id,
                            record.owner_email, record.meeting_link, local.answers, local.meeting_intelligence, signature.signature)
                cursor = MagicMock(); cursor.description = [(key,) for key in row]
                cursor.fetchall.return_value = [tuple(row.values())]
                db = stack.enter_context(patch.object(views, 'connections'))
                db['default'].cursor.return_value.__enter__.return_value = cursor
                stack.enter_context(patch('learner_api.imported_review_calendar.connection'))
                stack.enter_context(patch('learner_api.imported_review_calendar._review_rows', return_value=[row]))
                stack.enter_context(patch('learner_api.imported_review_calendar._sections_by_review', return_value={}))
                native = stack.enter_context(patch('curriculum_api.review_instances.ensure_review_instance', side_effect=AssertionError('Native write')))
                graph = stack.enter_context(patch.object(views, 'sync_calendar_event_to_graph', side_effect=AssertionError('External mutation')))
                with CaptureQueriesContext(connection) as queries:
                    coach_base, _ = views.fetch_aptem_review_events([profile()], {21: 6301}, owner_email=local.owner_email, owner_name='Synthetic coach')
                    coach = enrich_imported_events(coach_base)
                    learner = imported_events_for_learner(source(), profile(), 6301, [record])
                self.assertTrue(all(query['sql'].lstrip().upper().startswith('SELECT') for query in queries))
                for result in (coach, learner):
                    self.assertEqual(len(result), 1)
                    self.assertEqual((result[0]['reviewId'], result[0]['aptemReviewId'], result[0]['importedReviewType']), (str(row['id']), row['aptem_review_id'], family))
                    self.assertEqual((result[0]['status'], result[0]['sourceStatus']), ('completed', 'not-scheduled'))
                    self.assertEqual((result[0]['calendarEventKey'], result[0]['formEventKey']), (record.event_key, local.event_key))
                    self.assertIsNone(result[0]['reviewInstanceId'])
                stack.enter_context(patch.object(endpoints, '_party_overlay', return_value=local))
                stack.enter_context(patch.object(endpoints, '_pdf_context', side_effect=AssertionError('Regenerated frozen PDF')))
                for role in ('learner', 'employer'):
                    with patch.object(endpoints, 'authenticate_request', return_value=SimpleNamespace(role=role)):
                        response = endpoints.migrated_review_party_pdf(RequestFactory().get('/'), key)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(response.content, content)
                record.refresh_from_db(); local.refresh_from_db(); signature.refresh_from_db(); document.refresh_from_db()
                self.assertEqual(original, (record.pk, record.event_key, record.operation_id, record.idempotency_key, record.graph_event_id,
                    record.owner_email, record.meeting_link, local.answers, local.meeting_intelligence, signature.signature))
                self.assertEqual(bytes(document.pdf_bytes), content)
                native.assert_not_called(); graph.assert_not_called()

    def test_participant_identity_uses_aptem_bridge_and_rejects_conflicting_or_unrelated_accounts(self):
        from coach_api import migrated_completion_views as endpoints
        local = overlay(); local.save(force_insert=True)
        person, enrolment = profile(), source()
        enrolment.employer_id = 221
        with patch.object(endpoints.LearnerProfile.objects, 'filter') as profiles, \
             patch.object(endpoints.EnrolmentUser.all_learners, 'filter') as sources, patch.object(endpoints, 'connections') as db:
            profiles.return_value.first.return_value = person
            sources.return_value.first.return_value = enrolment
            db['default'].cursor.return_value.__enter__.return_value.fetchone.return_value = ('Not Scheduled', None)
            for role, subject, allowed in [('learner', 121, True), ('employer', 221, True), ('learner', 999, False), ('employer', 999, False)]:
                self.assertEqual(endpoints._party_overlay(local.event_key, SimpleNamespace(role=role, subject_id=subject)) is not None, allowed)
            enrolment.aptem_id = '6333'
            self.assertIsNone(endpoints._party_overlay(local.event_key, SimpleNamespace(role='learner', subject_id=121)))

    def test_legacy_calendar_key_remains_the_booking_for_forms_and_summary(self):
        from coach_api.review_sources import booking_for_imported_review, booking_for_overlay
        local = overlay(status='scheduled'); local.save(force_insert=True)
        record = booking('legacy-calendar-key', learner_id=121,
            idempotency_key='learner-book:mcm:commercial:121:2026-11:401')
        record.save(force_insert=True)
        review = _serialize_review(imported_row(), {})
        self.assertEqual(booking_for_imported_review(profile(), review, local).pk, record.pk)
        with patch('learner_api.models.LearnerProfile.objects.filter') as profiles:
            profiles.return_value.first.return_value = profile()
            self.assertEqual(booking_for_overlay(local).pk, record.pk)
        self.assertEqual(CoachCalendarEvent.objects.count(), 1)


    def test_learner_booking_reuses_one_imported_calendar_operation_and_never_creates_a_native_instance(self):
        import json
        from inspect import unwrap
        for index, family in enumerate(('Monthly Coaching Meeting', 'Progress Review', 'Progress Review (+ Skills Radar)'), 1):
            with self.subTest(family=family), ExitStack() as stack:
                row = imported_row(500 + index, family)
                event = base_event(row)
                enrolment = source(); enrolment.username = 'Synthetic learner'
                model = MagicMock(); model.all_learners.filter.return_value.first.return_value = enrolment
                stack.enter_context(patch.dict(calendar.SOURCE_MODELS, {'commercial': model}))
                stack.enter_context(patch.object(calendar, '_calendar_profile', return_value=profile()))
                stack.enter_context(patch.object(calendar, 'booking_date_restriction', return_value=None))
                stack.enter_context(patch.object(calendar, 'coaching_events_for_learner', return_value=[event]))
                stack.enter_context(patch('learner_api.calendar_connections.booking_conflicts', return_value=False))
                stack.enter_context(patch.object(views, 'england_non_delivery_reason', return_value=None))
                stack.enter_context(patch.object(views, 'ensure_learner_session_not_booked_in_week'))
                stack.enter_context(patch.object(views, 'ensure_learner_calendar_available'))
                stack.enter_context(patch.object(calendar, '_mark_imported_review_scheduled'))
                native = stack.enter_context(patch.object(views, 'ensure_review_instance_for_calendar_record', side_effect=AssertionError('Native instance')))
                def sync(record, _event):
                    record.graph_event_id = 'synthetic-graph-' + str(index)
                    record.meeting_link = 'https://example.invalid/teams/' + str(index)
                    record.graph_organizer_email = record.owner_email
                    return ''
                graph = stack.enter_context(patch.object(views, 'sync_calendar_event_to_graph', side_effect=sync))
                payload = {'sessionType': event['source'], 'eventKey': event['eventKey'], 'reviewId': event['reviewId'],
                    'scheduledDate': '2099-11-19', 'scheduledTime': '10:00', 'durationMinutes': 60}
                request = lambda data: RequestFactory().post('/book/', data=json.dumps(data), content_type='application/json')
                first = unwrap(calendar.learner_calendar_book)(request(payload), 'commercial', 121)
                self.assertEqual(first.status_code, 201, first.content)
                self.assertEqual(json.loads(first.content)['event']['reviewId'], str(row['id']))
                self.assertEqual(json.loads(first.content)['event']['aptemReviewId'], row['aptem_review_id'])
                record = CoachCalendarEvent.objects.get(event_key=event['eventKey'])
                identity = (record.pk, record.operation_id, record.graph_event_id, record.graph_organizer_email)
                replay = unwrap(calendar.learner_calendar_book)(request(payload), 'commercial', 121)
                self.assertEqual(replay.status_code, 200, replay.content)
                conflict = unwrap(calendar.learner_calendar_book)(request({**payload, 'scheduledTime': '12:00'}), 'commercial', 121)
                self.assertEqual(conflict.status_code, 409, conflict.content)
                record.refresh_from_db()
                self.assertEqual(identity, (record.pk, record.operation_id, record.graph_event_id, record.graph_organizer_email))
                self.assertFalse(record.review_instance_id); self.assertFalse(record.review_template_id)
                self.assertEqual(CoachCalendarEvent.objects.filter(event_key=event['eventKey']).count(), 1)
                graph.assert_called_once(); native.assert_not_called()

    def test_native_form_and_signature_endpoints_do_not_adopt_an_imported_booking(self):
        from inspect import unwrap
        record = booking(review_instance_id='legacy-native-instance')
        record._imported_review_event = base_event()
        with patch.object(calendar, '_learner_calendar_record', return_value=record), \
             patch('curriculum_api.review_instances.get_review_instance', side_effect=AssertionError('Native form')) as native:
            get = RequestFactory().get('/')
            post = RequestFactory().post('/', '{}', content_type='application/json')
            self.assertEqual(unwrap(calendar.learner_calendar_event_review)(get, 'commercial', 121, record.event_key).status_code, 409)
            self.assertEqual(calendar._save_learner_review_answers(post, 'commercial', 121, record.event_key).status_code, 409)
            self.assertEqual(unwrap(calendar.learner_progress_review_sign)(post, 'commercial', 121, record.event_key).status_code, 409)
            native.assert_not_called()
