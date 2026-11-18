"""Plan/apply a verified insert-only cross-branch free-course import."""
import json
import os

import psycopg
from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, connection, transaction

from curriculum_api.free_course_alignment import apply_plan, build_plan, rows, snapshot


def verify(database, branch_id):
    result = rows(database, "SELECT current_database() AS db, current_setting('neon.branch_id',true) AS branch")[0]
    if not branch_id or result['branch'] != branch_id or result['db'] != 'neondb':
        raise CommandError('Database identity does not match the explicit Neon branch and neondb target.')


class Command(BaseCommand):
    help = 'Preview additions without exposing learner data; --apply requires the reviewed plan fingerprint.'

    def add_arguments(self, parser):
        parser.add_argument('--source-branch-id', required=True)
        parser.add_argument('--target-branch-id', required=True)
        parser.add_argument('--source-url-env', default='FREE_COURSE_SOURCE_DATABASE_URL')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-plan')

    def handle(self, *args, **options):
        if options['source_branch_id'] == options['target_branch_id']:
            raise CommandError('Source and target must be different branches.')
        url = os.environ.get(options['source_url_env'])
        if not url:
            raise CommandError('The source URL environment variable is missing.')
        if connection.vendor != 'postgresql' or '-pooler.' in connection.settings_dict.get('HOST', ''):
            raise CommandError('Use a verified direct PostgreSQL target connection.')
        try:
            with psycopg.connect(url, connect_timeout=20, options='-c default_transaction_read_only=on') as source_db:
                source_db.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY')
                verify(source_db, options['source_branch_id'])
                source = snapshot(source_db)
            with transaction.atomic():
                with connection.cursor() as cursor:
                    cursor.execute('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ' +
                                   ('' if options['apply'] else ', READ ONLY'))
                    cursor.execute("SET LOCAL lock_timeout='5s'")
                    cursor.execute("SET LOCAL statement_timeout='60s'")
                verify(connection, options['target_branch_id'])
                with connection.cursor() as cursor:
                    if options['apply']:
                        cursor.execute('SELECT pg_try_advisory_xact_lock(%s)', [411407087])
                        if cursor.fetchone()[0] is not True:
                            raise CommandError('Another alignment is running; no rows were written.')
                before = snapshot(connection)
                plan = build_plan(source, before)
                self.stdout.write(json.dumps(plan.summary(), sort_keys=True))
                self.stdout.flush()
                if options['apply']:
                    if options['expected_plan'] != plan.fingerprint:
                        raise CommandError('The plan changed or has no reviewed fingerprint; no rows were written.')
                    learners = sorted({r['learner_id'] for table in
                        ('learner_free_courses','learner_free_course_progress') for r in plan.inserts[table]})
                    with connection.cursor() as cursor:
                        cursor.execute('SELECT id FROM "Learner".learners WHERE id=ANY(%s) ORDER BY id FOR UPDATE NOWAIT', [learners])
                        cursor.execute('SELECT id FROM enrolment."Created_users" WHERE id=ANY(%s) ORDER BY id FOR UPDATE NOWAIT',
                                       [sorted(plan.assignment_appends)])
                    apply_plan(connection, plan, before)
            self.stdout.write('APPLIED and verified' if options['apply'] else 'READ-ONLY preview; no rows written')
        except (psycopg.Error, DatabaseError, ValueError) as exc:
            # PostgreSQL details can include row content. Only safe diagnostics
            # reach terminals/CI; no source rows or connection strings are logged.
            if isinstance(exc, ValueError):
                raise CommandError(str(exc)) from None
            code = getattr(exc, 'sqlstate', None) or getattr(exc.__cause__, 'sqlstate', None) or type(exc).__name__
            raise CommandError(f'Database operation failed ({code}); transaction rolled back.') from None
