"""Explicit opt-in Teams fixtures, synthetic capabilities, no DB or network."""
import importlib
import os
from pathlib import Path
import runpy
import socket
import sys
import unittest

assert [n for _, n in socket.if_nameindex()] == ['lo']
assert len(Path('/proc/net/route').read_text().splitlines()) == 1
assert not any(k in os.environ for k in ('NEW_ENDPOINT_URL', 'DATABASE_URL', 'DJANGO_SETTINGS_MODULE'))

def audit(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system'):
        raise RuntimeError('External operation forbidden: ' + event)
    if event == 'open' and isinstance(args[0], (str, bytes)) and '.env' in os.fsdecode(args[0]).split('/')[-1]:
        raise RuntimeError('Environment files forbidden')
sys.addaudithook(audit)
sys.path[:0] = ['/tmp/phase1f/backend', '/tmp/phase1f/backend/curriculum_api']
mode, target = sys.argv[1:3]
if mode == 'django':
    from django.apps import AppConfig
    from django.conf import settings
    apps = ['django.contrib.auth', 'django.contrib.contenttypes', 'django.contrib.sessions',
            'curriculum_api', 'learner_api', 'coach_api', 'login', 'read_models', 'quiz_api']
    settings.configure(SECRET_KEY='meetings-synthetic', DEBUG=False, USE_TZ=True,
        INSTALLED_APPS=[AppConfig(n, importlib.import_module(n)) for n in apps],
        DATABASES={n:{'ENGINE':'django.db.backends.dummy'} for n in
            ('default','enrolment','audit','audit_clone','kbc_attendance','assistant_conversations')},
        CACHES={'default':{'BACKEND':'django.core.cache.backends.locmem.LocMemCache'}},
        MIDDLEWARE=[], ALLOWED_HOSTS=['testserver'], DEFAULT_AUTO_FIELD='django.db.models.BigAutoField',
        CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP=False, READ_MODEL_OUTBOX_ENABLED=False)
    import django
    django.setup()
suite = unittest.defaultTestLoader.loadTestsFromName(target)
# This reconciliation explicitly forbids running migrations, even on the
# disposable environment. Keep their tests intact and report this exclusion.
blocked = []
def permitted_tests(items):
    selected = unittest.TestSuite()
    for test in items:
        if isinstance(test, unittest.TestSuite):
            selected.addTests(permitted_tests(test))
        elif test.id() in {
            'curriculum_api.test_study_weeks_no_db.StudyWeekTests.test_migration_is_repeatable_and_leaves_old_data_null',
            'curriculum_api.test_module_week_start_no_db.ModuleWeekStartContractTests.test_additive_migration_preserves_existing_rows_and_is_repeatable',
        }:
            blocked.append(test.id())
        else:
            selected.addTest(test)
    return selected
suite = permitted_tests(suite)
for identifier in blocked:
    print('MEETING_BLOCKED', identifier, 'migration execution not authorized', flush=True)
result = unittest.TextTestRunner(verbosity=2).run(suite)
print('MEETING_RESULT', target, result.testsRun, len(result.failures), len(result.errors), len(result.skipped), flush=True)
sys.exit(1 if not result.wasSuccessful() else 2 if blocked else 0)
