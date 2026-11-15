"""Exercise the scheduler's real retry SQL using temporary PostgreSQL tables."""
from contextlib import nullcontext
from io import StringIO
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import MagicMock, patch

from django.db import connection
from django.test import TestCase

from .management.commands import process_session_results as worker


@skipUnless(connection.vendor == 'postgresql', 'Retry SQL requires isolated PostgreSQL.')
class TranscriptRetryTests(TestCase):
    databases = {'default'}

    def setUp(self):
        # No application rows are touched, including in a database-backed test run.
        with connection.cursor() as cursor:
            cursor.execute('''
                CREATE TEMP TABLE modules(module_catalogue_id text,deleted_at timestamptz,is_programme_deleted boolean) ON COMMIT DROP;
                CREATE TEMP TABLE live_sessions(id text,module_catalogue_id text,organizer_email text,
                    online_meeting_id text,join_url text,status text) ON COMMIT DROP;
                CREATE TEMP TABLE live_session_occurrences(id text,live_session_id text,status text,scheduled_end timestamp) ON COMMIT DROP;
                CREATE TEMP TABLE live_session_artifacts(id text,occurrence_id text,artifact_type text) ON COMMIT DROP;
                CREATE TEMP TABLE session_result_archive(artifact_id text,status text) ON COMMIT DROP;
                CREATE TEMP TABLE session_result_jobs(live_session_id text PRIMARY KEY,state text,requested_at timestamptz,
                    next_attempt_at timestamptz,attempts integer,force_refresh boolean,finished_at timestamptz) ON COMMIT DROP;
            ''')

    def seed(self, key, *, kind='transcript', saved='failed', state='failed', hours=2):
        with connection.cursor() as cursor:
            cursor.execute('INSERT INTO pg_temp.modules VALUES(%s,NULL,false)', [key])
            cursor.execute("INSERT INTO pg_temp.live_sessions VALUES(%s,%s,'owner@example.invalid','meeting','','active')", [key, key])
            cursor.execute("INSERT INTO pg_temp.live_session_occurrences VALUES(%s,%s,'scheduled',(now() AT TIME ZONE 'UTC')-interval '8 days')", [key, key])
            cursor.execute('INSERT INTO pg_temp.live_session_artifacts VALUES(%s,%s,%s)', [key, key, kind])
            cursor.execute('INSERT INTO pg_temp.session_result_archive VALUES(%s,%s)', [key, saved])
            cursor.execute("INSERT INTO pg_temp.session_result_jobs VALUES(%s,%s,now()-interval '3 hours',now(),8,false,now()-%s*interval '1 hour')", [key, state, hours])

    def run_scheduled_selection(self, selected=()):
        # Capture the command's actual statement and parameters without invoking
        # attendance, Graph, storage, feedback delivery or another queue worker.
        cursor = MagicMock()
        cursor.__enter__.return_value = cursor
        cursor.fetchone.return_value = None
        with patch.object(worker, 'connections', {'default': SimpleNamespace(cursor=lambda: cursor)}), \
                patch.object(worker.transaction, 'atomic', side_effect=nullcontext), \
                patch('curriculum_api.session_captions.sync_pending_captions'), \
                patch('curriculum_api.teams_people_refresh.sync_due_people', return_value={'checked': 0, 'failed': 0}):
            worker.Command(stdout=StringIO()).handle(limit=1, scheduled=True, provision_container=False,
                                                    live_session_ids=list(selected))
        sql, params = cursor.execute.call_args_list[0].args
        with connection.cursor() as actual:
            actual.execute(sql.replace('curriculum.', 'pg_temp.'), params)
            actual.execute('SELECT live_session_id,state,attempts FROM pg_temp.session_result_jobs ORDER BY live_session_id')
            return {key: (state, attempts) for key, state, attempts in actual.fetchall()}

    def test_exhausted_transcript_and_recording_recover_after_one_hour(self):
        self.seed('transcript')
        self.seed('recording', kind='recording')
        rows = self.run_scheduled_selection()
        self.assertEqual(rows, {'recording': ('queued', 0), 'transcript': ('queued', 0)})

    def test_ready_files_backoff_and_active_workers_are_preserved(self):
        self.seed('ready', saved='ready')
        self.seed('backoff', hours=0.5)
        self.seed('running', state='running')
        self.seed('queued', state='queued')
        self.seed('other-kind', kind='other')
        self.assertEqual(self.run_scheduled_selection(), {
            'ready': ('failed', 8), 'backoff': ('failed', 8), 'running': ('running', 8),
            'queued': ('queued', 8), 'other-kind': ('failed', 8)})

    def test_explicit_retry_scope_does_not_requeue_another_series(self):
        self.seed('selected')
        self.seed('other')
        self.assertEqual(self.run_scheduled_selection(['selected']), {
            'selected': ('queued', 0), 'other': ('failed', 8)})
