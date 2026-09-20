"""Direct regression runner: stdlib/AST only; no Django setup, DB or network."""
import ast
import functools
import hashlib
import json
import logging
import re
import tempfile
import uuid
import sys
import types
import unittest
from collections import defaultdict
from contextlib import contextmanager, nullcontext
from datetime import datetime, timedelta, timezone
from pathlib import Path
from unittest.mock import Mock, patch

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
from curriculum_api.session_results_policy import (attendance_seconds, evidence_seconds, session_roster,
    attendance_csv, archive_prefix, transcript_text, instant, session_runs)
from curriculum_api.session_graph import collection
from curriculum_api.session_transfer_progress import byte_count
from curriculum_api.session_media_policy import (hidden_artifact_ids, recordings_for_transcript,
    recording_transcript_links, transcript_timing_ready, artifact_metadata)


def functions(path, names, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == len(names), (path, names)
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


class Response(dict):
    def __init__(self, data=None, status=200, **kwargs):
        super().__init__(data if isinstance(data, dict) else {})
        self.status_code = status
        self.content = data


class AlternativeRecoveryMatchingTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.ns = {'defaultdict': defaultdict, 'INACTIVE_STATUSES': {
            'cancelled', 'canceled', 'deleted', 'failed', 'superseded',
        }}
        functions(ROOT.parent / 'learner_api' / 'alternative_recovery.py', {
            '_active', '_module_key', '_matching_alternative_series',
        }, cls.ns)

    @staticmethod
    def row(**values):
        return types.SimpleNamespace(**values)

    def test_matches_same_module_title_in_other_group_only(self):
        original_module = self.row(module_catalogue_id='MOD-A', group_id='GROUP-FRI',
                                   title='Aya  Module')
        original_series = self.row(id='LIVE-FRI', module_catalogue_id='MOD-A',
                                   module_title='Aya Module', status='active')
        wednesday_module = self.row(module_catalogue_id='MOD-B', group_id='GROUP-WED',
                                    title='  aya module COPY ')
        unrelated_module = self.row(module_catalogue_id='MOD-C', group_id='GROUP-WED',
                                    title='Test-cover')
        wrong_same_group = self.row(module_catalogue_id='MOD-D', group_id='GROUP-FRI',
                                    title='Aya Module')
        sessions = [
            original_series,
            self.row(id='LIVE-WED', module_catalogue_id='MOD-B', status='active'),
            self.row(id='LIVE-UNRELATED', module_catalogue_id='MOD-C', status='active'),
            self.row(id='LIVE-SAME-GROUP', module_catalogue_id='MOD-D', status='active'),
        ]

        result = self.ns['_matching_alternative_series'](
            original_series, original_module,
            [original_module, wednesday_module, unrelated_module, wrong_same_group],
            sessions,
        )

        self.assertEqual(set(result), {'GROUP-WED'})
        self.assertEqual(result['GROUP-WED'][0].module_catalogue_id, 'MOD-B')
        self.assertEqual(result['GROUP-WED'][1].id, 'LIVE-WED')

    def test_copy_suffix_is_removed_only_at_the_end(self):
        module_key = self.ns['_module_key']

        self.assertEqual(module_key('Aya  Modual copy'), module_key('aya modual'))
        self.assertEqual(module_key('Copy skills'), 'copy skills')

    def test_rejects_ambiguous_series_for_the_same_module_delivery(self):
        original_module = self.row(module_catalogue_id='MOD-A', group_id='GROUP-FRI', title='Module')
        original_series = self.row(id='LIVE-FRI', module_catalogue_id='MOD-A',
                                   module_title='Module', status='active')
        candidate = self.row(module_catalogue_id='MOD-B', group_id='GROUP-WED', title='Module')
        sessions = [
            original_series,
            self.row(id='LIVE-WED-1', module_catalogue_id='MOD-B', status='active'),
            self.row(id='LIVE-WED-2', module_catalogue_id='MOD-B', status='active'),
        ]

        result = self.ns['_matching_alternative_series'](
            original_series, original_module, [original_module, candidate], sessions,
        )

        self.assertEqual(result, {})


class ModuleCalendarLinkingTests(unittest.TestCase):
    def setUp(self):
        self.updates = []
        self.ns = {
            'LIVE_SESSIONS_TABLE': 'curriculum.live_sessions',
            'datetime': types.SimpleNamespace(utcnow=lambda: 'NOW'),
            'ensure_live_sessions_table': lambda: None,
            'clean_str': lambda value: str(value or '').strip(),
            'update_authoring_rows': lambda *args: self.updates.append(args),
        }
        functions(ROOT / 'views.py', {'link_live_session_series_to_module'}, self.ns)

    def test_full_structure_does_not_reparent_calendar_from_delivery_metadata(self):
        self.ns['link_live_session_series_to_module']('MOD-COPY', {
            'weekStructure': [{'components': []}],
            'deliveryMetadata': {'teamsLiveSessionId': 'LIVE-SOURCE'},
        })

        self.assertEqual(self.updates, [])

    def test_full_structure_links_calendar_named_by_live_component(self):
        self.ns['link_live_session_series_to_module']('MOD-COPY', {
            'weekStructure': [{'components': [{
                'settings': {'teamsLiveSessionId': 'LIVE-COPY'},
            }]}],
            'deliveryMetadata': {'teamsLiveSessionId': 'LIVE-SOURCE'},
        })

        self.assertEqual(len(self.updates), 1)
        self.assertEqual(self.updates[0][2], ['LIVE-COPY'])

    def test_legacy_partial_save_keeps_metadata_fallback(self):
        self.ns['link_live_session_series_to_module']('MOD-LEGACY', {
            'deliveryMetadata': {'teamsLiveSessionId': 'LIVE-LEGACY'},
        })

        self.assertEqual(len(self.updates), 1)
        self.assertEqual(self.updates[0][2], ['LIVE-LEGACY'])


def visit(start, end):
    return {'joinDateTime': f'2026-09-16T09:{start}Z', 'leaveDateTime': f'2026-09-16T09:{end}Z'}


class AuthoringIdentityTests(unittest.TestCase):
    def setUp(self):
        self.ns = {'json': json}
        functions(ROOT / 'session_results.py', {'json_value'}, self.ns)
        self.ns['as_json_value'] = self.ns['json_value']
        tree = ast.parse((ROOT / 'views.py').read_text(encoding='utf-8-sig'))
        names = {'BASE_COMPONENT_SETTINGS', 'COMPONENT_SETTINGS_SCHEMA', 'LEGACY_SETTING_KEYS',
                 'LIVE_SESSION_TRACKING_SETTING_KEYS'}
        nodes = [node for node in tree.body if isinstance(node, ast.Assign)
                 and any(isinstance(target, ast.Name) and target.id in names for target in node.targets)]
        exec(compile(ast.Module(body=nodes, type_ignores=[]), 'authoring-settings', 'exec'), self.ns)
        functions(ROOT / 'views.py', {'frontend_component_type', 'component_settings_defaults',
            'allowed_component_setting_keys', 'normalise_component_settings_payload'}, self.ns)
        self.normalize = self.ns['normalise_component_settings_payload']
        self.tracking = {'teamsLiveSessionId': 'S1', 'teamsOccurrenceId': 'O6', 'teamsSessionNumber': 6,
            'teamsOnlineMeetingId': 'MEETING-1', 'teamsMeetingUrl': 'https://teams.microsoft.com/meet/example',
            'teamsWebLink': 'https://outlook.office.com/calendar/item/example',
            'teamsStartDateTimeUtc': '2026-10-29T09:00:00Z', 'teamsDurationMinutes': 90,
            'sessionDay': 'Thursday', 'sessionRescheduled': True}

    def test_save_retains_exact_occurrence_and_shifted_calendar_fields(self):
        for kind in ('live-session', 'live_session'):
            with self.subTest(kind=kind):
                saved = self.normalize(kind, self.tracking)
                saved = self.normalize(kind, saved)
                self.assertEqual({key: saved.get(key) for key in self.tracking}, self.tracking)
                self.assertTrue(set(saved).issubset(self.ns['allowed_component_setting_keys'](kind)))
                self.assertNotIn('legacySettings', saved)

    def test_previous_legacy_identity_is_recovered_without_changing_other_fields(self):
        saved = self.normalize('live-session', {'legacySettings': json.dumps(self.tracking),
            'teamsAttendees': ['learner@example.invalid'], 'teamsRecording': 'record-transcribe',
            'teamsLobbyBypass': 'organizer', 'preparationInstructions': 'Read the material'})
        self.assertEqual({key: saved.get(key) for key in self.tracking}, self.tracking)
        self.assertEqual(saved['teamsAttendees'], ['learner@example.invalid'])
        self.assertEqual(saved['teamsRecording'], 'record-transcribe')
        self.assertEqual(saved['teamsLobbyBypass'], 'organizer')
        self.assertEqual(saved['preparationInstructions'], 'Read the material')

    def test_explicit_clear_wins_and_missing_identity_is_not_invented(self):
        saved = self.normalize('live-session', {'teamsSessionNumber': '', 'teamsOccurrenceId': '',
            'legacySettings': json.dumps(self.tracking)})
        self.assertEqual(saved['teamsSessionNumber'], '')
        self.assertEqual(saved['teamsOccurrenceId'], '')
        self.assertNotIn('teamsSessionNumber', self.normalize('live-session', {}))

    def test_other_component_types_do_not_acquire_session_identity(self):
        saved = self.normalize('reading', {'legacySettings': json.dumps(self.tracking)})
        self.assertNotIn('teamsSessionNumber', saved)
        self.assertEqual(json.loads(saved['legacySettings']), self.tracking)


class EvidenceTests(unittest.TestCase):
    def test_threshold(self):
        for seconds, expected in [(0, 0), (179, 0), (180, 0), (181, 1), (10000, 1)]:
            with self.subTest(seconds=seconds):
                row = session_roster(['a@example.invalid'], [{'email': 'a@example.invalid', 'total_attendance_seconds': seconds}], complete=True)[0]
                self.assertEqual(row['attendance'], expected)

    def test_reconnects_add_and_overlap_does_not(self):
        self.assertEqual(attendance_seconds([visit('00:00', '02:00'), visit('01:00', '03:00'), visit('04:00', '05:00')]), 240)

    def test_multiple_devices_and_duplicate_report(self):
        records = [{'intervals': [visit('00:00', '02:00')]}, {'intervals': [visit('01:00', '03:00')]}]
        self.assertEqual(evidence_seconds(records + records), 180)

    def test_invalid_negative_intervals_do_not_count(self):
        self.assertEqual(attendance_seconds([{}, visit('02:00', '01:00'), None]), 0)

    def test_timezone_instants_union(self):
        self.assertEqual(attendance_seconds([{'joinDateTime': '2026-09-16T10:00:00+01:00', 'leaveDateTime': '2026-09-16T09:03:01Z'}]), 181)

    def test_duration_fallback_does_not_double_count(self):
        self.assertEqual(evidence_seconds([{'total_attendance_seconds': 120}] * 2), 120)

    def test_missing_report_is_pending(self):
        row = session_roster(['a@example.invalid'], [], complete=False)[0]
        self.assertIsNone(row['attendance'])
        self.assertEqual(row['rawStatus'], 'pending')
        self.assertEqual(row['effectiveStatus'], 'pending')

    def test_unidentified_attendee_requires_review(self):
        rows = session_roster(['a@example.invalid'], [{'id': 'guest', 'total_attendance_seconds': 300}], complete=True)
        self.assertEqual([r['status'] for r in rows], ['review', 'review'])

    def test_email_normalization_and_reconnects(self):
        rows = session_roster([' A@EXAMPLE.invalid '], [{'email': 'a@example.invalid', 'intervals': [visit('00:00', '02:00')]},
            {'email': 'A@EXAMPLE.invalid', 'intervals': [visit('03:00', '05:00')]}], complete=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['attendance'], 1)

    def test_export_escapes_formulas_and_keeps_pending_blank(self):
        rows = session_roster(['=cmd@example.invalid'], [], complete=False)
        csv = attendance_csv(rows)
        self.assertTrue(csv.startswith('\ufeff'))
        self.assertIn("'=cmd", csv)
        self.assertIn('Raw attendance,Raw status,Effective attendance,Final outcome', csv)
        self.assertIn(',pending,,pending,0,', csv)

    def test_archive_paths_scope_module_group_occurrence(self):
        series = {'id': 'S', 'module_title': '../Calculus', 'module_catalogue_id': 'M'}
        path = archive_prefix(series, {'id': 'O1', 'session_number': 1}, {'group_id': 'G1'})
        self.assertEqual(len(path.split('/')), 3)
        self.assertNotIn('..', path)
        self.assertNotEqual(path, archive_prefix(series, {'id': 'O2', 'session_number': 1}, {'group_id': 'G1'}))
        self.assertNotEqual(path, archive_prefix(series, {'id': 'O1', 'session_number': 1}, {'group_id': 'G2'}))


class RawAttendancePersistenceTests(unittest.TestCase):
    def test_reporting_upsert_does_not_make_recovery_a_raw_presence(self):
        source = (ROOT.parent / 'learner_api' / 'teams_attendance.py').read_text(encoding='utf-8-sig')
        self.assertIn('attendance_status = EXCLUDED.attendance_status', source)
        self.assertIn('catchup_completed = EXCLUDED.catchup_completed', source)
        self.assertNotIn("attendance_status = CASE WHEN learner_attendance_details.catchup_completed THEN 'present'", source)

    def test_catchup_refresh_never_updates_the_original_attendance_status(self):
        source = (ROOT.parent / 'learner_api' / 'session_recovery.py').read_text(encoding='utf-8-sig')
        self.assertNotIn("SET attendance_status='present'", source)

    def test_transcript_preserves_speakers(self):
        self.assertEqual(transcript_text('WEBVTT\n\n1\n00:01 --> 00:03\n<v Speaker>Hello</v>'), 'Speaker: Hello')


class PaginationTests(unittest.TestCase):
    def test_follows_all_pages(self):
        get = Mock(side_effect=[{'value': [1], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/users/a?page=2'}, {'value': [2]}])
        self.assertEqual(collection(get, 'users/a', 'https://graph.microsoft.com/v1.0'), [1, 2])
        self.assertEqual(get.call_args.args, ('GET', 'users/a?page=2'))

    def test_expanded_roster_continuation(self):
        get = Mock(return_value={'value': [2]})
        first = {'attendanceRecords': [1], 'attendanceRecords@odata.nextLink': 'https://graph.microsoft.com/v1.0/users/a/records?page=2'}
        self.assertEqual(collection(get, 'users/a/report', 'https://graph.microsoft.com/v1.0', first=first, key='attendanceRecords'), [1, 2])

    def test_rejects_cross_origin_without_sending_token(self):
        get = Mock(return_value={'value': [1], '@odata.nextLink': 'https://evil.invalid/v1.0/users/a'})
        with self.assertRaises(RuntimeError):
            collection(get, 'users/a', 'https://graph.microsoft.com/v1.0')
        self.assertEqual(get.call_count, 1)

    def test_cycle_is_failure_not_partial_success(self):
        with self.assertRaises(RuntimeError):
            collection(Mock(return_value={'value': [], '@odata.nextLink': 'users/a'}), 'users/a', 'https://graph.microsoft.com/v1.0')

    def test_second_page_error_propagates(self):
        get = Mock(side_effect=[{'value': [1], '@odata.nextLink': 'users/a?p=2'}, RuntimeError('429')])
        with self.assertRaises(RuntimeError):
            collection(get, 'users/a', 'https://graph.microsoft.com/v1.0')


class StorageUrlTests(unittest.TestCase):
    def test_recording_lifetime_does_not_change_existing_document_default(self):
        sign = Mock(return_value='synthetic-signature')
        ns = {'datetime': datetime, 'timezone': timezone, 'timedelta': timedelta,
            'settings': types.SimpleNamespace(AZURE_STORAGE_ACCOUNT='synthetic', AZURE_STORAGE_KEY='test-only', AZURE_SAS_TTL_MINUTES=15),
            'generate_blob_sas': sign, 'BlobSasPermissions': lambda **values: values,
            'blob_url': lambda container, name: f'https://storage.invalid/{container}/{name}'}
        functions(ROOT.parent / 'learner_api/evidence_storage.py', {'get_read_sas'}, ns)
        before = datetime.now(timezone.utc)
        ns['get_read_sas']('documents', 'file.pdf')
        self.assertAlmostEqual((sign.call_args.kwargs['expiry'] - before).total_seconds(), 900, delta=2)
        ns['get_read_sas']('session-recordings', 'recording.mp4', ttl_minutes=240)
        self.assertAlmostEqual((sign.call_args.kwargs['expiry'] - before).total_seconds(), 14400, delta=2)
        self.assertEqual(sign.call_args.kwargs['permission'], {'read': True})
        self.assertEqual(sign.call_args.kwargs['blob_name'], 'recording.mp4')


class RegisterTests(unittest.TestCase):
    class Query(list):
        def using(self, *_args): return self
        def filter(self, *_args, **kwargs):
            if kwargs.get('actual_end__isnull') is False:
                return type(self)(row for row in self if row.actual_end is not None)
            if kwargs.get('pk__in') is not None:
                allowed = set(kwargs['pk__in'])
                return type(self)(row for row in self if row.id in allowed)
            return self
        def exclude(self, *_args, **kwargs): return self
        def only(self, *_args): return self
        def order_by(self, *_args): return self
        def values_list(self, *fields, **_kwargs):
            return [(getattr(row, field) for field in fields) for row in self]

    class Q:
        def __init__(self, **kwargs): pass
        def __or__(self, other): return self

    def roster(self, records, *, invited=True, launched=False, complete=True, stored_attendees=None, recovery_guest=False):
        learner = types.SimpleNamespace(id=13, enrolment_id=7, full_name='Example Learner', email='a@example.invalid', coach_name='Coach')
        session = types.SimpleNamespace(id='S', module_catalogue_id='M', module_title='Module', attendees=['a@example.invalid'] if invited else [])
        if stored_attendees is not None:
            session.attendees = stored_attendees
        start, end = instant('2026-09-16T09:00Z'), instant('2026-09-16T10:00Z')
        occurrences = [types.SimpleNamespace(id=f'O{i}', live_session_id='S', session_number=i, attendance_report_id=f'R{i}',
            actual_start=start, actual_end=end if complete else None, scheduled_start=start, scheduled_end=end,
            artifacts_synced_at=end, updated_at=end) for i in (1, 2)]
        launches = types.ModuleType('curriculum_api.session_results')
        launches.launch_expectations = lambda *_args: (defaultdict(set, {'S': {'a@example.invalid'}} if launched else {}),
            defaultdict(set, {'O1': {'a@example.invalid'}} if launched else {}))
        recovery = types.ModuleType('learner_api.session_recovery'); recovery.apply_recovery_to_rows = lambda rows: rows
        alternatives = types.ModuleType('learner_api.alternative_recovery')
        alternatives.approved_alternative_guests = lambda *_args: defaultdict(
            set, {'O1': {'a@example.invalid'}} if recovery_guest else {},
        )
        ns = {'__name__': 'learner_api.teams_attendance', '__package__': 'learner_api',
            'defaultdict': defaultdict, 'evidence_seconds': evidence_seconds, 'datetime': datetime,
            'datetime_timezone': timezone, 'parse_datetime': instant, 'Q': self.Q,
            'timezone': types.SimpleNamespace(is_aware=lambda value: value.tzinfo is not None, is_naive=lambda value: value.tzinfo is None,
                localtime=lambda value: value, now=lambda: end), 'router': types.SimpleNamespace(db_for_read=lambda model: 'default'),
            'LearnerProfile': types.SimpleNamespace(objects=self.Query([learner])),
            'LiveSession': types.SimpleNamespace(objects=self.Query([session])),
            'LiveSessionOccurrence': types.SimpleNamespace(objects=self.Query(occurrences)),
            'LiveSessionAttendance': types.SimpleNamespace(objects=self.Query([types.SimpleNamespace(occurrence_id='O1', graph_record_id=str(i),
                display_name='Example Learner', email=email, intervals=intervals, total_attendance_seconds=0) for i, (email, intervals) in enumerate(records)])),
            'ModuleAuthoringModule': types.SimpleNamespace(objects=self.Query([types.SimpleNamespace(module_catalogue_id='M', group_id='G', group_name='Group')]))}
        functions(ROOT.parent / 'learner_api/teams_attendance.py', {'_email', '_session_expected_emails', '_local_datetime',
            '_graph_datetime', '_attendance_interval_bounds', 'fetch_verified_teams_attendance_rows'}, ns)
        # The shared invitation parser is also used by the incoming Teams code.
        # Load its real rules through AST so its lazy import cannot load Django.
        views = types.ModuleType('curriculum_api.views')
        views.__dict__.update(json=json, re=re)
        functions(ROOT / 'views.py', {'teams_series_email_list', 'parse_json_value', 'clean_str'}, views.__dict__)
        with patch.dict(sys.modules, {'curriculum_api.views': views, 'curriculum_api.session_results': launches,
                'learner_api.session_recovery': recovery, 'learner_api.alternative_recovery': alternatives}), patch('socket.socket', side_effect=AssertionError('Network forbidden')):
            return ns['fetch_verified_teams_attendance_rows'](learner_emails=['a@example.invalid'])

    def test_register_unions_devices_and_preserves_source_identity(self):
        rows = self.roster([('a@example.invalid', [visit('00:00', '02:00')]), ('a@example.invalid', [visit('01:00', '03:01')])])
        self.assertEqual(rows[0]['attended_seconds'], 181)
        self.assertEqual(rows[0]['attendance_status'], 'present')
        self.assertEqual((rows[0]['learner_profile_id'], rows[0]['enrolment_id']), (13, 7))
        self.assertEqual(rows[1]['attendance_status'], 'absent')

    def test_stored_json_invitees_keep_verified_attendance_and_ignore_invalid_entries(self):
        rows = self.roster([('a@example.invalid', [visit('00:00', '03:01')])],
            stored_attendees='[" A@EXAMPLE.INVALID ", "a@example.invalid", "invalid", "a"]')
        self.assertEqual(len(rows), 2)
        self.assertEqual([row['attendance_status'] for row in rows], ['present', 'absent'])
        self.assertEqual([row['occurrence_id'] for row in rows], ['O1', 'O2'])

    def test_join_extends_only_clicked_occurrence_and_never_proves_attendance(self):
        rows = self.roster([], invited=False, launched=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual((rows[0]['occurrence_id'], rows[0]['attendance_status']), ('O1', 'absent'))
        self.assertEqual(rows[0]['eligibility_reason'], 'assigned_lms_join')

    def test_approved_recovery_guest_is_expected_only_for_target_occurrence(self):
        rows = self.roster([], invited=False, recovery_guest=True)
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['occurrence_id'], 'O1')
        self.assertEqual(rows[0]['attendance_status'], 'absent')
        self.assertEqual(rows[0]['eligibility_reason'], 'approved_recovery_guest')

    def test_pending_report_never_publishes_absence(self):
        self.assertEqual(self.roster([], complete=False), [])

    def test_anonymous_participant_prevents_false_absence(self):
        rows = self.roster([('', [visit('00:00', '03:01')])])
        self.assertEqual([row['occurrence_id'] for row in rows], ['O2'])


class EndpointTests(unittest.TestCase):
    def setUp(self):
        self.network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.network.start(); self.addCleanup(self.network.stop)
        learner_package = types.ModuleType('learner_api')
        learner_package.__path__ = [str(ROOT.parent / 'learner_api')]
        alternatives = types.ModuleType('learner_api.alternative_recovery')
        alternatives.alternative_occurrence_id = lambda key: str(key or '').removeprefix('alternative:')
        learner_modules = patch.dict(sys.modules, {
            'learner_api': learner_package,
            'learner_api.alternative_recovery': alternatives,
        })
        learner_modules.start(); self.addCleanup(learner_modules.stop)
        self.ns = {'__name__': 'curriculum_api.session_results', '__package__': 'curriculum_api', 'functools': functools, 'json': json,
            'JsonResponse': Response, 'HttpResponse': Response, 'HttpResponseRedirect': lambda url: Response({'location': url}, 302),
            'DatabaseError': type('DatabaseError', (Exception,), {}), 'defaultdict': defaultdict,
            'log': logging.getLogger('test'), 'require_GET': lambda f: f, 'require_POST': lambda f: f,
            'csrf_protect': lambda f: f, '_auth_gate_enabled': lambda: True,
            'authenticate_request': lambda req: req.account, '_unauthenticated': lambda req: Response(status=401),
            '_forbidden': lambda roles: Response(status=403), '_read_only_learner_view': lambda: Response(status=403),
            '_target_learner_id': lambda req, kwargs, **opts: kwargs.get('learner_id'),
            'instant': instant, 'session_roster': session_roster, 'attendance_csv': attendance_csv,
            'session_runs': session_runs, 'evidence_seconds': evidence_seconds,
            'hidden_artifact_ids': hidden_artifact_ids, 'recording_transcript_links': recording_transcript_links,
            'transcript_timing_ready': transcript_timing_ready, 'artifact_metadata': artifact_metadata,
            'timezone': types.SimpleNamespace(now=lambda: datetime(2026, 9, 16, 12, tzinfo=timezone.utc))}
        functions(ROOT.parent / 'login/permissions.py', {'require_role', '_learner_progress_gate', 'learner_self_or_staff'}, self.ns)
        functions(ROOT / 'session_results.py', {'json_value', 'result_rows', 'admin_session', 'learner_results', 'learner_content',
            'module_results', 'stored_content', 'queue_sync', 'learner_join', 'apply_recovery', 'unavailable', 'archive_schema_missing', 'recording_visibility', 'export_attendance'}, self.ns)
        self.cursor = Mock(); self.cursor.__enter__ = Mock(return_value=self.cursor); self.cursor.__exit__ = Mock(return_value=False)
        self.ns['connections'] = {'default': types.SimpleNamespace(cursor=lambda: self.cursor)}
        self.ns['read'] = Mock(return_value=[])
        self.ns['launch_expectations'] = lambda *args: (defaultdict(set), defaultdict(set))
        self.ns['start_requested_sync'] = Mock(return_value=True)
        self.ns['add_sync_progress'] = Mock()
        callbacks = []

        @contextmanager
        def atomic():
            try:
                yield
            except Exception:
                callbacks.clear()
                raise
            pending = list(callbacks)
            callbacks.clear()
            for callback in pending:
                callback()
        self.ns['transaction'] = types.SimpleNamespace(atomic=atomic, on_commit=callbacks.append)

    def req(self, role='admin', subject_id=7, method='GET'):
        return types.SimpleNamespace(account=types.SimpleNamespace(role=role, subject_id=subject_id) if role else None, GET={}, method=method)

    def test_admin_endpoint_rejects_learner_without_read(self):
        response = self.ns['admin_session'](self.req('learner'), series_id='S', session_number=1)
        self.assertEqual(response.status_code, 403); self.ns['read'].assert_not_called()

    def test_unauthenticated_rejected(self):
        self.assertEqual(self.ns['admin_session'](self.req(None), series_id='S', session_number=1).status_code, 401)

    def test_other_learner_cannot_read_or_download(self):
        for endpoint, params in [('learner_results', {'session_number': 1}), ('learner_content', {'artifact_id': 'A'})]:
            response = self.ns[endpoint](self.req('learner'), kind='commercial', learner_id=8, series_id='S', **params)
            self.assertEqual(response.status_code, 404)
        self.ns['read'].assert_not_called()

    def test_visibility_requires_staff_and_boolean_and_scopes_the_recording(self):
        for role in (None, 'learner', 'employer'):
            response = self.ns['recording_visibility'](self.req(role, method='POST'), series_id='S', artifact_id='A')
            self.assertIn(response.status_code, (401, 403))
        self.cursor.execute.assert_not_called()
        req = self.req('staff', method='POST'); req.body = b'{"hidden":"false"}'
        self.assertEqual(self.ns['recording_visibility'](req, 'S', 'A').status_code, 400)
        req.body = b'{"hidden":true}'
        self.cursor.fetchone.return_value = None
        self.assertEqual(self.ns['recording_visibility'](req, 'OTHER', 'A').status_code, 404)
        self.cursor.fetchone.return_value = ('A',)
        self.assertEqual(self.ns['recording_visibility'](req, 'S', 'A')['hiddenFromLearners'], True)
        sql, params = self.cursor.execute.call_args.args
        self.assertEqual(params, ['true', 'A', 'S'])
        self.assertIn("o.live_session_id=%s", sql)
        self.assertIn("a.artifact_type='recording'", sql)

    def test_pdf_export_is_staff_only_and_uses_saved_session_evidence(self):
        for role in (None, 'learner', 'employer'):
            response = self.ns['export_attendance'](self.req(role), series_id='S', session_number=1, file_format='pdf')
            self.assertIn(response.status_code, (401, 403))
        self.ns['read'].assert_not_called()
        self.ns['read'].return_value = [{'id': 'S'}]
        saved = {'id': 'O', 'attendance': []}
        self.ns['result_rows'] = Mock(return_value=[saved])
        pdf = types.ModuleType('curriculum_api.session_attendance_pdf')
        pdf.build_attendance_pdf = Mock(return_value=b'%PDF-synthetic')
        with patch.dict(sys.modules, {'curriculum_api.session_attendance_pdf': pdf}):
            response = self.ns['export_attendance'](self.req('staff'), series_id='S', session_number=1, file_format='pdf')
        pdf.build_attendance_pdf.assert_called_once_with(saved)
        self.assertEqual(response.content, b'%PDF-synthetic')
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertIn('.pdf', response['Content-Disposition'])
        self.cursor.execute.assert_not_called()

    def test_hidden_recording_and_transcript_downloads_are_denied_before_signing(self):
        self.ns['learner_series'] = Mock(return_value=(object(), {'id': 'S'}))
        self.ns['read'].return_value = [
            {'id': 'V', 'artifact_type': 'recording', 'content_correlation_id': 'pair', 'metadata': {'lmsHiddenFromLearners': True}},
            {'id': 'T', 'artifact_type': 'transcript', 'content_correlation_id': 'pair'},
        ]
        for kind in ('commercial', 'apprenticeship'):
            for artifact in ('V', 'T', 'OTHER'):
                response = self.ns['learner_content'](self.req('learner'), kind=kind, learner_id=7, series_id='S', artifact_id=artifact)
                self.assertEqual(response.status_code, 404)

    def test_hidden_media_is_removed_from_learner_result_payload(self):
        self.ns['apply_recovery'] = lambda rows: None
        self.ns['read'].side_effect = [[{'id': 'O', 'session_number': 1, 'status': 'completed',
            'scheduled_start': '2026-09-16T09:00Z', 'scheduled_end': '2026-09-16T10:00Z'}], [], [
            {'id': 'V', 'occurrence_id': 'O', 'artifact_type': 'recording', 'metadata': {'lmsHiddenFromLearners': True}},
            {'id': 'T', 'occurrence_id': 'O', 'artifact_type': 'transcript', 'transcript_text': 'Private speech'},
        ]]
        rows = self.ns['result_rows']({'id': 'S'}, session_number=1, email='a@example.invalid')
        self.assertEqual(rows[0]['artifacts'], [])
        self.assertNotIn('Private speech', json.dumps(rows, default=str))

    def test_employer_cannot_access_private_results(self):
        self.assertEqual(self.ns['learner_results'](self.req('employer'), kind='apprenticeship', learner_id=7, series_id='S', session_number=1).status_code, 403)

    def test_unassigned_module_rejected(self):
        self.ns['learner_series'] = Mock(return_value=(None, None))
        self.assertEqual(self.ns['learner_results'](self.req('learner'), kind='apprenticeship', learner_id=7, series_id='S', session_number=1).status_code, 404)

    def test_learner_results_filter_own_email(self):
        self.ns['learner_series'] = Mock(return_value=(types.SimpleNamespace(email=' A@EXAMPLE.invalid '), {'id': 'S'}))
        self.ns['result_rows'] = Mock(return_value=[])
        for kind in ('commercial', 'apprenticeship'):
            self.assertEqual(self.ns['learner_results'](self.req('learner'), kind=kind, learner_id=7, series_id='S', session_number=2).status_code, 200)
        self.ns['result_rows'].assert_called_with({'id': 'S'}, session_number=2, email='a@example.invalid')

    def test_result_rows_never_returns_other_students_or_graph_urls(self):
        self.ns['apply_recovery'] = lambda rows: None
        self.ns['read'].side_effect = [[{'id': 'O', 'session_number': 1, 'status': 'completed', 'attendance_report_id': 'R',
            'actual_end': '2026-09-16T10:00Z', 'scheduled_start': '2026-09-16T09:00Z', 'scheduled_end': '2026-09-16T10:00Z'}],
            [{'id': 'A', 'occurrence_id': 'O', 'email': 'a@example.invalid', 'total_attendance_seconds': 200, 'raw_data': {'private': True}}], []]
        rows = self.ns['result_rows']({'id': 'S', 'attendees': ['a@example.invalid', 'b@example.invalid']}, session_number=1, email='a@example.invalid')
        self.assertEqual(len(rows[0]['attendance']), 1)
        self.assertNotIn('raw_data', json.dumps(rows, default=str))
        self.assertEqual(self.ns['read'].call_args_list[0].args[1], ['S', 1])

    def test_launch_expectations_are_scoped_to_the_clicked_occurrence(self):
        functions(ROOT / 'session_results.py', {'launch_expectations'}, self.ns)
        self.ns['read'].return_value = [{'live_session_id': 'S', 'occurrence_id': 'O2', 'email': 'a@example.invalid'}]
        series, occurrences = self.ns['launch_expectations'](['S'], ['a@example.invalid'])
        self.assertEqual(series['S'], {'a@example.invalid'})
        self.assertEqual(occurrences['O1'], set())
        self.assertEqual(occurrences['O2'], {'a@example.invalid'})
        self.assertEqual(self.ns['read'].call_args.args[1], [['S'], ['a@example.invalid']])

    def test_queue_returns_202_without_graph_and_deduplicates(self):
        self.ns['read'].return_value = [{'id': 'S'}]
        self.cursor.execute.side_effect = lambda *args: self.ns['start_requested_sync'].assert_not_called()
        self.assertEqual(self.ns['queue_sync'](self.req(method='POST'), series_id='S').status_code, 202)
        query, params = self.cursor.execute.call_args.args
        self.assertIn("state NOT IN ('running','queued')", query)
        self.assertEqual(params, ['S'])
        self.ns['start_requested_sync'].assert_called_once_with('S')

    def test_request_start_failure_is_not_reported_as_success(self):
        self.ns['read'].return_value = [{'id': 'S'}]
        self.ns['start_requested_sync'].side_effect = RuntimeError('Cannot start thread')
        with self.assertLogs('test', level='ERROR'):
            response = self.ns['queue_sync'](self.req(method='POST'), series_id='S')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response['code'], 'session_sync_start_failed')
        self.assertNotIn('state', response)

    def test_only_staff_can_wake_requested_worker(self):
        for role in (None, 'learner', 'employer'):
            response = self.ns['queue_sync'](self.req(role, method='POST'), series_id='S')
            self.assertIn(response.status_code, (401, 403))
        self.ns['start_requested_sync'].assert_not_called()
        self.cursor.execute.assert_not_called()

    def test_session_status_reads_only_its_series_without_starting_work(self):
        job = {'live_session_id': 'S', 'state': 'failed', 'last_error': 'Retry required'}
        self.ns['read'].side_effect = [[{'id': 'S'}], [job]]
        self.ns['result_rows'] = Mock(return_value=[{'id': 'O', 'sessionNumber': 12}])
        response = self.ns['admin_session'](self.req(), series_id='S', session_number=12)
        self.assertEqual(response['job'], job)
        self.assertEqual(self.ns['read'].call_args.args[1], ['S'])
        self.ns['result_rows'].assert_called_once_with({'id': 'S'}, session_number=12)
        self.ns['start_requested_sync'].assert_not_called()

    def test_missing_job_table_does_not_hide_saved_session(self):
        self.ns['read'].side_effect = [[{'id': 'S'}], self.missing_archive()]
        self.ns['result_rows'] = Mock(return_value=[{'id': 'O'}])
        response = self.ns['admin_session'](self.req(), series_id='S', session_number=1)
        self.assertEqual(response['sessions'], [{'id': 'O'}])
        self.assertIsNone(response['job'])

    def missing_archive(self):
        cause = Exception('Missing archive table')
        cause.sqlstate = '42P01'
        error = self.ns['DatabaseError']('Storage unavailable')
        error.__cause__ = cause
        return error

    def test_module_index_retains_sessions_when_sync_setup_is_missing(self):
        self.ns['read'].side_effect = [[{'id': 'S', 'module_title': 'Example'}],
            [{'id': 'O', 'seriesId': 'S', 'sessionNumber': 1, 'startsAt': None,
              'endsAt': None, 'syncedAt': None, 'reportReady': True, 'fileCount': 2}], self.missing_archive()]
        response = self.ns['module_results'](self.req(), module_id='M')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response['series'][0]['sessions'][0]['id'], 'O')
        self.assertFalse(response['syncAvailable'])
        self.assertIn('needs setup', response['warning'])
        self.assertEqual(response['jobs'], [])
        self.assertEqual(self.ns['read'].call_args.args[1], [['S']])
        self.cursor.execute.assert_not_called()

    def test_module_index_does_not_hide_other_database_failures(self):
        self.ns['read'].side_effect = [[{'id': 'S', 'module_title': 'Example'}], [], self.ns['DatabaseError']('Read failed')]
        with self.assertLogs('test', level='ERROR'):
            response = self.ns['module_results'](self.req(), module_id='M')
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('series', response)

    def test_missing_archive_preserves_attendance_and_known_file_metadata(self):
        self.ns['apply_recovery'] = Mock()
        self.ns['read'].side_effect = [[{'id': 'O', 'session_number': 1, 'status': 'completed',
            'attendance_report_id': 'R', 'actual_end': '2026-09-16T10:00Z',
            'scheduled_start': '2026-09-16T09:00Z', 'scheduled_end': '2026-09-16T10:00Z'}],
            [{'occurrence_id': 'O', 'email': 'a@example.invalid', 'total_attendance_seconds': 240}],
            self.missing_archive(), [{'id': 'A', 'occurrence_id': 'O', 'artifact_type': 'recording',
            'created_datetime': None, 'archive_status': None, 'transcript_text': None}]]
        rows = self.ns['result_rows']({'id': 'S', 'attendees': ['a@example.invalid']}, session_number=1)
        self.assertFalse(rows[0]['archiveReady'])
        self.assertEqual(rows[0]['attendance'][0]['attendance'], 1)
        self.assertEqual(rows[0]['artifacts'][0]['state'], 'pending')
        self.assertNotIn('url', rows[0]['artifacts'][0])
        self.ns['apply_recovery'].assert_called_once_with(rows)
        self.assertEqual(self.ns['read'].call_args.args[1], [['O']])
        self.cursor.execute.assert_not_called()

    def test_missing_archive_queue_never_claims_success(self):
        self.ns['read'].return_value = [{'id': 'S'}]
        self.cursor.execute.side_effect = self.missing_archive()
        response = self.ns['queue_sync'](self.req(method='POST'), series_id='S')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response['code'], 'session_archive_setup_required')
        self.assertNotIn('state', response)
        self.ns['start_requested_sync'].assert_not_called()

    def test_pending_file_cannot_be_downloaded(self):
        self.ns['read'].return_value = [{'status': 'pending'}]
        self.assertEqual(self.ns['stored_content'](self.req(), 'S', 'A').status_code, 409)

    def test_file_signing_scoped_read_only_private_url(self):
        storage = types.ModuleType('learner_api.evidence_storage')
        storage.get_read_sas = Mock(return_value='https://storage.invalid/private/read')
        with patch.dict(sys.modules, {'learner_api.evidence_storage': storage}):
            self.ns['read'].return_value = [{'status': 'ready', 'artifact_type': 'recording', 'container': 'session-recordings', 'blob_name': 'M/G/S/file.mp4'}]
            response = self.ns['stored_content'](self.req(), 'S', 'A')
        self.assertEqual(response.status_code, 302)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.assertEqual(self.ns['read'].call_args.args[1], ['A', 'S'])
        storage.get_read_sas.assert_called_once_with('session-recordings', 'M/G/S/file.mp4', ttl_minutes=240)

    def test_timed_cues_are_read_from_database_without_signing_or_fetching_storage(self):
        cues = [{'start': 1, 'end': 3, 'speaker': 'Speaker', 'text': 'Saved words'}]
        self.ns['read'].return_value = [{'status': 'ready', 'artifact_type': 'transcript',
            'metadata': {'lmsTranscriptTimeline': {'version': 1, 'cues': cues}}}]
        req = self.req(); req.GET = {'format': 'cues'}
        response = self.ns['stored_content'](req, 'S', 'T')
        self.assertEqual(response['cues'], cues)
        self.assertEqual(response['Cache-Control'], 'private, no-store')
        self.cursor.execute.assert_not_called()
        self.ns['read'].return_value[0]['metadata'] = {}
        self.assertEqual(self.ns['stored_content'](req, 'S', 'T').status_code, 409)

    def test_expired_join_is_denied_without_launch_write(self):
        checks = types.ModuleType('curriculum_api.teams_calendar_checks'); checks.safe_teams_join_url = lambda value: True
        self.ns['learner_series'] = lambda *args: (types.SimpleNamespace(email='a@example.invalid'), {'id': 'S', 'status': 'active'})
        self.ns['read'].return_value = [{'id': 'O', 'status': 'completed', 'scheduled_end': '2026-09-16T10:00Z'}]
        with patch.dict(sys.modules, {'curriculum_api.teams_calendar_checks': checks}):
            response = self.ns['learner_join'](self.req('learner'), kind='commercial', learner_id=7, series_id='S', session_number=1)
        self.assertEqual(response.status_code, 410); self.cursor.execute.assert_not_called()

    def test_join_records_context_not_presence(self):
        checks = types.ModuleType('curriculum_api.teams_calendar_checks'); checks.safe_teams_join_url = lambda value: True
        self.ns['learner_series'] = lambda *args: (types.SimpleNamespace(email='a@example.invalid'), {'id': 'S', 'status': 'active'})
        self.ns['read'].return_value = [{'id': 'O', 'status': 'scheduled', 'scheduled_end': '2026-09-16T13:00Z', 'join_url': 'https://teams.microsoft.com/meet/example'}]
        with patch.dict(sys.modules, {'curriculum_api.teams_calendar_checks': checks}):
            response = self.ns['learner_join'](self.req('learner'), kind='commercial', learner_id=7, series_id='S', session_number=1)
        self.assertEqual(response.status_code, 302)
        query, params = self.cursor.execute.call_args.args
        self.assertIn('live_session_join_launches', query)
        self.assertNotIn('attendance_status', query)
        self.assertEqual(params[1:], ['S', 'O', 'a@example.invalid'])

    def test_approved_excuse_stays_absent_until_completed_matching_catchup(self):
        reports = types.ModuleType('learner_api.absence_reports')
        reports._kbc_attendance_report_id = lambda key: key
        for status, email, event_type, expected in [('scheduled', 'a@example.invalid', 'catch-up', 0),
            ('completed', 'other@example.invalid', 'catch-up', 0), ('completed', 'a@example.invalid', 'student-support', 0),
            ('completed', 'a@example.invalid', 'catch-up', 1)]:
            with self.subTest(status=status, email=email, event_type=event_type), patch.dict(sys.modules, {'learner_api.absence_reports': reports}):
                self.ns['read'].side_effect = [[{'enrolment_id': 7, 'email': 'a@example.invalid'}],
                    [{'attendance_id': '7:teams:O', 'learner_id': 7, 'status': 'approved', 'catchup_status': status,
                        'event_type': event_type, 'learner_email': email}]]
                rows = [{'id': 'O', 'attendance': session_roster(['a@example.invalid'], [], complete=True)}]
                self.ns['apply_recovery'](rows)
                person = rows[0]['attendance'][0]
                self.assertEqual(person['status'], 'absent')
                self.assertEqual(person['attendance'], 0)
                self.assertEqual(person['rawStatus'], 'absent')
                self.assertEqual(person['rawAttendance'], 0)
                self.assertEqual(person['effectiveAttendance'], expected)
                self.assertEqual(person['finalOutcome'], 'made_up' if expected else 'absent_excused')
                self.assertTrue(person['excused'])

    def test_only_approved_alternative_attendance_recovers_original_absence(self):
        reports = types.ModuleType('learner_api.absence_reports')
        reports._kbc_attendance_report_id = lambda key: key
        alternatives = types.ModuleType('learner_api.alternative_recovery')
        alternatives.alternative_occurrence_id = lambda key: str(key or '').removeprefix('alternative:')
        for approval, expected in [('pending', 0), ('approved', 1)]:
            with self.subTest(approval=approval), patch.dict(sys.modules, {
                'learner_api.absence_reports': reports,
                'learner_api.alternative_recovery': alternatives,
            }):
                self.ns['read'].side_effect = [
                    [{'enrolment_id': 7, 'email': 'a@example.invalid'}],
                    [{'attendance_id': '7:teams:O', 'learner_id': 7, 'status': approval,
                      'recovery_method': 'alternative', 'catchup_event_key': 'alternative:TARGET',
                      'catchup_status': None, 'event_type': None, 'learner_email': None}],
                    [{'occurrence_id': 'TARGET', 'email': 'a@example.invalid',
                      'total_attendance_seconds': 181, 'intervals': []}],
                    [{'id': 'TARGET', 'status': 'completed', 'actual_end': '2026-09-16T11:00Z',
                      'attendance_report_id': 'REPORT', 'scheduled_end': '2026-09-16T11:00Z'}],
                ]
                rows = [{'id': 'O', 'attendance': session_roster(['a@example.invalid'], [], complete=True)}]
                self.ns['apply_recovery'](rows)
                person = rows[0]['attendance'][0]
                self.assertEqual(person['rawAttendance'], 0)
                self.assertEqual(person['effectiveAttendance'], expected)
                self.assertEqual(person['finalOutcome'], 'made_up' if expected else 'absent')

    def test_approved_alternative_without_attendance_is_missed(self):
        reports = types.ModuleType('learner_api.absence_reports')
        reports._kbc_attendance_report_id = lambda key: key
        alternatives = types.ModuleType('learner_api.alternative_recovery')
        alternatives.alternative_occurrence_id = lambda key: str(key or '').removeprefix('alternative:')
        with patch.dict(sys.modules, {
            'learner_api.absence_reports': reports,
            'learner_api.alternative_recovery': alternatives,
        }):
            self.ns['read'].side_effect = [
                [{'enrolment_id': 7, 'email': 'a@example.invalid'}],
                [{'attendance_id': '7:teams:O', 'learner_id': 7, 'status': 'approved',
                  'recovery_method': 'alternative', 'catchup_event_key': 'alternative:TARGET',
                  'catchup_status': None, 'event_type': None, 'learner_email': None}],
                [],
                [{'id': 'TARGET', 'status': 'completed', 'actual_end': '2026-09-16T11:00Z',
                  'attendance_report_id': 'REPORT', 'scheduled_end': '2026-09-16T11:00Z'}],
            ]
            rows = [{'id': 'O', 'attendance': session_roster(['a@example.invalid'], [], complete=True)}]
            self.ns['apply_recovery'](rows)
            person = rows[0]['attendance'][0]
            self.assertEqual(person['recoveryStatus'], 'missed')
            self.assertEqual(person['effectiveAttendance'], 0)
            self.assertEqual(person['finalOutcome'], 'absent_excused')


class ArchiveWorkerTests(unittest.TestCase):
    def setUp(self):
        network = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        network.start(); self.addCleanup(network.stop)
        self.transport = types.ModuleType('coach_api.views')
        self.transport.get_graph_settings = lambda: {'base_url': 'https://graph.microsoft.com/v1.0'}
        self.transport.microsoft_graph_token = Mock(return_value='synthetic-token')
        self.storage = types.ModuleType('learner_api.evidence_storage')
        self.storage.upload_blob = Mock()
        self.views = types.ModuleType('curriculum_api.views')
        self.views.teams_online_meeting_owner_id = lambda *args: 'owner'
        modules = patch.dict(sys.modules, {'coach_api.views': self.transport,
            'learner_api.evidence_storage': self.storage, 'curriculum_api.views': self.views})
        modules.start(); self.addCleanup(modules.stop)

    def archive(self, *, state=None, exists=True, failure=False, kind='recording', timed=False, headers=None):
        blob = Mock(); blob.exists.return_value = exists
        blob.download_blob.return_value.readall.return_value = b'WEBVTT\n\n00:00:01.000 --> 00:00:03.000\n<v Speaker>Hello</v>'
        client = Mock(); client.get_blob_client.return_value = blob
        response = Mock()
        response.iter_bytes.return_value = ([b'WEBVTT\n\n1\n00:01 --> 00:03\n<v Speaker>Hello</v>']
            if kind == 'transcript' else [b'synthetic-', b'movie'])
        if failure:
            response.raise_for_status.side_effect = RuntimeError('synthetic private error')
        http = Mock()
        def graph_content(_method, _url, *, headers):
            if kind == 'transcript' and headers.get('Accept') != 'text/vtt':
                raise RuntimeError('Graph requires a supported transcript content format')
            return nullcontext(response)
        response.headers = headers or {}
        http.stream.side_effect = graph_content
        self.ns = {'__name__': 'curriculum_api.session_archive', '__package__': 'curriculum_api',
            'read': Mock(side_effect=[[{'id': 'S', 'module_catalogue_id': 'M', 'module_title': 'Calculus',
                'organizer_email': 'owner@example.invalid', 'online_meeting_id': 'meeting', 'join_url': 'https://teams.microsoft.com/meet/example'}],
                [{'group_id': 'G', 'group_name': 'Group'}], [{'id': 'O', 'session_number': 1}],
                [{'id': 'A', 'occurrence_id': 'O', 'artifact_type': kind, 'graph_artifact_id': 'GRA', 'saved_status': state,
                  'saved_name': 'existing/module/session/recording.mp4' if exists else None}]]),
            'storage_client': lambda: client, 'CONTAINER': 'session-recordings', 'archive_prefix': archive_prefix,
            'transcript_text': transcript_text, 'transcript_timing_ready': lambda artifact: timed,
            'save_transcript_timing': Mock(), 'TransferProgress': Mock(), 'byte_count': byte_count,
            'save_archive': Mock(), 'tempfile': tempfile, 'httpx': types.SimpleNamespace(Client=lambda **kwargs: nullcontext(http)),
            'quote': __import__('urllib.parse', fromlist=['quote']).quote,
            'ResourceExistsError': type('ResourceExistsError', (Exception,), {}),
            'result_rows': lambda series: [], 'log': Mock()}
        functions(ROOT / 'session_archive.py', {'archive_series'}, self.ns)
        return self.ns['archive_series']('S', lease_id='owned-lease'), blob

    def test_ready_recording_does_not_redownload_or_reupload(self):
        errors, blob = self.archive(state='ready')
        self.assertEqual(errors, [])
        self.transport.microsoft_graph_token.assert_not_called()
        self.storage.upload_blob.assert_not_called(); blob.exists.assert_not_called()

    def test_existing_transcript_backfills_timings_without_graph_or_any_reupload(self):
        errors, blob = self.archive(state='ready', kind='transcript')
        self.assertEqual(errors, [])
        self.ns['save_transcript_timing'].assert_called_once()
        self.transport.microsoft_graph_token.assert_not_called()
        self.storage.upload_blob.assert_not_called()
        blob.upload_blob.assert_not_called()
        errors, blob = self.archive(state='ready', kind='transcript', timed=True)
        self.assertEqual(errors, [])
        blob.download_blob.assert_not_called()
        self.ns['save_transcript_timing'].assert_not_called()

    def test_uploaded_file_after_crash_is_reused_at_original_path(self):
        errors, _ = self.archive()
        self.assertEqual(errors, [])
        self.transport.microsoft_graph_token.assert_not_called()
        self.storage.upload_blob.assert_not_called()
        self.assertEqual(self.ns['save_archive'].call_args.args[1], 'existing/module/session/recording.mp4')

    def test_recording_streams_to_bounded_upload_without_overwrite(self):
        captured = []
        self.storage.upload_blob.side_effect = lambda stream, *args, **kwargs: captured.append((stream.read(), args, kwargs))
        errors, _ = self.archive(exists=False)
        self.assertEqual(errors, [])
        self.assertEqual(captured[0][0], b'synthetic-movie')
        self.assertEqual(captured[0][1][0], 'session-recordings')
        self.assertEqual(captured[0][2], {'overwrite': False, 'upload_block_bytes': 4194304, 'max_concurrency': 2,
            'progress_hook': self.ns['TransferProgress'].return_value.uploaded})

    def test_reports_actual_download_bytes_then_upload_phase_without_invented_total(self):
        errors, _ = self.archive(exists=False)
        self.assertEqual(errors, [])
        reporter = self.ns['TransferProgress'].return_value
        reporter.update.assert_any_call('downloading', 15, None, force=True)
        reporter.update.assert_any_call('uploading', 0, 15)
        self.assertEqual(reporter.update.call_args.args, ('finalizing',))

    def test_known_download_size_and_encoded_response_do_not_share_a_false_percentage(self):
        for headers, total in [({'Content-Length': '15'}, 15),
                               ({'Content-Length': '10', 'Content-Encoding': 'gzip'}, None),
                               ({'Content-Length': 'invalid'}, None)]:
            with self.subTest(headers=headers):
                errors, _ = self.archive(exists=False, headers=headers)
                self.assertEqual(errors, [])
                self.ns['TransferProgress'].return_value.update.assert_any_call('downloading', 15, total, force=True)

    def test_archive_failure_is_visible_and_never_marked_ready(self):
        errors, _ = self.archive(exists=False, failure=True)
        self.assertEqual(len(errors), 1)
        self.assertNotIn('synthetic private error', errors[0])
        self.assertEqual(self.ns['save_archive'].call_args.kwargs['state'], 'failed')
        self.storage.upload_blob.assert_not_called()

    def test_transcript_requests_vtt_and_archives_readable_text(self):
        captured = []
        self.storage.upload_blob.side_effect = lambda stream, *args, **kwargs: captured.append((stream.read(), args))
        errors, blob = self.archive(exists=False, kind='transcript')
        self.assertEqual(errors, [])
        self.assertTrue(captured[0][0].startswith(b'WEBVTT'))
        self.assertEqual(captured[0][1][-1], 'text/vtt')
        self.assertEqual(self.ns['save_archive'].call_args.kwargs['text'], 'Speaker: Hello')
        blob.upload_blob.assert_called_once_with(b'Speaker: Hello', overwrite=True)

    def worker(self, *, queued=True, partial=False):
        cursor = Mock(); cursor.__enter__ = Mock(return_value=cursor); cursor.__exit__ = Mock(return_value=False)
        cursor.fetchone.side_effect = [('S', True), None] if queued else [None]
        self.views.curriculum_teams_meeting_artifacts = Mock(return_value=Response(json.dumps({'errors': ['partial'] if partial else []}), 207 if partial else 200))
        ns = {'BaseCommand': object, 'CommandError': RuntimeError, 'json': json, 'uuid': uuid, 'logging': logging,
            'connections': {'default': types.SimpleNamespace(cursor=lambda: cursor)},
            'transaction': types.SimpleNamespace(atomic=nullcontext), 'archive_series': Mock(return_value=[]),
            'RequestFactory': lambda: types.SimpleNamespace(post=lambda path: types.SimpleNamespace())}
        tree = ast.parse((ROOT / 'management/commands/process_session_results.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.ClassDef))
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'worker', 'exec'), ns)
        command = ns['Command'](); command.stdout = Mock()
        return command, ns, cursor

    def test_idle_worker_performs_no_external_calls(self):
        command, ns, _ = self.worker(queued=False)
        command.handle(limit=2, scheduled=False, provision_container=False)
        self.views.curriculum_teams_meeting_artifacts.assert_not_called()
        ns['archive_series'].assert_not_called()

    def test_worker_claims_with_lock_and_finishes_only_owned_lease(self):
        command, ns, cursor = self.worker()
        command.handle(limit=2, scheduled=False, provision_container=False)
        queries = cursor.execute.call_args_list
        self.assertIn('FOR UPDATE SKIP LOCKED', queries[0].args[0])
        finish = next(call for call in queries if 'finished_at=now()' in call.args[0])
        self.assertIn('lease_id=%s', finish.args[0])
        self.assertIn('requested_at>started_at', finish.args[0])
        self.assertEqual(finish.args[1][0], 'complete')
        self.assertTrue(self.views.curriculum_teams_meeting_artifacts.call_args.args[0].session_result_force)
        ns['archive_series'].assert_called_once_with('S', lease_id=queries[1].args[1][0])

    def test_targeted_worker_limits_both_queued_and_expired_jobs_to_requested_series(self):
        command, ns, cursor = self.worker()
        command.handle(limit=2, scheduled=False, provision_container=False, live_session_ids=[' S ', 'S'])
        claim = cursor.execute.call_args_list[0]
        self.assertEqual(claim.args[1], [['S']])
        self.assertIn("interval '2 hours')) AND live_session_id=ANY(%s)", claim.args[0])
        self.assertIn('FOR UPDATE SKIP LOCKED', claim.args[0])
        ns['archive_series'].assert_called_once_with('S', lease_id=cursor.execute.call_args_list[1].args[1][0])

    def test_targeted_scheduled_worker_queues_only_requested_series(self):
        command, ns, cursor = self.worker(queued=False)
        command.handle(limit=2, scheduled=True, provision_container=False, live_session_ids=['S'])
        scheduled, claim = cursor.execute.call_args_list
        self.assertIn('AND o.live_session_id=ANY(%s)', scheduled.args[0])
        self.assertEqual(scheduled.args[1], [['S']])
        self.assertEqual(claim.args[1], [['S']])
        ns['archive_series'].assert_not_called()

    def test_discovery_does_not_exclude_early_or_late_recordings_by_planned_date(self):
        command, _, cursor = self.worker(queued=False)
        command.handle(limit=2, scheduled=True, provision_container=False)
        selection = cursor.execute.call_args_list[0].args[0]
        self.assertNotIn('scheduled_end', selection)
        self.assertIn("coalesce(s.online_meeting_id,'')<>''", selection)
        self.assertIn('m.deleted_at IS NULL', selection)
        self.assertIn("session_result_jobs.state='complete'", selection)
        self.assertIn("interval '5 minutes'", selection)

    def test_default_worker_keeps_processing_the_shared_queue(self):
        command, _, cursor = self.worker(queued=False)
        command.handle(limit=2, scheduled=False, provision_container=False)
        claim = cursor.execute.call_args_list[0]
        self.assertNotIn('live_session_id=ANY', claim.args[0])
        self.assertEqual(claim.args[1], [])

    def test_legacy_scheduler_passes_explicit_series_scope_to_worker(self):
        cursor = Mock(); cursor.__enter__ = Mock(return_value=cursor); cursor.__exit__ = Mock(return_value=False)
        queryset = Mock()
        queryset.filter.return_value = queryset
        queryset.order_by.return_value.values_list.return_value = ['S']
        ns = {'BaseCommand': object, 'CommandError': RuntimeError, 'timedelta': timedelta,
              'timezone': types.SimpleNamespace(now=lambda: datetime(2026, 9, 16, tzinfo=timezone.utc)),
              'has_graph_credentials': lambda: True, 'call_command': Mock(),
              'LiveSessionOccurrence': types.SimpleNamespace(objects=queryset),
              'connections': {'default': types.SimpleNamespace(cursor=lambda: cursor)}}
        tree = ast.parse((ROOT / 'management/commands/sync_teams_meeting_artifacts.py').read_text(encoding='utf-8'))
        node = next(n for n in tree.body if isinstance(n, ast.ClassDef))
        exec(compile(ast.Module(body=[node], type_ignores=[]), 'scheduler', 'exec'), ns)
        command = ns['Command'](); command.stdout = Mock(); command.stderr = Mock()
        archive = types.ModuleType('coach_api.recording_archive')
        archive.archive_configured = Mock(return_value=False)
        with patch.dict(sys.modules, {'coach_api': types.ModuleType('coach_api'), 'coach_api.recording_archive': archive}):
            command.handle(lookback_hours=168, limit=1, coach_limit=1, skip_coach_meetings=True, live_session_ids=['S'])
        archive.archive_configured.assert_called_once_with()
        ns['call_command'].assert_called_once_with('process_session_results', limit=1, scheduled=True,
            live_session_ids=['S'], stdout=command.stdout, stderr=command.stderr)

    def test_partial_graph_success_archives_available_files_and_schedules_retry(self):
        command, ns, cursor = self.worker(partial=True)
        with self.assertRaises(RuntimeError):
            command.handle(limit=2, scheduled=False, provision_container=False)
        ns['archive_series'].assert_called_once_with('S', lease_id=cursor.execute.call_args_list[1].args[1][0])
        finish = next(call for call in cursor.execute.call_args_list if 'finished_at=now()' in call.args[0])
        self.assertEqual(finish.args[1][0], 'failed')


if __name__ == '__main__':
    with patch('socket.socket', side_effect=AssertionError('Network forbidden')):
        unittest.main(verbosity=2)
