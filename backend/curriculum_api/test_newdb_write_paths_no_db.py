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
    """One read, one row per entry with its KSB codes folded into arrays: it
    unfolds to one row per (entry, KSB code), keeps an entry with no counted
    KSB as one NULL-code row, and keeps the entries' order."""

    def run_reader(self, entries, *args, **kwargs):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        with mock.patch.object(views, 'connection', mock.Mock(cursor=mock.Mock(return_value=cursor))),                 mock.patch.object(views, 'and_not_excluded', return_value=''),                 mock.patch.object(views, 'rows_as_dicts', return_value=entries):
            rows = views.progress_consumption_rows(*args, **kwargs)
        return rows, cursor

    def test_rows_unfold_in_entry_order(self):
        entries = [
            {'learner_id': 7, 'progress_id': 2, 'kind': 'quiz',
             'ksb_codes': ['K1', 'S1'], 'ksb_weights': [1, 0.5], 'ksb_classes': ['hard', 'soft']},
            {'learner_id': 7, 'progress_id': 1, 'kind': 'activity',
             'ksb_codes': None, 'ksb_weights': None, 'ksb_classes': None},
        ]
        rows, cursor = self.run_reader(entries, [7])
        self.assertEqual(
            [(row['progress_id'], row['ksb_code'], row['weight'], row['weight_class']) for row in rows],
            [(2, 'K1', 1, 'hard'), (2, 'S1', 0.5, 'soft'), (1, None, 0, 'soft')],
        )
        self.assertNotIn('ksb_codes', rows[0])
        self.assertEqual(cursor.execute.call_count, 1)

    def test_codes_keep_only_entries_carrying_one(self):
        _rows, cursor = self.run_reader([], [7], ['K1'])
        sql, params = cursor.execute.call_args[0]
        self.assertIn('ksb.codes is not null', sql)
        self.assertEqual(params[:2], [['K1'], [7]])

    def test_achieved_only_filters_outcomes_and_skips_reflection(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [('quiz', True), ('quiz', False), ('activity', None)]
        with mock.patch.object(views, 'connection', mock.Mock(cursor=mock.Mock(return_value=cursor))),                 mock.patch.object(views, 'and_not_excluded', return_value=''),                 mock.patch.object(views, 'rows_as_dicts', return_value=[]):
            views.progress_consumption_rows([7], ['K1'], achieved_only=True)
        sql, params = cursor.execute.call_args[0]
        self.assertNotIn('p.feedback', sql)
        # A failed attempt is not an accepted outcome.
        self.assertNotIn(False, params)
        self.assertEqual(params[-4:], ['quiz', True, 'activity', None])

    def test_achieved_only_with_no_accepted_outcome_reads_no_entries(self):
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = [('quiz', False)]
        with mock.patch.object(views, 'connection', mock.Mock(cursor=mock.Mock(return_value=cursor))),                 mock.patch.object(views, 'and_not_excluded', return_value=''):
            self.assertEqual(views.progress_consumption_rows([7], ['K1'], achieved_only=True), [])
        self.assertEqual(cursor.execute.call_count, 1)


class ReuseMappingRowsTests(SimpleTestCase):
    """UNIQUE (component_id, standard_ksb_id) also holds archived rows: a KSB put
    back on a component reuses its stored row instead of inserting a second."""

    def run_with(self, stored, payloads):
        from curriculum_api import schema_compat
        cursor = mock.MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchall.return_value = stored
        conn = mock.Mock(vendor='postgresql', cursor=mock.Mock(return_value=cursor))
        with mock.patch.object(schema_compat, 'connection', conn):
            return schema_compat.reuse_mapping_rows(payloads)

    def test_readded_ksb_takes_the_archived_rows_id(self):
        rows = self.run_with([('C1', 120, 'OLD')], [{'id': 'NEW', 'component_id': 'C1', 'standard_ksb_id': 120, 'weight': 20}])
        self.assertEqual(rows, [{'id': 'OLD', 'component_id': 'C1', 'standard_ksb_id': 120, 'weight': 20}])

    def test_same_ksb_twice_keeps_the_first(self):
        rows = self.run_with([], [{'id': 'A', 'component_id': 'C1', 'standard_ksb_id': 1},
                                  {'id': 'B', 'component_id': 'C1', 'standard_ksb_id': 1}])
        self.assertEqual([row['id'] for row in rows], ['A'])

    def test_a_row_moved_to_another_ksb_gives_up_its_id(self):
        # Y held KSB 2 and now carries KSB 3; KSB 2 comes back under a new id.
        rows = self.run_with([('C1', 2, 'Y')], [{'id': 'Y', 'component_id': 'C1', 'standard_ksb_id': 3},
                                                {'id': 'N', 'component_id': 'C1', 'standard_ksb_id': 2}])
        by_ksb = {row['standard_ksb_id']: row['id'] for row in rows}
        self.assertEqual(by_ksb[2], 'Y')
        self.assertNotIn(by_ksb[3], {'Y', 'N'})
        self.assertEqual(len({row['id'] for row in rows}), 2)


class ProgressScopePredicateTests(SimpleTestCase):
    """The SQL in-scope test mirrors learner_progress_ksb_consumption's: the
    component is in the scope, or the stamped lineage names it."""

    def test_component_or_lineage(self):
        sql, params = views.progress_scope_predicate({'C2', 'C1'}, 'module_ref', 'MOD-1')
        self.assertIn('p.component_ref', sql)
        self.assertIn('"module_ref"', sql)
        self.assertEqual(params, [['C1', 'C2'], 'MOD-1'])

    def test_unknown_lineage_column_is_never_interpolated(self):
        sql, params = views.progress_scope_predicate(set(), 'x; drop table y', 'MOD-1')
        self.assertNotIn('drop', sql)
        self.assertEqual(params, [[]])


class LearnerProgressUnavailableTests(SimpleTestCase):
    """A failed progress read is reported, never answered as zero achievement."""

    def test_reader_raises_instead_of_returning_empty_totals(self):
        from curriculum_api.progress_errors import LearnerProgressUnavailable
        with mock.patch.object(views, 'connection', mock.Mock(vendor='postgresql')), \
                mock.patch.object(views, 'learner_schema_table_exists', return_value=True), \
                mock.patch.object(views, 'progress_consumption_rows', side_effect=RuntimeError('statement timeout')):
            with self.assertRaises(LearnerProgressUnavailable):
                views.learner_progress_ksb_consumption([7], ['K1'])

    def test_middleware_answers_503_with_the_reason(self):
        import json
        from django.test import RequestFactory
        from curriculum_api.middleware import SchemaNotProvisionedMiddleware
        from curriculum_api.progress_errors import LearnerProgressUnavailable
        response = SchemaNotProvisionedMiddleware(lambda request: None).process_exception(
            RequestFactory().get('/curriculum_api/curriculum/modules/M/learner-ksb-impact/'), LearnerProgressUnavailable(),
        )
        self.assertEqual(response.status_code, 503)
        body = json.loads(response.content)
        self.assertEqual(body['code'], 'learner_progress_unavailable')
        self.assertIn('could not be loaded', body['error'])


class NamesCacheTests(SimpleTestCase):
    """Names are re-read only when a name table is written, and held for one request."""

    def setUp(self):
        from curriculum_api import curriculum_names
        self.names = curriculum_names
        curriculum_names.invalidate()
        curriculum_names.end_request()

    def tearDown(self):
        self.names.invalidate()
        self.names.end_request()

    def test_only_name_tables_invalidate(self):
        self.names._LOCAL.lookups = {'at': 0}
        self.names.invalidate_for('components')
        self.names.invalidate_for('ksb_mappings')
        self.assertIsNotNone(self.names._LOCAL.lookups)
        self.names.invalidate_for('groups')
        self.assertIsNone(self.names._LOCAL.lookups)

    def test_names_read_in_a_request_outlive_the_ttl_until_it_ends(self):
        self.names.begin_request()
        token = self.names._LOCAL.request_token
        self.names._LOCAL.lookups = {'at': -1000.0, 'request_token': token}
        self.assertIs(self.names.lookups(), self.names._LOCAL.lookups)
        self.names.end_request()
        with mock.patch.object(self.names, 'connections') as connections:
            connections.__getitem__.side_effect = RuntimeError('re-read')
            with self.assertRaises(RuntimeError):
                self.names.lookups()


class SharedRecordingReadsTests(SimpleTestCase):
    """Inside shared_recording_reads() a register reads each session's recordings
    and watch rows once, and every learner still gets only their own progress."""

    def test_two_learners_one_read_each_and_their_own_progress(self):
        from curriculum_api import recording_views
        recording = {'id': 'R1', 'occurrence_id': 'OCC-1', 'artifact_type': 'recording', 'archive_status': 'ready'}
        views_rows = [
            {'occurrence_id': 'OCC-1', 'learner_kind': 'commercial', 'learner_id': 101, 'artifact_id': 'R1',
             'watched_seconds': 600, 'duration_seconds': 600},
            {'occurrence_id': 'OCC-1', 'learner_kind': 'commercial', 'learner_id': 102, 'artifact_id': 'R1',
             'watched_seconds': 10, 'duration_seconds': 600},
        ]
        sql_seen = []

        def fake_read(sql, params=()):
            sql_seen.append('views' if 'live_session_recording_views' in sql else 'artifacts')
            if sql_seen[-1] == 'artifacts':
                return [dict(recording)]
            if 'learner_id=%s' in sql:  # the single-learner query filters in SQL
                return [row for row in views_rows if (row['learner_kind'], row['learner_id']) == (params[0], params[1])]
            return list(views_rows)
        with mock.patch.object(recording_views, 'read', side_effect=fake_read), \
                mock.patch.object(recording_views, 'hidden_artifact_ids', return_value=set()):
            with recording_views.shared_recording_reads():
                first = recording_views.fully_watched_occurrences('commercial', 101, ['OCC-1'])
                second = recording_views.fully_watched_occurrences('commercial', 102, ['OCC-1'])
            outside = recording_views.fully_watched_occurrences('commercial', 101, ['OCC-1'])
        self.assertEqual((first, second), ({'OCC-1'}, set()))
        self.assertEqual(sql_seen[:2].count('artifacts'), 1)
        self.assertEqual(sql_seen[:2].count('views'), 1)
        self.assertEqual(len(sql_seen), 4)  # outside the block it reads again
        self.assertEqual(outside, {'OCC-1'})
