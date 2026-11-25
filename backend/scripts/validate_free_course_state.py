"""Run Free Course regressions with in-memory SQLite and external I/O denied.

No migrations or shared databases. Run with backend/.venv/Scripts/python.exe -B
backend/scripts/validate_free_course_state.py from the repository root.
"""
import logging.config
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from django.conf import settings
from django.db.backends.base.base import BaseDatabaseWrapper

for config in settings.DATABASES.values():
    assert config['ENGINE'] == 'django.db.backends.sqlite3'
    config['NAME'] = ':memory:'

original_connect = BaseDatabaseWrapper.ensure_connection


def memory_only(database):
    if database.vendor != 'sqlite' or database.settings_dict['NAME'] != ':memory:':
        raise AssertionError('Only isolated in-memory SQLite is permitted')
    return original_connect(database)


with patch.object(BaseDatabaseWrapper, 'ensure_connection', memory_only), \
     patch.object(logging.config, 'dictConfig'):
    import django
    django.setup()
    with patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')):
        suite = unittest.defaultTestLoader.loadTestsFromNames([
            'learner_api.test_free_course_hours',
            'learner_api.tests_free_courses',
            'learner_api.tests_my_learning_no_db',
            'learner_api.test_free_course_flow_no_db',
            'learner_api.test_free_course_progress_status_no_db',
            'learner_api.test_free_course_unknown_dates_no_db',
            'learner_api.test_free_course_assignments_no_db',
            'learner_api.test_free_course_assignments_sqlite',
            'learner_api.test_free_course_quiz_access_no_db',
            'learner_api.tests_free_course_assignments_no_db',
            'learner_api.tests_certificate_eligibility',
            'curriculum_api.catalogue.tests.tests_free_course_alignment',
        ])
        result = unittest.TextTestRunner(verbosity=1).run(suite)
        raise SystemExit(not result.wasSuccessful())
