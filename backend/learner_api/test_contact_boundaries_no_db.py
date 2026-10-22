"""Actual app imports and existing consumer suites, with DB/network forbidden."""
import sys
from pathlib import Path
sys.path[0] = str(Path(__file__).resolve().parent.parent)
import ast
import types
import unittest
from contextlib import ExitStack
from unittest.mock import patch


def guard(event, args):
    if event in {'subprocess.Popen', 'os.system'}:
        raise RuntimeError('External IO forbidden')
    if event in {'socket.connect', 'socket.bind'} and args[1][0] not in {'127.0.0.1', '::1'}:
        raise RuntimeError('External socket forbidden')
    if event in {'socket.getaddrinfo', 'socket.gethostbyname'} and args[0] not in {'localhost', '127.0.0.1', '::1'}:
        raise RuntimeError('External resolution forbidden')
    if event == 'open' and Path(str(args[0])).name.startswith('.env'):
        raise RuntimeError('Environment files forbidden')


if __name__ == '__main__':
    sys.addaudithook(guard)
    from django.conf import settings
    tree = ast.parse((Path(__file__).resolve().parent.parent / 'config/settings.py').read_text(encoding='utf-8'))
    apps = next(ast.literal_eval(n.value) for n in tree.body if isinstance(n, ast.Assign)
                and any(isinstance(t, ast.Name) and t.id == 'INSTALLED_APPS' for t in n.targets))
    settings.configure(SECRET_KEY='synthetic-only', INSTALLED_APPS=apps, USE_TZ=True,
        BASE_DIR=Path(__file__).resolve().parent.parent,
        ROOT_URLCONF='contact_consumer_urls', DATABASES={'default': {'ENGINE': 'django.db.backends.dummy'},
        'enrolment': {'ENGINE': 'django.db.backends.dummy'}},
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
        ALLOWED_HOSTS=['testserver'])
    import django
    with patch.object(sys, 'argv', [__file__, 'test']):
        django.setup()
    from django.urls import include, path
    urls = types.ModuleType('contact_consumer_urls')
    urls.urlpatterns = [path('coach_api/', include('coach_api.urls'))]
    sys.modules[urls.__name__] = urls
    modules = [
        'learner_api.tests_first_login_details', 'learner_api.tests_learner_date_sync', 'learner_api.tests_case_owner_sync',
        'coach_api.test_cache_fail_open_no_db', 'coach_api.test_dashboard_sections_no_db',
        'coach_api.test_dashboard_hidden_learners_no_db', 'coach_api.test_dashboard_snapshot_scheduler_no_db',
    ]
    if '--teams' in sys.argv:
        modules = ['coach_api.tests_errors', 'coach_api.tests.CoachTimetableWindowTests',
                   'coach_api.tests.CoachTimetableBookingConflictTests', 'coach_api.tests.CoachMeetingArtifactTests']
    if '--f01' in sys.argv:
        modules = ['learner_api.tests_activation_recovery', 'learner_api.tests_invitation_readiness',
                   'learner_api.tests_access_gate', 'learner_api.tests_account_identity_sync',
                   'learner_api.tests_first_login_details', 'login.tests_staff_learner_actions',
                   'login.tests_admin_learner_actions', 'login.tests_learner_progress_gate',
                   'learner_api.tests.LearnerProgressionTests', 'login.tests_student_entry_routing',
                   'login.tests_saved_signature', 'login.tests_unit.RoleMappingTests',
                   'login.tests_unit.ExpiryReasonTests', 'login.tests_coach_learner_actions']
    if '--recovery-unit' in sys.argv:
        modules = ['learner_api.tests_activation_recovery']
    suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(name) for name in modules)
    # Existing consumer tests exercise pre-invalidation behavior with synthetic
    # generations. The database/CAS and invalidated-cache cases run on Neon.
    with ExitStack() as seams, patch('read_models.repository.contact_revision', return_value=''), \
            patch.object(sys, 'argv', [__file__, 'test']):
        if '--teams' in sys.orig_argv:
            seams.enter_context(patch('coach_api.views.get_graph_settings', return_value={
                'tenant_id': 'synthetic', 'client_id': 'synthetic', 'client_secret': 'synthetic',
                'scope': 'https://graph.microsoft.com/.default', 'base_url': 'https://graph.microsoft.com/v1.0',
                'timezone': 'Europe/London'}))
        result = unittest.TextTestRunner(verbosity=1).run(suite)
    sys.exit(0 if result.wasSuccessful() else 1)
