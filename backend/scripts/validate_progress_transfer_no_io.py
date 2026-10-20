"""Run transfer/consumer regressions without DB setup or network access."""
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE']='config.settings_sqlite_test'
os.environ['CURRICULUM_WARM']='0'
from django.conf import settings
from django.db.backends.base.base import BaseDatabaseWrapper

assert all(db['ENGINE']=='django.db.backends.sqlite3' for db in settings.DATABASES.values())
names=sys.argv[1:] or [
    'learner_api.tests_progress_transfer_no_db', 'learner_api.tests_my_learning_no_db',
    'learner_api.tests_my_learning_performance_no_db', 'learner_api.tests_replacement_learning',
    'learner_api.test_canonical_learning_no_db', 'learner_api.test_canonical_metrics_bulk_no_db',
    'learner_api.test_subject_origins_no_db', 'learner_api.test_previous_learning_groups_no_db',
    'learner_api.tests_student_activity.SubjectBuilderCoverTests.test_current_builder_cover_does_not_override_historical_subject_image',
]
with patch.object(BaseDatabaseWrapper,'ensure_connection',side_effect=AssertionError('Database forbidden')), \
     patch('psycopg.connect',side_effect=AssertionError('Direct database forbidden')), \
     patch('psycopg.Connection.connect',side_effect=AssertionError('Direct database forbidden')):
    import django
    django.setup()
    with patch.object(socket.socket,'connect',side_effect=AssertionError('Network forbidden')), \
         patch.object(socket,'getaddrinfo',side_effect=AssertionError('DNS forbidden')), \
         patch.object(socket,'create_connection',side_effect=AssertionError('Network forbidden')):
        result=unittest.TextTestRunner().run(unittest.defaultTestLoader.loadTestsFromNames(names))
raise SystemExit(not result.wasSuccessful())
