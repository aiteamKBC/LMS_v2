"""No-database tests for write paths the normalised database (NEW_ENDPOINT_URL) constrains.

Nothing here opens a connection: the connection, the column lookups and the row
reads are patched.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import views


class ModulePermanentDeleteOrderTests(SimpleTestCase):
    def test_children_are_deleted_before_their_parents(self):
        # ksb_mappings -> components -> weeks -> modules are ON DELETE RESTRICT
        # on the normalised schema; weeks first was refused every time.
        order = list(views.MODULE_CHILD_AUTHORING_TABLES)
        self.assertLess(order.index(views.AUTHORING_KSB_MAPPINGS_TABLE), order.index(views.AUTHORING_COMPONENTS_TABLE))
        self.assertLess(order.index(views.AUTHORING_COMPONENTS_TABLE), order.index(views.AUTHORING_WEEKS_TABLE))


class StructureRevisionTests(SimpleTestCase):
    """The editor GET hashes stored rows; a save re-reads them through
    authoring_fetch_all, which adds derived keys on the normalised schema. Both
    must give the same revision, or every full save is refused as a conflict."""

    STORED = {
        views.AUTHORING_MODULES_TABLE: {'module_catalogue_id', 'title', 'tutor_id', 'status', 'updated_at'},
        views.AUTHORING_WEEKS_TABLE: {'id', 'module_catalogue_id', 'title', 'status', 'updated_at'},
        views.AUTHORING_COMPONENTS_TABLE: {'id', 'week_id', 'module_catalogue_id', 'title', 'status', 'updated_at'},
        views.AUTHORING_KSB_MAPPINGS_TABLE: {'id', 'component_id', 'status', 'created_at'},
        views.AUTHORING_COMPLETION_TABLE: {'module_catalogue_id', 'rule'},
        views.AUTHORING_ADVANCED_TABLE: {'module_catalogue_id', 'notes'},
    }
    RAW = {
        views.AUTHORING_MODULES_TABLE: [{'module_catalogue_id': 'MOD-1', 'title': 'M', 'tutor_id': 'TUTOR-1', 'status': 'active'}],
        views.AUTHORING_WEEKS_TABLE: [{'id': 'WEEK-1', 'module_catalogue_id': 'MOD-1', 'title': 'W', 'status': 'active'}],
        views.AUTHORING_COMPONENTS_TABLE: [{'id': 'COMP-1', 'week_id': 'WEEK-1', 'module_catalogue_id': 'MOD-1', 'title': 'C',
                                           'status': 'active'}],
        views.AUTHORING_KSB_MAPPINGS_TABLE: [],
        views.AUTHORING_COMPLETION_TABLE: [{'module_catalogue_id': 'MOD-1', 'rule': 'all'}],
        views.AUTHORING_ADVANCED_TABLE: [],
    }
    DERIVED = {
        views.AUTHORING_MODULES_TABLE: {'programme_name': 'P', 'tutor_name': 'Tutor', 'deleted_at': None,
                                        'is_programme_deleted': False},
        views.AUTHORING_WEEKS_TABLE: {'library_state': '', 'origin_module_title': '', 'deleted_at': None},
        views.AUTHORING_COMPONENTS_TABLE: {'ksb_mappings': [], 'library_state': '', 'deleted_at': None},
    }

    def fetch_with_derived_keys(self, table, *args, **kwargs):
        return [{**row, **self.DERIVED.get(table, {})} for row in self.RAW[table]]

    def test_fresh_read_and_editor_source_rows_agree(self):
        with mock.patch.object(views, 'connection', mock.Mock(vendor='sqlite')), \
                mock.patch.object(views, 'ensure_module_authoring_tables'), \
                mock.patch.object(views, 'column_names', side_effect=lambda table: self.STORED[table]), \
                mock.patch.object(views, 'authoring_fetch_all', side_effect=self.fetch_with_derived_keys):
            fresh = views.module_structure_revision('MOD-1')
            from_source = views.module_structure_revision('MOD-1', source_rows=self.RAW)
        self.assertTrue(fresh)
        self.assertEqual(fresh, from_source)

    def test_a_stored_change_still_changes_the_revision(self):
        changed = {**self.RAW, views.AUTHORING_COMPONENTS_TABLE: [
            {**self.RAW[views.AUTHORING_COMPONENTS_TABLE][0], 'title': 'C2'}]}
        with mock.patch.object(views, 'connection', mock.Mock(vendor='sqlite')), \
                mock.patch.object(views, 'ensure_module_authoring_tables'), \
                mock.patch.object(views, 'column_names', side_effect=lambda table: self.STORED[table]):
            before = views.module_structure_revision('MOD-1', source_rows=self.RAW)
            after = views.module_structure_revision('MOD-1', source_rows=changed)
        self.assertNotEqual(before, after)


class TeamsArtifactsReadTests(SimpleTestCase):
    """The tracked-plan GET reads attendance and artifacts once per series, not
    per session, and leaves the transcript cues to their own endpoint."""

    def test_one_read_per_table_and_no_transcript_timeline(self):
        from django.test import RequestFactory

        occurrences = [{'id': 'OCC-1', 'session_number': 1}, {'id': 'OCC-2', 'session_number': 2}]
        attendance = [{'id': 'A-1', 'occurrence_id': 'OCC-2', 'display_name': 'Ann', 'intervals': '[]', 'raw_data': '{}'}]
        artifacts = [{'id': 'T-1', 'occurrence_id': 'OCC-1', 'artifact_type': 'transcript',
                      'metadata': {'lmsTranscriptTimeline': {'cues': ['x'] * 50}, 'transcriptContentUrl': 'u'}}]
        reads = []

        def fetch(table, where='', params=None, order=''):
            reads.append((table, where))
            return {
                views.LIVE_SESSIONS_TABLE: [{'id': 'LIVE-1'}],
                views.LIVE_SESSION_OCCURRENCES_TABLE: [dict(row) for row in occurrences],
                views.LIVE_SESSION_ATTENDANCE_TABLE: [dict(row) for row in attendance],
                views.LIVE_SESSION_ARTIFACTS_TABLE: [dict(row, metadata=dict(row['metadata'])) for row in artifacts],
            }[table]

        from curriculum_api import teams_calendar_integrity
        with mock.patch.object(views.schema_gate, 'require_tables'), \
                mock.patch.object(views, 'authoring_fetch_all', side_effect=fetch), \
                mock.patch.object(teams_calendar_integrity, 'read_events', return_value=[]), \
                mock.patch.object(teams_calendar_integrity, 'off_schedule_runs', return_value=[]), \
                mock.patch.object(views, 'attendance_report_rosters', side_effect=lambda series, rows, **kw: rows), \
                mock.patch.object(views, 'stamp_live_session_instants', side_effect=lambda row: row), \
                mock.patch.object(views, 'teams_schedule_settings', return_value={}), \
                mock.patch.object(views, 'graph_timezone_iana', return_value='Europe/London'), \
                mock.patch.object(views, 'stored_leftover_slots', return_value=[]):
            response = views.curriculum_teams_meeting_artifacts(RequestFactory().get('/x/'), 'LIVE-1')
        self.assertEqual(response.status_code, 200)
        import json
        body = json.loads(response.content)
        by_id = {row['id']: row for row in body['occurrences']}
        self.assertEqual([row['id'] for row in by_id['OCC-2']['attendance']], ['A-1'])
        self.assertEqual(by_id['OCC-1']['attendance'], [])
        self.assertEqual(by_id['OCC-1']['artifacts'][0]['metadata'], {'transcriptContentUrl': 'u'})
        self.assertEqual(by_id['OCC-2']['artifacts'], [])
        per_table = [table for table, _ in reads]
        self.assertEqual(per_table.count(views.LIVE_SESSION_ATTENDANCE_TABLE), 1)
        self.assertEqual(per_table.count(views.LIVE_SESSION_ARTIFACTS_TABLE), 1)


class ProgressConsumptionRowsTests(SimpleTestCase):
    """The split read gives one row per (entry, KSB code), keeps an entry with
    no counted KSB as one NULL-code row, and keeps the entries' order."""

    def test_rows_join_back_in_entry_order(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [(2, 'K1', 1, 'hard'), (2, 'S1', 0.5, 'soft')]
        entries = [{'learner_id': 7, 'progress_id': 2, 'kind': 'quiz'}, {'learner_id': 7, 'progress_id': 1, 'kind': 'activity'}]
        with mock.patch.object(views, 'connection', mock.Mock(cursor=mock.Mock(return_value=cursor))), \
                mock.patch.object(views, 'and_not_excluded', return_value=''), \
                mock.patch.object(views, 'rows_as_dicts', return_value=entries):
            rows = views.progress_consumption_rows([7])
        self.assertEqual(
            [(row['progress_id'], row['ksb_code'], row['weight'], row['weight_class']) for row in rows],
            [(2, 'K1', 1, 'hard'), (2, 'S1', 0.5, 'soft'), (1, None, 0, 'soft')],
        )

    def test_codes_only_with_no_matching_ksb_reads_no_entries(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = []
        with mock.patch.object(views, 'connection', mock.Mock(cursor=mock.Mock(return_value=cursor))), \
                mock.patch.object(views, 'and_not_excluded', return_value=''):
            self.assertEqual(views.progress_consumption_rows([7], ['K1']), [])
        self.assertEqual(cursor.execute.call_count, 1)
