"""Selected activity time stays consistent without writing learner data."""
import json
from contextlib import ExitStack
from copy import deepcopy
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase

from . import components, videos, quizzes
from .active_users import completed_hours_value_from_progress
from .current_learning import project_current
from .time_tracking import issue_tracking_session


class SelectedActivityTimeTests(SimpleTestCase):
    def submit(self, *, media="component", kind="apprenticeship", selected=2400,
               source="input", session_seconds=300, reported="14 hours",
               component_type="reading", used=False, token_owner="19", planned=None, history=None, decision=None, previous=None):
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
                **({"plannedOtjh": planned} if planned is not None else {}),
                **({'retakeTimeChoice': decision, 'retakeTimeReason': 'Correcting a mistaken time.'} if decision else {}),
                **({'retakePreviousSeconds': previous} if previous is not None else {})}),
            content_type="application/json",
        )
        view = endpoint.submit_video_progress if media == "video" else endpoint.submit_component_progress
        while hasattr(view, "__wrapped__"):
            view = view.__wrapped__
        model = Mock()
        model.objects.get.return_value = SimpleNamespace(id=19)
        profile = SimpleNamespace(training_plan_progress=history or [])
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

    def test_assignment_completion_uses_saved_input_for_progress_and_marking(self):
        for kind in ("commercial", "apprenticeship"):
            for hours in ("1", "0.1", "0.25", "3.5"):
                with self.subTest(kind=kind, hours=hours), ExitStack() as stack:
                    stack.enter_context(patch("learner_api.assignment_settings.monthly_assignment_required", return_value=True))
                    stack.enter_context(patch.object(components, "_assignment_form_ready", return_value=True))
                    connection = stack.enter_context(patch("learner_api.monthly_assignment.connections"))
                    stack.enter_context(patch("learner_api.monthly_assignment.transaction.atomic"))
                    stack.enter_context(patch("learner_api.monthly_assignment.assignment_checks", return_value=[{"passed": True}]))
                    stack.enter_context(patch("learner_api.reflection_submissions._reflection_lineage", return_value={"progress_entry_id": 123}))
                    cursor = connection.__getitem__.return_value.cursor.return_value.__enter__.return_value
                    cursor.fetchone.return_value = ("saved", "draft", {
                        "actualTimeHours": hours, "plannedOtjh": "2",
                        "monthlyAssignment": {"claims": [{"code": "K1"}],
                            "timeEntries": [{"topic": "Research", "date": "2026-01-15", "hours": hours}]},
                    })
                    response, save, queue = self.submit(kind=kind, component_type="assignment",
                        selected=720, source="timer", session_seconds=720, planned="2 hours")
                    seconds = round(float(hours) * 3600)
                    record = self.assert_selected_duration(response, save, seconds, 720)
                    self.assertTrue(record["timeTrackingSource"].endswith(":input"))
                    self.assertEqual(queue.call_args.kwargs["context"]["actualTimeHours"], float(hours))
                    self.assertEqual(queue.call_args.kwargs["context"]["plannedOtjh"], "2 hours")
                    saved_payload = json.loads(cursor.execute.call_args.args[1][0])
                    self.assertEqual(saved_payload["plannedOtjh"], "2")
                    self.assertEqual(saved_payload["actualTimeHours"], hours)

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

    def test_saved_timer_choice_ignores_stale_reflection_duration(self):
        for selected, verified in ((129, 129), (317, 60), (0, 0)):
            with self.subTest(selected=selected, verified=verified):
                record = dict(kind="component", componentId="C1", reportedTime="50h",
                    claimedSeconds=selected, verifiedSeconds=verified,
                    timeTrackingSource="signed_session_capped_visible_page:timer")
                before = deepcopy(record)
                self.assertAlmostEqual(completed_hours_value_from_progress([record]) * 3600, selected)
                row = dict(id=1, kind="component", component_ref="C1", component_type="powerpoint",
                    component_link_source="direct", submitted_at="2026-10-01T12:00:00Z",
                    reported_time="50h", claimed_seconds=selected, verified_seconds=verified,
                    time_tracking_source=record['timeTrackingSource'])
                projected = project_current([row], {})[0]
                self.assertAlmostEqual(projected['actual_seconds'], selected)
                self.assertTrue(projected['completed'])
                self.assertEqual(record, before)
                # Persisted/approved ledger time is not an unsynchronised save.
                approved = {**row, 'actual_seconds': 900, 'accepted': True}
                self.assertEqual(project_current([approved], {})[0]['actual_seconds'], 900)

    def test_attempt_deduplication_compares_selected_timer_time(self):
        record = dict(kind="component", componentId="C1", claimedSeconds=120,
            verifiedSeconds=120, reportedTime="50h",
            timeTrackingSource="signed_session_capped_visible_page:timer")
        later = {**record, 'claimedSeconds': 300, 'verifiedSeconds': 300, 'reportedTime': '5 minutes'}
        self.assertAlmostEqual(completed_hours_value_from_progress([record, later]) * 3600, 300)

    def test_manual_declarations_and_unclassified_history_are_preserved(self):
        for source in ('signed_session_capped_visible_page:input', '', 'historical_import'):
            with self.subTest(source=source):
                record = dict(kind="component", componentId="C1", reportedTime="30 hours",
                    claimedSeconds=108000 if source.endswith(':input') else 60,
                    verifiedSeconds=60, timeTrackingSource=source)
                self.assertEqual(completed_hours_value_from_progress([record]), 30)

    def test_marking_receives_separate_planned_and_selected_actual_time(self):
        response, save, queue = self.submit(reported="40 minutes", planned="14h")
        self.assert_selected_duration(response, save, 2400, 300)
        self.assertEqual(queue.call_args.kwargs["context"]["plannedOtjh"], "14h")
        self.assertEqual(queue.call_args.kwargs["context"]["actualTimeHours"], 2400 / 3600)

    def test_three_explicit_decisions_keep_evidence_and_server_owned_totals(self):
        for media in ('video', 'component'):
            for kind in ('commercial', 'apprenticeship'):
                for mode, expected in (('correct', 1200), ('add', 4800), ('retry', 3600)):
                    with self.subTest(media=media, kind=kind, mode=mode):
                        history = [{'kind': media, 'componentId': 'COMP-TIME', 'claimedSeconds': 3600,
                                    'verifiedSeconds': 10, 'timeTrackingSource': 'signed:input', 'submittedAt': '2026-01-14T12:00:00Z'}]
                        response, save, _ = self.submit(media=media, kind=kind, selected=1200, decision=mode, previous=3600, history=history)
                        self.assertEqual(response.status_code, 200, response.content)
                        record = json.loads(response.content)['record']
                        self.assertEqual(record['countedSeconds'], expected)
                        self.assertEqual(record['claimedSeconds'], 1200)
                        self.assertEqual(record['verifiedSeconds'], 300)
                        self.assertEqual(history[0]['claimedSeconds'], 3600)
                        save.assert_called_once()

    def test_addition_above_eight_hours_cannot_save_and_a_smaller_retry_can(self):
        for media in ('video', 'component'):
            history = [{'kind': media, 'componentId': 'COMP-TIME', 'claimedSeconds': 21600,
                        'timeTrackingSource': 'signed:input', 'submittedAt': '2026-01-14T12:00:00Z'}]
            response, save, _ = self.submit(media=media, selected=10800, decision='add', previous=21600, history=history)
            self.assertEqual(response.status_code, 400)
            self.assertIn('9 hours', json.loads(response.content)['error'])
            self.assertIn('try again', json.loads(response.content)['error'])
            save.assert_not_called()
            response, save, _ = self.submit(media=media, selected=7200, decision='add', previous=21600, history=history)
            self.assertEqual(json.loads(response.content)['record']['countedSeconds'], 28800)
            save.assert_called_once()

    def test_hard_limit_and_stale_previous_time_cannot_write(self):
        response, save, _ = self.submit(selected=28801)
        self.assertEqual(response.status_code, 400); save.assert_not_called()
        history = [{'kind': 'component', 'componentId': 'COMP-TIME', 'claimedSeconds': 3600, 'timeTrackingSource': 'signed:input'}]
        response, save, _ = self.submit(decision='add', previous=1200, history=history)
        self.assertEqual(response.status_code, 400); save.assert_not_called()

    def test_failed_explicit_quiz_retry_cannot_replace_successful_raw_hours(self):
        old = {'kind': 'quiz', 'quizId': '77', 'passed': True, 'claimedSeconds': 3600,
               'timeTrackingSource': 'signed:input', 'submittedAt': '2026-01-14T12:00:00Z'}
        for mode in ('correct', 'add', 'retry'):
            failed = {**old, 'claimedSeconds': 7200, 'passed': False, 'retakeTimeChoice': mode,
                      'submittedAt': '2026-01-15T12:00:00Z'}
            self.assertEqual(completed_hours_value_from_progress([old, failed]), 1)


class QuizActivityTimeTests(SimpleTestCase):
    QUIZ_ID = 77

    def submit(self, *, kind='commercial', current=1200, previous=3600, mode='add', source='input', answers=None):
        from .tests import QuizSubmitWorkingRulesTests
        now = datetime(2026, 1, 15, 12, tzinfo=timezone.utc)
        token = issue_tracking_session(activity_kind='quiz', activity_id=77, learner_kind=kind,
            learner_id='19', counting_mode='active_quiz', issued_at=now - timedelta(seconds=20))
        payload = {'trackingToken': token['trackingToken'], 'timeTakenSeconds': current,
            'timeEntrySource': source, 'answers': answers or {'1': 10}, 'retakeTimeChoice': mode,
            'retakeTimeReason': 'Correcting a synthetic entry.', 'retakePreviousSeconds': previous}
        request = RequestFactory().post(f'/learner_api/quizzes/77/submit/?kind={kind}&learnerId=19',
            data=json.dumps(payload), content_type='application/json')
        model = Mock(); model.objects.get.return_value = SimpleNamespace(id=19)
        history = [{'kind': 'quiz', 'quizId': '77', 'passed': True, 'claimedSeconds': previous,
            'timeTrackingSource': 'signed:input', 'submittedAt': '2026-01-14T12:00:00Z'}]
        view = quizzes.submit_quiz_attempt
        while hasattr(view, '__wrapped__'): view = view.__wrapped__
        with ExitStack() as stack:
            stack.enter_context(patch('socket.socket', side_effect=AssertionError('Network forbidden')))
            for name, value in {'SOURCE_MODELS': {kind: model}, '_fetch_quiz': QuizSubmitWorkingRulesTests._quiz(self),
                    'learner_profile_for_source': SimpleNamespace(training_plan_progress=history),
                    'tracking_session_already_used': False}.items():
                stack.enter_context(patch.object(quizzes, name, new=value) if name == 'SOURCE_MODELS'
                                    else patch.object(quizzes, name, return_value=value))
            save = stack.enter_context(patch.object(quizzes, 'save_progress_record'))
            audit = stack.enter_context(patch.object(quizzes, 'record_quiz_attempt'))
            stack.enter_context(patch.object(quizzes.timezone, 'now', return_value=now))
            stack.enter_context(patch('learner_api.working_rules.learner_holiday_details', return_value={}))
            response = view(request, 77)
        return response, save, audit

    def test_decisions_use_selected_time_and_preserve_scores_and_verified_time(self):
        for kind in ('commercial', 'apprenticeship'):
            for source in ('input', 'timer'):
                for mode, expected in (('correct', 1200), ('add', 4800), ('retry', 3600)):
                    with self.subTest(kind=kind, source=source, mode=mode):
                        response, save, audit = self.submit(kind=kind, mode=mode, source=source)
                        self.assertEqual(response.status_code, 200, response.content)
                        data = json.loads(response.content)
                        self.assertTrue(data['passed']); self.assertEqual(data['achievedScore'], 1)
                        self.assertEqual(data['attempt']['countedSeconds'], expected)
                        self.assertEqual(data['attempt']['claimedSeconds'], 1200)
                        self.assertEqual(data['attempt']['verifiedSeconds'], 20)
                        save.assert_called_once(); audit.assert_called_once()

    def test_over_limit_attempt_writes_nothing_and_smaller_addition_can_save(self):
        for current, expected_status in ((10800, 400), (7200, 200)):
            response, save, audit = self.submit(previous=21600, current=current)
            self.assertEqual(response.status_code, expected_status, response.content)
            if current == 10800:
                self.assertIn('9 hours', json.loads(response.content)['error'])
                save.assert_not_called(); audit.assert_not_called()
            else:
                self.assertEqual(json.loads(response.content)['attempt']['countedSeconds'], 28800)
                save.assert_called_once(); audit.assert_called_once()

    def test_failed_attempt_response_keeps_the_successful_total_for_the_next_retry(self):
        for mode in ('correct', 'add', 'retry'):
            response, save, audit = self.submit(mode=mode, current=7200, answers={'1': 11})
            self.assertEqual(response.status_code, 200, response.content)
            data = json.loads(response.content)
            self.assertFalse(data['passed'])
            self.assertEqual(data['attempt']['countedSeconds'], 3600)
            self.assertEqual(data['attempt']['claimedSeconds'], 7200)
            save.assert_called_once(); audit.assert_called_once()
