"""The shared deleted-row rule against real rows (PostgreSQL only).

Kept apart from ``tests_week_visibility`` so that module stays database-free:
any suite that asks for a database cannot build one on sqlite.

The fixture mirrors the AI in Marketing incident: a running module still holds
a set of weeks and components from an earlier archive, stamped with its own id,
sharing week numbers with the live set and sorting first by id.
"""
import json
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.conf import settings
from django.db import connections
from django.test import RequestFactory, TestCase

from curriculum_api.week_visibility import visible_child_sql, visible_week_sql

ENROLMENT_IS_POSTGRES = settings.DATABASES.get('enrolment', {}).get('ENGINE', '').endswith('postgresql')

EARLIER = '2026-09-21 08:53:13+00'
ARCHIVED = '2026-10-01 10:00:00+00'
WITH_ARCHIVE = '2026-10-01 09:59:59+00'


class IncidentFixture:
    """Rows shaped like the incident, written through ``ALIAS``.

    Readers use different aliases -- separate connections, each inside its
    own uncommitted test transaction -- so the rows go through the one the
    readers under test read from.
    """

    databases = {'default', 'enrolment'}
    ALIAS = 'enrolment'
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

    def _component(self, cur, component_id, module_id, week_id, title, deleted_at=None, via=None, otjh=1):
        cur.execute('''INSERT INTO curriculum.components
            (id, module_catalogue_id, week_id, type, title, display_order, expected_otjh,
             deleted_at, deleted_via_parent)
            VALUES (%s, %s, %s, 'reading', %s, 0, %s, %s::timestamptz, %s)''',
                    [component_id, module_id, week_id, title, otjh, deleted_at, via])

    def _mapping(self, cur, mapping_id, module_id, week_id, component_id, code, deleted_at=None, via=None):
        cur.execute('''INSERT INTO curriculum.ksb_mappings
            (id, module_catalogue_id, week_id, component_id, ksb_code, deleted_at, deleted_via_parent)
            VALUES (%s, %s, %s, %s, %s, %s::timestamptz, %s)''',
                    [mapping_id, module_id, week_id, component_id, code, deleted_at, via])

    def _visible(self, module_id):
        with connections['enrolment'].cursor() as cur:
            cur.execute('SELECT DISTINCT ON (w.week_number) w.week_number, w.title FROM curriculum.weeks w '
                        f'WHERE w.module_catalogue_id=%s AND {visible_week_sql("w")} '
                        'ORDER BY w.week_number, w.display_order, w.id', [module_id])
            return cur.fetchall()

    def _visible_ids(self, table, module_id):
        with connections['enrolment'].cursor() as cur:
            cur.execute(f'SELECT t.id FROM curriculum.{table} t '
                        f'WHERE t.module_catalogue_id=%s AND {visible_child_sql("t")} ORDER BY t.id',
                        [module_id])
            return [str(row[0]) for row in cur.fetchall()]

    def setUp(self):
        with connections[self.ALIAS].cursor() as cur:
            # Running module: a stale set from an earlier archive shares week
            # numbers with the live set and sorts first by id.
            self._module(cur, self.LIVE_MOD)
            self._week(cur, 'WEEK-A-GHOST-1', self.LIVE_MOD, 1, 'Event MasterClass', EARLIER, self.LIVE_MOD)
            self._week(cur, 'WEEK-A-GHOST-2', self.LIVE_MOD, 2, 'Introduction', EARLIER, self.LIVE_MOD)
            self._week(cur, 'WEEK-B-LIVE-1', self.LIVE_MOD, 1, 'Introduction', None, None)
            self._week(cur, 'WEEK-B-LIVE-2', self.LIVE_MOD, 2, 'Data', None, None)
            self._week(cur, 'WEEK-B-REMOVED-3', self.LIVE_MOD, 3, 'Removed by author', EARLIER, None)
            self._component(cur, 'COMP-A-GHOST-1', self.LIVE_MOD, 'WEEK-A-GHOST-1', 'Ghost reading', EARLIER, self.LIVE_MOD, 123)
            self._component(cur, 'COMP-B-LIVE-1', self.LIVE_MOD, 'WEEK-B-LIVE-1', 'Live reading')
            # A ghost component left on a LIVE week: hidden by its own stamp,
            # not by its week.
            self._component(cur, 'COMP-B-GHOST-ON-LIVE', self.LIVE_MOD, 'WEEK-B-LIVE-1', 'Ghost on live week', EARLIER, self.LIVE_MOD, 50)
            self._component(cur, 'COMP-B-REMOVED', self.LIVE_MOD, 'WEEK-B-LIVE-2', 'Removed by author', EARLIER, None)
            self._mapping(cur, 'MAP-B-LIVE', self.LIVE_MOD, 'WEEK-B-LIVE-1', 'COMP-B-LIVE-1', 'K1')
            self._mapping(cur, 'MAP-B-GHOST', self.LIVE_MOD, 'WEEK-B-LIVE-1', 'COMP-B-LIVE-1', 'K9', EARLIER, self.LIVE_MOD)
            # Module archived on its own: rows stamped by that same archive stay
            # history; an older ghost and a row the author removed do not.
            self._module(cur, self.ARCHIVED_MOD, ARCHIVED, None)
            self._week(cur, 'WEEK-C-GHOST-1', self.ARCHIVED_MOD, 1, 'Stale', EARLIER, self.ARCHIVED_MOD)
            self._week(cur, 'WEEK-D-HIST-1', self.ARCHIVED_MOD, 1, 'History 1', WITH_ARCHIVE, self.ARCHIVED_MOD)
            self._week(cur, 'WEEK-D-HIST-2', self.ARCHIVED_MOD, 2, 'History 2', WITH_ARCHIVE, self.ARCHIVED_MOD)
            self._week(cur, 'WEEK-D-REMOVED-3', self.ARCHIVED_MOD, 3, 'Removed first', '2026-10-01 09:59:00+00', None)
            self._week(cur, 'WEEK-D-OTHER-4', self.ARCHIVED_MOD, 4, 'Other parent', WITH_ARCHIVE, 'WEEK-X')
            self._component(cur, 'COMP-C-GHOST', self.ARCHIVED_MOD, 'WEEK-C-GHOST-1', 'Stale', EARLIER, self.ARCHIVED_MOD)
            self._component(cur, 'COMP-D-HIST', self.ARCHIVED_MOD, 'WEEK-D-HIST-1', 'History', WITH_ARCHIVE, self.ARCHIVED_MOD)
            # Archived with its programme: module and rows share the programme stamp.
            self._module(cur, self.PROGRAMME_MOD, ARCHIVED, 'PROG-1')
            self._week(cur, 'WEEK-E-HIST-1', self.PROGRAMME_MOD, 1, 'Programme history', '2026-10-01 10:00:02+00', 'PROG-1')
            self._component(cur, 'COMP-E-HIST', self.PROGRAMME_MOD, 'WEEK-E-HIST-1', 'Programme history', '2026-10-01 10:00:02+00', 'PROG-1')


@skipUnless(ENROLMENT_IS_POSTGRES, 'needs PostgreSQL (interval arithmetic, curriculum schema)')
class VisibleWeekPostgresTests(IncidentFixture, TestCase):
    """The rule, and the readers on the `enrolment` alias, against real rows."""

    # ---------------------------------------------------------------- the rule

    def test_running_module_shows_only_live_weeks_despite_duplicate_numbers(self):
        self.assertEqual(self._visible(self.LIVE_MOD), [(1, 'Introduction'), (2, 'Data')])

    def test_archived_module_keeps_the_weeks_archived_with_it(self):
        self.assertEqual(self._visible(self.ARCHIVED_MOD), [(1, 'History 1'), (2, 'History 2')])

    def test_programme_archive_keeps_its_weeks(self):
        self.assertEqual(self._visible(self.PROGRAMME_MOD), [(1, 'Programme history')])

    def test_running_module_shows_only_live_components_and_mappings(self):
        self.assertEqual(self._visible_ids('components', self.LIVE_MOD), ['COMP-B-LIVE-1'])
        self.assertEqual(self._visible_ids('ksb_mappings', self.LIVE_MOD), ['MAP-B-LIVE'])

    def test_archived_modules_keep_only_the_components_archived_with_them(self):
        self.assertEqual(self._visible_ids('components', self.ARCHIVED_MOD), ['COMP-D-HIST'])
        self.assertEqual(self._visible_ids('components', self.PROGRAMME_MOD), ['COMP-E-HIST'])

    # -------------------------------------------------------- the reader paths

    def test_training_plan_builder_pickers_list_only_live_rows(self):
        from learner_api import curriculum

        factory = RequestFactory()
        with patch.dict('os.environ', {'LEARNER_API_REQUIRE_AUTH': '1'}), \
                patch('login.permissions.authenticate_request',
                      return_value=SimpleNamespace(role='staff')):
            weeks = curriculum.weeks(factory.get('/', {'module': self.LIVE_MOD}))
            self.assertEqual(weeks.status_code, 200, weeks.content)
            self.assertEqual([row['id'] for row in json.loads(weeks.content)['results']],
                             ['WEEK-B-LIVE-1', 'WEEK-B-LIVE-2'])
            components = curriculum.components(factory.get('/', {'week': 'WEEK-B-LIVE-1'}))
            self.assertEqual([row['id'] for row in json.loads(components.content)['results']],
                             ['COMP-B-LIVE-1'])

    def test_dashboard_components_exclude_ghost_hours(self):
        from learner_api.dashboard_metrics import load_native_components_bulk

        rows = load_native_components_bulk([self.LIVE_MOD])[self.LIVE_MOD]
        self.assertEqual([str(row['id']) for row in rows], ['COMP-B-LIVE-1'])

    def test_legacy_week_titles_resolve_to_the_live_week(self):
        from learner_api.learner_detail import _resolve_week_ids

        resolved = _resolve_week_ids([{'module': self.LIVE_MOD, 'week': 'Introduction'}])
        self.assertEqual(resolved, {(self.LIVE_MOD, 'Introduction'): 'WEEK-B-LIVE-1'})


@skipUnless(ENROLMENT_IS_POSTGRES, 'needs PostgreSQL (interval arithmetic, curriculum schema)')
class DefaultAliasReaderPostgresTests(IncidentFixture, TestCase):
    """Readers that query curriculum.* on the `default` alias."""

    ALIAS = 'default'

    def test_printed_training_plan_lists_only_live_weeks_and_components(self):
        from learner_api.training_plan_document import _module_breakdown

        weeks = _module_breakdown([self.LIVE_MOD])[self.LIVE_MOD]
        text = repr(weeks)
        self.assertIn('Live reading', text)
        for ghost in ('Event MasterClass', 'Ghost reading', 'Ghost on live week', 'Removed by author'):
            self.assertNotIn(ghost, text)

    def test_module_shift_pairs_only_live_weeks_and_components(self):
        from learner_api.module_shift import _weeks_with_components

        weeks = _weeks_with_components(self.LIVE_MOD)
        self.assertEqual([week['weekId'] for week in weeks], ['WEEK-B-LIVE-1', 'WEEK-B-LIVE-2'])
        component_ids = [c['componentId'] for week in weeks for c in week.get('components', []) if c.get('componentId')]
        self.assertEqual(component_ids, ['COMP-B-LIVE-1'])
