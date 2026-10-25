"""Synthetic source rows only; all DB connections, network and AI are mocked."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase

from coach_api import recordings_saved_evidence as source
from coach_api.recordings_calendar_media import calendar_context, calendar_record

OWNER = 'coach@example.invalid'
START = datetime(2026, 10, 22, 9, tzinfo=timezone.utc)
END = START.replace(hour=10)


class SavedEvidenceTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.enterContext(patch('socket.socket', side_effect=AssertionError('Network forbidden')))
        self.connect = self.enterContext(patch('psycopg.connect'))
        self.cursor = self.connect.return_value.__enter__.return_value.cursor.return_value.__enter__.return_value
        self.meeting = {'id': 'meeting', 'coach_email': OWNER, 'event_id': 'event',
            'online_meeting_id': 'online', 'start_at': START, 'end_at': END}
        self.transcript = {'content': 'WEBVTT\n\n00:00:00.000 --> 00:00:03.000\nSynthetic transcript',
            'duration_seconds': 3, 'status': 'synced', 'updated_at': END}
        self.analysis = {'id': 'analysis', 'learner_id': 42, 'learner_name': 'Synthetic Learner',
            'component_type': 'monthly_coaching', 'ai_status': 'completed',
            'report': {'executive_summary': 'Synthetic saved analysis'}, 'ai_checked_at': END}
        self.report = {'id': 'report', 'report_id': 'graph-report', 'status': 'synced',
            'meeting_start_at': START, 'meeting_end_at': END, 'updated_at': END}
        self.participant = {'report_id': 'report', 'graph_record_id': 'person', 'email': 'person@example.invalid',
            'display_name': 'Actual participant', 'role': 'attendee', 'total_attendance_seconds': 90,
            'intervals': [{'joinDateTime': START.isoformat(), 'leaveDateTime': START.replace(minute=2).isoformat()}]}
        self.rows()

    def rows(self, *, meetings=None, transcripts=None, analyses=None, reports=None, participants=None):
        self.cursor.fetchall.side_effect = [meetings if meetings is not None else [self.meeting],
            [],  # No row in the original dashboard; exercise the existing ingest fallback.
            transcripts if transcripts is not None else [self.transcript],
            analyses if analyses is not None else [self.analysis], reports if reports is not None else [self.report],
            participants if participants is not None else [self.participant]]

    def read(self, *, online='online', learner_ids=None):
        return source._read('synthetic-dsn', OWNER, 'event', online, (START, END), learner_ids)

    def test_completed_evidence_is_same_meeting_read_only_and_bounded_without_generation(self):
        result = self.read(learner_ids=[42])
        self.assertEqual(result['state'], 'matched')
        self.assertEqual(result['transcript']['content'], self.transcript['content'])
        self.assertEqual(result['analyses'][0]['report'], self.analysis['report'])
        self.assertEqual(result['attendance']['rows'][0]['totalAttendanceSeconds'], 120)
        self.assertEqual(result['attendance']['rows'][0]['status'], 'attended')
        self.assertEqual(result['attendance']['source'], 'coaching-session')
        self.connect.assert_called_once()
        self.assertEqual(self.connect.call_args.kwargs['options'], '-c default_transaction_read_only=on')
        calls = self.cursor.execute.call_args_list
        self.assertIn('statement_timeout', calls[0].args[0])
        self.assertTrue(all(call.args[0].lstrip().startswith(('SELECT', 'SET LOCAL')) for call in calls))
        scoped_queries = [call for call in calls if 'learner_id=ANY' in call.args[0]]
        self.assertEqual(len(scoped_queries), 2)
        self.assertTrue(all([42] in call.args[1] for call in scoped_queries))

    def test_other_coach_event_or_occurrence_never_returns_transcript_or_report(self):
        for changes in ({'coach_email': 'other@example.invalid'}, {'event_id': 'other', 'online_meeting_id': 'other'},
                        {'start_at': START.replace(day=21), 'end_at': END.replace(day=21)}):
            self.rows(meetings=[{**self.meeting, **changes}])
            result = self.read()
            self.assertEqual(result['state'], 'not-found')
            self.assertIsNone(result['transcript'])
            self.assertEqual(result['analyses'], [])

    def test_ambiguous_meeting_is_withheld_instead_of_selecting_a_learner_or_title_match(self):
        self.rows(meetings=[self.meeting, {**self.meeting, 'id': 'second'}])
        self.assertEqual(self.read()['state'], 'ambiguous')
        self.cursor.fetchone.assert_not_called()

    def test_verified_online_identity_can_match_another_calendar_copy_of_the_same_occurrence(self):
        self.rows(meetings=[{**self.meeting, 'event_id': 'organizer-copy'}])
        self.assertEqual(self.read()['state'], 'matched')
        self.rows(meetings=[{**self.meeting, 'event_id': 'organizer-copy'}])
        self.assertEqual(self.read(online='')['state'], 'not-found')

    def test_saved_coach_report_matches_a_different_organizer_only_by_verified_online_occurrence(self):
        original = {**self.analysis, 'id': 'dashboard:shared', 'source_session_id': 'b' * 32,
            'has_transcript': True, 'transcript': 'Verified original shared-meeting transcript',
            'updated_at': END, 'report_context': '{"source":"progress_review"}'}
        host = {**self.meeting, 'coach_email': 'host@example.invalid', 'event_id': 'organizer-copy'}
        self.cursor.fetchall.side_effect = [[], [host], [original]]
        result = source._read('synthetic-dsn', OWNER, 'coach-calendar-copy', 'online', (START, END), [42], part='pdf')
        self.assertEqual(result['state'], 'matched')
        self.assertEqual(result['transcript']['content'], original['transcript'])
        self.assertEqual(result['analyses'][0]['report'], original['report'])
        self.assertEqual(result['analyses'][0]['sourceSessionId'], 'b' * 32)
        self.assertEqual(result['analyses'][0]['session'], {'source': 'progress_review'})
        query, params = self.cursor.execute.call_args.args
        self.assertIn('lower(trim(case_owner_email))=%s', query)
        self.assertEqual(params[-1], OWNER)
        self.assertIn([42], params)
        self.assertIn('meeting_id=ANY(%s) AND meeting_start_time BETWEEN', query)
        statements = ' '.join(c.args[0] for c in self.cursor.execute.call_args_list)
        self.assertNotIn('FROM public.all_sessions_cache', statements)
        self.assertNotIn('attendance_records', statements)

    def test_shared_source_report_is_withheld_for_foreign_or_ambiguous_or_other_occurrence(self):
        for candidates, state in [
            ([{**self.meeting, 'online_meeting_id': 'foreign'}], 'not-found'),
            ([{**self.meeting, 'start_at': START.replace(day=21), 'end_at': END.replace(day=21)}], 'not-found'),
            ([{**self.meeting, 'start_at': START.replace(minute=2)},
              {**self.meeting, 'id': 'different-start', 'start_at': START.replace(minute=3)}], 'ambiguous'),
        ]:
            self.cursor.fetchall.side_effect = [[], candidates]
            result = self.read()
            self.assertEqual(result['state'], state)
            self.assertIsNone(result['transcript'])
            self.assertEqual(result['analyses'], [])
            self.assertNotIn('dashboard_sessions_cache', self.cursor.execute.call_args.args[0])

    def test_calendar_copies_recover_the_original_coach_report_when_own_ingest_row_has_none(self):
        original = {**self.analysis, 'id': 'dashboard:shared', 'source_session_id': 'b' * 32,
            'has_transcript': True, 'transcript': 'Original shared transcript', 'updated_at': END}
        host = {**self.meeting, 'id': 'organizer-copy', 'coach_email': 'host@example.invalid'}
        self.cursor.fetchall.side_effect = [[self.meeting], [], [], [], [self.meeting, host], [original]]
        result = source._read('synthetic-dsn', OWNER, 'event', 'online', (START, END), [42], part='evidence')
        self.assertEqual(result['state'], 'matched')
        self.assertEqual(result['analyses'][0]['report'], original['report'])
        self.assertEqual(result['transcript']['content'], original['transcript'])
        query, params = self.cursor.execute.call_args.args
        self.assertIn('meeting_id=ANY(%s)', query)
        self.assertEqual(params[0], ['meeting', 'organizer-copy'])
        self.assertEqual(params[-1], OWNER)

    def test_shared_identity_without_a_report_in_the_current_coach_caseload_returns_no_evidence(self):
        self.cursor.fetchall.side_effect = [[], [self.meeting], [], []]
        result = self.read(learner_ids=[])
        self.assertEqual(result['state'], 'not-found')
        self.assertEqual(result['analyses'], [])
        query, params = next(call.args for call in self.cursor.execute.call_args_list
            if 'FROM public.dashboard_sessions_cache' in call.args[0])
        self.assertIn('lower(trim(case_owner_email))=%s', query)
        self.assertEqual(params[-3:], [False, [], OWNER])

    def test_other_meeting_recovers_organizer_transcript_without_a_dashboard_report(self):
        host = {**self.meeting, 'id': 'organizer-copy', 'coach_email': 'host@example.invalid'}
        self.cursor.fetchall.side_effect = [[], [host], [], [self.transcript]]
        result = source._read('synthetic-dsn', OWNER, 'attendee-calendar-copy', 'online',
            (START, END), [], part='pdf')
        self.assertEqual(result['state'], 'matched')
        self.assertEqual(result['transcript']['content'], self.transcript['content'])
        self.assertEqual(result['analyses'], [])
        query, params = self.cursor.execute.call_args.args
        self.assertIn('meeting_id=ANY(%s::uuid[])', query)
        self.assertEqual(params, [['organizer-copy']])
        self.assertNotIn('public.attendance_reports', ' '.join(c.args[0] for c in self.cursor.execute.call_args_list))

    def test_own_empty_calendar_copy_does_not_hide_organizer_transcript_or_replace_saved_ai(self):
        host = {**self.meeting, 'id': 'organizer-copy', 'coach_email': 'host@example.invalid'}
        original = {**self.analysis, 'ai_status': 'processing', 'has_transcript': False, 'transcript': None}
        self.cursor.fetchall.side_effect = [[self.meeting], [original], [],
            [self.meeting, host], [], [self.transcript]]
        result = source._read('synthetic-dsn', OWNER, 'event', 'online', (START, END), [42], part='evidence')
        self.assertEqual(result['transcript']['content'], self.transcript['content'])
        self.assertEqual(result['analyses'][0]['status'], 'processing')
        self.assertIsNone(result['analyses'][0]['report'])
        self.assertEqual(self.cursor.execute.call_args.args[1], [['meeting', 'organizer-copy']])

    def test_shared_transcript_never_selects_a_different_online_identity_or_occurrence(self):
        host = {**self.meeting, 'id': 'organizer-copy', 'coach_email': 'host@example.invalid'}
        foreign = {**host, 'id': 'foreign', 'online_meeting_id': 'other'}
        older = {**host, 'id': 'old', 'start_at': START.replace(day=21), 'end_at': END.replace(day=21)}
        self.cursor.fetchall.side_effect = [[], [host, foreign, older], [], [self.transcript]]
        result = source._read('synthetic-dsn', OWNER, 'calendar-copy', 'online', (START, END), None, part='evidence')
        self.assertTrue(result['transcript'])
        self.assertEqual(self.cursor.execute.call_args.args[1], [['organizer-copy']])

    def test_transcript_copies_are_deduplicated_and_failed_parts_are_withheld(self):
        self.cursor.fetchall.return_value = [self.transcript, dict(self.transcript),
            {**self.transcript, 'content': 'Failed incomplete text', 'status': 'failed'}]
        self.cursor.fetchall.side_effect = None
        result = source._meeting_transcript(self.cursor, ['copy-a', 'copy-b'])
        self.assertEqual(result['content'], self.transcript['content'])
        self.assertEqual(result['durationSeconds'], 3)

    def test_shared_lookup_is_never_attempted_without_worker_identity_or_for_attendance(self):
        for online, part in [('', 'evidence'), ('online', 'attendance')]:
            self.cursor.reset_mock()
            self.cursor.fetchall.side_effect = [[]]
            result = source._read('synthetic-dsn', OWNER, 'calendar-copy', online, (START, END), None, part=part)
            self.assertEqual(result['state'], 'not-found')
            self.assertEqual(self.cursor.fetchall.call_count, 1)

    def test_pending_report_does_not_expose_partial_ai_and_old_attendance_is_excluded(self):
        self.transcript['status'] = 'failed'
        self.rows(analyses=[{**self.analysis, 'ai_status': 'processing'}],
            reports=[{**self.report, 'meeting_start_at': START.replace(day=21), 'meeting_end_at': END.replace(day=21)}])
        result = self.read()
        self.assertIsNone(result['transcript'])
        self.assertIsNone(result['analyses'][0]['report'])
        self.assertEqual(result['attendance']['state'], 'pending')
        self.assertEqual(result['attendance']['rows'], [])

    def test_multiple_saved_transcript_parts_are_all_previewable_and_downloadable(self):
        self.rows(transcripts=[self.transcript, {**self.transcript, 'content': 'Second saved transcript part'}])
        result = self.read()['transcript']
        self.assertIn(self.transcript['content'], result['content'])
        self.assertIn('Second saved transcript part', result['content'])
        self.assertIsNone(result['durationSeconds'])

    def test_device_visits_are_unioned_and_zero_duration_never_infers_absence(self):
        self.rows(participants=[self.participant, {**self.participant, 'graph_record_id': 'device2'},
            {**self.participant, 'graph_record_id': 'zero', 'email': 'zero@example.invalid', 'total_attendance_seconds': 0, 'intervals': []}])
        result = self.read()['attendance']['rows']
        self.assertEqual(result[0]['totalAttendanceSeconds'], 120)
        self.assertEqual(result[1]['status'], 'pending')

    def test_source_offline_does_not_return_a_successful_empty_match(self):
        self.connect.side_effect = OSError('Private connection detail must not be returned')
        record = calendar_record(calendar_context(OWNER, 'event', START, END))
        with patch.object(source, 'source_dsn', return_value='synthetic-dsn'):
            result = source.saved_evidence(record, None)
            repeated = source.saved_evidence(record, None)
        self.assertEqual(result, source.empty_evidence('unavailable'))
        self.assertEqual(repeated, result)
        self.connect.assert_called_once()

    def test_polling_reuses_read_but_other_learner_scopes_and_occurrences_do_not(self):
        record = calendar_record(calendar_context(OWNER, 'event', START, END))
        with patch.object(source, 'source_dsn', return_value='synthetic-dsn'), \
                patch.object(source, '_read', return_value=source.empty_evidence('matched')) as read:
            source.saved_evidence(record, None, learner_ids=[42])
            source.saved_evidence(record, None, learner_ids=[42])
            self.assertEqual(read.call_count, 1)
            source.saved_evidence(record, None, learner_ids=[])
            self.assertEqual(read.call_count, 2)
            record.calendar_window = (START.replace(day=21), END.replace(day=21))
            source.saved_evidence(record, None, learner_ids=[42])
            self.assertEqual(read.call_count, 3)

    def test_verified_base_only_not_browser_links_supplies_online_identity(self):
        self.assertEqual(source.online_identity(SimpleNamespace(result={'base': 'users/owner/onlineMeetings/abc%3D'})), 'abc=')
        self.assertEqual(source.online_identity(SimpleNamespace(result={'base': 'https://foreign.invalid/onlineMeetings/abc'})), '')

    def test_attendance_does_not_query_or_transfer_ai_reports_and_transcripts(self):
        self.cursor.fetchall.side_effect = [[self.meeting], [self.report], [self.participant]]
        result = source._read('synthetic-dsn', OWNER, 'event', 'online', (START, END), None, part='attendance')
        self.assertEqual(result['attendance']['state'], 'available')
        self.assertIsNone(result['transcript'])
        self.assertEqual(result['analyses'], [])
        statements = ' '.join(call.args[0] for call in self.cursor.execute.call_args_list)
        self.assertNotIn('meeting_transcripts', statements)
        self.assertNotIn('report_ai', statements)

    def test_evidence_does_not_query_or_wait_for_attendance(self):
        self.cursor.fetchall.side_effect = [[self.meeting], [], [self.transcript], [self.analysis]]
        result = source._read('synthetic-dsn', OWNER, 'event', 'online', (START, END), None, part='evidence')
        self.assertEqual(result['analyses'][0]['report'], self.analysis['report'])
        statements = ' '.join(call.args[0] for call in self.cursor.execute.call_args_list)
        self.assertNotIn('attendance_reports', statements)
        self.assertNotIn('attendance_records', statements)

    def test_original_dashboard_is_authoritative_and_keeps_its_exact_export_identity(self):
        original = {**self.analysis, 'id': 'dashboard:10', 'source_session_id': 'a' * 32,
            'has_transcript': True, 'transcript': 'Exact original saved transcript', 'updated_at': END}
        self.cursor.fetchall.side_effect = [[self.meeting], [original]]
        result = source._read('synthetic-dsn', OWNER, 'event', 'online', (START, END), [42], part='evidence')
        self.assertEqual(result['analyses'][0]['sourceSessionId'], 'a' * 32)
        self.assertEqual(result['analyses'][0]['report'], original['report'])
        self.assertEqual(result['transcript']['content'], original['transcript'])
        statements = ' '.join(call.args[0] for call in self.cursor.execute.call_args_list)
        self.assertIn('dashboard_sessions_cache', statements)
        self.assertIn("SET LOCAL TIME ZONE 'UTC'", statements)
        self.assertNotIn('FROM public.meeting_transcripts', statements)
        self.assertNotIn('FROM public.all_sessions_cache', statements)
        query = self.cursor.execute.call_args
        self.assertIn('meeting_id=%s', query.args[0])
        self.assertIn([42], query.args[1])
        self.assertNotIn('learner_name=', query.args[0])

    def test_pdf_reads_only_whitelisted_original_session_context_without_attendance_expansion(self):
        original = {**self.analysis, 'has_transcript': True, 'transcript': 'Original saved text',
                    'report_context': {'learner_name': 'Synthetic Learner', 'aptem_status': 'Awaiting signature'}}
        self.cursor.fetchall.side_effect = [[self.meeting], [original]]
        result = source._read('synthetic-dsn', OWNER, 'event', '', (START, END), None, part='pdf')
        self.assertEqual(result['analyses'][0]['session'], original['report_context'])
        statements = ' '.join(call.args[0] for call in self.cursor.execute.call_args_list)
        self.assertIn('jsonb_build_object', statements)
        self.assertNotIn('public.attendance_reports', statements)

    def test_pdf_context_handles_the_configured_psycopg_text_json_loader(self):
        original = {**self.analysis, 'has_transcript': True, 'transcript': 'Original saved text',
                    'report_context': '{"learner_name":"Synthetic Learner","aptem_status":"Awaiting signature"}'}
        self.cursor.fetchall.side_effect = [[self.meeting], [original]]
        result = source._read('synthetic-dsn', OWNER, 'event', '', (START, END), None, part='pdf')
        self.assertEqual(result['analyses'][0]['session']['aptem_status'], 'Awaiting signature')

    def test_other_owner_or_occurrence_never_reads_original_dashboard(self):
        self.rows(meetings=[{**self.meeting, 'coach_email': 'other@example.invalid'}])
        self.assertEqual(self.read()['state'], 'not-found')
        self.assertNotIn('dashboard_sessions_cache', ' '.join(call.args[0] for call in self.cursor.execute.call_args_list))

    def test_original_dashboard_deduplicates_transcript_without_fabricating_pending_analysis(self):
        original = {**self.analysis, 'source_session_id': 'b' * 32, 'has_transcript': True,
            'transcript': 'One saved transcript', 'updated_at': END, 'ai_status': 'processing'}
        self.cursor.fetchall.side_effect = [[self.meeting], [original, {**original, 'id': 'second'}]]
        result = source._read('synthetic-dsn', OWNER, 'event', 'online', (START, END), [], part='evidence')
        self.assertEqual(result['transcript']['content'], 'One saved transcript')
        self.assertTrue(all(row['report'] is None for row in result['analyses']))
        self.assertIn([], self.cursor.execute.call_args.args[1])

    def test_test_runner_never_opens_configured_external_source(self):
        self.assertEqual(source.source_dsn(), '')
        self.assertEqual(source.saved_evidence(calendar_record(calendar_context(OWNER, 'event', START, END)), None)['state'], 'unavailable')
        self.connect.assert_not_called()
