"""Focused API regressions: all DB connections forbidden, no migrations/writes."""
import logging.config
import os
from pathlib import Path
import socket
import sys
import unittest
from contextlib import nullcontext
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'
read_only = '--read-only' in sys.argv
if read_only:
    os.environ['RUN_MY_LEARNING_READ_ONLY_TESTS'] = '1'
else:
    os.environ.pop('RUN_MY_LEARNING_READ_ONLY_TESTS', None)
from django.db.backends.base.base import BaseDatabaseWrapper

# Daphne initializes a local asyncio socketpair on Windows during setup.
# Database connections are denied throughout; tests also deny network access.
with patch.object(BaseDatabaseWrapper, 'ensure_connection', side_effect=AssertionError('Database forbidden')), \
     patch.object(logging.config, 'dictConfig'):
    import django
    django.setup()
    with (nullcontext() if read_only else patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden'))):
        names = [
            'learner_api.test_free_course_hours.FreeCourseHoursTests',
            'learner_api.test_free_course_attempts_no_db',
            'learner_api.test_free_course_flow_no_db',
            'learner_api.test_free_course_progress_status_no_db',
            'learner_api.test_free_course_unknown_dates_no_db',
            'learner_api.test_free_course_quiz_access_no_db',
        ]
        if read_only:
            # These suites connect exclusively through connect_development(), which
            # verifies the endpoint, branch and read-only transaction before queries.
            names = ['learner_api.test_free_course_hours', 'learner_api.test_free_course_attempts_sql']
        elif '--my-learning' in sys.argv:
            names += [
                'learner_api.tests_my_learning_no_db',
                'learner_api.tests_my_learning_diagnostics_no_db',
                'learner_api.tests_my_learning_performance_no_db',
                'learner_api.tests_my_learning_module_scope_no_db',
                'learner_api.tests_my_learning_ksbs_no_db',
                'learner_api.tests_my_learning_hidden_io_no_db',
                'learner_api.test_canonical_learning_no_db',
            ]
        suite = unittest.defaultTestLoader.loadTestsFromNames(names)
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
