"""Prove the SQL learner-count path agrees with the Python one before it ships.

Reads every module id the catalogue knows about -- the same set
`attach_module_assignment_counts` would ask for -- runs both implementations
against the live data, and prints any module whose count differs. Nothing is
written and nothing the application serves changes; this is the gate that has to
come back clean before `bulk_assigned_learner_counts_sql` replaces the original.
"""
from contextlib import ExitStack, contextmanager

from django.core.management.base import BaseCommand
from django.db import connections, transaction

from curriculum_api import views
from curriculum_api.learner_assignment_counts_sql import compare_assignment_counts
from learner_api.models import EnrolmentUser


@contextmanager
def _no_statement_timeout(aliases):
    """Let the slow implementation finish, just this once.

    The Python path is the thing the 15s `statement_timeout` kills -- that is
    the whole reason the curriculum payload never builds -- so a comparison that
    inherits the timeout can only ever compare a failure. `SET LOCAL` inside an
    explicit transaction is also the only form that survives Neon's PgBouncer:
    a transaction is pinned to one backend, whereas a plain post-connect `SET`
    lands on whichever backend the pooler happened to hand out.

    Read-only, and scoped to this command.
    """
    with ExitStack() as stack:
        for alias in aliases:
            stack.enter_context(transaction.atomic(using=alias))
            with connections[alias].cursor() as cursor:
                cursor.execute('SET LOCAL statement_timeout = 0')
        yield


class Command(BaseCommand):
    help = 'Compare the Python and SQL assigned-learner counts on the live data.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--module', action='append', dest='modules', default=None,
            help='Limit to these module catalogue ids (repeatable). Default: every module.',
        )
        parser.add_argument(
            '--show-counts', action='store_true',
            help='Also print the agreed count for every module, not just mismatches.',
        )

    def handle(self, *args, **options):
        module_ids = options['modules']
        if not module_ids:
            rows = views.authoring_fetch_all(views.AUTHORING_MODULES_TABLE)
            module_ids = [
                views.clean_str(row.get('module_catalogue_id')) for row in rows
                if views.clean_str(row.get('module_catalogue_id'))
            ]
        module_ids = sorted(set(module_ids))
        self.stdout.write(f'Comparing {len(module_ids)} module(s)...')

        aliases = list(dict.fromkeys(['default', EnrolmentUser.all_learners.db]))
        with _no_statement_timeout(aliases):
            report = compare_assignment_counts(module_ids)

        self.stdout.write('')
        self.stdout.write(f"python : {report['old_seconds']}s")
        self.stdout.write(f"sql    : {report['new_seconds']}s")
        self.stdout.write(f"modules: {report['modules']}  matched: {report['matched']}  "
                          f"mismatched: {len(report['mismatches'])}")

        if report['mismatches']:
            self.stdout.write('')
            self.stdout.write(f"{'module_id':<44}{'old':>6}{'new':>6}{'diff':>7}")
            for row in report['mismatches']:
                self.stdout.write(
                    f"{row['module_id']:<44}{row['old_count']!s:>6}{row['new_count']!s:>6}"
                    f"{row['difference']:>+7}"
                )
            self.stderr.write(self.style.ERROR(
                f"{len(report['mismatches'])} mismatch(es) -- do NOT switch over."
            ))
            return

        if options['show_counts']:
            self.stdout.write('')
            for module_id, count in sorted(report['new_counts'].items()):
                if count:
                    self.stdout.write(f'{module_id:<44}{count:>6}')

        self.stdout.write(self.style.SUCCESS('Identical on every module.'))
