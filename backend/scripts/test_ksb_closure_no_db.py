"""Run existing KSB regressions with databases/network denied and a local cache."""
import logging.config
import os
from pathlib import Path
import socket
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
os.environ['DJANGO_SETTINGS_MODULE'] = 'config.settings_sqlite_test'
os.environ['CURRICULUM_WARM'] = '0'

from django.db.backends.base.base import BaseDatabaseWrapper
from django.test import override_settings

SUITES = [
    'curriculum_api.test_source_activity_ksbs_no_db',
    'curriculum_api.test_write_shape_no_db',
    'learner_api.test_journal_sources_no_db',
    'old_otjh.test_ksbs',
    'learner_api.test_response_cache_no_db',
    'learner_api.tests_ksb_progress',
    'learner_api.tests_ksb_standards_consumers',
    'learner_api.tests_my_learning_ksbs_no_db',
    'learner_api.test_aptem_ksb_breakdown_no_db',
    'learner_api.test_component_ksb_mappings_no_db',
    'coach_api.tests_ksb_standards_sources',
    'coach_api.tests_otjh_ksb',
    'curriculum_api.test_programme_ksb_source_no_db',
    'curriculum_api.test_programme_ksb_design_cache_no_db',
    'learner_api.test_curriculum_schema_compat_no_db',
]


def main():
    with patch.object(BaseDatabaseWrapper, 'ensure_connection',
                      side_effect=AssertionError('Database forbidden')), \
         patch.object(logging.config, 'dictConfig'):
        # Daphne needs a local socketpair during Windows startup.
        import django
        django.setup()
        with override_settings(CACHES={'default': {
                'BACKEND': 'django.core.cache.backends.locmem.LocMemCache',
                'LOCATION': 'ksb-closure-audit'}}), \
             patch.object(socket.socket, 'connect', side_effect=AssertionError('Network forbidden')):
            result = unittest.TextTestRunner(verbosity=1).run(
                unittest.defaultTestLoader.loadTestsFromNames(sys.argv[1:] or SUITES))
    return int(not result.wasSuccessful())


if __name__ == '__main__':
    raise SystemExit(main())
