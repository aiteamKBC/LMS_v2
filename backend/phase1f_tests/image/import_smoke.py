"""Import-only preflight: no database, credentials, application settings or hooks."""
import importlib
import os
from pathlib import Path
import socket
import sys
import threading

assert [name for _, name in socket.if_nameindex()] == ['lo']
assert len(Path('/proc/net/route').read_text().splitlines()) == 1
assert not any(key in os.environ for key in ('NEW_ENDPOINT_URL', 'DATABASE_URL', 'DJANGO_SETTINGS_MODULE'))

def audit(event, args):
    if event in ('socket.connect', 'socket.getaddrinfo', 'subprocess.Popen', 'os.system'):
        raise RuntimeError('Forbidden import-time operation: ' + event)
    if event == 'open' and isinstance(args[0], (str, bytes)):
        if '.env' in os.fsdecode(args[0]).split('/')[-1]:
            raise RuntimeError('Environment-file access forbidden')

sys.addaudithook(audit)
def no_threads(*args, **kwargs):
    raise RuntimeError('Import-time background thread forbidden')
threading.Thread.start = no_threads
sys.path.insert(0, '/tmp/phase1f/backend')
from django.conf import settings
from django.apps import AppConfig

# Base AppConfig deliberately suppresses ready hooks for this import-only check.
# Actual hooks and PostgreSQL behavior require the separate integration stage.
apps = [AppConfig(name, importlib.import_module(name))
        for name in ('curriculum_api', 'learner_api', 'login', 'read_models')]
aliases = ('default', 'enrolment', 'audit', 'audit_clone', 'kbc_attendance', 'assistant_conversations')
settings.configure(SECRET_KEY='phase1f-synthetic-only', DEBUG=False,
    INSTALLED_APPS=apps, DATABASES={key: {'ENGINE': 'django.db.backends.dummy'} for key in aliases},
    CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
    USE_TZ=True, DEFAULT_AUTO_FIELD='django.db.models.BigAutoField', MIDDLEWARE=[])
import django
django.setup()
targets = ('views', 'learner_assignments', 'learner_status_counts', 'learning_storage',
           'home_summary', 'programme_list', 'upload_storage',
           'catalogue.application.overview', 'catalogue.infrastructure.overview_reads',
           'catalogue.application.structure_payloads', 'catalogue.infrastructure.component_reads',
           'catalogue.application.component_projection', 'catalogue.application.component_catalogue',
           'catalogue.infrastructure.library_reads',
           'catalogue.infrastructure.authoring_sql', 'catalogue.infrastructure.authoring_reads',
           'catalogue.infrastructure.component_summary_reads', 'catalogue.domain.component_summary', 'authoring_read_transport', 'authoring_row_cache',
           'catalogue.infrastructure.authoring_transport', 'catalogue.infrastructure.authoring_row_snapshots',
           'catalogue.application.structure_revisions', 'catalogue.infrastructure.structure_sources',
           'catalogue.domain.structure_revision', 'catalogue.application.record_revisions',
           'catalogue.application.conflict_records', 'catalogue.infrastructure.record_revisions', 'record_snapshots',
           'catalogue.application.week_templates', 'catalogue.infrastructure.week_templates',
           'catalogue.application.placement_records', 'catalogue.infrastructure.placement_records',
           'catalogue.application.cohort_calendar', 'catalogue.domain.holiday_selection',
           'catalogue.infrastructure.holiday_reads', 'calendar_policy', 'delivery_calendar',
           'country_calendars', 'england_holidays', 'catalogue.application.inherited_calendar',
           'catalogue.domain.session_plan', 'catalogue.application.session_plans',
           'catalogue.domain.delivery_pattern', 'catalogue.application.delivery_schedules',
           'catalogue.application.session_calendar',
           'catalogue.domain.staff_identity', 'catalogue.application.staff_profiles', 'catalogue.application.staff_assignments',
           'catalogue.infrastructure.staff_directory', 'catalogue.domain.tutor_conflicts', 'catalogue.application.tutor_availability',
           'catalogue.infrastructure.tutor_reads')
targets += ('reporting.domain.ksb', 'reporting.domain.otjh', 'reporting.application.activity', 'reporting.application.consumption', 'reporting.infrastructure.progress', 'reporting.infrastructure.reflections')
targets += ('reporting.application.queries', 'reporting.application.achievement', 'reporting.application.coverage', 'reporting.application.supplementary', 'reporting.api.responses', 'reporting.infrastructure.achievement_cache', 'reporting.infrastructure.supplementary')
targets += ('reporting.api.statistics', 'reporting.application.programme_statistics', 'reporting.application.source_catalogue', 'reporting.application.source_projection', 'reporting.domain.programme_statistics', 'reporting.domain.sources', 'reporting.infrastructure.statistics_cache', 'reporting.infrastructure.statistics_reads')
targets += ('catalogue.domain.session_identity', 'catalogue.application.session_links', 'catalogue.infrastructure.session_reads')
for target in targets:
    importlib.import_module('curriculum_api.' + target)
    print('IMPORT PASS:', 'curriculum_api.' + target, flush=True)
print('Import smoke PASS; no PostgreSQL/HTTP parity claimed', flush=True)

for owner in ('catalogue.api.programme_detail', 'catalogue.application.calendar_queries', 'catalogue.infrastructure.calendar_rows', 'delivery_dashboard', 'calendar_read_rows'):
    importlib.import_module('curriculum_api.' + owner)
print('Calendar owner imports PASS')

for owner in ('catalogue.application.scope_queries', 'catalogue.infrastructure.scope_reads', 'catalogue.application.scope_identity', 'catalogue.application.ksb_projection', 'catalogue.domain.component_settings', 'catalogue.application.authoring_metadata', 'catalogue.api.module_reads', 'catalogue.application.structure_resolution', 'catalogue.infrastructure.resolution_candidates'):
    importlib.import_module('curriculum_api.' + owner)
print('Module workspace owner imports PASS')

for module in ("curriculum_api.catalogue.application.programme_modules", "curriculum_api.catalogue.domain.programme_scope"):
    importlib.import_module(module)
print("Programme source owner imports PASS", flush=True)

importlib.import_module('curriculum_api.catalogue.api.ksb_sources')
print('KSB reference API owner import PASS', flush=True)
