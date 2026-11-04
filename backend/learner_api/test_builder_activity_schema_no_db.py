"""Exercise the schedule module SELECT against the normalized module schema."""
import sqlite3
from unittest.mock import patch

from django.test import SimpleTestCase

from .builder_activity_dates import read_builder_activity_dates


class BuilderActivitySchemaTests(SimpleTestCase):
    def test_assignment_dates_load_without_module_deletion_columns(self):
        with sqlite3.connect(':memory:') as db:
            db.execute("ATTACH DATABASE ':memory:' AS curriculum")
            db.executescript('''
                CREATE TABLE curriculum.modules (module_catalogue_id TEXT, start_date TEXT,
                    sessions_number INTEGER, session_week_day TEXT, session_start_time TEXT,
                    session_end_time TEXT, cohort_id TEXT, session_overrides TEXT);
                INSERT INTO curriculum.modules VALUES
                    ('M1', '2026-10-05', 1, 'Monday', '10:00', '11:00', 'C1', '{}'),
                    ('M2', '2026-11-02', 1, 'Monday', '10:00', '11:00', 'C2', '{}');
            ''')
            module_rows = []

            class Cursor:
                def execute(self, sql, params):
                    if 'FROM curriculum.modules' in sql:
                        # Only the Postgres JSON accessor and array binding need
                        # translation; the actual selected columns remain intact.
                        sql = sql.replace("to_jsonb(m)->'session_overrides'", 'session_overrides')
                        sql = sql.replace('=ANY(%s)', ' IN (' + ','.join('?' for _ in params[0]) + ')')
                        self.result = db.execute(sql, params[0]).fetchall()
                        module_rows.extend(self.result)
                    elif 'FROM curriculum.weeks' in sql:
                        self.result = [('W1', 'M1', 'Week 1')]
                    else:
                        raise AssertionError('Unexpected query')

                def fetchall(self):
                    return self.result

            with patch('curriculum_api.views.cohort_selected_holidays_by_cohort', return_value={'C1': []}):
                result = read_builder_activity_dates(Cursor(), ['M1'], components=[
                    ('A1', 'M1', 'W1', 'Assignment', 'assignment', {'dueTiming': 'end of week'}),
                    ('A2', 'M2', 'W2', 'Other assignment', 'assignment', {}),
                ])
            self.assertEqual([row[0] for row in module_rows], ['M1'])
            self.assertEqual(set(result), {'A1'})
            self.assertEqual(result['A1']['date'], '2026-10-05')
            self.assertEqual(result['A1']['due_timing'], 'end of week')
