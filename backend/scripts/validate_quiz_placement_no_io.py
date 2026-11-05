"""Run quiz placement and its shared readers without database/network access.

Uses unittest, never the application's schema-provisioning test runner.
Pass --shared to include the broader My Learning/coach/loading regressions.
"""
import http.client
import os
from pathlib import Path
import socket
import sys
import unittest
import urllib.request
from unittest.mock import patch

os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from django.db.backends.base.base import BaseDatabaseWrapper
import requests

modules = [
    'learner_api.test_quiz_placement_no_db',
    'learner_api.test_retained_quiz_progress_no_db',
    'learner_api.tests_module_propagation',
    'learner_api.tests.LearnerWeekQuizVisibilityTests',
    'learner_api.tests.LearnerReflectionQuestionTests',
    'learner_api.tests_my_learning_performance_no_db',
    'learner_api.test_dashboard_weekly_no_db',
    'learner_api.tests_weekly_learning',
    'learner_api.test_dashboard_monthly_no_db',
]
if '--shared' in sys.argv[1:]:
    modules += [
        'learner_api.tests_my_learning_no_db',
        'learner_api.tests_my_learning_module_scope_no_db',
        'learner_api.tests_my_learning_bottlenecks_no_db',
        'learner_api.tests_module_progress',
        'coach_api.tests_learning_plan_projection',
        'coach_api.tests_case_file_overview',
        'learner_api.test_activity_viewer_no_db',
        'learner_api.tests_learner_loading',
    ]

with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Database forbidden')), \
     patch.object(requests.sessions.Session, 'request', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(urllib.request, 'urlopen', side_effect=AssertionError('HTTP forbidden')), \
     patch.object(http.client.HTTPConnection, 'connect', side_effect=AssertionError('HTTP forbidden')):
    import django
    django.setup()
    from django.conf import settings
    assert all(c['ENGINE'] == 'django.db.backends.sqlite3' for c in settings.DATABASES.values())
    # Windows' event loop creates a local socketpair during Django/Daphne setup.
    # Once setup finishes, prohibit all socket connections as well as HTTP/DB I/O.
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')), \
         patch.object(socket, 'create_connection', side_effect=AssertionError('Network forbidden')):
        result = unittest.TextTestRunner(verbosity=1).run(unittest.defaultTestLoader.loadTestsFromNames(modules))
        raise SystemExit(not result.wasSuccessful())
