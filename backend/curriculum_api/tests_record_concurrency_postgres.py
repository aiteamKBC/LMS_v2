"""The one thing SQLite cannot show: two connections racing the same row.

``tests_record_concurrency`` proves the guard refuses a stale save, carries the
right state back, and does its check inside the transaction that writes. What it
cannot prove is the part that makes check-and-write one operation rather than
two: the ``select ... for update`` in ``lock_record_row``. A SQLite write
transaction takes the whole database, so the race is serialised for free there
and a missing lock would pass every test in that file.

So this suite exists to be run against a real Postgres, and skips itself
everywhere else rather than reporting a pass it did not earn. Two threads, two
connections, one row:

    A                               B
    ----------------------------    ----------------------------
    lock the row
    read revision N
                                    lock the row  -- blocks here
    write, commit
                                    ...unblocks
                                    read revision N+1
                                    refused

Without the lock, B's revision read would happen while A was still in flight,
come back N, pass the check, and overwrite A -- which is the silent lost update
the whole mechanism exists to make impossible.

Run it with the curriculum tables provisioned against an ISOLATED Postgres --
never the shared one. For example, with a throwaway container:

    docker run --rm -d -p 55432:5432 -e POSTGRES_PASSWORD=x --name lms-race postgres:16
    DATABASE_URL=postgres://postgres:x@localhost:55432/postgres \\
        python manage.py test curriculum_api.tests_record_concurrency_postgres
    docker rm -f lms-race

``TransactionTestCase`` rather than ``TestCase``, deliberately: the per-test
atomic block a ``TestCase`` wraps everything in would put both threads inside
one transaction and hide exactly what is being measured.
"""
import json
import threading
import unittest

from django.db import connection, connections
from django.test import Client, TransactionTestCase

from curriculum_api import views


def _postgres_only(test):
    return unittest.skipUnless(
        connection.vendor == 'postgresql',
        'Row-level locking needs Postgres; a SQLite write transaction takes the '
        'whole database and would serialise this race whether or not the lock '
        'is there, which is precisely what this asserts.',
    )(test)


@_postgres_only
class CohortRowLockRaceTests(TransactionTestCase):
    """Two saves that both read revision N; only one may land."""

    databases = {'default'}

    def setUp(self):
        self.client = Client()
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        views.ensure_module_authoring_tables()
        self.cohort_id = 'COHORT-RACE'
        if not views.fetch_cohort_row(self.cohort_id):
            views.insert_row(views.COHORT_AUTHORING_DETAILS_TABLE, {
                'cohort_id': self.cohort_id,
                'cohort_name': 'Race cohort',
                'programme_id': 'PROG-RACE',
                'programme_name': 'Race programme',
                'start_date': '2026-09-07',
                'duration_months': 12,
                'color': '#6d28d9',
            })
        self.addCleanup(self._remove_cohort)

    def _remove_cohort(self):
        views.delete_rows(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [self.cohort_id])

    def _save(self, name, revision, outcomes, index):
        """One editor's save, on its own connection."""
        try:
            response = self.client.patch(
                '/curriculum_api/curriculum/cohorts/%s/' % self.cohort_id,
                data=json.dumps({'name': name, 'expectedRevision': revision}),
                content_type='application/json',
            )
            outcomes[index] = response.status_code
        finally:
            # A thread that leaves its connection open holds the row after the
            # test has finished with it, and the next test blocks on it.
            connections.close_all()

    def test_only_one_of_two_saves_from_the_same_revision_lands(self):
        shared = views.cohort_record_revision(self.cohort_id)
        self.assertTrue(shared)

        # Both editors are inside the guard before either one writes. The gate
        # opens only once both have asked for the lock, so this is the race as
        # it happens rather than a sequence dressed up as one.
        both_arrived = threading.Barrier(2, timeout=20)
        real_lock = views.lock_record_row

        def gated_lock(table, where_sql, params):
            try:
                both_arrived.wait()
            except threading.BrokenBarrierError:
                pass
            return real_lock(table, where_sql, params)

        views.lock_record_row = gated_lock
        self.addCleanup(setattr, views, 'lock_record_row', real_lock)

        outcomes = [None, None]
        editors = [
            threading.Thread(target=self._save, args=('A renamed it', shared, outcomes, 0)),
            threading.Thread(target=self._save, args=('B renamed it', shared, outcomes, 1)),
        ]
        for editor in editors:
            editor.start()
        for editor in editors:
            editor.join(timeout=30)
            self.assertFalse(editor.is_alive(), 'A save deadlocked on the row lock.')

        # Exactly one landed. Two 200s here would mean both passed the same
        # revision check and the second one wrote over the first -- the lost
        # update, reproduced.
        self.assertEqual(sorted(outcomes), [200, 409], outcomes)

        # And the row holds whichever editor won, not a blend and not the loser.
        stored = views.fetch_cohort_row(self.cohort_id)
        self.assertIn(stored.get('cohort_name'), {'A renamed it', 'B renamed it'})
        # The winner's revision is what a reader would fingerprint now, so the
        # refused editor's retry is measured against a version that exists.
        self.assertNotEqual(views.cohort_record_revision(self.cohort_id), shared)

    def test_the_lock_actually_blocks_the_second_reader(self):
        """The lock is doing the work, not luck in the scheduling.

        Held explicitly on one connection, then asked for on another with
        ``nowait`` so it fails instead of waiting: if the row were not locked
        this would simply succeed.
        """
        from django.db import transaction

        with transaction.atomic():
            views.lock_record_row(
                views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [self.cohort_id],
            )
            blocked = []

            def contend():
                try:
                    with connections['default'].cursor() as cursor:
                        cursor.execute(
                            'select 1 from %s where cohort_id = %%s for update nowait'
                            % views.table_name(views.COHORT_AUTHORING_DETAILS_TABLE),
                            [self.cohort_id],
                        )
                    blocked.append(False)
                except Exception:
                    blocked.append(True)
                finally:
                    connections.close_all()

            contender = threading.Thread(target=contend)
            contender.start()
            contender.join(timeout=20)

        self.assertEqual(blocked, [True], 'The row was not locked; check-and-write is not atomic.')
