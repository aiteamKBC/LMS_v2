"""Canonical consumer regressions with database connections and HTTP prohibited."""
import importlib
import io
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'backend'))
from django.conf import settings
settings.configure(SECRET_KEY='synthetic-master-tests', USE_TZ=True, ROOT_URLCONF='master_test_urls',
    DEFAULT_AUTO_FIELD='django.db.models.BigAutoField', ALLOWED_HOSTS=['testserver'],
    DATABASES={name: {'ENGINE': 'django.db.backends.sqlite3', 'NAME': ':memory:'}
               for name in ['default', 'enrolment', 'audit', 'legacy', 'source']},
    AZURE_APPROVED_CONTAINER='synthetic-approved', AZURE_QUARANTINE_CONTAINER='synthetic-quarantine',
    AZURE_REJECTED_CONTAINER='synthetic-rejected',
    INSTALLED_APPS=[], CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}})
from django.apps import apps, AppConfig
names = ['django.contrib.contenttypes', 'django.contrib.auth', 'login', 'learner_api', 'coach_api',
         'curriculum_api', 'quiz_api', 'enrolment_api', 'read_models', 'system_audit',
         'engagement_api', 'progress_reviews_api', 'chat', 'knowledge_base', 'old_otjh']
modules = [
    'learner_api.test_canonical_learning_no_db', 'learner_api.test_material_storage_no_db',
    'learner_api.test_subject_origins_no_db', 'learner_api.test_recovered_activity_content_no_db',
    'learner_api.test_my_learning_sources_sql', 'learner_api.test_course_projection_merge_no_db',
    'learner_api.tests_my_learning_no_db', 'learner_api.tests_my_learning_module_scope_no_db',
    'learner_api.tests_my_learning_diagnostics_no_db', 'learner_api.tests_subject_store',
    'coach_api.tests_overview_modules', 'coach_api.tests_overview_module_selection',
    'coach_api.tests_learning_plan_projection', 'scripts.test_migrate_wordpress_media',
    'learner_api.test_activity_time_history_no_db', 'learner_api.test_activity_viewer_no_db',
    'learner_api.test_journal_sources_no_db', 'learner_api.test_monthly_actual_cache_no_db',
    'learner_api.test_response_cache_no_db', 'learner_api.test_hour_projection_no_db',
    'learner_api.test_free_course_attempts_no_db', 'learner_api.test_free_course_progress_status_no_db',
    'learner_api.test_free_course_quiz_access_no_db', 'learner_api.test_free_course_unknown_dates_no_db',
    'curriculum_api.test_cache_scope_no_db', 'curriculum_api.test_authoring_row_cache_no_db',
    'curriculum_api.test_http_cache_no_db', 'coach_api.test_cache_fail_open_no_db',
    'learner_api.tests_evidence_retention', 'learner_api.tests_evidence_can_delete',
]
with patch('django.db.backends.base.base.BaseDatabaseWrapper.ensure_connection', side_effect=AssertionError('Database forbidden')), \
     patch('requests.sessions.Session.request', side_effect=AssertionError('HTTP forbidden')):
    apps.populate([AppConfig(name, importlib.import_module(name)) for name in names])
    from types import ModuleType
    from django.urls import include, path
    urls = ModuleType('master_test_urls')
    urls.urlpatterns = [path(prefix + '/', include(module + '.urls')) for prefix, module in
                       [('curriculum_api', 'curriculum_api'), ('learner_api', 'learner_api'), ('login_api', 'login')]]
    sys.modules['master_test_urls'] = urls
    results = []
    for name in modules:
        stream = io.StringIO()
        result = unittest.TextTestRunner(stream=stream, verbosity=1).run(unittest.defaultTestLoader.loadTestsFromName(name))
        results.append({'suite': name, 'run': result.testsRun, 'failures': len(result.failures),
                        'errors': len(result.errors), 'skips': len(result.skipped), 'output': stream.getvalue()})
        print(name, result.testsRun, len(result.failures), len(result.errors), flush=True)
    (ROOT / 'specs/lms-master-completion/canonical-contracts.json').write_text(json.dumps(results, indent=2), encoding='utf-8')
raise SystemExit(any(row['failures'] or row['errors'] for row in results))
