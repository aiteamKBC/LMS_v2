"""Preview/apply a bounded register repair using saved evidence only."""
from collections import Counter
from contextlib import ExitStack

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, router, transaction

from curriculum_api.live_session_register import upsert_live_session_register
from curriculum_api.models import LiveSessionLearnerAttendance
from curriculum_api.shared_session_register import shared_register_rows


class Command(BaseCommand):
    help = 'Preview shared-module learner attendance; --apply persists only the specified modules.'
    requires_system_checks = []

    def add_arguments(self, parser):
        parser.add_argument('--module-id', action='append', required=True, dest='module_ids')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-branch-id', default='')

    def handle(self, *args, **options):
        modules = sorted({value.strip() for value in options['module_ids'] if value.strip()})
        if not modules:
            raise CommandError('At least one exact module ID is required.')
        database = router.db_for_write(LiveSessionLearnerAttendance) or 'default'
        if connections[database].vendor != 'postgresql':
            raise CommandError('This reconciliation requires the verified PostgreSQL application database.')
        apply = options['apply']
        if apply and not options['expected_branch_id']:
            raise CommandError('--apply requires --expected-branch-id to identify the intended database.')
        with ExitStack() as stack:
            identities = set()
            for alias in dict.fromkeys([database, 'default', 'enrolment']):
                stack.enter_context(transaction.atomic(using=alias))
                with connections[alias].cursor() as cursor:
                    if not apply:
                        cursor.execute('SET TRANSACTION READ ONLY')
                    cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
                    identities.add(tuple(cursor.fetchone()))
            if len(identities) != 1:
                raise CommandError('Application aliases must resolve to the same database and Neon branch.')
            _, branch_id = next(iter(identities))
            if options['expected_branch_id'] and branch_id != options['expected_branch_id']:
                raise CommandError('Database branch does not match --expected-branch-id; nothing written.')
            rows = shared_register_rows(database=database, module_refs=modules, exact_modules=True)
            counts = Counter((row['module_catalogue_id'], row['attendance_status']) for row in rows)
            for module_id in modules:
                self.stdout.write(f"{module_id}: {counts[module_id, 'present']} present, {counts[module_id, 'absent']} absent")
            if apply:
                with connections[database].cursor() as cursor:
                    cursor.execute('''SELECT pg_get_constraintdef(oid) FROM pg_constraint
                        WHERE conrelid='curriculum.live_session_learner_attendance'::regclass
                          AND conname='curriculum_live_learner_attendance_uniq' ''')
                    constraint = cursor.fetchone()
                    if not constraint or 'module_catalogue_id' not in constraint[0]:
                        raise CommandError('Migration 0072 is required before writing shared-module attendance.')
                    upsert_live_session_register(cursor, rows)
                    cursor.execute('''SELECT module_catalogue_id,count(*)
                        FROM curriculum.live_session_learner_attendance
                        WHERE module_catalogue_id=ANY(%s) GROUP BY module_catalogue_id''', [modules])
                    totals = dict(cursor.fetchall())
                for module_id in modules:
                    self.stdout.write(f'{module_id}: {totals.get(module_id, 0)} total saved rows after reconciliation')
        self.stdout.write(f"{'Saved' if apply else 'Previewed'} {len(rows)} shared-module attendance rows."
                          + ('' if apply else ' No changes made.'))
