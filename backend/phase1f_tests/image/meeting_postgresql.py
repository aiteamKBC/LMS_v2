"""Explicit Teams PostgreSQL fixtures on the existing disposable isolated runner."""
import importlib
import os
from pathlib import Path
import runpy
import socket
import sys
import unittest
from unittest.mock import patch

assert [n for _, n in socket.if_nameindex()] == ['lo']
assert len(Path('/proc/net/route').read_text().splitlines()) == 1
assert not any(k in os.environ for k in ('NEW_ENDPOINT_URL','DATABASE_URL','DJANGO_SETTINGS_MODULE'))
sys.path.insert(0, '/tmp/phase1f/backend')

def audit(event, args):
    if event == 'socket.connect' and (not isinstance(args[1], tuple) or args[1][0] != '127.0.0.1'):
        raise RuntimeError('External network forbidden')
    if event in ('subprocess.Popen','os.system'):
        raise RuntimeError('Subprocess forbidden')
    if event == 'open' and isinstance(args[0], (str,bytes)) and '.env' in os.fsdecode(args[0]).split('/')[-1]:
        raise RuntimeError('Environment files forbidden')
sys.addaudithook(audit)
from django.apps import AppConfig
from django.conf import settings
configure = type(settings).configure

def configure_meetings(self, **values):
    existing = {app.name if isinstance(app, AppConfig) else app for app in values['INSTALLED_APPS']}
    values['INSTALLED_APPS'] += [AppConfig(n, importlib.import_module(n)) for n in
        ('coach_api','django.contrib.auth','django.contrib.contenttypes','django.contrib.sessions','quiz_api')
        if n not in existing]
    values['CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP'] = True
    values['ROOT_URLCONF'] = __name__
    configure(self, **values)

# Reuse the reviewed real-ORM schema/alias setup, without executing its test main.
with patch.object(type(settings), 'configure', configure_meetings):
    fixture_namespace = runpy.run_path('/tmp/phase1f/integration.py', run_name='meeting_fixture_setup')
from django.db import connection
from django.urls import include, path
from curriculum_api import views
urlpatterns = [path('curriculum_api/',include('curriculum_api.urls'))]
assert connection.settings_dict['HOST'] == '127.0.0.1'
assert connection.settings_dict['NAME'] == 'phase1f'
with connection.cursor() as cursor:
    cursor.execute('SELECT current_database(), current_user')
    assert cursor.fetchone() == ('phase1f','postgres')
    # schema_editor applies Python defaults only to ORM inserts. These tests
    # also use the existing raw authoring SQL, whose DDL declares DB defaults.
    # Match authoring_schema.py on the disposable fixture, retaining constraints.
    cursor.execute("ALTER TABLE curriculum.modules ALTER COLUMN quality_score SET DEFAULT 0, ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN created_at SET DEFAULT current_timestamp, ALTER COLUMN updated_at SET DEFAULT current_timestamp")
    cursor.execute("ALTER TABLE curriculum.weeks ALTER COLUMN week_number SET DEFAULT 1, ALTER COLUMN title SET DEFAULT '', ALTER COLUMN display_order SET DEFAULT 0, ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN created_at SET DEFAULT current_timestamp, ALTER COLUMN updated_at SET DEFAULT current_timestamp")
    cursor.execute("ALTER TABLE curriculum.weeks ALTER COLUMN holiday_note_enabled SET DEFAULT false, ALTER COLUMN holiday_note SET DEFAULT ''")
    cursor.execute("ALTER TABLE curriculum.components ALTER COLUMN title SET DEFAULT '', ALTER COLUMN expected_otjh SET DEFAULT 2, ALTER COLUMN points SET DEFAULT 0, ALTER COLUMN reflection_required SET DEFAULT false, ALTER COLUMN workplace_evidence_required SET DEFAULT false, ALTER COLUMN tutor_validation_required SET DEFAULT false, ALTER COLUMN display_order SET DEFAULT 0, ALTER COLUMN status SET DEFAULT 'active', ALTER COLUMN created_at SET DEFAULT current_timestamp, ALTER COLUMN updated_at SET DEFAULT current_timestamp")
    cursor.execute("ALTER TABLE curriculum.components ALTER COLUMN coach_validation_required SET DEFAULT true")
    # Dev's KSB synchronization and module detail writers now read these fields.
    # They are fixture columns in this verified disposable database only.
    cursor.execute('ALTER TABLE curriculum.module_details ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT current_timestamp, ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT current_timestamp')
    # The authoring group writer stores its delivery day in this schema column;
    # the older read fixture's week_days column is a different contract.
    cursor.execute('ALTER TABLE curriculum.groups ADD COLUMN session_week_day varchar(255)')
    cursor.execute('ALTER TABLE "Learner".learner_progress_entries ADD COLUMN reporting_month varchar(7), ADD COLUMN curriculum_component_ref text')
    cursor.execute('ALTER TABLE "Learner".learner_progress_ksbs ADD COLUMN ksb_description text, ADD COLUMN source_type text, ADD COLUMN source_id text, ADD COLUMN classification text')
views.provision_live_sessions_table()
views.provision_live_session_tracking_tables()
for name in ('session_results_archive.sql','teams_calendar_create_claims.sql','teams_calendar_create_drafts.sql',
             'teams_schedule_emails.sql','2026-10-08_teams_calendar_integrity_events.sql','module_session_overrides.sql'):
    with connection.cursor() as cursor:
        cursor.execute((Path('/tmp/phase1f/backend/sql') / name).read_text(encoding='utf-8-sig'))
# No outside HTTP/Graph transport can escape the namespace. The tests provide
# synthetic Graph responses; all six aliases still address this disposable DB.
targets = ('curriculum_api.tests.CurriculumTeamsMeetingTests',
           'curriculum_api.tests_study_weeks',
           'curriculum_api.tests_module_weekly_schedule',
           'curriculum_api.tests.TeamsCalendarSyncVerdictTests',
           'curriculum_api.test_teams_delivery_sync')
suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(n) for n in targets)
from curriculum_api.meetings.tests.invitees_postgresql import suite as invitee_suite
suite.addTests(invitee_suite(fixture_namespace))
blocked = []
def permitted_tests(items):
    selected = unittest.TestSuite()
    for test in items:
        if isinstance(test, unittest.TestSuite):
            selected.addTests(permitted_tests(test))
        elif test.id() == 'curriculum_api.tests_study_weeks.StudyWeekPersistenceTests.test_migration_refreshes_existing_read_views_and_preserves_legacy_rows':
            blocked.append(test.id())
        else:
            selected.addTest(test)
    return selected
suite = permitted_tests(suite)
for identifier in blocked:
    print('MEETING_POSTGRES_BLOCKED', identifier, 'migration execution not authorized', flush=True)
result = unittest.TextTestRunner(verbosity=2).run(suite)
print('MEETING_POSTGRES_RESULT', result.testsRun, len(result.failures), len(result.errors), len(result.skipped), flush=True)
sys.exit(1 if not result.wasSuccessful() else 2 if blocked else 0)
