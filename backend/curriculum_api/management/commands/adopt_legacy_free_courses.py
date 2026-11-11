"""Move legacy free courses into Module Builder, retaining source history."""
import json
from contextlib import contextmanager, ExitStack

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from curriculum_api.legacy_free_course_adoption import (
    adoption_snapshot, adopt_course, adopt_learners, save_backup, snapshot_counts,
)


@contextmanager
def read_only_databases():
    with ExitStack() as stack:
        for alias in ('default', 'enrolment'):
            stack.enter_context(transaction.atomic(using=alias))
            with connections[alias].cursor() as cursor:
                cursor.execute('SET TRANSACTION READ ONLY')
        yield


class Command(BaseCommand):
    help = __doc__

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-database', required=True)
        parser.add_argument('--expected-host', required=True)
        parser.add_argument('--backup', help='New private JSON restore-point path; required with --apply.')

    def handle(self, *args, **options):
        # Schema is already owned by migrations. Neither preview nor adoption
        # may run the development schema bootstrap/backfill helpers.
        settings.CURRICULUM_ALLOW_RUNTIME_SCHEMA_BOOTSTRAP = False
        expected_host = options['expected_host'].replace('-pooler.', '.')
        for alias in ('default', 'enrolment'):
            db = connections[alias]
            if (db.vendor != 'postgresql'
                    or str(db.settings_dict['HOST']).replace('-pooler.', '.') != expected_host
                    or db.settings_dict['NAME'] != options['expected_database']):
                raise CommandError('Both configured aliases must match the explicitly identified database target.')
            with db.cursor() as cursor:
                cursor.execute('SELECT current_database()')
                if cursor.fetchone()[0] != options['expected_database']:
                    raise CommandError('Connected database does not match the intended target.')
        try:
            with read_only_databases():
                snapshot = adoption_snapshot()
        except ValueError as exc:
            raise CommandError(str(exc)) from exc
        self.stdout.write(json.dumps({'preview': snapshot_counts(snapshot)}))
        if not options['apply']:
            return
        if not options['backup']:
            raise CommandError('--backup is required for an application-database write.')
        save_backup(snapshot, options['backup'])
        created = sum(adopt_course(payload) for payload in snapshot['payloads'])
        result = adopt_learners(snapshot)
        self.stdout.write(json.dumps({'coursesCreated': created, **result}))
        # Re-read the normal catalogue and the remaining old assignments.
        with read_only_databases():
            verified = adoption_snapshot()
        if snapshot_counts(verified)['assignedLearners']:
            raise CommandError('Legacy assignments remain; rerun after resolving the reported failure.')
        self.stdout.write('Verified: legacy assignments moved; source content and completion history retained.')
