"""Selected activity time stays consistent without writing learner data."""
import json
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import components, videos
from .active_users import completed_hours_value_from_progress
from .current_learning import project_current
from .time_tracking import issue_tracking_session


class SelectedActivityTimeTests(SimpleTestCase):
    def submit(self, *, media="component", kind="apprenticeship", selected=2400,
               source="input", session_seconds=300, reported="14 hours",
               component_type="reading", used=False, token_owner="19", planned=None):
        endpoint = videos if media == "video" else components
        now = datetime(2026, 1, 15, 12, tzinfo=timezone.utc)
        session = issue_tracking_session(
            activity_kind=media, activity_id="COMP-TIME", learner_kind=kind,
            learner_id=token_owner, counting_mode="active_playback" if media == "video" else "visible_page",
            issued_at=now - timedelta(seconds=session_seconds),
        )
        request = RequestFactory().post(
            f"/learner_api/{media}/COMP-TIME/complete/?kind={kind}&learnerId=19",
            data=json.dumps({"trackingToken": session["trackingToken"], "timeTakenSeconds": selected,
                "timeEntrySource": source, "reportedTime": reported, "videoTitle": "Synthetic video",
                **({"plannedOtjh": planned} if planned is not None else {})}),
            content_type="application/json",
        )
        view = endpoint.submit_video_progress if media == "video" else endpoint.submit_component_progress
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        model = Mock()
        model.objects.get.return_value = SimpleNamespace(id=19)
        profile = SimpleNamespace(training_plan_progress=[])
        with ExitStack() as stack:
            def mock(name, **kwargs):
                return stack.enter_context(patch.object(endpoint, name, **kwargs))
            mock("SOURCE_MODELS", new={kind: model})
            mock("learner_profile_for_source", return_value=profile)
            mock("component_ksb_codes", return_value=["K1"])
            mock("tracking_session_already_used", return_value=used)
            save = mock("save_progress_record")
            queue = None
            if media == "component":
                mock("_component_meta", return_value=(component_type, "Synthetic activity"))
                mock("_completion_criteria", return_value=(True, None))
                mock("requires_tutor_validation", return_value=True)
                queue = mock("queue_for_marking")
            stack.enter_context(patch.object(endpoint.timezone, "now", return_value=now))
            stack.enter_context(patch("learner_api.working_rules.learner_holiday_details", return_value={}))
            response = view(request, "COMP-TIME")
        return response, save, queue

    def assert_selected_duration(self, response, save, selected, verified):
        self.assertEqual(response.status_code, 200, response.content)
        record = json.loads(response.content)["record"]
        minutes, seconds = divmod(selected, 60)
        self.assertEqual(record["timeTaken"], f"{minutes:02d}:{seconds:02d}")
        self.assertEqual(record["claimedSeconds"], selected)
        self.assertEqual(record["verifiedSeconds"], verified)
        self.assertEqual(record["timeTrackingCalculation"], "min(client_active_seconds, signed_server_session_seconds)")
        save.assert_called_once()
        self.assertEqual(save.call_args.args[1], record)
        self.assertEqual(save.call_args.args[2]["detail"], record["reportedTime"])
        self.assertAlmostEqual(completed_hours_value_from_progress([record]) * 3600, selected)
        # The dashboard/OTJ adapter consumes snake_case ORM rows after reload.
        row = dict(id=1, component_ref="COMP-TIME", component_link_source="direct", kind=record["kind"],
            component_type=record.get("componentType", "video"), submitted_at=record["submittedAt"],
            reported_time=record["reportedTime"], claimed_seconds=record["claimedSeconds"],
            verified_seconds=record["verifiedSeconds"], time_tracking_source=record["timeTrackingSource"],
            expected_otjh=14)
        self.assertAlmostEqual(project_current([row], {})[0]["actual_seconds"], selected)
        return record

    def test_input_choice_is_not_capped_to_the_timer_or_replaced_by_planned_hours(self):
        for media in ("video", "component"):
            for kind in ("apprenticeship", "commercial"):
                with self.subTest(media=media, kind=kind):
                    response, save, queue = self.submit(media=media, kind=kind)
                    record = self.assert_selected_duration(response, save, 2400, 300)
                    self.assertTrue(record["timeTrackingSource"].endswith(":input"))
                    if queue:
                        self.assertEqual(queue.call_args.kwargs["context"]["actualTimeHours"], 2400 / 3600)
                        self.assertEqual(queue.call_args.kwargs["context"]["plannedOtjh"], "14 hours")

    def test_timer_choice_wins_over_a_different_reported_or_planned_time(self):
        for media in ("video", "component"):
            with self.subTest(media=media):
                response, save, _ = self.submit(media=media, source="timer", selected=300, reported="40 minutes")
                record = self.assert_selected_duration(response, save, 300, 300)
                self.assertTrue(record["timeTrackingSource"].endswith(":timer"))

    def test_seconds_zero_and_more_than_an_hour_keep_their_units(self):
        for media in ("video", "component"):
            for source, selected in (("timer", 0), ("timer", 317), ("input", 5400)):
                with self.subTest(media=media, source=source, selected=selected):
                    response, save, _ = self.submit(media=media, source=source, selected=selected, session_seconds=6000)
                    self.assert_selected_duration(response, save, selected, selected)

    def test_resumed_timer_keeps_selected_time_and_separate_session_evidence(self):
        response, save, _ = self.submit(source="timer", selected=317, session_seconds=60)
        self.assert_selected_duration(response, save, 317, 60)

    def test_audio_slides_and_reading_share_the_selected_duration(self):
        for component_type in ("podcast", "audio", "reading", "powerpoint"):
            with self.subTest(component_type=component_type):
                response, save, _ = self.submit(component_type=component_type)
                self.assert_selected_duration(response, save, 2400, 300)

    def test_other_learner_token_and_reused_session_cannot_write(self):
        for media in ("video", "component"):
            for options, status in (({"token_owner": "20"}, 400), ({"used": True}, 409)):
                with self.subTest(media=media, options=options):
                    response, save, queue = self.submit(media=media, **options)
                    self.assertEqual(response.status_code, status)
                    save.assert_not_called()
                    if queue:
                        queue.assert_not_called()

    def test_invalid_selected_duration_cannot_write(self):
        for media in ("video", "component"):
            for value in (-1, "invalid", None):
                with self.subTest(media=media, value=value):
                    response, save, _ = self.submit(media=media, selected=value)
                    self.assertEqual(response.status_code, 400)
                    save.assert_not_called()

    def test_existing_records_are_unchanged_when_new_hours_are_added(self):
        legacy = dict(kind="component", componentId="OLD", reportedTime="2 hours", timeTaken="00:05")
        before = deepcopy(legacy)
        response, _, _ = self.submit()
        record = json.loads(response.content)["record"]
        self.assertAlmostEqual(completed_hours_value_from_progress([legacy, record]), 2 + 2400 / 3600)
        self.assertEqual(legacy, before)

    def test_marking_receives_separate_planned_and_selected_actual_time(self):
        response, save, queue = self.submit(reported="40 minutes", planned="14h")
        self.assert_selected_duration(response, save, 2400, 300)
        self.assertEqual(queue.call_args.kwargs["context"]["plannedOtjh"], "14h")
        self.assertEqual(queue.call_args.kwargs["context"]["actualTimeHours"], 2400 / 3600)
