"""Real document rendering/HTTP with synthetic files; no DB or external services."""
import importlib
import os
from pathlib import Path
import socket
import sys
import unittest

assert [name for _, name in socket.if_nameindex()] == ['lo']
assert len(Path('/proc/net/route').read_text().splitlines()) == 1
assert not any(key in os.environ for key in ('NEW_ENDPOINT_URL', 'DATABASE_URL', 'DJANGO_SETTINGS_MODULE'))


def audit(event, args):
    if event.startswith(('socket.connect', 'socket.getaddrinfo', 'subprocess.')) or event == 'os.system':
        raise RuntimeError('Forbidden media-test operation: ' + event)
    if event == 'open' and isinstance(args[0], (str, bytes)):
        if '.env' in os.fsdecode(args[0]).replace('\\', '/').split('/')[-1]:
            raise RuntimeError('Environment-file access forbidden')


sys.addaudithook(audit)
sys.path.insert(0, '/tmp/phase1f/backend')
from django.conf import settings
from django.apps import AppConfig
aliases = ('default', 'enrolment', 'audit', 'audit_clone', 'kbc_attendance', 'assistant_conversations')
settings.configure(
    SECRET_KEY='synthetic-media-only', DEBUG=False, USE_TZ=True,
    INSTALLED_APPS=[AppConfig(n, importlib.import_module(n)) for n in ('curriculum_api', 'learner_api', 'login', 'read_models')],
    DATABASES={key: {'ENGINE': 'django.db.backends.dummy'} for key in aliases},
    CACHES={'default': {'BACKEND': 'django.core.cache.backends.dummy.DummyCache'}},
    ROOT_URLCONF=__name__, ALLOWED_HOSTS=['testserver'], MIDDLEWARE=[],
    MEDIA_ROOT='/tmp/media-contracts', STORAGE_BACKEND='azure',
    AZURE_STORAGE_ACCOUNT='', AZURE_STORAGE_KEY='', AZURE_CURRICULUM_CONTAINER='',
    CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP=False, READ_MODEL_OUTBOX_ENABLED=False,
    DEFAULT_AUTO_FIELD='django.db.models.BigAutoField', LOGGING_CONFIG=None,
)
from django.db.backends.base.base import BaseDatabaseWrapper


def forbidden_db(*args, **kwargs):
    raise AssertionError('Database operation forbidden in media tests')


BaseDatabaseWrapper.ensure_connection = forbidden_db
BaseDatabaseWrapper.connect = forbidden_db
BaseDatabaseWrapper.cursor = forbidden_db
import django
django.setup()
from django.urls import path
from curriculum_api import views
urlpatterns = [
    path('curriculum_api/curriculum/modules/<str:module_catalogue_id>/ai-material/', views.curriculum_module_ai_material),
    path('curriculum_api/curriculum/presentations/slides/', views.curriculum_presentation_slides),
    path('curriculum_api/curriculum/uploads/<path:path>', views.curriculum_uploaded_file),
    path('curriculum_api/office-preview/<str:token>/<str:filename>', views.curriculum_office_preview_file),
    path('curriculum_api/curriculum/components/<str:component_id>/upload/', views.curriculum_component_upload),
    path('curriculum_api/curriculum/week-components/<str:component_id>/upload/', views.curriculum_week_component_upload),
]
targets = [
    'curriculum_api.tests_ai_material',
    'curriculum_api.tests_pptx_slides',
    'curriculum_api.tests_slide_fallback',
    'curriculum_api.tests_office_preview',
    'curriculum_api.tests_upload_storage',
    'curriculum_api.test_media_delivery_boundary_no_db',
]
suite = unittest.TestSuite(unittest.defaultTestLoader.loadTestsFromName(name) for name in targets)
result = unittest.TextTestRunner(verbosity=2).run(suite)
assert not result.skipped, result.skipped
raise SystemExit(not result.wasSuccessful())
