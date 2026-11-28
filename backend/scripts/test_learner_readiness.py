"""Run learner SimpleTestCases without provisioning or writing a database.

Usage from backend: ./.venv/Scripts/python.exe scripts/test_learner_readiness.py
"""
import os
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings'
os.environ['DJANGO_USE_SQLITE'] = 'true'
os.environ['AZURE_MAIL_ENABLED'] = 'false'
os.environ['CURRICULUM_WARM'] = '0'
labels = sys.argv[1:] or ['learner_api']
sys.argv = ['manage.py', 'test']

import django
django.setup()

from django.test import SimpleTestCase, TestCase, TransactionTestCase
from django.test.runner import DiscoverRunner, iter_test_cases

runner = DiscoverRunner(verbosity=1, interactive=False)
discovered = runner.build_suite(labels)
selected = []
excluded = []
for test in iter_test_cases(discovered):
    if (isinstance(test, SimpleTestCase)
            and not isinstance(test, (TestCase, TransactionTestCase))
            and not getattr(test, 'databases', set())):
        selected.append(test)
    else:
        excluded.append(test.id())
print(f'Running {len(selected)} database-free learner tests; excluded {len(excluded)} database-dependent cases.')
suite = unittest.TestSuite(selected)
if runner.get_databases(suite):
    raise RuntimeError('Readiness checks must not request database setup.')
runner.setup_test_environment()
try:
    result = runner.run_suite(suite)
finally:
    runner.teardown_test_environment()
sys.exit(0 if result.wasSuccessful() else 1)
