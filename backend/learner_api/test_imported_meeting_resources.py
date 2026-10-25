"""APTEM portal reads use saved evidence, never an implicit Teams refresh."""
import copy
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from coach_api import views
from learner_api import calendar, employer_portal

STORED_SNAPSHOT = views.stored_coach_meeting_snapshot
LEARNER_RECORD = calendar._learner_calendar_record


class ImportedMeetingResourceTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role="learner", subject_id=71)
        self.record = SimpleNamespace(event_key="calendar:71", status="scheduled",
                                      _imported_review_event={"reviewSource": "aptem", "reviewId": "901"})
        self.snapshot = {
            "artifacts": [{"artifact_type": "recording", "graph_artifact_id": "rec-1"},
                          {"artifact_type": "transcript", "graph_artifact_id": "private-transcript"}],
            "attendance": {"records": [], "reportCount": 1}, "attendanceReports": [],
            "attendanceTracker": {}, "errors": [], "partial": False,
            "storage": {"stored": True, "syncedAt": "2026-10-20T10:00:00+00:00"},
        }
        self.model = MagicMock()
        self.learner = SimpleNamespace(pk=71, employer_id=91)
        self.model.all_learners.get.return_value = self.learner
        self.rows = [{"id": "imported-review:901", "eventKey": "imported-review:901",
                      "calendarEventKey": self.record.event_key}]
        self.start(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))
        self.start(patch("login.permissions.authenticate_request", side_effect=lambda request: self.account))
        self.reader = self.start(patch.object(calendar, "_learner_calendar_record", return_value=self.record))
        self.start(patch.object(employer_portal, "SOURCE_MODELS", {"commercial": self.model, "apprenticeship": self.model}))
        self.start(patch.object(employer_portal, "_employer_or_404", return_value=(SimpleNamespace(pk=91), None)))
        self.start(patch.object(employer_portal, "_employer_progress_review_rows",
                               side_effect=lambda *args: (self.rows, {}, None)))
        self.stored = self.start(patch.object(views, "stored_coach_meeting_snapshot", side_effect=lambda record: copy.deepcopy(self.snapshot)))
        # These historical-resource fixtures have no initialized local Review
        # and therefore no protected actual-call claim.
        overlays = self.start(patch("coach_api.models.ImportedReviewInstance.objects"))
        overlays.filter.return_value.__getitem__.return_value = []
        self.archive = self.start(patch("coach_api.recording_archive.archived_recording_url", return_value="https://storage.example.test/saved"))
        self.effects = {
            name: self.start(patch.object(views, name)) for name in (
                "fetch_coach_meeting_graph_snapshot", "persist_coach_meeting_snapshots",
                "apply_teams_attendance_status_transition", "ensure_coach_meeting_summary",
                "openai_meeting_summary", "microsoft_graph_request", "coach_meeting_artifact_content_response",
            )
        }
        self.effects["fetch_coach_meeting_graph_snapshot"].side_effect = lambda record: (copy.deepcopy(self.snapshot), None, 200)
        self.effects["persist_coach_meeting_snapshots"].return_value = {"stored": True}

    def start(self, patcher):
        result = patcher.start()
        self.addCleanup(patcher.stop)
        return result

    def request(self, portal, *, method="get", target=71, event_key="imported-review:901", content=False):
        request = getattr(RequestFactory(), method)("/artifacts/?refresh=1")
        extra = {"artifact_type": "recording", "artifact_id": "rec-1"} if content else {}
        if portal == "learner":
            view = calendar.learner_calendar_event_artifact_content if content else calendar.learner_calendar_event_artifacts
            return view(request, kind="apprenticeship", pk=target, event_key=event_key, **extra)
        view = employer_portal.employer_portal_review_artifact_content if content else employer_portal.employer_portal_review_artifacts
        return view(request, employer_id=91, kind="apprenticeship", learner_id=target, event_key=event_key, **extra)

    def assert_no_effects(self):
        for name, mocked in self.effects.items():
            self.assertEqual(mocked.call_count, 0, name)

    def test_bound_recordings_exclude_another_call_for_employer_and_playback(self):
        from coach_api.migrated_session_scope import SessionContext
        from learner_api.imported_meeting_resources import stored_recording

        self.account = SimpleNamespace(role='employer', subject_id=91)
        self.record.graph_event_id = 'graph-71'
        self.snapshot['artifacts'] = [
            {'artifact_type': 'recording', 'graph_artifact_id': artifact,
             'call_id': call, 'created_datetime': '2026-10-28T10:00:00Z',
             'end_datetime': '2026-10-28T10:30:00Z',
             'metadata': {'callId': call, '_lms_graph_event_id': 'graph-71'}}
            for artifact, call in (('rec-1', 'claimed-call'), ('rec-other', 'other-call'))
        ]
        with patch('coach_api.bound_actual_session.bound_session', return_value=SimpleNamespace(
                context=SessionContext('claimed-call', 'report-1', 'online-1', 1))), \
             patch('coach_api.views.build_coach_meeting_attendance_tracker', return_value={}):
            from coach_api.models import ImportedReviewInstance
            ImportedReviewInstance.objects.filter.return_value.__getitem__.return_value = [SimpleNamespace(pk=1)]
            result = self.request('employer')
            self.assertEqual(result.status_code, 200)
            self.assertEqual([row['graph_artifact_id'] for row in json.loads(result.content)['artifacts']], ['rec-1'])
            self.archive.reset_mock()
            denied = stored_recording(self.record, 'rec-other')
            self.assertEqual(denied.status_code, 404)
            self.archive.assert_not_called()

    def test_learner_get_is_stored_only_for_each_family_and_stage(self):
        self.check_families("learner")

    def test_employer_get_is_stored_only_for_each_family_and_stage(self):
        self.account = SimpleNamespace(role="employer", subject_id=91)
        self.check_families("employer")

    def check_families(self, portal):
        for family in ("MCM", "PR", "PR_SKILLS_RADAR", "PSP"):
            for status in ("not-scheduled", "scheduled", "in-progress", "awaiting-signature", "completed", "cancelled"):
                with self.subTest(portal=portal, family=family, status=status):
                    self.record._imported_review_event["reviewFamily"] = family
                    self.record.status = status
                    before = copy.deepcopy(vars(self.record))
                    response = self.request(portal)
                    self.assertEqual(response.status_code, 200)
                    body = json.loads(response.content)
                    self.assertEqual(body["artifacts"], [{**self.snapshot["artifacts"][0], "content_available": True}])
                    self.assertEqual(body["storage"], self.snapshot["storage"])
                    self.assertEqual(body["resourceMode"], "stored")
                    self.assertIsNone(body["meetingSummary"])
                    self.assertEqual("attendance" in body, portal == "learner")
                    self.assertEqual(response["Cache-Control"], "private, no-store")
                    self.assertEqual(vars(self.record), before)
                    self.assert_no_effects()

    def test_next_get_sees_resources_saved_by_coach_without_party_refresh(self):
        for portal in ("learner", "employer"):
            self.account = SimpleNamespace(role=portal, subject_id=71 if portal == "learner" else 91)
            self.snapshot["artifacts"] = []
            self.assertEqual(json.loads(self.request(portal).content)["artifacts"], [])
            self.snapshot["artifacts"] = [{"artifact_type": "recording", "graph_artifact_id": "new-recording"}]
            self.assertEqual(json.loads(self.request(portal).content)["artifacts"],
                             [{**self.snapshot["artifacts"][0], "content_available": True}])
        self.assert_no_effects()

    def test_saved_metadata_without_archived_video_is_explicitly_unavailable(self):
        self.archive.return_value = ""
        response = self.request("learner")
        artifact = json.loads(response.content)["artifacts"][0]
        self.assertEqual(artifact["graph_artifact_id"], "rec-1")
        self.assertFalse(artifact["content_available"])
        self.assert_no_effects()

    def test_missing_or_unreadable_storage_is_not_silently_refreshed(self):
        for partial in (False, True):
            self.snapshot.update(artifacts=[], partial=partial,
                                 errors=["Stored Teams artifacts could not be loaded."] if partial else [],
                                 storage={"stored": False, "reason": "snapshot_tables_missing"})
            response = self.request("learner")
            self.assertEqual(response.status_code, 207 if partial else 200)
            self.assertEqual(json.loads(response.content)["errors"], self.snapshot["errors"])
            self.assert_no_effects()

    def test_other_learner_is_rejected_before_read(self):
        self.assertEqual(self.request("learner", target=72).status_code, 404)
        self.reader.assert_not_called()
        self.stored.assert_not_called()
        self.assert_no_effects()

    def test_other_employer_and_unrelated_learner_are_rejected(self):
        self.account = SimpleNamespace(role="employer", subject_id=92)
        self.assertEqual(self.request("employer").status_code, 404)
        self.account.subject_id = 91
        self.learner.employer_id = 92
        self.assertEqual(self.request("employer").status_code, 403)
        self.stored.assert_not_called()
        self.assert_no_effects()

    def test_hidden_review_and_missing_meeting_are_rejected(self):
        self.account = SimpleNamespace(role="employer", subject_id=91)
        self.rows = []
        self.assertEqual(self.request("employer").status_code, 404)
        self.account = SimpleNamespace(role="learner", subject_id=71)
        self.reader.return_value = None
        self.assertEqual(self.request("learner").status_code, 404)
        self.stored.assert_not_called()
        self.assert_no_effects()

    def test_parties_and_staff_viewers_cannot_post_refresh(self):
        for portal in ("learner", "employer"):
            for role in (portal, "staff", "admin"):
                self.account = SimpleNamespace(role=role, subject_id=71 if portal == "learner" else 91)
                with self.subTest(portal=portal, role=role):
                    self.assertEqual(self.request(portal, method="post").status_code, 405)
                    self.assert_no_effects()
        self.stored.assert_not_called()

    def test_staff_view_get_remains_read_only(self):
        self.account = SimpleNamespace(role="admin", subject_id=999)
        for portal in ("learner", "employer"):
            self.assertEqual(self.request(portal).status_code, 200)
        self.assert_no_effects()

    def test_signed_out_reads_are_rejected(self):
        self.account = None
        for portal in ("learner", "employer"):
            self.assertEqual(self.request(portal).status_code, 401)
        self.stored.assert_not_called()
        self.assert_no_effects()

    def test_native_resource_flow_is_preserved(self):
        del self.record._imported_review_event
        for portal in ("learner", "employer"):
            self.account = SimpleNamespace(role=portal, subject_id=71 if portal == "learner" else 91)
            self.assertEqual(self.request(portal).status_code, 200)
        self.stored.assert_not_called()
        self.assertEqual(self.effects["fetch_coach_meeting_graph_snapshot"].call_count, 2)
        self.assertEqual(self.effects["persist_coach_meeting_snapshots"].call_count, 2)
        self.assertEqual(self.effects["apply_teams_attendance_status_transition"].call_count, 1)

    def test_imported_recording_content_uses_archive_without_graph_fallback(self):
        with patch("coach_api.recording_archive.archived_recording_url", return_value="https://storage.example.test/saved") as archive:
            for portal in ("learner", "employer"):
                self.account = SimpleNamespace(role=portal, subject_id=71 if portal == "learner" else 91)
                response = self.request(portal, content=True)
                self.assertEqual(response.status_code, 302)
                self.assertEqual(response["Location"], "https://storage.example.test/saved")
                archive.assert_called_with(self.record.event_key, "rec-1")
            archive.return_value = ""
            response = self.request("employer", content=True)
            self.assertEqual(response.status_code, 404)
            self.assertEqual(json.loads(response.content)["code"], "STORED_RECORDING_UNAVAILABLE")
        self.assert_no_effects()

    def test_imported_content_denials_do_not_query_archive_or_graph(self):
        with patch("coach_api.recording_archive.archived_recording_url") as archive:
            self.assertEqual(self.request("learner", target=72, content=True).status_code, 404)
            self.account = SimpleNamespace(role="employer", subject_id=92)
            self.assertEqual(self.request("employer", content=True).status_code, 404)
            self.account.subject_id = 91
            self.rows = []
            self.assertEqual(self.request("employer", content=True).status_code, 404)
            archive.assert_not_called()
        self.assert_no_effects()

    def test_actual_stored_reader_executes_selects_only(self):
        self.record.graph_event_id = "graph-71"
        self.stored.side_effect = STORED_SNAPSHOT
        cursor = MagicMock()
        cursor.fetchall.side_effect = [
            [("recording", "saved-71", "call-71", "", None, None, {}, None, "graph-71")], [], [],
        ]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(views, "connections", {"default": connection}), \
                patch.object(views.router, "db_for_read", return_value="default"), \
                patch.object(views, "coach_meeting_snapshot_tables_ready", return_value=True), \
                patch.object(views, "coach_meeting_expected_attendees", return_value=[]):
            response = self.request("learner")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(json.loads(response.content)["artifacts"][0]["graph_artifact_id"], "saved-71")
        self.assertEqual(cursor.execute.call_count, 3)
        for call in cursor.execute.call_args_list:
            self.assertTrue(call.args[0].lstrip().startswith("SELECT"))
            self.assertEqual(call.args[1][0], self.record.event_key)
        self.assert_no_effects()

    def test_real_resolver_marks_canonical_legacy_and_reconciled_imports(self):
        self.reader.side_effect = LEARNER_RECORD
        self.learner.email = "learner@example.test"
        self.model.all_learners.filter.return_value.first.return_value = self.learner
        profile = SimpleNamespace(id=800, email=self.learner.email)
        self.record.learner_id = 800
        self.record.review_instance_id = None
        self.record.review_template_id = None
        self.record.event_type = "progress-review"
        with patch.object(calendar, "SOURCE_MODELS", {"apprenticeship": self.model, "commercial": self.model}), \
                patch.object(calendar, "_calendar_profile", return_value=profile), \
                patch.object(calendar, "source_for_learner", return_value=SimpleNamespace(kind="aptem")), \
                patch.object(calendar, "review_profile_for_source", return_value=profile), \
                patch.object(calendar, "coaching_events_for_learner") as events, \
                patch.object(calendar.CoachCalendarEvent.objects, "filter") as query, \
                patch("coach_api.reconciliation_links.for_calendar") as reconcile:
            query.return_value.first.return_value = self.record
            for key, linked in (("imported-review:901", False), ("learner-book:legacy", False), ("review:native-reconciled", True)):
                for kind in ("commercial", "apprenticeship"):
                    with self.subTest(key=key, kind=kind):
                        self.record.event_key = key
                        self.record.__dict__.pop("_imported_review_event", None)
                        events.return_value = [{"reviewSource": "aptem", "reviewId": "901", "aptemReviewId": "external-901",
                                                "eventKey": "imported-review:901", "calendarEventKey": key}]
                        reconcile.return_value = SimpleNamespace(source_review_id=901, aptem_review_id="external-901") if linked else None
                        response = calendar.learner_calendar_event_artifacts(
                            RequestFactory().get("/artifacts/"), kind=kind, pk=71, event_key=key)
                        self.assertEqual(response.status_code, 200)
                        self.assertEqual(json.loads(response.content)["resourceMode"], "stored")
                        self.assert_no_effects()
            self.record.__dict__.pop("_imported_review_event", None)
            events.return_value = []
            response = self.request("learner", event_key=self.record.event_key)
            self.assertEqual(response.status_code, 404)
            self.assert_no_effects()
