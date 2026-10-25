"""Imported Check Session resource contract; synthetic providers and storage boundary."""
from contextlib import ExitStack, nullcontext
from copy import deepcopy
from datetime import date, datetime, time, timezone as utc
from io import BytesIO
import inspect
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch
from urllib.error import HTTPError

from django.test import RequestFactory, SimpleTestCase, override_settings
from coach_api import migrated_intelligence_views as action, views

NOW = datetime(2026, 10, 25, 12, tzinfo=utc.utc)
BASE = 'users/synthetic-organizer/onlineMeetings/synthetic-meeting'
KEY = 'imported-review:synthetic-audit-pr'
EXPECTED = [{'id': 'learner', 'role': 'learner', 'email': 'learner@example.invalid', 'displayName': 'Synthetic'}]

def provider_error(code):
    error = RuntimeError('Synthetic resource failure')
    error.__cause__ = HTTPError('https://example.invalid', code, 'synthetic', {'Retry-After': '12'}, BytesIO(b''))
    return error


@override_settings(TIME_ZONE='Europe/London')
class CheckSessionResourceTests(SimpleTestCase):
    def setUp(self):
        self.record = SimpleNamespace(pk=9, id=9, event_key=KEY, owner_email='coach@example.invalid', learner_id=42,
            learner_name='Synthetic', event_type='progress-review', status='in-progress', sync_state='synced',
            graph_event_id='graph-audit', graph_organizer_email='coach@example.invalid',
            meeting_link='https://example.invalid/teams', graph_web_link='', review_instance_id='', review_template_id='',
            scheduled_date=date(2026,10,25), scheduled_time=time(11), duration_minutes=120, save=Mock())
        self.overlay = SimpleNamespace(pk=3, event_key=KEY, owner_email=self.record.owner_email, learner_id=42,
            source_review_id=7, status='in-progress', completed_at=None, answers={}, meeting_intelligence={},
            updated_at=NOW, save=Mock(), migrated_signatures=Mock(),
            template_snapshot={'family':'PR', 'sections':[{'key':'meeting','title':'Meeting','order':0,'fields':[
                {'key':'summary','title':'Summary','order':0,'aptemType':13,'semanticKey':'meeting_summary'}]}]})
        self.overlay.migrated_signatures.exists.return_value=False
        self.definition = {'template':{'reviewTypeCode':'aptem_progress_review'},'instance':{'targetDate':'2027-03-30'}}
        self.stored={'artifacts':[],'attendanceReports':[],'attendanceTracker':{},'attendance':{'expectedAttendees':EXPECTED},
                     'storage':{'stored':True},'partial':False,'errors':[]}
        self.collections={kind:{'value':[]} for kind in ('attendanceReports','transcripts','recordings')}
        self.details={}; self.bodies={}; self.paths=[]; self.writes=[]; self.target_failure=None; self.ai_hook=None
        self.transcript_reads=[]; self.archive_url=''

    def add_artifact(self, kind='transcript', key='t1', *, call='one', body='Opening and agreed actions', **times):
        raw={'id':key,'callId':call,'createdDateTime':'2026-10-25T11:10:00Z','endDateTime':'2026-10-25T11:40:00Z',**times}
        self.collections[kind+'s']['value'].append(raw)
        self.bodies[key]=body

    def add_report(self, key='r1', **times):
        raw={'id':key,'meetingStartDateTime':'2026-10-25T11:00:00Z','meetingEndDateTime':'2026-10-25T11:45:00Z',
             'totalParticipantCount':1,**times}
        self.collections['attendanceReports']['value'].append(raw)
        self.details[key]={**raw,'attendanceRecords':[{'id':'person','emailAddress':'learner@example.invalid',
            'totalAttendanceInSeconds':600,'identity':{'displayName':'Synthetic'},'attendanceIntervals':[]}]}

    def graph(self, method, path, **kwargs):
        self.paths.append(path)
        self.assertEqual(method,'GET')
        suffix=path.removeprefix(BASE+'/')
        if suffix.startswith('attendanceReports/'):
            value=self.details[suffix.split('/')[1].split('?')[0]]
        else:
            value=self.collections[suffix]
        if isinstance(value,Exception): raise value
        return deepcopy(value)

    def body(self, base, key, **kwargs):
        self.paths.append(base+'/transcripts/'+key+'/content')
        value=self.bodies[key]
        if isinstance(value, TimeoutError):
            raise value
        return {'transcript_text':'','transcript_fetch_error':'Synthetic transcript content failure'} if isinstance(value,Exception) else {
            'transcript_text':value,'transcript_vtt':'WEBVTT\n\n00:00.000 --> 00:01.000\n'+value,'transcript_fetch_error':''}

    def persist(self, record, *, artifacts, attendance_reports, attendance_tracker, imported_refresh=None):
        self.writes.append(deepcopy({'artifacts':artifacts,'reports':attendance_reports,'tracker':attendance_tracker}))
        by_id={(a['artifact_type'],a['graph_artifact_id']):a for a in self.stored['artifacts']}
        by_id.update({(a['artifact_type'],a['graph_artifact_id']):a for a in artifacts})
        reports={a['id']:a for a in self.stored['attendanceReports']}; reports.update({a['id']:a for a in attendance_reports})
        self.stored.update(artifacts=list(by_id.values()),attendanceReports=list(reports.values()),
            attendanceTracker=deepcopy(attendance_tracker),storage={'stored':True,'syncedAt':str(len(self.writes))})
        return {'stored':True}

    def transcript(self, record, *, artifact_ids=None):
        rows=[a for a in self.stored['artifacts'] if a['artifact_type']=='transcript'
              and a.get('transcript_text') and (artifact_ids is None or a['graph_artifact_id'] in artifact_ids)]
        self.transcript_reads.append([a['graph_artifact_id'] for a in rows])
        return {'artifactId':','.join(a['graph_artifact_id'] for a in rows),'text':'\n\n'.join(a['transcript_text'] for a in rows)} if rows else None

    def call(self):
        with ExitStack() as stack:
            def p(name,**kwargs): return stack.enter_context(patch(name,**kwargs))
            p('coach_api.migrated_intelligence_views.timezone.now',return_value=NOW)
            p('coach_api.migrated_intelligence_views._association',return_value=(self.overlay,self.record,self.definition))
            p('coach_api.migrated_intelligence_views.transaction.atomic',return_value=nullcontext())
            p('coach_api.views.has_graph_credentials',return_value=True)
            def verified_target(_record, *, identity_out):
                if self.target_failure:
                    raise self.target_failure
                identity_out['target'] = SimpleNamespace(online_meeting_id='synthetic-meeting')
                return BASE, None
            p('coach_api.actual_session_resolution.review_meeting_target',side_effect=verified_target)
            p('coach_api.views.microsoft_graph_request',side_effect=self.graph)
            p('coach_api.views.get_graph_settings',return_value={'base_url':'https://graph.microsoft.com/v1.0'})
            p('coach_api.views.fetch_coach_meeting_transcript_content',side_effect=self.body)
            p('coach_api.views.coach_meeting_expected_attendees',return_value=EXPECTED)
            p('coach_api.views.stored_coach_meeting_snapshot',side_effect=lambda *a,**k:deepcopy(self.stored))
            p('coach_api.views.persist_coach_meeting_snapshots',side_effect=self.persist)
            p('coach_api.views.stored_coach_meeting_transcript_for_summary',side_effect=self.transcript)
            archive=p('coach_api.recording_archive.archived_recording_url',side_effect=lambda *a,**k:self.archive_url)
            p('coach_api.reconciliation_links.active_links')
            p('coach_api.review_sources.booking_for_overlay',return_value=self.record)
            p('coach_api.migrated_intelligence_views.claim',return_value='synthetic-lease')
            p('coach_api.migrated_intelligence_views.owns',return_value=True)
            p('coach_api.migrated_intelligence_views.release')
            def ai(*args):
                if self.ai_hook: self.ai_hook()
                return ({'overview':'Synthetic OLD transcript recap'},'fake-model')
            provider=p('coach_api.views.openai_meeting_summary',side_effect=ai)
            response=inspect.unwrap(action.migrated_review_check_session)(RequestFactory().post('/',data='{}',content_type='application/json'),KEY)
            self.ai_calls=provider.call_count
            self.archive_calls=archive.call_args_list
        self.payload=json.loads(response.content)
        return response.status_code

    def after_end(self): self.record.duration_minutes=45

    def test_early_empty_is_checked_pending_without_ai_or_answers(self):
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.payload['intelligence']['meetingEndStatus'], 'pending')
        self.assertEqual(self.payload['intelligence']['meetingEndCode'], 'MEETING_END_PENDING')
        self.assertEqual(self.payload['intelligence']['attendanceStatus'], 'pending')
        self.assertTrue(self.payload['intelligence']['lastCheckedAt'])
        self.assertEqual(len(self.writes), 1)
        self.assertEqual(self.ai_calls, 0)
        self.assertEqual(self.overlay.answers, {})

    def test_early_complete_transcript_saved_and_start_returned_without_ai(self):
        self.overlay.status = self.record.status = 'scheduled'
        self.add_artifact()
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.payload['event']['status'], 'in-progress')
        self.assertEqual(self.payload['intelligence']['transcriptStatus'], 'available')
        self.assertEqual(self.stored['artifacts'][0]['transcript_text'], 'Opening and agreed actions')
        self.assertEqual(self.ai_calls, 0)
        self.assertEqual(self.overlay.answers, {})

    def test_early_recording_saved_without_start_or_video_download(self):
        self.overlay.status = self.record.status = 'scheduled'
        self.add_artifact('recording', 'video')
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.payload['intelligence']['recordingStatus'], 'available')
        self.assertEqual(self.overlay.status, 'scheduled')
        self.assertEqual(self.ai_calls, 0)
        self.assertFalse(any('/recordings/' in path for path in self.paths))

    def test_recording_play_requires_existing_archive_contract_and_never_exposes_signed_url(self):
        self.add_artifact('recording', 'video')
        for url in ('', 'https://example.invalid/PRIVATE-SIGNED-REFERENCE'):
            with self.subTest(archived=bool(url)):
                self.archive_url=url
                self.assertEqual(self.call(), 200)
                self.assertEqual(self.payload['artifacts'][0].get('content_available'), bool(url))
                self.assertEqual(self.archive_calls[0].args, (self.record.event_key, 'video'))
                self.assertNotIn('PRIVATE-SIGNED-REFERENCE', json.dumps(self.payload))

    def test_gradual_resources_then_ended_report_generates_once(self):
        self.add_artifact(); self.add_artifact('recording', 'video')
        self.assertEqual(self.call(), 200); self.assertEqual(self.ai_calls, 0)
        self.add_report()
        self.assertEqual(self.call(), 200); self.assertEqual(self.ai_calls, 1)
        self.assertEqual(self.payload['intelligence']['meetingEndStatus'], 'attendance-confirmed')
        answers = deepcopy(self.overlay.answers)
        self.assertEqual(self.call(), 200); self.assertEqual(self.ai_calls, 0)
        self.assertEqual(self.overlay.answers, answers)

    def test_verified_early_call_with_its_ended_report_generates_from_saved_segments(self):
        self.add_artifact(key='early-1', body='First decision',
                          createdDateTime='2026-10-24T11:10:00Z', endDateTime='2026-10-24T11:20:00Z')
        self.add_artifact(key='early-2', body='Second decision',
                          createdDateTime='2026-10-24T11:20:00Z', endDateTime='2026-10-24T11:40:00Z')
        self.add_report(meetingStartDateTime='2026-10-24T11:00:00Z',
                        meetingEndDateTime='2026-10-24T11:45:00Z')
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.ai_calls, 1)
        self.assertEqual(set(self.transcript_reads[-1]), {'early-1', 'early-2'})
        self.assertEqual(self.payload['intelligence']['transcriptStatus'], 'available')
        self.assertTrue(self.overlay.answers.get('summary'))
        self.assertEqual(self.payload['summaryBinding']['generationStatus'], 'ready')

    def test_verified_late_call_with_its_ended_report_generates(self):
        self.record.scheduled_date = date(2026, 10, 20)
        self.add_artifact(createdDateTime='2026-10-24T11:10:00Z',
                          endDateTime='2026-10-24T11:40:00Z')
        self.add_report(meetingStartDateTime='2026-10-24T11:00:00Z',
                        meetingEndDateTime='2026-10-24T11:45:00Z')
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.ai_calls, 1)
        self.assertTrue(self.overlay.answers.get('summary'))

    def test_off_window_suggestion_remains_verifiable_on_form_reload(self):
        from coach_api.migrated_summary_generation import summary_binding_response
        self.add_artifact(createdDateTime='2026-10-24T11:10:00Z',
                          endDateTime='2026-10-24T11:40:00Z')
        self.add_report(meetingStartDateTime='2026-10-24T11:00:00Z',
                        meetingEndDateTime='2026-10-24T11:45:00Z')
        self.assertEqual(self.call(), 200)
        with patch('coach_api.review_sources.booking_for_overlay', return_value=self.record), \
             patch.object(views, 'stored_coach_meeting_snapshot', return_value=deepcopy(self.stored)), \
             patch.object(views, 'stored_coach_meeting_transcript_for_summary', side_effect=self.transcript):
            binding = summary_binding_response(self.overlay)
        self.assertEqual(binding['generationStatus'], 'ready')
        self.assertEqual(binding['suggestionSource'], 'teams')
        self.assertIn('Synthetic OLD transcript recap', binding['suggestionText'])

    def test_unrelated_ended_report_does_not_enable_off_window_ai(self):
        self.add_artifact(createdDateTime='2026-10-24T11:10:00Z',
                          endDateTime='2026-10-24T11:40:00Z')
        self.add_report(meetingStartDateTime='2026-10-23T11:00:00Z',
                        meetingEndDateTime='2026-10-23T11:45:00Z')
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.ai_calls, 0)
        self.assertEqual(self.payload['intelligence']['summaryStatus'], 'pending')

    def test_several_calls_with_one_ended_report_remain_ai_pending(self):
        self.add_artifact(key='first', createdDateTime='2026-10-24T11:10:00Z',
                          endDateTime='2026-10-24T11:20:00Z')
        self.add_artifact(key='second', call='two', createdDateTime='2026-10-24T11:25:00Z',
                          endDateTime='2026-10-24T11:40:00Z')
        self.add_report(meetingStartDateTime='2026-10-24T11:00:00Z',
                        meetingEndDateTime='2026-10-24T11:45:00Z')
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.ai_calls, 0)
        self.assertEqual(self.payload['intelligence']['transcriptStatus'], 'available')
        self.assertEqual(self.payload['summaryBinding']['status'], 'summary-pending')
        self.assertEqual(self.overlay.answers, {})

    def test_report_change_during_ai_rejects_stale_summary(self):
        self.add_artifact()
        self.add_report()
        self.ai_hook = lambda: self.stored['attendanceReports'][0].update(
            meetingEndDateTime='2026-10-25T11:35:00Z')
        self.assertEqual(self.call(), 409)
        self.assertEqual(self.overlay.answers, {})

    def test_after_booked_end_without_actual_completion_keeps_ai_pending(self):
        self.after_end(); self.add_artifact()
        self.assertEqual(self.call(), 200); self.assertEqual(self.ai_calls, 0)
        self.assertEqual(self.payload['intelligence']['meetingEndStatus'], 'pending')
        self.assertEqual(self.payload['intelligence']['transcriptStatus'], 'available')
        self.assertEqual(self.payload['summaryBinding']['status'], 'summary-pending')
        self.assertEqual(self.overlay.answers, {})

    def test_incomplete_transcript_keeps_recording_but_never_generates(self):
        self.add_artifact(); self.add_artifact(key='second', body=RuntimeError())
        self.add_artifact('recording', 'video'); self.add_report()
        self.assertEqual(self.call(), 207)
        self.assertEqual(self.ai_calls, 0)
        self.assertIn('TRANSCRIPT_INCOMPLETE', self.payload['intelligence']['errorCodes'])
        self.assertEqual({a['graph_artifact_id'] for a in self.stored['artifacts']}, {'t1', 'video'})

    def test_two_verified_calls_are_saved_separately_without_ai(self):
        self.overlay.status = self.record.status = 'scheduled'
        self.add_artifact(); self.add_artifact(key='other', call='two')
        self.assertEqual(self.call(), 200)
        self.assertEqual({row['graph_artifact_id'] for row in self.stored['artifacts']}, {'t1', 'other'})
        self.assertEqual({row['call_id'] for row in self.stored['artifacts']}, {'one', 'two'})
        self.assertEqual(self.ai_calls, 0)

    def test_verified_early_content_is_saved_without_exposing_its_body_in_metadata(self):
        self.add_artifact(key='PRIVATE-OLD-ID', body='PRIVATE OLD WORDS',
                          createdDateTime='2026-10-24T11:00:00Z', endDateTime='2026-10-24T11:40:00Z')
        self.assertEqual(self.call(), 200)
        self.assertEqual(self.stored['artifacts'][0]['transcript_text'], 'PRIVATE OLD WORDS')
        self.assertEqual(self.payload['artifacts'][0]['graph_artifact_id'], 'PRIVATE-OLD-ID')
        self.assertNotIn('PRIVATE OLD WORDS', json.dumps(self.payload)); self.assertEqual(self.ai_calls, 0)

    def test_two_call_segments_and_early_recording_remain_distinct(self):
        self.add_artifact()
        self.add_artifact(key='later', createdDateTime='2026-10-25T13:05:00Z', endDateTime='2026-10-25T13:10:00Z')
        self.add_artifact('recording', 'old', call='old', createdDateTime='2026-10-24T11:00:00Z', endDateTime='2026-10-24T11:10:00Z')
        self.assertEqual(self.call(), 200)
        self.assertEqual({a['graph_artifact_id'] for a in self.stored['artifacts']}, {'t1', 'later', 'old'})
        self.assertEqual(self.ai_calls, 0)

    def test_missing_or_partial_attendance_preserves_prior_evidence(self):
        self.add_report(); self.assertEqual(self.call(), 200)
        old = deepcopy(self.stored['attendanceReports'])
        for value in ({'value': []}, {'value': [], '@odata.nextLink': 'https://example.invalid/next'}):
            with self.subTest(value=value):
                self.collections['attendanceReports'] = value
                self.assertIn(self.call(), (200, 207))
                self.assertEqual(self.stored['attendanceReports'], old)
                self.assertEqual(self.payload['intelligence']['attendanceStatus'], 'available')

    def test_resource_failures_are_partial_and_keep_independent_evidence(self):
        self.add_artifact('recording', 'video')
        for error in (provider_error(403), provider_error(429), TimeoutError('synthetic timeout')):
            with self.subTest(error=type(error).__name__):
                self.collections['attendanceReports'] = error
                self.assertEqual(self.call(), 207)
                self.assertTrue(self.payload['partial'])
                self.assertEqual(self.payload['intelligence']['attendanceStatus'], 'fetch-failed')
                self.assertEqual(self.payload['intelligence']['recordingStatus'], 'available')
                self.assertEqual(self.ai_calls, 0)

    def test_recording_continuation_is_incomplete_not_complete_absence(self):
        self.collections['recordings']['@odata.nextLink'] = 'https://graph.microsoft.com/v1.0/'+BASE+'/recordings?$skiptoken=two'
        self.assertEqual(self.call(), 207)
        self.assertEqual(self.payload['intelligence']['recordingStatus'], 'incomplete')
        self.assertIn('RECORDING_INCOMPLETE', self.payload['intelligence']['errorCodes'])
        self.assertEqual(self.stored['artifacts'], [])

    def test_recording_continuation_keeps_verified_first_page_and_cache(self):
        self.add_artifact('recording', 'video'); self.assertEqual(self.call(), 200)
        self.collections['recordings'] = {'value': [], '@odata.nextLink': 'https://example.invalid/next'}
        self.assertEqual(self.call(), 207)
        self.assertEqual([a['graph_artifact_id'] for a in self.stored['artifacts']], ['video'])
        self.assertIn('RECORDING_INCOMPLETE', self.payload['intelligence']['errorCodes'])

    def test_cancelled_and_unscheduled_calendar_never_reach_graph(self):
        for status in ('cancelled', 'not-scheduled'):
            with self.subTest(status=status):
                self.record.status = status
                self.assertEqual(self.call(), 409)
                self.assertEqual(self.payload['code'], 'MEETING_NOT_FOUND')
                self.assertFalse(self.paths); self.assertFalse(self.writes)

    def test_completed_and_signed_manual_action_stays_read_only(self):
        for status in ('completed', 'awaiting-signature', 'submitted'):
            with self.subTest(status=status):
                self.overlay.status = status
                self.assertEqual(self.call(), 409); self.assertFalse(self.paths)

    def test_target_failure_remains_hard_and_no_saved_success(self):
        for code, status in ((401, 502), (403, 403), (404, 404), (429, 429)):
            with self.subTest(code=code):
                self.target_failure = provider_error(code)
                self.assertEqual(self.call(), status); self.assertFalse(self.writes)
                self.assertFalse(self.paths)

    def test_new_transcript_during_ai_blocks_stale_first_fill(self):
        self.after_end(); self.add_artifact(); self.add_report()
        def changed():
            self.stored['artifacts'][0]['transcript_text'] = 'New corrected final decisions'
        self.ai_hook = changed
        self.assertEqual(self.call(), 409)
        self.assertEqual(self.payload['code'], 'SUMMARY_SUPERSEDED')
        self.assertEqual(self.overlay.answers, {})
        self.assertEqual(self.stored['artifacts'][0]['transcript_text'], 'New corrected final decisions')

    def test_recording_only_change_during_ai_does_not_invalidate_transcript(self):
        self.after_end(); self.add_artifact(); self.add_report()
        self.ai_hook = lambda: self.stored['artifacts'].append({'artifact_type':'recording',
            'graph_artifact_id':'new-video','created_datetime':'2026-10-25T11:10:00Z',
            'end_datetime':'2026-10-25T11:30:00Z','call_id':'one',
            'metadata': {'_lms_graph_event_id': self.record.graph_event_id,
                         '_lms_verified_online_meeting_id': 'synthetic-meeting'}})
        self.assertEqual(self.call(), 200); self.assertTrue(self.overlay.answers.get('summary'))
        self.assertEqual(self.payload['intelligence']['recordingStatus'], 'available')

    def test_manual_edits_and_clears_survive_generation(self):
        self.after_end(); self.add_artifact(); self.add_report()
        for text in ('Coach answer', ''):
            with self.subTest(text=text):
                self.overlay.answers = {'summary': text}; self.overlay.meeting_intelligence = {}
                self.assertEqual(self.call(), 200); self.assertEqual(self.overlay.answers['summary'], text)

    def test_early_report_is_meeting_level_attendance_without_ai_call_mapping(self):
        self.add_report(meetingStartDateTime='2026-10-24T11:00:00Z', meetingEndDateTime='2026-10-24T11:45:00Z')
        self.add_artifact('recording', 'video')
        self.assertEqual(self.call(), 200); self.assertEqual(self.ai_calls, 0)
        self.assertEqual(self.payload['attendance']['reportCount'], 1)
        self.assertEqual(self.payload['intelligence']['meetingEndStatus'], 'attendance-confirmed')
        self.assertEqual(self.payload['intelligence']['summaryStatus'], 'pending')

    def test_transcript_content_timeout_keeps_recording_and_never_starts_or_generates(self):
        self.overlay.status = self.record.status = 'scheduled'
        self.add_artifact(body=TimeoutError('synthetic read timeout')); self.add_artifact('recording', 'video')
        self.assertEqual(self.call(), 207)
        self.assertEqual(self.overlay.status, 'scheduled'); self.assertEqual(self.ai_calls, 0)
        self.assertEqual({row['graph_artifact_id'] for row in self.stored['artifacts']}, {'video'})
        self.assertIn('TRANSCRIPT_INCOMPLETE', self.payload['intelligence']['errorCodes'])

    def test_added_empty_segment_during_ai_blocks_publication(self):
        self.after_end(); self.add_artifact(); self.add_report()
        def changed():
            self.stored['artifacts'].append({**self.stored['artifacts'][0], 'graph_artifact_id':'empty', 'transcript_text':''})
        self.ai_hook = changed
        self.assertEqual(self.call(), 409); self.assertEqual(self.overlay.answers, {})

    def test_changed_transcript_provenance_during_ai_blocks_publication(self):
        self.after_end(); self.add_artifact(); self.add_report()
        self.ai_hook = lambda: self.stored['artifacts'][0].update(call_id='different-call')
        self.assertEqual(self.call(), 409); self.assertEqual(self.overlay.answers, {})

    def test_three_imported_families_have_same_early_resource_contract(self):
        for family in ('MCM', 'PR', 'PR_SKILLS_RADAR'):
            with self.subTest(family=family):
                self.setUp(); self.overlay.template_snapshot['family'] = family
                self.record.event_type = 'mcr' if family == 'MCM' else 'progress-review'
                self.add_artifact('recording', 'video')
                self.assertEqual(self.call(), 200); self.assertEqual(self.ai_calls, 0)
                self.assertEqual(self.payload['intelligence']['recordingStatus'], 'available')

