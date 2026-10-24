"""Previous Aptem context: synthetic sources, real local overlays, no Graph/AI."""
from copy import deepcopy
from inspect import unwrap
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, TestCase

from learner_api.review_history import _serialize_review
from . import migrated_previous as previous, views
from .views import stored_coach_meeting_transcript_for_summary as scoped_transcript_reader
from .models import ImportedReviewInstance
from .test_migrated_summary_binding import DEFINITION

OWNER = "coach@example.invalid"


def source(pk, planned, *, family="Monthly Coaching Meeting", status="Scheduled", programme="Sample programme"):
    row = {
        "id": pk, "learner_id": 42, "aptem_review_id": f"source-{pk}",
        "review_name": f"Saved meeting {pk}", "review_type": family,
        "planned_scheduled_date": planned, "completed_date": None, "status": status,
        "review_data": {"aptem_learner_id": 902, "live_odata": {"ProgramName": programme}},
    }
    return row, _serialize_review(row, {})


class MigratedPreviousTests(TestCase):
    def setUp(self):
        self.current = source(3, "2026-10-20")
        self.prior = source(2, "2026-09-20")
        self.rows = [self.current, self.prior, source(1, "2026-08-20", status="Completed")]
        self.overlay = ImportedReviewInstance.objects.create(
            event_key="imported-review:source-2", source_review_id=2, learner_id=42,
            owner_email=OWNER, status="completed", template_snapshot=deepcopy(DEFINITION),
            answers={"recap": "Final coach-edited summary."},
            meeting_intelligence={"summaryStatus": "ready", "summary": {"overview": "Older AI suggestion."}},
        )
        self.profiles = [SimpleNamespace(id=42, programme_id="p1", programme="Sample programme", aptem_id=902)]
        self.definition_reader = self.patch(views, "_imported_review_definition", side_effect=self.definition)
        self.patch(views, "fetch_caseload_dashboard_profiles", return_value=self.profiles)
        self.patch(views, "resolve_effective_aptem_ids", return_value=({42: 902}, set()))
        self.sources = self.patch(previous, "_sources", side_effect=lambda *args: self.rows)
        self.booking = self.patch(previous, "booking_for_overlay", return_value=None)
        self.transcript = self.patch(views, "stored_coach_meeting_transcript_for_summary", return_value=None)
        self.patch(views, "openai_meeting_summary", side_effect=AssertionError("Read-only endpoint must not call AI"))
        self.patch(views, "fetch_coach_meeting_graph_snapshot", side_effect=AssertionError("Read-only endpoint must not call Graph"))

    def patch(self, obj, name, **kwargs):
        patcher = patch.object(obj, name, **kwargs)
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def definition(self, owner, key, **kwargs):
        for row, review in self.rows:
            if key == f"imported-review:{row['aptem_review_id']}":
                return {"instance": {"id": key, "learnerId": row["learner_id"]},
                        "historicalReview": review, "programme": "Sample programme", "programmeId": "p1"}
        return None

    def load(self):
        request = RequestFactory().get("/coach_api/coach/reviews/imported-review:source-3/previous")
        request.coach_email = OWNER
        response = unwrap(views.coach_review_instance_previous)(request, "imported-review:source-3")
        return response, json.loads(response.content)

    def test_saved_answer_wins_and_get_does_not_write(self):
        before = ImportedReviewInstance.objects.values().get(pk=self.overlay.pk)
        response, data = self.load()
        self.assertEqual(response.status_code, 200)
        self.assertTrue(data["available"])
        self.assertEqual(data["instance"]["id"], self.overlay.event_key)
        self.assertIsNone(data["instance"]["occurrenceNumber"])
        self.assertEqual(data["summaryText"], "Final coach-edited summary.")
        self.assertFalse(data["transcriptAvailable"])
        self.assertEqual(before, ImportedReviewInstance.objects.values().get(pk=self.overlay.pk))
        self.sources.assert_called_once_with(42, "MCM")
        self.assertTrue(all(call.kwargs["pdf_only"] for call in self.definition_reader.call_args_list))

    def test_pr_and_skills_radar_keep_their_exact_family(self):
        for source_type, family in (("Progress Review", "PR"), ("Progress Review (+ Skills Radar)", "PR_SKILLS_RADAR")):
            with self.subTest(family=family):
                self.current[1]["type"] = source_type
                _, data = self.load()
                self.assertTrue(data["available"])
                self.sources.assert_called_with(42, family)
                self.assertEqual(data["review"]["reviewTypeCode"], "aptem_progress_review")

    def test_cleared_answer_does_not_restore_old_ai_suggestion(self):
        self.overlay.answers = {"recap": ""}
        self.overlay.save()
        _, data = self.load()
        self.assertTrue(data["available"])
        self.assertEqual(data["summaryText"], "")

    def test_absent_bound_answer_is_not_an_unsaved_ai_suggestion(self):
        self.overlay.answers = {}
        self.overlay.save()
        self.assertEqual(self.load()[1]["summaryText"], "")

    def test_stored_transcript_is_from_verified_booking_and_is_bounded(self):
        self.booking.return_value = SimpleNamespace(owner_email=OWNER, event_type="mcr")
        self.transcript.return_value = {"text": "abcdefgh"}
        with patch.object(views, "COACH_MEETING_SUMMARY_TRANSCRIPT_CHARS", 5):
            _, data = self.load()
        self.assertEqual(data["transcriptText"], "abcde")
        self.assertTrue(data["transcriptTruncated"])
        self.transcript.assert_called_once_with(self.booking.return_value)

    def test_previous_transcript_excludes_other_calls_and_preserves_form_answer(self):
        from datetime import date, time
        from .models import CoachCalendarEvent
        from django.test import override_settings
        record = CoachCalendarEvent(id=7, owner_email=OWNER, event_key=self.overlay.event_key,
            learner_id=42, event_type='mcr', graph_event_id='graph-current',
            scheduled_date=date(2026, 9, 20), scheduled_time=time(10), duration_minutes=60)
        self.booking.return_value = record
        self.transcript.side_effect = scoped_transcript_reader
        artifacts = [dict(artifact_type='transcript', graph_artifact_id=key, call_id=call,
            created_datetime=at, metadata={'_lms_graph_event_id': 'graph-current'}) for key, call, at in
            [('current', 'one', '2026-09-20T10:05:00Z'), ('old', 'two', '2026-08-20T10:05:00Z')]]
        with override_settings(TIME_ZONE='UTC'), patch.object(views, 'stored_coach_meeting_snapshot', return_value={'artifacts': artifacts}), \
                patch.object(views, 'coach_meeting_snapshot_tables_ready', return_value=True), \
                patch.object(views, 'coach_meeting_artifact_transcript_columns_ready', return_value=True), \
                patch.object(views, 'connections') as connections:
            cursor = connections.__getitem__.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('current', 'Only the previous booked call')]
            _, data = self.load()
            self.assertEqual(data['transcriptText'], 'Only the previous booked call')
            self.assertNotIn('old', cursor.execute.call_args.args[1])
            artifacts[1]['created_datetime'] = '2026-09-20T10:10:00Z'
            cursor.execute.reset_mock()
            _, ambiguous = self.load()
            self.assertFalse(ambiguous['transcriptAvailable'])
            self.assertEqual(ambiguous['summaryText'], 'Final coach-edited summary.')
            cursor.execute.assert_not_called()
        self.overlay.refresh_from_db()
        self.assertEqual(self.overlay.answers['recap'], 'Final coach-edited summary.')

    def test_historical_source_wins_over_local_answers(self):
        self.prior[1].update(status="completed", sections=[{
            "name": "Meeting Summary", "fields": [{"label": "Summary", "value": "Original Aptem summary."}],
        }])
        _, data = self.load()
        self.assertEqual(data["summaryText"], "Original Aptem summary.")
        self.booking.assert_not_called()

    def test_no_previous_and_missing_dates_are_explicit(self):
        self.rows = [self.current]
        self.assertFalse(self.load()[1]["available"])
        self.rows.append(source(4, None))
        self.assertIn("no planned date", self.load()[1]["reason"])
        self.current[1]["plannedDate"] = None
        self.assertIn("no planned date", self.load()[1]["reason"])

    def test_same_date_reviews_are_not_ordered_by_database_id(self):
        for day in ("2026-09-20", "2026-10-20"):
            with self.subTest(day=day):
                self.rows = [self.current, self.prior, source(7, day)]
                self.assertIn("ambiguous", self.load()[1]["reason"])

    def test_unstarted_previous_does_not_skip_to_an_older_completed_review(self):
        self.overlay.status = "scheduled"
        self.overlay.save()
        _, data = self.load()
        self.assertFalse(data["available"])
        self.assertIn("not started", data["reason"])

    def test_previous_overlay_of_another_coach_is_not_exposed(self):
        self.overlay.owner_email = "other@example.invalid"
        self.overlay.save()
        _, data = self.load()
        self.assertIn("not assigned", data["reason"])
        self.assertEqual(data["summaryText"], "")

    def test_source_identity_conflict_does_not_expose_content(self):
        for field in ("aptem_learner_id", "aptem_review_id"):
            with self.subTest(field=field):
                original = deepcopy(self.prior[0]["review_data"])
                self.prior[0]["review_data"][field] = "wrong-identity"
                self.assertFalse(self.load()[1]["available"])
                self.prior[0]["review_data"] = original
        self.prior[0]["review_data"]["live_odata"]["LearnerId"] = 999
        self.assertFalse(self.load()[1]["available"])

    def test_selected_source_must_still_be_authorized(self):
        self.definition_reader.side_effect = lambda owner, key, **kwargs: self.definition(owner, key) if key.endswith("source-3") else None
        self.assertFalse(self.load()[1]["available"])

    def test_unauthorized_current_is_404_before_history_lookup(self):
        self.definition_reader.return_value = None
        self.definition_reader.side_effect = None
        response, _ = self.load()
        self.assertEqual(response.status_code, 404)
        self.sources.assert_not_called()

    def test_unsupported_family_is_unavailable(self):
        self.current[1]["type"] = "Gateway review"
        self.assertFalse(self.load()[1]["available"])
        self.sources.assert_not_called()

    def test_different_captured_programme_is_excluded(self):
        self.prior[0]["review_data"]["live_odata"]["ProgramName"] = "Different programme"
        _, data = self.load()
        self.assertTrue(data["available"])
        self.assertEqual(data["instance"]["id"], "imported-review:source-1")

    def test_wrong_frozen_programme_or_family_is_not_exposed(self):
        for metadata in ({"programmeKey": "id:other"}, {"family": "PR"}):
            with self.subTest(metadata=metadata):
                self.overlay.template_snapshot["templateSource"] = metadata
                self.overlay.save()
                self.assertFalse(self.load()[1]["available"])

    def test_ambiguous_calendar_or_wrong_family_hides_context(self):
        self.booking.side_effect = previous.ReviewIdentityConflict("synthetic conflict")
        self.assertFalse(self.load()[1]["available"])
        self.booking.side_effect = None
        self.booking.return_value = SimpleNamespace(owner_email=OWNER, event_type="progress-review")
        self.assertFalse(self.load()[1]["available"])
        self.transcript.assert_not_called()

    def test_post_is_rejected_before_history_lookup(self):
        request = RequestFactory().post("/")
        response = unwrap(views.coach_review_instance_previous)(request, "imported-review:source-3")
        self.assertEqual(response.status_code, 405)
        self.sources.assert_not_called()

    def test_source_query_scopes_profile_and_exact_family(self):
        self.sources.side_effect = None
        cursor = MagicMock()
        cursor.description = [(name,) for name in self.current[0]]
        cursor.fetchall.return_value = [tuple(self.current[0].values())]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(previous, "connections", {"isolated": connection}), \
             patch.object(views, "get_learner_db_alias", return_value="isolated"), \
             patch.object(previous, "_sections_by_review", return_value={}):
            result = SOURCE_READER(42, "PR")
        self.assertEqual(cursor.execute.call_args.args[1], [42, ["progress review"]])
        self.assertEqual(result[0][1]["id"], "3")


SOURCE_READER = previous._sources
