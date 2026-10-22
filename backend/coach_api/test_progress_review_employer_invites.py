"""Aptem source -> Graph invitations, without a database or live Microsoft calls."""
from datetime import date, time
from types import SimpleNamespace
from unittest.mock import patch
from uuid import UUID

from django.test import SimpleTestCase

from . import views
from .models import CoachCalendarEvent
from .test_review_source_selection_no_db import learner


class AptemProgressReviewEmployerInvitesTests(SimpleTestCase):
    def resolve(self, types, *, contact_email="employer@example.invalid"):
        profiles = [learner(1), learner(2)]
        events = [{"eventKey": f"imported-review:{index}", "learnerId": str(profile_id),
                   "source": "mcr" if title == "Monthly Coaching Meeting" else "progress-review",
                   "reviewSource": "aptem", "importedReviewType": title, "title": title}
                  for index, (profile_id, title) in enumerate(types)]
        with patch.object(views, "resolve_effective_aptem_ids", return_value=({1: 101, 2: 102}, set())), \
                patch.object(views, "fetch_aptem_review_events", return_value=(events, {1, 2})), \
                patch.object(views.Employer.objects, "filter") as employer:
            employer.return_value.only.return_value.first.return_value = SimpleNamespace(
                full_name="Linked Employer", email=contact_email,
            )
            result = views.resolve_coach_review_events("coach@example.invalid", "Coach", profiles,
                source_schedule_rows=({1: SimpleNamespace(employer_id=77),
                                       2: SimpleNamespace(manager_email="other@example.invalid")}, {}))
        return result["events"], employer

    def record(self, **overrides):
        return CoachCalendarEvent(**{
            "event_key": "imported-review:0", "event_type": "progress-review",
            "owner_email": "coach@example.invalid", "owner_name": "Coach",
            "learner_id": 1, "learner_email": "learner@example.invalid", "learner_name": "Learner",
            "scheduled_date": date(2026, 10, 26), "scheduled_time": time(9),
            "duration_minutes": 60, "target_date": date(2026, 10, 26),
            "operation_id": UUID("00000000-0000-0000-0000-000000000001"), **overrides,
        })

    def test_both_imported_pr_types_invite_their_own_linked_employer_once(self):
        events, employer = self.resolve([
            (1, "Progress Review"), (1, "Progress Review (+ Skills Radar)"), (2, "Progress Review"),
        ])
        employer.assert_called_once_with(pk=77)
        for event, expected in zip(events, ["employer@example.invalid", "employer@example.invalid", "other@example.invalid"]):
            with self.subTest(event=event["eventKey"]):
                payload = views.build_graph_event_payload(self.record(), event)
                addresses = [item["emailAddress"]["address"] for item in payload["attendees"]]
                self.assertIn(expected, addresses)
                self.assertIn("learner@example.invalid", addresses)
                self.assertEqual(len(addresses), len(set(addresses)))
                self.assertEqual(payload["transactionId"], "00000000-0000-0000-0000-000000000001")

    def test_support_gateway_and_mcm_do_not_resolve_or_invite_an_employer(self):
        events, employer = self.resolve([(1, title) for title in (
            "Personal Support Plan", "Gateway Review", "Monthly Coaching Meeting",
        )])
        employer.assert_not_called()
        for event in events:
            self.assertNotIn("employerEmail", event)
            self.assertNotIn("employer@example.invalid", str(views.build_graph_event_payload(self.record(), event)["attendees"]))

    def test_missing_employer_address_does_not_invent_an_invitee(self):
        events, _ = self.resolve([(1, "Progress Review")], contact_email="")
        self.assertNotIn("employerEmail", events[0])

    def test_duplicate_learner_and_employer_address_is_invited_once(self):
        events, _ = self.resolve([(1, "Progress Review")], contact_email="LEARNER@example.invalid")
        addresses = [item["emailAddress"]["address"]
                     for item in views.build_graph_event_payload(self.record(), events[0])["attendees"]]
        self.assertEqual(addresses.count("learner@example.invalid"), 1)

    def test_new_graph_booking_includes_employer_but_reschedule_keeps_attendees_and_identity(self):
        events, _ = self.resolve([(1, "Progress Review")])
        record = self.record()
        join_url = "https://teams.microsoft.com/meet/synthetic"
        with patch.object(views, "has_graph_credentials", return_value=True), \
                patch.object(views, "microsoft_graph_request", return_value={
                    "id": "existing-event", "onlineMeeting": {"joinUrl": join_url},
                }) as graph, \
                patch.object(views, "apply_teams_meeting_options", return_value=(True, {}, [])) as options:
            self.assertEqual(views.sync_calendar_event_to_graph(record, events[0]), "")
            self.assertEqual(graph.call_args.args[0], "POST")
            self.assertIn("employer@example.invalid", str(graph.call_args.kwargs["payload"]["attendees"]))
            options.assert_called_once()
            graph.reset_mock()
            options.reset_mock()
            record.scheduled_time = time(10)
            self.assertEqual(views.sync_calendar_event_to_graph(record, events[0]), "")
            graph.assert_called_once()
            self.assertEqual(graph.call_args.args, ("PATCH", "users/coach%40example.invalid/events/existing-event"))
            self.assertEqual(set(graph.call_args.kwargs["payload"]), {"subject", "start", "end"})
            self.assertEqual(record.graph_event_id, "existing-event")
            self.assertEqual(record.meeting_link, join_url)
            options.assert_not_called()
