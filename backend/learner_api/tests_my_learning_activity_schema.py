"""Execute teaching-window SQL on PostgreSQL with both authoring schemas."""
from unittest.mock import patch

from django.db import connections
from django.test import SimpleTestCase, override_settings

from . import my_learning_activity as activity


@override_settings(TIME_ZONE='Europe/London')
class MyLearningActivitySchemaTests(SimpleTestCase):
    databases = {'enrolment'}

    def setUp(self):
        self.db = connections['enrolment']
        if self.db.vendor != 'postgresql':
            self.skipTest('Requires the verified PostgreSQL test runner.')
        with self.db.cursor() as cur:
            cur.execute('''CREATE TEMP TABLE learning_activity_modules (
                module_catalogue_id varchar(100) PRIMARY KEY,start_date date,source_type text,
                teams_shared_source_module_id varchar(100),deleted_at timestamptz,
                is_programme_deleted boolean)''')
            cur.execute('''CREATE TEMP TABLE learning_activity_sessions (
                id bigint PRIMARY KEY,module_catalogue_id varchar(100),status text,
                start_datetime timestamptz,duration_minutes integer,provider text,
                graph_event_id text,online_meeting_id text,join_url text)''')
            cur.execute('''CREATE TEMP TABLE learning_activity_occurrences (
                id bigint PRIMARY KEY,live_session_id bigint,status text,
                scheduled_start timestamptz,scheduled_end timestamptz)''')
        self.addCleanup(self.drop_tables)

    def drop_tables(self):
        with self.db.cursor() as cur:
            for name in ('occurrences', 'sessions', 'modules'):
                cur.execute('DROP TABLE IF EXISTS pg_temp.learning_activity_' + name)

    def read(self, sql, params):
        # Execute the complete production query; only redirect its three tables
        # to synthetic temporary tables owned by this test connection.
        for source, target in (
            ('curriculum.live_session_occurrences', 'learning_activity_occurrences'),
            ('curriculum.live_sessions', 'learning_activity_sessions'),
            ('curriculum.modules', 'learning_activity_modules'),
        ):
            sql = sql.replace(source, 'pg_temp.' + target)
        with self.db.cursor() as cur:
            cur.execute(sql, params)
            names = [column[0] for column in cur.description]
            return [dict(zip(names, row)) for row in cur.fetchall()]

    def test_missing_optional_columns_load_owned_and_shared_teaching_windows(self):
        with self.db.cursor() as cur:
            cur.execute('''INSERT INTO learning_activity_modules
                (module_catalogue_id,start_date,teams_shared_source_module_id) VALUES
                ('M1','2026-09-01',NULL),('M2','2026-10-01','OWNER'),
                ('OWNER','2020-01-01','M2'),('OTHER','2026-01-01',NULL)''')
            cur.execute('''INSERT INTO learning_activity_sessions
                (id,module_catalogue_id,status,start_datetime,duration_minutes,provider,graph_event_id)
                VALUES (1,'M1','scheduled','2026-10-31T10:00:00Z',60,'Microsoft Teams','event-1'),
                (2,'OWNER','scheduled','2026-12-01T10:00:00Z',60,'Microsoft Teams','event-2'),
                (3,'OTHER','scheduled','2027-01-01T10:00:00Z',60,'Microsoft Teams','event-3')''')
        with patch.object(activity.canonical, 'query', side_effect=self.read):
            result = activity.card_teaching_activity([
                {'id': 'current:M1'}, {'id': 'legacy:2', 'moduleId': 'M2'}, {'id': 'legacy:3'}])
        self.assertEqual(result, {
            'current:M1': {'startDate': '2026-09-01', 'lastLiveDate': '2026-10-31'},
            'legacy:2': {'startDate': '2026-10-01', 'lastLiveDate': '2026-12-01'},
        })

    def test_optional_archive_library_and_deletion_flags_still_filter_cards(self):
        with self.db.cursor() as cur:
            cur.execute('ALTER TABLE learning_activity_modules ADD COLUMN status text, ADD COLUMN library_state text')
            cur.execute('''INSERT INTO learning_activity_modules
                (module_catalogue_id,start_date,status,library_state,deleted_at,is_programme_deleted) VALUES
                ('VISIBLE','2026-09-01',NULL,NULL,NULL,false),
                ('ARCHIVED','2026-09-01','archived',NULL,NULL,false),
                ('LIBRARY','2026-09-01',NULL,'library',NULL,false),
                ('DELETED','2026-09-01',NULL,NULL,now(),false),
                ('PROGRAMME','2026-09-01',NULL,NULL,NULL,true)''')
        with patch.object(activity.canonical, 'query', side_effect=self.read):
            result = activity.card_teaching_activity([
                {'id': 'current:' + name} for name in ('VISIBLE', 'ARCHIVED', 'LIBRARY', 'DELETED', 'PROGRAMME')])
        self.assertEqual(result, {'current:VISIBLE': {'startDate': '2026-09-01', 'lastLiveDate': ''}})
