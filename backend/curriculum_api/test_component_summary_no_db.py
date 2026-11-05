"""Programme Overview component summary and the archive reads; synthetic rows, no database.

The summary replaces the programme page's read of every component (~17k on
the largest programme) for the Overview figures, so what is asserted here is
that it answers exactly what that read answered: the same rows survive the
same filters, land in the same week buckets, and carry the same counts,
published counts and per-component-rounded Expected OTJH minutes.
"""
import gzip
import json
from collections import Counter, defaultdict
from unittest.mock import MagicMock, patch

from django.test import RequestFactory, SimpleTestCase

from . import views


def js_round(value):
    # Math.round, written out independently of views.js_round.
    whole = int(value // 1)
    return whole + 1 if value - whole >= 0.5 else whole


MODULES = [
    {'module_catalogue_id': 'MOD-1', 'title': 'Planning', 'programme_name': 'Synthetic programme'},
    {'module_catalogue_id': 'MOD-2', 'title': 'Controls', 'programme_name': 'Synthetic programme'},
]
WEEKS = [
    {'id': 'W-1', 'module_catalogue_id': 'MOD-1', 'week_number': 1, 'title': 'Orientation'},
    {'id': 'W-2', 'module_catalogue_id': 'MOD-1', 'week_number': 2, 'title': ''},
    {'id': 'W-3', 'module_catalogue_id': 'MOD-2', 'week_number': 1, 'title': 'Kick-off'},
    # Archived week: its components fall back to "Week 1" exactly as the full read does.
    {'id': 'W-OLD', 'module_catalogue_id': 'MOD-2', 'week_number': 5, 'title': 'Gone', 'deleted_at': '2026-01-01'},
]


def component(cid, module, week, otjh, *, status=None, order=0, title='', **extra):
    settings = {'componentBuilderStatus': status} if status is not None else {}
    return {
        'id': cid, 'module_catalogue_id': module, 'week_id': week, 'type': 'reading',
        'title': title or cid, 'display_order': order, 'expected_otjh': otjh,
        'deleted_at': None, 'is_programme_deleted': False, 'library_state': None,
        'settings_json': settings, **extra,
    }


COMPONENTS = [
    component('C-1', 'MOD-1', 'W-1', 0.25, status='published', order=2),
    component('C-2', 'MOD-1', 'W-1', 0.025, status='draft', order=1),  # 1.5 min: Math.round -> 2
    component('C-3', 'MOD-1', 'W-1', 0.1),  # 6.000000000000001 -> 6
    component('C-4', 'MOD-1', 'W-2', -1, status='published'),  # negative counts as 0 minutes
    component('C-5', 'MOD-1', 'W-2', None),
    component('C-6', 'MOD-2', 'W-3', 1.5, status='published'),
    component('C-7', 'MOD-2', 'W-OLD', 0.5),
    component('C-8', 'MOD-2', 'W-MISSING', 2),
    component('C-9', 'MOD-3', 'W-X', 1),  # module row absent -> 'Unassigned programme'
    # A settings document stored as a JSON string is parsed, as the full read parses it.
    component('C-10', 'MOD-2', 'W-3', 0.75, settings_json=json.dumps({'componentBuilderStatus': 'published'})),
    # Filtered out by active_component_rows(), as the full read filters them.
    component('C-RETIRED', 'MOD-1', 'W-1', 9, type='workplace-evidence'),
    component('C-LIBRARY', 'MOD-1', 'W-1', 9, library_state=views.LIBRARY_STATE_DETACHED),
    component('C-DELETED', 'MOD-1', 'W-1', 9, deleted_at='2026-02-02'),
    component('C-PROG-DELETED', 'MOD-1', 'W-1', 9, is_programme_deleted=True),
]
IDS = ['MOD-1', 'MOD-2', 'MOD-3']
COLUMNS = {
    'id', 'module_catalogue_id', 'week_id', 'type', 'title', 'display_order', 'expected_otjh',
    'deleted_at', 'is_programme_deleted', 'library_state', 'settings_json',
}


def fake_fetch(table, where_sql='', params=None, order_sql='', **kwargs):
    rows = {
        views.AUTHORING_MODULES_TABLE: MODULES,
        views.AUTHORING_WEEKS_TABLE: WEEKS,
        views.AUTHORING_COMPONENTS_TABLE: COMPONENTS,
        views.AUTHORING_KSB_MAPPINGS_TABLE: [],
    }[table]
    wanted = set(params or [])
    return [dict(row) for row in rows if not wanted or row.get('module_catalogue_id') in wanted]


def expected_buckets():
    """The figures, aggregated from what components/ itself returns for these rows."""
    with patch.object(views, 'authoring_fetch_all', side_effect=fake_fetch), \
            patch.object(views, 'ensure_module_authoring_tables'), \
            patch.object(views, 'mappings_with_inferred_sources', side_effect=lambda rows, modules: rows):
        full = views._component_builder_rows(IDS, [dict(row) for row in COMPONENTS])
    buckets = defaultdict(lambda: {'count': 0, 'publishedCount': 0, 'otjhMinutes': 0})
    for item in full:
        key = (item['moduleCatalogueId'], item['weekId'], item['week'], item['weekTitle'], item['module'], item['programme'])
        buckets[key]['count'] += 1
        buckets[key]['publishedCount'] += 1 if item['status'] == 'published' else 0
        buckets[key]['otjhMinutes'] += max(0, js_round(float(item['expectedOtjh'] or 0) * 60))
    return dict(buckets)


def as_buckets(rows):
    return {
        (row['moduleCatalogueId'], row['weekId'], row['week'], row['weekTitle'], row['module'], row['programme']):
        {'count': row['count'], 'publishedCount': row['publishedCount'], 'otjhMinutes': row['otjhMinutes']}
        for row in rows
    }


def grouped_like_postgres(sql, params=None):
    """What the two summary statements return, computed from COMPONENTS."""
    live = [
        row for row in COMPONENTS
        if row['module_catalogue_id'] in set(params or []) and row['deleted_at'] is None and row['is_programme_deleted'] is not True
    ]
    if 'group by' in sql:
        groups = {}
        for row in live:
            settings = row['settings_json']
            if not (settings is None or isinstance(settings, dict)):
                continue
            published = isinstance(settings, dict) and settings.get('componentBuilderStatus') == 'published'
            key = (row['module_catalogue_id'], row['week_id'], row['type'], row['library_state'],
                   row['is_programme_deleted'], None, row['expected_otjh'], published)
            group = groups.setdefault(key, {'rows': []})
            group['rows'].append(row)
        out = []
        for key, group in groups.items():
            first = min(group['rows'], key=lambda r: (r['display_order'], r['title']))
            out.append({
                'module_catalogue_id': key[0], 'week_id': key[1], 'type': key[2], 'library_state': key[3],
                'is_programme_deleted': key[4], 'is_deleted': key[5], 'expected_otjh': key[6],
                '_published_flag': key[7], '_count': len(group['rows']),
                'display_order': first['display_order'], 'title': first['title'],
            })
        return out
    return [dict(row) for row in live if isinstance(row['settings_json'], str)]


class ComponentSummaryTests(SimpleTestCase):
    def summary(self, vendor):
        connection = MagicMock(vendor=vendor)
        with patch.object(views, 'connection', connection), \
                patch.object(views, 'column_names', return_value=COLUMNS), \
                patch.object(views, 'authoring_fetch_all', side_effect=fake_fetch), \
                patch.object(views, 'ensure_module_authoring_tables'), \
                patch.object(views, 'fetch_all', side_effect=grouped_like_postgres) as fetch_all:
            rows = views.component_summary_rows(IDS)
        return rows, fetch_all

    def test_matches_the_full_component_read_bucket_for_bucket(self):
        expected = expected_buckets()
        for vendor in ('sqlite', 'postgresql'):
            with self.subTest(vendor=vendor):
                rows, _ = self.summary(vendor)
                self.assertEqual(as_buckets(rows), expected)

    def test_figures_the_overview_shows(self):
        rows, _ = self.summary('postgresql')
        self.assertEqual(sum(row['count'] for row in rows), 10)
        self.assertEqual(sum(row['publishedCount'] for row in rows), 4)
        # 15 + 2 + 6 + 0 + 0 + 90 + 30 + 120 + 60 + 45
        self.assertEqual(sum(row['otjhMinutes'] for row in rows), 368)
        stale_week = next(row for row in rows if row['weekId'] == 'W-OLD')
        self.assertEqual((stale_week['week'], stale_week['weekTitle']), ('Week 1', 'Week 1'))
        orphan = next(row for row in rows if row['moduleCatalogueId'] == 'MOD-3')
        self.assertEqual(orphan['programme'], 'Unassigned programme')

    def test_first_component_of_a_bucket_is_its_display_order_then_title(self):
        rows, _ = self.summary('postgresql')
        week_one = next(row for row in rows if row['weekId'] == 'W-1')
        self.assertEqual((week_one['displayOrder'], week_one['title']), (0, 'C-3'))

    def test_postgres_groups_in_the_database_and_never_selects_content(self):
        _, fetch_all = self.summary('postgresql')
        statements = [call.args[0] for call in fetch_all.call_args_list]
        self.assertEqual(len(statements), 2)
        self.assertIn('group by', statements[0])
        self.assertIn('count(*)', statements[0])
        for statement in statements:
            self.assertNotIn('select *', statement)
            self.assertNotIn('description', statement)
            self.assertIn('deleted_at', statement)

    def test_no_ids_reads_nothing(self):
        with patch.object(views, 'fetch_all') as fetch_all, patch.object(views, 'authoring_fetch_all') as fetch:
            self.assertEqual(views.component_summary_rows([]), [])
        fetch_all.assert_not_called()
        fetch.assert_not_called()

    def test_js_round_is_math_round(self):
        self.assertEqual(views.js_round(2.5), 3)
        self.assertEqual(views.js_round(-2.5), -2)
        self.assertEqual(views.js_round(1.4999999), 1)
        self.assertEqual(views.js_round(0.1 * 60), 6)


class ComponentSummaryViewTests(SimpleTestCase):
    def get(self, query, **headers):
        with patch.object(views, 'component_summary_rows', return_value=[{'count': 1}]) as rows, \
                patch.object(views, 'cached_curriculum_value', side_effect=lambda key, build, **kw: build()) as cached:
            request = RequestFactory().get('/curriculum/components/summary/' + query, **headers)
            response = views.curriculum_component_summary(request)
        return response, rows, cached

    def test_requires_module_ids(self):
        response, rows, _ = self.get('')
        self.assertEqual(response.status_code, 400)
        rows.assert_not_called()

    def test_key_is_the_sorted_id_set_and_the_body_round_trips(self):
        first, rows, cached = self.get('?module_catalogue_ids=B,A,B', HTTP_ACCEPT_ENCODING='gzip')
        rows.assert_called_once_with(['A', 'B'])
        body = gzip.decompress(first.content) if first.get('Content-Encoding') == 'gzip' else first.content
        self.assertEqual(json.loads(body)['results'], [{'count': 1}])
        _, _, reordered = self.get('?module_catalogue_ids=A,B')
        self.assertEqual(cached.call_args.args[0], reordered.call_args.args[0])
        self.assertEqual(cached.call_args.kwargs['ttl'], 60)
        unchanged, _, _ = self.get('?module_catalogue_ids=A,B', HTTP_IF_NONE_MATCH=first['ETag'])
        self.assertEqual(unchanged.status_code, 304)

    def test_skip_cache_forces_a_rebuild(self):
        _, _, cached = self.get('?module_catalogue_ids=A&skipCache=1')
        self.assertTrue(cached.call_args.kwargs['force'])


class ArchivedCohortsTests(SimpleTestCase):
    def test_reads_the_holiday_calendar_once_and_answers_as_before(self):
        cohorts = [
            {'cohort_id': f'C-{index}', 'cohort_name': f'Cohort {index}', 'programme_id': 'P', 'programme_name': 'P',
             'start_date': '2026-01-05', 'end_date': '2026-12-18', 'duration_months': 12, 'deleted_at': '2026-03-01'}
            for index in range(5)
        ]
        holidays = [{'id': 'H-1', 'holiday_date': '2026-05-04', 'title': 'Early May bank holiday', 'source': 'govuk'}]

        def archived(table):
            return cohorts if table == views.COHORT_AUTHORING_DETAILS_TABLE else []

        with patch.object(views, 'archived_authoring_rows', side_effect=archived), \
                patch.object(views, 'active_learner_delivery_counts', return_value=({}, {})), \
                patch.object(views, 'get_holiday_rows_safe', return_value=holidays) as read_holidays:
            response = views.curriculum_archived_cohorts(RequestFactory().get('/curriculum/cohorts/archived/'))
            per_row = [views.archived_cohort_payload(row, [], {}) for row in cohorts]
        self.assertEqual(response.status_code, 200)
        # Once for the list; the per-row reference above reads once per row.
        self.assertEqual(read_holidays.call_count, 1 + len(cohorts))
        self.assertEqual(json.loads(response.content)['results'], json.loads(json.dumps(per_row, default=str)))


class ArchivedModuleComponentCountTests(SimpleTestCase):
    def test_postgres_counts_only_the_named_modules_in_the_database(self):
        cursor = MagicMock()
        cursor.fetchall.return_value = [('MOD-A', 3), ('MOD-B', 1)]
        connection = MagicMock(vendor='postgresql')
        connection.cursor.return_value.__enter__.return_value = cursor
        with patch.object(views, 'connection', connection), patch.object(views, 'ensure_module_authoring_tables'):
            counts = views.archived_module_component_counts(['MOD-B', 'MOD-A', 'MOD-A'])
        sql, params = cursor.execute.call_args.args
        self.assertIn('group by module_catalogue_id', sql)
        self.assertIn('count(*)', sql)
        self.assertEqual(params, ['MOD-A', 'MOD-B'])
        self.assertEqual(dict(counts), {'MOD-A': 3, 'MOD-B': 1})

    def test_no_archived_modules_reads_nothing(self):
        connection = MagicMock(vendor='postgresql')
        with patch.object(views, 'connection', connection):
            self.assertEqual(dict(views.archived_module_component_counts([])), {})
        connection.cursor.assert_not_called()

    def test_other_databases_count_every_row_as_before(self):
        rows = [{'module_catalogue_id': key} for key in ['M1', 'M1', 'M2', '', None]]
        with patch.object(views, 'connection', MagicMock(vendor='sqlite')), \
                patch.object(views, 'authoring_fetch_all', return_value=rows):
            counts = views.archived_module_component_counts(['M1'])
        self.assertEqual(dict(counts), dict(Counter({'M1': 2, 'M2': 1})))

    def test_view_counts_the_archived_modules_it_lists(self):
        rows = [
            {'module_catalogue_id': 'MOD-A', 'title': 'A', 'deleted_at': '2026-01-01'},
            {'module_catalogue_id': '', 'title': 'blank'},
        ]
        with patch.object(views, 'archived_module_rows', return_value=rows), \
                patch.object(views, 'archived_module_component_counts', return_value={'MOD-A': 7}) as counts, \
                patch.object(views, 'archived_parent_programme', return_value=None):
            response = views.curriculum_archived_modules(RequestFactory().get('/curriculum/modules/archived/'))
        counts.assert_called_once_with(['MOD-A'])
        results = json.loads(response.content)['results']
        self.assertEqual([(row['id'], row['components']) for row in results], [('MOD-A', 7)])
