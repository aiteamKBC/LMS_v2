"""Recording availability and mutation boundaries, with synthetic owned data."""
import inspect
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.db import DatabaseError
from django.test import RequestFactory, SimpleTestCase

from . import live_session_access as access


NOW = datetime(2026, 11, 17, 12, tzinfo=timezone.utc)
SESSION = {'id': 'O1', 'live_session_id': 'S1', 'session_number': 1,
           'scheduled_start': NOW - timedelta(hours=3), 'scheduled_end': NOW - timedelta(hours=1),
           'status': 'scheduled', 'session_status': 'scheduled'}
COMPONENT = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'live_session',
             'teamsLiveSessionId': 'S1', 'teamsOccurrenceId': 'O1', 'teamsSessionNumber': 1}


class LiveSessionAccessTests(SimpleTestCase):
    def setUp(self):
        self.profile = SimpleNamespace(id=248, pk=248, enrolment_id=7)
        self.enterContext(patch(
            'learner_api.identity.learner_profile_for_source', return_value=self.profile,
        ))
        self.enterContext(patch(
            'learner_api.learning_plan.install_canonical_training_plan_module_ids',
            side_effect=lambda source, _profile: (
                setattr(source, '_canonical_training_plan', [{'moduleId': 'M1'}])
                or source._canonical_training_plan
            ),
        ))

    def test_future_current_missing_and_cancelled_never_open_even_with_a_recording(self):
        for row, status in [
            (None, 'unlinked'),
            ({**SESSION, 'scheduled_start': NOW + timedelta(days=1)}, 'upcoming'),
            ({**SESSION, 'scheduled_end': NOW + timedelta(hours=1)}, 'in_progress'),
            ({**SESSION, 'status': 'cancelled'}, 'cancelled'),
            ({**SESSION, 'scheduled_end': None}, 'unlinked'),
            ({**SESSION, 'scheduled_end': SESSION['scheduled_start']}, 'unlinked'),
        ]:
            with self.subTest(status=status):
                state = access.session_access(row, {'ready': True}, now=NOW)
                self.assertFalse(state['open'])
                self.assertEqual(state['status'], status)

    def test_ended_session_requires_ready_recording_not_watch_or_completion(self):
        for evidence in (None, {}, {'ready': False, 'completed': True}):
            self.assertEqual(access.session_access(SESSION, evidence, now=NOW)['status'], 'awaiting_recording')
        self.assertTrue(access.session_access(SESSION, {'ready': True, 'completed': False}, now=NOW)['open'])

    def test_batched_projection_uses_exact_occurrences_and_keeps_join_and_history(self):
        components = [{**COMPONENT, 'liveSessionUrl': 'https://example.test/join', 'attendanceCompleted': True},
                      {**COMPONENT, 'componentId': 'C2', 'teamsOccurrenceId': 'O2'},
                      {'componentId': 'R1', 'type': 'reading'}]
        for kind in ('commercial', 'apprenticeship'):
            with self.subTest(kind=kind), patch.object(access, '_read', return_value=[SESSION]), \
                    patch.object(access.timezone, 'now', return_value=NOW), \
                    patch('curriculum_api.recording_views.recording_completion_evidence', return_value={'O1': {'ready': True}}) as evidence:
                result = access.annotate_access(SimpleNamespace(pk=7, learner_type=kind), components)
            evidence.assert_called_once_with(kind, 7, ['O1'])
            self.assertTrue(result[0]['liveSessionAccess']['open'])
            self.assertEqual(result[0]['liveSessionUrl'], components[0]['liveSessionUrl'])
            self.assertTrue(result[0]['attendanceCompleted'])
            self.assertFalse(result[1]['liveSessionAccess']['open'])
            self.assertIs(result[2], components[2])
            self.assertNotIn('liveSessionAccess', components[0])

    def test_ambiguous_or_unlinked_activity_cannot_use_another_recording(self):
        rows = [SESSION, {**SESSION, 'id': 'O2'}]
        component = {**COMPONENT, 'teamsOccurrenceId': None}
        with patch.object(access, '_read', return_value=rows), \
                patch('curriculum_api.recording_views.recording_completion_evidence') as evidence:
            result = access.annotate_access(SimpleNamespace(pk=7), [component])
        self.assertFalse(result[0]['liveSessionAccess']['open'])
        evidence.assert_not_called()

    def test_legacy_date_matching_stays_within_the_module_and_refuses_ambiguity(self):
        component = {'componentId': 'C1', 'moduleId': 'M1', 'type': 'live_session', 'sessionDate': '2026-11-17'}
        own = {**SESSION, 'module_catalogue_id': 'M1'}
        other = {**SESSION, 'id': 'OTHER', 'module_catalogue_id': 'M2'}
        for rows, blocked, ready in (([own, other], False, True), ([other], False, False),
                                     ([own, {**own, 'id': 'O2'}], False, False), ([own], True, False)):
            with self.subTest(blocked=blocked, rows=len(rows)), patch.object(access, '_read', return_value=rows), \
                    patch.object(access.timezone, 'now', return_value=NOW), \
                    patch('curriculum_api.recording_views.recording_completion_evidence', return_value={'O1': {'ready': True}}):
                row = access.annotate_access(SimpleNamespace(pk=7), [{**component, '_liveSessionBindingBlocked': blocked}])[0]
            self.assertEqual(row['liveSessionAccess']['open'], ready)
            self.assertNotIn('_liveSessionBindingBlocked', row)

    def test_write_guard_checks_assignment_visibility_and_authored_type(self):
        source = SimpleNamespace(pk=7)
        with patch.object(access, '_read', return_value=[{'type': 'live_session', 'module_catalogue_id': 'M1'}]), \
                patch('learner_api.learning_plan.effective_training_plan', return_value=[]) as plan, \
                patch('learner_api.learner_detail._resolve_from_master') as resolve:
            self.assertEqual(access.access_refusal('commercial', 7, 'C1', source=source).status_code, 403)
            plan.assert_called_once_with(source)
            resolve.assert_not_called()
        with patch.object(access, '_read', side_effect=DatabaseError('private failure')):
            response = access.access_refusal('commercial', 7, 'C1', source=source)
        self.assertEqual(response.status_code, 503)
        self.assertNotIn(b'private failure', response.content)

    def test_assigned_activity_guard_allows_only_ready_recording(self):
        for ready in (False, True):
            with self.subTest(ready=ready), \
                    patch.object(access, '_read', return_value=[{'type': 'live_session', 'module_catalogue_id': 'M1'}]), \
                    patch('learner_api.learning_plan.effective_training_plan', return_value=[{'moduleId': 'M1'}]), \
                    patch('learner_api.learner_detail._resolve_from_master', return_value=([], [], [COMPONENT])), \
                    patch.object(access, 'annotate_access', return_value=[{'liveSessionAccess': access.session_access(SESSION, {'ready': ready}, now=NOW)}]):
                result = access.access_refusal('commercial', 7, 'C1', source=SimpleNamespace(pk=7))
            if ready:
                self.assertIsNone(result)
            else:
                self.assertEqual(result.status_code, 409)
                self.assertEqual(json.loads(result.content)['code'], 'live_session_locked')

    def test_non_live_components_keep_existing_rules(self):
        with patch.object(access, '_read') as read:
            self.assertIsNone(access.access_refusal('commercial', 7, 'R1', component_type='reading'))
        read.assert_not_called()

    def test_timer_lookup_uses_the_correct_learner_kind_manager(self):
        for kind, model in (('commercial', 'CommercialUser'), ('apprenticeship', 'EnrolmentUser')):
            with self.subTest(kind=kind), \
                    patch.object(access, '_read', return_value=[{'type': 'live_session', 'module_catalogue_id': 'M1'}]), \
                    patch(f'learner_api.models.{model}.objects') as manager, \
                    patch('learner_api.learning_plan.effective_training_plan', return_value=[]):
                manager.filter.return_value.first.return_value = SimpleNamespace(pk=7, learner_type=kind)
                result = access.access_refusal(kind, '7', 'C1')
                self.assertEqual(result.status_code, 403)
                manager.filter.assert_called_once_with(pk='7')

    def test_compact_activity_stays_viewable_while_time_entry_is_locked(self):
        from .weekly_learning import _weekly_component
        for ready in (False, True):
            state = access.session_access(SESSION, {'ready': ready}, now=NOW)
            row = _weekly_component({**COMPONENT, 'liveSessionAccess': state, 'attendanceCompleted': True})
            self.assertEqual(row['liveSessionAccess'], state)
            self.assertTrue(row['contentAvailable'])

    def test_timers_and_reflection_drafts_refuse_before_writes_even_with_spoofed_type(self):
        from .time_tracking import start_time_tracking, checkpoint_time_tracking
        from .reflection_submissions import _submit_reflection
        from django.http import JsonResponse
        cases = [
            (start_time_tracking, {'activityKind': 'video', 'activityId': 'C1'}, 'learner_api.time_tracking.issue_tracking_session'),
            (checkpoint_time_tracking, {'activityKind': 'video', 'activityId': 'C1'}, 'learner_api.timing_drafts.checkpoint'),
            (_submit_reflection, {'learnerKind': 'commercial', 'learnerId': '7', 'activityId': 'C1',
                                 'activityType': 'reading', 'submissionMode': 'draft',
                                 'additionalReflectionSeconds': 60}, 'learner_api.reflection_submissions._reflection_lineage'),
        ]
        for endpoint, payload, writer in cases:
            with self.subTest(endpoint=endpoint.__name__), \
                    patch.object(access, 'access_refusal', return_value=JsonResponse({'code': 'live_session_locked'}, status=409)) as gate, \
                    patch(writer) as write:
                request = RequestFactory().post('/?kind=commercial&learnerId=7', json.dumps(payload), content_type='application/json')
                response = inspect.unwrap(endpoint)(request)
            self.assertEqual(response.status_code, 409)
            gate.assert_called_once_with('commercial', '7', 'C1')
            write.assert_not_called()

    def test_generic_and_video_completion_cannot_bypass_the_gate(self):
        from . import components, videos
        from django.http import JsonResponse
        from unittest.mock import MagicMock
        for module, endpoint in ((components, components.submit_component_progress), (videos, videos.submit_video_progress)):
            model = MagicMock()
            model.DoesNotExist = type('MissingLearner', (Exception,), {})
            source = model.objects.get.return_value
            with self.subTest(endpoint=endpoint.__name__), \
                    patch.object(module, 'SOURCE_MODELS', {'commercial': model}), \
                    patch.object(module, 'component_ksb_codes', return_value=[]), \
                    patch.object(module, 'resolve_completion_instants', return_value=(NOW, '')), \
                    patch.object(components, '_component_meta', return_value=('live_session', 'Lecture')), \
                    patch.object(access, 'access_refusal', return_value=JsonResponse({'code': 'live_session_locked'}, status=409)) as gate, \
                    patch.object(module, 'sync_active_user') as sync, \
                    patch.object(module, 'learner_profile_for_source') as profile:
                request = RequestFactory().post('/?kind=commercial&learnerId=7', json.dumps({
                    'componentType': 'reading', 'videoTitle': 'Spoofed', 'timeTakenSeconds': 9000,
                }), content_type='application/json')
                response = inspect.unwrap(endpoint)(request, 'C1')
            self.assertEqual(response.status_code, 409)
            self.assertEqual(gate.call_args.args, ('commercial', '7', 'C1'))
            self.assertIs(gate.call_args.kwargs['source'], source)
            profile.assert_not_called()
            sync.assert_not_called()
