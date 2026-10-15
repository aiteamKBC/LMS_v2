"""The shared deleted-week rule against real rows (PostgreSQL only).

Kept apart from ``tests_week_visibility`` so that module stays database-free:
any suite that asks for a database cannot build one on sqlite.
"""
from unittest import skipUnless

from django.conf import settings
from django.db import connections
from django.test import TestCase

from curriculum_api.week_visibility import visible_week_sql

ENROLMENT_IS_POSTGRES = settings.DATABASES.get('enrolment', {}).get('ENGINE', '').endswith('postgresql')


@skipUnless(ENROLMENT_IS_POSTGRES, 'needs PostgreSQL (interval arithmetic, curriculum schema)')
class VisibleWeekPostgresTests(TestCase):
    """The rule against real rows: needs the Postgres test database."""

    databases = {'default', 'enrolment'}
    LIVE_MOD = 'MOD-WV-LIVE'
    ARCHIVED_MOD = 'MOD-WV-ARCHIVED'
    PROGRAMME_MOD = 'MOD-WV-PROGRAMME'

    def _module(self, cur, module_id, deleted_at=None, via=None):
        cur.execute('''INSERT INTO curriculum.modules (module_catalogue_id, title, deleted_at, deleted_via_parent)
            VALUES (%s, %s, %s::timestamptz, %s)''', [module_id, module_id, deleted_at, via])

    def _week(self, cur, week_id, module_id, number, title, deleted_at=None, via=None):
        cur.execute('''INSERT INTO curriculum.weeks
            (id, module_catalogue_id, week_number, display_order, title, deleted_at, deleted_via_parent)
            VALUES (%s, %s, %s, %s, %s, %s::timestamptz, %s)''',
                    [week_id, module_id, number, number - 1, title, deleted_at, via])

    def _visible(self, module_id):
        with connections['enrolment'].cursor() as cur:
            cur.execute('SELECT DISTINCT ON (w.week_number) w.week_number, w.title FROM curriculum.weeks w '
                        f'WHERE w.module_catalogue_id=%s AND {visible_week_sql("w")} '
                        'ORDER BY w.week_number, w.display_order, w.id', [module_id])
            return cur.fetchall()

    def setUp(self):
        earlier, archived = '2026-09-21 08:53:13+00', '2026-10-01 10:00:00+00'
        with connections['enrolment'].cursor() as cur:
            # Running module: a stale set from an earlier delete-and-restore
            # shares week numbers with the live set and sorts first by id.
            self._module(cur, self.LIVE_MOD)
            self._week(cur, 'WEEK-A-GHOST-1', self.LIVE_MOD, 1, 'Event MasterClass', earlier, self.LIVE_MOD)
            self._week(cur, 'WEEK-A-GHOST-2', self.LIVE_MOD, 2, 'Introduction', earlier, self.LIVE_MOD)
            self._week(cur, 'WEEK-B-LIVE-1', self.LIVE_MOD, 1, 'Introduction', None, None)
            self._week(cur, 'WEEK-B-LIVE-2', self.LIVE_MOD, 2, 'Data', None, None)
            self._week(cur, 'WEEK-B-REMOVED-3', self.LIVE_MOD, 3, 'Removed by author', earlier, None)
            # Module archived on its own: weeks stamped by that same delete stay
            # history; an older ghost and a week the author removed do not.
            self._module(cur, self.ARCHIVED_MOD, archived, None)
            self._week(cur, 'WEEK-C-GHOST-1', self.ARCHIVED_MOD, 1, 'Stale', earlier, self.ARCHIVED_MOD)
            self._week(cur, 'WEEK-D-HIST-1', self.ARCHIVED_MOD, 1, 'History 1', '2026-10-01 09:59:59+00', self.ARCHIVED_MOD)
            self._week(cur, 'WEEK-D-HIST-2', self.ARCHIVED_MOD, 2, 'History 2', '2026-10-01 09:59:59+00', self.ARCHIVED_MOD)
            self._week(cur, 'WEEK-D-REMOVED-3', self.ARCHIVED_MOD, 3, 'Removed first', '2026-10-01 09:59:00+00', None)
            self._week(cur, 'WEEK-D-OTHER-4', self.ARCHIVED_MOD, 4, 'Other parent', '2026-10-01 09:59:59+00', 'WEEK-X')
            # Archived with its programme: module and weeks share the programme stamp.
            self._module(cur, self.PROGRAMME_MOD, archived, 'PROG-1')
            self._week(cur, 'WEEK-E-HIST-1', self.PROGRAMME_MOD, 1, 'Programme history', '2026-10-01 10:00:02+00', 'PROG-1')

    def test_running_module_shows_only_live_weeks_despite_duplicate_numbers(self):
        self.assertEqual(self._visible(self.LIVE_MOD), [(1, 'Introduction'), (2, 'Data')])

    def test_archived_module_keeps_the_weeks_archived_with_it(self):
        self.assertEqual(self._visible(self.ARCHIVED_MOD), [(1, 'History 1'), (2, 'History 2')])

    def test_programme_archive_keeps_its_weeks(self):
        self.assertEqual(self._visible(self.PROGRAMME_MOD), [(1, 'Programme history')])
