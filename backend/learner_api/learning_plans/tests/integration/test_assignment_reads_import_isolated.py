"""Run only in the reviewed network-none container with synthetic Django settings."""


def main():
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
        if event.startswith(('socket.connect', 'socket.bind', 'socket.getaddrinfo', 'subprocess.', 'os.system')):
            raise RuntimeError('Operation forbidden in import verification: ' + event)
        if event == 'open' and isinstance(args[0], (str, bytes)) and '.env' in os.fsdecode(args[0]).split('/')[-1]:
            raise RuntimeError('Host environment files are forbidden')


    def no_threads(*args, **kwargs):
        raise RuntimeError('Background threads are forbidden')


    class NoLegacyRuntime:
        forbidden = {'curriculum_api.views', 'learner_api.learning_plan',
                     'learner_api.mappers', 'learner_api.training_plan_writes',
                     'curriculum_api.learner_assignments', 'config.settings'}

        def find_spec(self, fullname, path=None, target=None):
            if fullname in self.forbidden:
                raise AssertionError('Read import reached legacy API/writer: ' + fullname)


    sys.addaudithook(audit)
    threading.Thread.start = no_threads
    sys.meta_path.insert(0, NoLegacyRuntime())
    sys.path.insert(0, '/tmp/phase1f/backend')
    from django.apps import AppConfig
    from django.conf import settings

    aliases = ('default', 'enrolment', 'audit', 'audit_clone', 'kbc_attendance', 'assistant_conversations')
    settings.configure(SECRET_KEY='synthetic-assignment-import', USE_TZ=True,
        INSTALLED_APPS=[AppConfig(n, importlib.import_module(n))
                        for n in ('learner_api', 'curriculum_api', 'login', 'read_models')],
        DATABASES={key: {'ENGINE': 'django.db.backends.dummy'} for key in aliases},
        CACHES={'default': {'BACKEND': 'django.core.cache.backends.locmem.LocMemCache'}},
        DEFAULT_AUTO_FIELD='django.db.models.BigAutoField', MIDDLEWARE=[])
    import django
    django.setup()

    from curriculum_api import learner_assignment_counts_sql as counts
    from learner_api.learning_plans.infrastructure import assignment_reads
    assert counts.plans is assignment_reads
    assert counts.bulk_assigned_learner_counts_sql([]) == {}
    assert assignment_reads._effective_plan_ids(object(), {}, saved_plan=[]) == []
    assert not NoLegacyRuntime.forbidden.intersection(sys.modules)
    print('Cold count-reader import PASS: no views, Learning Plan API, mappers or writers; six dummy aliases; no connections')


if __name__ == '__main__':
    main()
