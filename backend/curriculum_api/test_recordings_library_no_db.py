"""Direct regression runner: stdlib/AST only; no Django setup, DB or network."""
import ast
import json
import re
import sys
import types
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path, PurePosixPath
from unittest.mock import Mock
from zoneinfo import ZoneInfo

ROOT = Path(__file__).parent
package = types.ModuleType('curriculum_api')
package.__path__ = [str(ROOT)]
sys.modules['curriculum_api'] = package
from curriculum_api.session_media_policy import artifact_metadata
from curriculum_api.session_results_policy import instant
from curriculum_api.session_component_identity import TIMEZONE_ALIASES


def functions(path, names, namespace):
    tree = ast.parse(path.read_text(encoding='utf-8-sig'))
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    assert len(nodes) == len(names), (path, names)
    for node in nodes:
        node.decorator_list = []
    exec(compile(ast.Module(body=nodes, type_ignores=[]), str(path), 'exec'), namespace)


def recording(**values):
    row = {'artifact_id': 'A1', 'series_id': 'S1', 'occurrence_id': 'O1', 'session_number': 1,
           'scheduled_start': datetime(2026, 9, 7, 9, tzinfo=timezone.utc),
           'created_datetime': datetime(2026, 9, 7, 9, 2, tzinfo=timezone.utc), 'end_datetime': None,
           'metadata': {}, 'module_catalogue_id': 'M-A', 'module_title': 'Data Analysis',
           'programme_name': 'Level 4', 'cohort_name': 'Sep 26', 'group_name': 'Group A', 'programme_status': 'active',
           'archive_status': 'ready'}
    row.update(values)
    return row


WEEKS = [{'id': 'W1', 'module_catalogue_id': 'M-A', 'week_number': 1, 'title': 'Intro', 'display_order': 0},
         {'id': 'W2', 'module_catalogue_id': 'M-A', 'week_number': 2, 'title': 'Cleaning', 'display_order': 1},
         {'id': 'W3', 'module_catalogue_id': 'M-A', 'week_number': 3, 'title': 'Guest', 'display_order': 2}]


def component(week_id, **settings):
    return {'week_id': week_id, 'module_catalogue_id': 'M-A', 'settings_json': json.dumps(settings)}


LIBRARY_FUNCTIONS = {'_settings', '_text', '_iso', 'week_owners', 'recording_week', 'programme_active',
                     'recording_status', 'same_recording_key', 'session_attention', 'attention_by_module',
                     '_component_start', 'module_index', 'calendar_sessions', 'placement_review_ids',
                     '_delivery', 'build_library',
                     'recordings_library'}


def library_namespace():
    ns = {'json': json, 'instant': instant, 'artifact_metadata': artifact_metadata,
          'datetime': datetime, 'timezone': timezone, 'timedelta': timedelta,
          'ZoneInfo': ZoneInfo, 'ZoneInfoNotFoundError': __import__('zoneinfo').ZoneInfoNotFoundError,
          'TIMEZONE_ALIASES': TIMEZONE_ALIASES,
          'RECORDING_PROCESSING': timedelta(hours=2), 'DEFAULT_SESSION_LENGTH': timedelta(hours=2),
          'RUN_DATE_TOLERANCE': timedelta(hours=12)}
    functions(ROOT / 'recordings_library.py', LIBRARY_FUNCTIONS, ns)
    return ns


class RecordingsLibraryTests(unittest.TestCase):
    def setUp(self):
        self.ns = library_namespace()

    def weeks_of(self, payload, delivery=0):
        return payload['deliveries'][delivery]['weeks']

    def test_week_comes_from_the_component_that_owns_the_occurrence_not_the_session_count(self):
        # Session 2 was cancelled; session 3 is week 2's. Counting would file it under week 3.
        payload = self.ns['build_library'](
            [recording(artifact_id='A1', occurrence_id='O1', session_number=1),
             recording(artifact_id='A3', occurrence_id='O3', session_number=3)],
            WEEKS, [component('W1', teamsOccurrenceId='O1'), component('W2', teamsOccurrenceId='O3')])
        weeks = self.weeks_of(payload)
        self.assertEqual([(week['weekNumber'], [r['id'] for r in week['recordings']]) for week in weeks],
                         [(1, ['A1']), (2, ['A3'])])

    def test_series_and_session_number_pair_when_no_occurrence_id_is_stored(self):
        payload = self.ns['build_library']([recording(occurrence_id='O9', session_number=4)], WEEKS,
                                           [component('W2', teamsLiveSessionId='S1', teamsSessionNumber='4')])
        self.assertEqual(self.weeks_of(payload)[0]['weekId'], 'W2')

    def test_additional_week_meeting_files_under_its_own_week(self):
        payload = self.ns['build_library']([recording(series_id='EXTRA', occurrence_id='OX')], WEEKS,
                                           [component('W3', extraTeamsLiveSessionId='EXTRA')])
        self.assertEqual(self.weeks_of(payload)[0]['title'], 'Guest')

    def test_explicit_recorded_day_places_shared_session_files_in_their_actual_weeks(self):
        rows = [recording(artifact_id='EVENT', created_datetime=datetime(2026, 10, 2, 10, 35, tzinfo=timezone.utc)),
                recording(artifact_id='LECTURE', created_datetime=datetime(2026, 10, 9, 8, tzinfo=timezone.utc))]
        components = [component('W2', recordingSeriesId='S1', recordingDate='2026-10-02'),
                      component('W3', teamsOccurrenceId='O1', teamsLiveSessionId='S1',
                                teamsSessionNumber=1, recordingDate='2026-10-09')]
        payload = self.ns['build_library'](rows, WEEKS, components, placement_reviews={'EVENT'})
        self.assertEqual([(week['weekId'], [item['id'] for item in week['recordings']])
                          for week in self.weeks_of(payload)],
                         [('W2', ['EVENT']), ('W3', ['LECTURE'])])
        self.assertFalse(self.weeks_of(payload)[0]['recordings'][0]['placementReview'])

    def test_unclaimed_recording_is_listed_last_not_dropped(self):
        payload = self.ns['build_library'](
            [recording(artifact_id='LOST', occurrence_id='O7'), recording(artifact_id='A1')],
            WEEKS, [component('W1', teamsOccurrenceId='O1')])
        weeks = self.weeks_of(payload)
        self.assertEqual([week['weekId'] for week in weeks], ['W1', None])
        self.assertEqual(weeks[1]['recordings'][0]['id'], 'LOST')
        self.assertEqual(payload['recordingCount'], 2)

    def test_each_delivery_carries_its_programme_cohort_and_group_in_drill_down_order(self):
        rows = [recording(artifact_id='B', module_catalogue_id='M-B', group_name='Group B', occurrence_id='OB'),
                recording(artifact_id='C', module_catalogue_id='M-C', cohort_name='Jan 27', group_name='Group C',
                          programme_name='Level 3', occurrence_id='OC'),
                recording(artifact_id='A', occurrence_id='O1')]
        payload = self.ns['build_library'](rows, WEEKS, [component('W1', teamsOccurrenceId='O1')])
        self.assertEqual([(d['programme'], d['cohort'], d['group'], d['moduleId'], d['recordingCount'])
                          for d in payload['deliveries']],
                         [('Level 3', 'Jan 27', 'Group C', 'M-C', 1), ('Level 4', 'Sep 26', 'Group A', 'M-A', 1),
                          ('Level 4', 'Sep 26', 'Group B', 'M-B', 1)])

    def test_draft_and_archived_programmes_are_not_active(self):
        rows = [recording(artifact_id=status or 'none', module_catalogue_id=f'M-{status}', programme_status=status)
                for status in ('active', 'Archived', 'draft', None)]
        payload = self.ns['build_library'](rows, WEEKS, [])
        self.assertEqual({d['moduleId']: d['programmeActive'] for d in payload['deliveries']},
                         {'M-active': True, 'M-Archived': False, 'M-draft': False, 'M-None': True})

    def test_recording_state_and_hidden_flag_are_reported(self):
        payload = self.ns['build_library'](
            [recording(archive_status=None, metadata=json.dumps({'lmsHiddenFromLearners': True}))], WEEKS, [])
        item = self.weeks_of(payload)[0]['recordings'][0]
        self.assertEqual(item['state'], 'pending')
        self.assertTrue(item['hiddenFromLearners'])
        self.assertEqual(item['startsAt'], '2026-09-07T09:00:00Z')

    def test_recording_from_another_day_is_kept_but_requires_placement_review(self):
        scheduled = datetime(2026, 10, 14, 8, tzinfo=timezone.utc)
        rows = [recording(artifact_id='EARLY', scheduled_start=scheduled,
                          created_datetime=datetime(2026, 10, 12, 9, tzinfo=timezone.utc)),
                recording(artifact_id='LECTURE', scheduled_start=scheduled,
                          created_datetime=datetime(2026, 10, 14, 7, 55, tzinfo=timezone.utc))]
        runs = [occurrence(scheduled_start=scheduled, series_timezone='Europe/London')]
        review = self.ns['placement_review_ids'](rows, runs)
        self.assertEqual(review, {'EARLY'})
        payload = self.ns['build_library'](rows, WEEKS, [component('W1', teamsOccurrenceId='O1')],
                                           placement_reviews=review)
        items = self.weeks_of(payload)[0]['recordings']
        self.assertEqual({item['id']: item['placementReview'] for item in items},
                         {'EARLY': True, 'LECTURE': False})

    def test_a_rescheduled_run_on_its_own_calendar_day_is_not_flagged(self):
        rows = [recording(artifact_id='RUN', occurrence_id='O2',
                          scheduled_start=datetime(2026, 10, 14, 8, tzinfo=timezone.utc),
                          created_datetime=datetime(2026, 10, 14, 22, tzinfo=timezone.utc))]
        runs = [occurrence(id='O2', scheduled_start=datetime(2026, 10, 14, 8, tzinfo=timezone.utc),
                           series_timezone='Europe/London')]
        self.assertEqual(self.ns['placement_review_ids'](rows, runs), set())

    def test_endpoint_reads_only_and_is_staff_gated(self):
        tree = ast.parse((ROOT / 'recordings_library.py').read_text(encoding='utf-8'))
        view = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == 'recordings_library')
        self.assertIn("require_role('admin', 'staff')", [ast.unparse(d) for d in view.decorator_list])
        sql = ' '.join(node.value for statement in tree.body if isinstance(statement, ast.Assign)
                       for node in ast.walk(statement.value)
                       if isinstance(node, ast.Constant) and isinstance(node.value, str)).upper()
        self.assertIn('SELECT', sql)
        self.assertIn('SESSION_RESULT_JOBS', sql)
        for verb in ('INSERT ', 'UPDATE ', 'DELETE ', 'TRUNCATE'):
            self.assertNotIn(verb, sql)
        imports = [ast.unparse(node) for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))]
        self.assertFalse([line for line in imports if 'graph' in line.lower() or 'sync' in line.lower()])

    def test_endpoint_skips_week_reads_when_nothing_is_recorded(self):
        self.ns['read'] = Mock(return_value=[])
        self.ns['JsonResponse'] = lambda data: {'data': data}
        self.ns['DatabaseError'] = type('DatabaseError', (Exception,), {})
        self.ns.update(MODULES_SQL='M', RECORDINGS_SQL='R', WEEKS_SQL='W', LIVE_COMPONENTS_SQL='C',
                       ATTENTION_COMPONENTS_SQL='AC', CALENDAR_COMPONENTS_SQL='CC', OCCURRENCES_SQL='O')
        response = self.ns['recordings_library'](types.SimpleNamespace())
        self.assertEqual(response['data'], {'deliveries': [], 'recordingCount': 0,
                                          'attentionChecked': True, 'sessions': [], 'modules': [],
                                          'calendarAvailable': True})
        self.assertEqual([call.args[0] for call in self.ns['read'].call_args_list], ['M', 'R', 'AC', 'CC', 'O'])

    def test_recordings_still_list_when_the_session_checks_cannot_be_read(self):
        error = type('DatabaseError', (Exception,), {})
        self.ns['DatabaseError'] = error
        self.ns['JsonResponse'] = lambda data: {'data': data}
        self.ns.update(MODULES_SQL='M', RECORDINGS_SQL='R', WEEKS_SQL='W', LIVE_COMPONENTS_SQL='C',
                       ATTENTION_COMPONENTS_SQL='AC', CALENDAR_COMPONENTS_SQL='CC', OCCURRENCES_SQL='O')
        self.ns['read'] = Mock(side_effect=lambda sql, *args: (_ for _ in ()).throw(error()) if sql == 'AC'
                               else ([recording()] if sql == 'R' else []))
        data = self.ns['recordings_library'](types.SimpleNamespace())['data']
        self.assertEqual(data['recordingCount'], 1)
        self.assertFalse(data['attentionChecked'])
        self.assertFalse(data['calendarAvailable'])

    def test_calendar_uses_authored_lecture_title_and_owning_occurrence(self):
        components = [
            {'component_title': 'Intro to analysis', 'week_id': 'W1', 'week_number': 1,
             'week_title': 'Week 1', 'module_catalogue_id': 'M-A', 'module_title': 'Data Analysis',
             'programme_name': 'Level 4', 'cohort_name': 'Sep 26', 'group_name': 'A',
             'programme_status': 'active', 'settings_json': json.dumps({'teamsOccurrenceId': 'O1'})},
            {'component_title': 'Different lecture', 'week_id': 'W2', 'week_number': 2,
             'week_title': 'Week 2', 'module_catalogue_id': 'M-A', 'module_title': 'Data Analysis',
             'programme_name': 'Level 4', 'cohort_name': 'Sep 26', 'group_name': 'A',
             'programme_status': 'active', 'settings_json': json.dumps({'teamsOccurrenceId': 'O3'})},
        ]
        sessions = self.ns['calendar_sessions'](components, [occurrence(id='O1'), occurrence(id='O3', session_number=3)])
        self.assertEqual([(item['title'], item['weekNumber'], item['occurrenceId']) for item in sessions],
                         [('Intro to analysis', 1, 'O1'), ('Different lecture', 2, 'O3')])
        self.assertEqual(sessions[0]['startsAt'], '2026-10-08T08:00:00Z')
        self.assertEqual(sessions[0]['joinUrl'], 'https://teams.microsoft.com/l/meetup-join/example')

    def test_calendar_includes_an_extra_week_meeting_and_labels_cancelled_runs(self):
        component = {'component_title': 'Guest lecture', 'week_id': 'W3', 'week_number': 3,
                     'week_title': 'Guest', 'module_catalogue_id': 'M-A', 'module_title': 'Data Analysis',
                     'programme_name': 'Level 4', 'cohort_name': 'Sep 26', 'group_name': 'A',
                     'programme_status': 'active',
                     'settings_json': json.dumps({'teamsOccurrenceId': 'O1', 'extraTeamsLiveSessionId': 'EX'})}
        sessions = self.ns['calendar_sessions']([component], [occurrence(),
            occurrence(id='OX', live_session_id='EX'),
            occurrence(id='OC', live_session_id='EX', status='cancelled')])
        self.assertEqual({item['occurrenceId'] for item in sessions}, {'O1', 'OX', 'OC'})
        cancelled = next(item for item in sessions if item['occurrenceId'] == 'OC')
        self.assertEqual(cancelled['status'], 'cancelled')
        self.assertEqual(cancelled['joinUrl'], '')

    def test_calendar_lists_unlinked_lms_occurrences_with_saved_module_title(self):
        rows = [occurrence(id='O1'), occurrence(id='O2', session_number=2,
                 scheduled_start=datetime(2026, 10, 14, 8, tzinfo=timezone.utc)),
                occurrence(id='O3', module_catalogue_id=None, live_session_id='S2',
                 series_module_title='Guest Teams lecture')]
        sessions = self.ns['calendar_sessions']([], rows, NOW)
        self.assertEqual(len(sessions), 3)
        by_id = {item['occurrenceId']: item for item in sessions}
        self.assertEqual([by_id[key]['title'] for key in ('O1', 'O2', 'O3')],
                         ['Data Analysis', 'Data Analysis', 'Guest Teams lecture'])
        self.assertEqual([item['weekNumber'] for item in sessions], [None, None, None])
        self.assertEqual(by_id['O1']['attentionStatus'], 'notRecorded')
        self.assertEqual(by_id['O3']['moduleId'], 'live-session:S2')

    def test_calendar_matches_a_component_only_within_its_module(self):
        owner = {'component_title': 'Own lecture', 'week_id': 'W1', 'week_number': 1,
                 'week_title': 'Introduction', 'module_catalogue_id': 'M-A',
                 'settings_json': json.dumps({'teamsOccurrenceId': 'O1'})}
        other = occurrence(id='O1', module_catalogue_id='M-B', module_title='Other module',
                           series_module_title='Other module')
        session = self.ns['calendar_sessions']([owner], [other])[0]
        self.assertEqual(session['title'], 'Other module')
        self.assertIsNone(session['weekId'])

    def test_all_modules_are_indexed_even_without_a_meeting(self):
        rows = [{'module_catalogue_id': 'M-A', 'title': 'Data Analysis', 'programme_name': 'Level 4',
                 'cohort_name': 'Sep 26', 'group_name': 'Group A', 'programme_status': 'active'},
                {'module_catalogue_id': 'M-B', 'title': 'Unscheduled Module', 'programme_name': 'Draft',
                 'cohort_name': '', 'group_name': '', 'programme_status': 'draft'}]
        modules = self.ns['module_index'](rows)
        self.assertEqual([item['moduleId'] for item in modules], ['M-A', 'M-B'])
        self.assertFalse(modules[1]['programmeActive'])

    def test_authored_session_without_a_booked_occurrence_is_planned_not_recorded(self):
        component = {'component_id': 'C1', 'component_title': 'Lecture plan', 'week_id': 'W1',
                     'week_number': 1, 'week_title': 'Intro', 'module_catalogue_id': 'M-A',
                     'module_title': 'Data Analysis', 'programme_name': 'Level 4',
                     'cohort_name': 'Sep 26', 'group_name': 'A', 'programme_status': 'active',
                     'settings_json': {'sessionDate': '2026-10-08', 'sessionTime': '09:00',
                                       'durationMinutes': 90, 'liveSessionUrl': 'https://teams.microsoft.com/inherited'}}
        sessions = self.ns['calendar_sessions']([component], [])
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]['source'], 'authored')
        self.assertEqual(sessions[0]['status'], 'planned')
        self.assertEqual(sessions[0]['joinUrl'], '')
        self.assertEqual(sessions[0]['endsAt'], '2026-10-08T09:30:00Z')

    def test_authored_clock_uses_its_named_zone_and_daylight_saving_rules(self):
        start = self.ns['_component_start']
        cairo = {'sessionDate': '2026-10-14', 'sessionTime': '11:00', 'sessionTimeZone': 'Africa/Cairo'}
        london = {**cairo, 'sessionTimeZone': 'Europe/London'}
        self.assertEqual(start(cairo), datetime(2026, 10, 14, 8, tzinfo=timezone.utc))
        self.assertEqual(start(london), datetime(2026, 10, 14, 10, tzinfo=timezone.utc))
        # Britain has moved to summer time before Egypt has, so the offset is
        # one hour on this date rather than a fixed two-hour adjustment.
        self.assertEqual(start({**cairo, 'sessionDate': '2026-04-01'}),
                         datetime(2026, 4, 1, 9, tzinfo=timezone.utc))
        self.assertEqual(start({**london, 'sessionDate': '2026-04-01'}),
                         datetime(2026, 4, 1, 10, tzinfo=timezone.utc))

    def test_unique_authored_time_enriches_an_occurrence_instead_of_duplicating_it(self):
        component = {'component_id': 'C1', 'component_title': 'Real lecture title', 'week_id': 'W1',
                     'week_number': 1, 'week_title': 'Intro', 'module_catalogue_id': 'M-A',
                     'settings_json': {'sessionDateTimeUtc': '2026-10-08T08:00:00Z'}}
        sessions = self.ns['calendar_sessions']([component], [occurrence()])
        self.assertEqual(len(sessions), 1)
        self.assertEqual(sessions[0]['source'], 'occurrence')
        self.assertEqual(sessions[0]['title'], 'Real lecture title')

    def test_processing_constants_match_the_module(self):
        source = (ROOT / 'recordings_library.py').read_text(encoding='utf-8')
        for line in ('RECORDING_PROCESSING = timedelta(hours=2)', 'DEFAULT_SESSION_LENGTH = timedelta(hours=2)',
                     'RUN_DATE_TOLERANCE = timedelta(hours=12)'):
            self.assertIn(line, source)


NOW = datetime(2026, 10, 9, 12, tzinfo=timezone.utc)


def occurrence(**values):
    row = {'id': 'O1', 'live_session_id': 'S1', 'session_number': 1,
           'module_catalogue_id': 'M-A', 'module_title': 'Data Analysis',
           'series_module_title': 'Data Analysis', 'programme_name': 'Level 4',
           'cohort_name': 'Sep 26', 'group_name': 'A', 'programme_status': 'active',
           'module_archived': False, 'join_url': 'https://teams.microsoft.com/l/meetup-join/example',
           'scheduled_start': datetime(2026, 10, 8, 8, tzinfo=timezone.utc),
           'scheduled_end': datetime(2026, 10, 8, 10, tzinfo=timezone.utc),
           'status': 'completed', 'actual_start': datetime(2026, 10, 8, 7, 58, tzinfo=timezone.utc),
           'series_status': 'active', 'job_state': 'complete',
           'job_finished_at': datetime(2026, 10, 8, 18, tzinfo=timezone.utc), 'has_recording': False}
    row.update(values)
    return row


class RecordingStatusTests(unittest.TestCase):
    """Statuses come from persisted rows only; a missing recording needs a complete sync after Teams had time."""

    def setUp(self):
        self.ns = library_namespace()
        self.verdict = lambda **values: self.ns['session_attention'](occurrence(**values), NOW)

    def test_archive_row_decides_the_recording_status(self):
        status = self.ns['recording_status']
        self.assertEqual([status(s) for s in ('ready', 'failed', 'pending', None)],
                         ['available', 'missingAzureFile', 'verificationRequired', 'verificationRequired'])

    def test_completed_is_not_enough_to_call_a_recording_missing(self):
        self.assertEqual(self.verdict(job_state='failed')[0], 'missingSync')
        self.assertEqual(self.verdict(job_state=None, job_finished_at=None)[0], 'missingSync')
        # A sync that finished before Teams had time to publish proves nothing.
        self.assertEqual(self.verdict(job_finished_at=datetime(2026, 10, 8, 11, tzinfo=timezone.utc))[0], 'missingSync')
        self.assertEqual(self.verdict()[0], 'notRecorded')

    def test_sessions_still_processing_recorded_or_cancelled_need_nothing(self):
        self.assertIsNone(self.verdict(scheduled_end=NOW - timedelta(hours=1)))
        self.assertIsNone(self.verdict(has_recording=True))
        self.assertIsNone(self.verdict(status='cancelled'))
        self.assertIsNone(self.verdict(series_status='cancelled'))

    def test_a_complete_sync_that_found_no_run_is_not_a_recording_problem(self):
        self.assertIsNone(self.verdict(status='scheduled', actual_start=None))

    def test_a_run_stored_on_another_day_asks_for_verification(self):
        status, reason = self.verdict(actual_start=datetime(2026, 10, 5, 7, 39, tzinfo=timezone.utc))
        self.assertEqual(status, 'verificationRequired')
        self.assertIn('05 Oct 2026', reason)
        status, reason = self.verdict(actual_start=datetime(2026, 10, 5, 7, 39, tzinfo=timezone.utc), job_state='failed')
        self.assertEqual(status, 'missingSync')
        self.assertIn('check which meeting', reason)

    def test_attention_is_filed_under_the_owning_week_and_skips_weeks_recorded_elsewhere(self):
        components = [
            {'week_id': 'W1', 'module_catalogue_id': 'M-A', 'week_number': 1, 'week_title': 'Intro', 'module_title': 'Data',
             'programme_name': 'L4', 'cohort_name': 'C', 'group_name': 'G', 'programme_status': 'active',
             'settings_json': json.dumps({'teamsOccurrenceId': 'O1'})},
            {'week_id': 'W2', 'module_catalogue_id': 'M-A', 'week_number': 2, 'week_title': 'Guest', 'module_title': 'Data',
             'programme_name': 'L4', 'cohort_name': 'C', 'group_name': 'G', 'programme_status': 'active',
             'settings_json': json.dumps({'teamsLiveSessionId': 'S1', 'teamsSessionNumber': '2', 'extraTeamsLiveSessionId': 'EX'})}]
        occurrences = [occurrence(), occurrence(id='O2', session_number=2),
                       occurrence(id='OX', live_session_id='EX', has_recording=True)]
        attention = self.ns['attention_by_module'](components, occurrences, NOW)
        self.assertEqual([(s['weekId'], s['status']) for s in attention['M-A']['sessions']], [('W1', 'notRecorded')])
        payload = self.ns['build_library']([], [], [], attention)
        self.assertEqual(payload['deliveries'][0]['attention'][0]['weekTitle'], 'Intro')
        self.assertEqual(payload['deliveries'][0]['recordingCount'], 0)


class ArchivedAndDuplicateRecordingTests(unittest.TestCase):
    def setUp(self):
        self.ns = library_namespace()

    def test_deleted_module_recordings_are_listed_and_flagged_archived(self):
        payload = self.ns['build_library'](
            [recording(), recording(artifact_id='OLD', module_catalogue_id='M-OLD', occurrence_id='OO', module_archived=True)],
            WEEKS, [component('W1', teamsOccurrenceId='O1')])
        self.assertEqual({d['moduleId']: d['archived'] for d in payload['deliveries']}, {'M-A': False, 'M-OLD': True})

    def test_one_recording_listed_under_two_graph_ids_is_shown_once_preferring_the_playable_copy(self):
        same = dict(call_id='CALL', content_correlation_id='CORR', end_datetime=datetime(2026, 9, 7, 10, tzinfo=timezone.utc))
        payload = self.ns['build_library'](
            [recording(artifact_id='COPY-1', archive_status='pending', **same),
             recording(artifact_id='COPY-2', **same),
             recording(artifact_id='OTHER', call_id='CALL', content_correlation_id='CORR-2')], WEEKS, [])
        items = payload['deliveries'][0]['weeks'][0]['recordings']
        self.assertEqual([(r['id'], r['status'], r['duplicateCount']) for r in items],
                         [('COPY-2', 'available', 1), ('OTHER', 'available', 0)])
        self.assertEqual(payload['recordingCount'], 2)

    def test_rows_without_a_correlation_id_are_never_merged(self):
        payload = self.ns['build_library']([recording(artifact_id='X'), recording(artifact_id='Y')], WEEKS, [])
        self.assertEqual(payload['recordingCount'], 2)


class RecordingDownloadNameTests(unittest.TestCase):
    def setUp(self):
        self.ns = {'re': re, 'PurePosixPath': PurePosixPath, 'ZoneInfo': ZoneInfo, 'instant': instant}
        functions(ROOT / 'session_results.py', {'recording_download_name'}, self.ns)

    def test_name_uses_module_session_and_london_date_and_strips_header_characters(self):
        self.ns['read'] = Mock(return_value=[{'module_title': 'Data "Analysis"\r\n', 'session_number': 3,
                                              'scheduled_start': datetime(2026, 9, 6, 23, 30, tzinfo=timezone.utc)}])
        name = self.ns['recording_download_name']({'occurrence_id': 'O1', 'blob_name': 'M/G/S/file.mp4'})
        self.assertEqual(name, 'Data-Analysis-session-3-2026-09-07.mp4')

    def test_missing_session_still_yields_a_safe_name(self):
        self.ns['read'] = Mock(return_value=[])
        self.assertEqual(self.ns['recording_download_name']({'occurrence_id': 'O1', 'blob_name': ''}), 'Live-session.mp4')


if __name__ == '__main__':
    unittest.main()
