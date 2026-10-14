"""The programmes list counts modules without reading their content.

``/curriculum/programmes/`` used to enrich every module with its full week,
component and KSB-mapping content before counting them, which made those two
tables -- the heaviest in the curriculum -- most of a cold load. It now asks
``authoring_catalogue_summaries(include_content=False)``, which reads the two
content figures that can change a count (``lessonCount`` and ``ksbCount``, the
tie-breakers in best_authoring_summary) from grouped queries instead.

Pinned here:

1. a counts-only summary agrees with a full one on every non-content field and
   on the ranking score, including around deleted, detached and retired rows;
2. the SQL pre-filter on the component read returns exactly the rows the Python
   filter keeps;
3. the programmes endpoint returns what a full enrichment would have given.
"""
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connection
from django.test import RequestFactory, TestCase
from unittest.mock import patch

from . import views


CONTENT_ONLY_FIELDS = {
    'weekStructure', 'quizCount', 'totalOtjh', 'totalOtjhMinutes', 'sessionNames', 'ksbCodes',
    # Resolved from the week components, so it is content too. Nothing that
    # counts modules for a programme card reads it.
    'deliveryWeeks',
}


class ProgrammeModuleCountTests(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        views.ensure_module_authoring_tables()
        self._ensure_programmes_table()
        self._clear()

    def tearDown(self):
        views.invalidate_curriculum_cache()

    def _ensure_programmes_table(self):
        with connection.cursor() as cursor:
            if connection.vendor == 'postgresql':
                cursor.execute('create schema if not exists curriculum')
                table_name = 'curriculum.programmes'
            else:
                table_name = 'programmes'
            cursor.execute(
                f"""
                create table if not exists {table_name} (
                    id varchar(128) primary key,
                    programme_id varchar(128),
                    program_id varchar(128),
                    name varchar(255),
                    status varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def _clear(self):
        for table in (
            views.AUTHORING_KSB_MAPPINGS_TABLE,
            views.AUTHORING_COMPONENTS_TABLE,
            views.AUTHORING_WEEKS_TABLE,
            views.AUTHORING_MODULES_TABLE,
            views.GROUPS_TABLE,
            views.COHORT_AUTHORING_DETAILS_TABLE,
            'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')

    # ------------------------------------------------------------------ setup

    def _programme(self, programme_id, name):
        views.insert_row('programmes', {
            'id': programme_id,
            'programme_id': programme_id,
            'program_id': programme_id,
            'name': name,
            'status': 'active',
            'is_archived': False,
            'is_active': True,
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })

    def _module(self, module_id, *, programme_id='PROG-1', programme_name='Programme One',
                title=None, group_id='GROUP-1', deleted=False):
        views.insert_row(views.AUTHORING_MODULES_TABLE, {
            'module_catalogue_id': module_id,
            'programme_id': programme_id,
            'programme_name': programme_name,
            'cohort_id': 'COHORT-1',
            'cohort_name': 'Cohort One',
            'group_id': group_id,
            'group_name': 'Group A',
            'title': title or f'Module {module_id}',
            'status': 'published',
            'is_programme_deleted': deleted,
            **({'deleted_at': views.datetime.utcnow(), 'deleted_by': 'test'} if deleted else {}),
        })

    def _week(self, week_id, module_id, number=1, **extra):
        views.insert_row(views.AUTHORING_WEEKS_TABLE, {
            'id': week_id,
            'module_catalogue_id': module_id,
            'week_number': number,
            'title': f'Week {number}',
            **extra,
        })

    def _component(self, component_id, module_id, week_id, ctype='reading', **extra):
        views.insert_row(views.AUTHORING_COMPONENTS_TABLE, {
            'id': component_id,
            'week_id': week_id,
            'module_catalogue_id': module_id,
            'type': ctype,
            'title': f'Component {component_id}',
            'expected_otjh': 1,
            **extra,
        })

    def _mapping(self, mapping_id, module_id, code, **extra):
        views.insert_row(views.AUTHORING_KSB_MAPPINGS_TABLE, {
            'id': mapping_id,
            'module_catalogue_id': module_id,
            'ksb_code': code,
            **extra,
        })

    def _seed(self):
        """Two programmes, plus a module whose programme has no programmes row.

        MOD-A carries every kind of row the filters have to drop: a soft-deleted
        component, a programme-deleted one, a detached library one and a retired
        type, plus mappings that are deleted, blank, padded and repeated.
        """
        self._programme('PROG-1', 'Programme One')
        self._programme('PROG-2', 'Programme Two')

        self._module('MOD-A')
        self._week('WEEK-A1', 'MOD-A', 1)
        self._week('WEEK-A2', 'MOD-A', 2)
        self._component('COMP-A1', 'MOD-A', 'WEEK-A1')
        self._component('COMP-A2', 'MOD-A', 'WEEK-A1', ctype='quiz')
        self._component('COMP-A3', 'MOD-A', 'WEEK-A2', ctype='live_session')
        self._component('COMP-A-DEL', 'MOD-A', 'WEEK-A2', deleted_at=views.datetime.utcnow())
        self._component('COMP-A-PDEL', 'MOD-A', 'WEEK-A2', is_programme_deleted=True)
        self._component('COMP-A-LIB', 'MOD-A', 'WEEK-A2', library_state=views.LIBRARY_STATE_DETACHED)
        self._component('COMP-A-RET', 'MOD-A', 'WEEK-A2', ctype='workplace_evidence')
        self._mapping('MAP-A1', 'MOD-A', 'K1')
        self._mapping('MAP-A2', 'MOD-A', 'K1')
        self._mapping('MAP-A3', 'MOD-A', ' S2 ')
        self._mapping('MAP-A4', 'MOD-A', 'S2')
        self._mapping('MAP-A5', 'MOD-A', '')
        self._mapping('MAP-A-DEL', 'MOD-A', 'B9', deleted_at=views.datetime.utcnow())
        self._mapping('MAP-A-PDEL', 'MOD-A', 'B8', is_programme_deleted=True)

        self._module('MOD-B', programme_id='PROG-2', programme_name='Programme Two', group_id='GROUP-2')
        self._week('WEEK-B1', 'MOD-B', 1)
        self._component('COMP-B1', 'MOD-B', 'WEEK-B1')
        self._mapping('MAP-B1', 'MOD-B', 'K4')

        # Content-free module, and one whose programme exists only on its rows.
        self._module('MOD-EMPTY')
        self._module('MOD-ORPHAN', programme_id='PROG-ORPHAN', programme_name='Orphan Programme', group_id='GROUP-3')
        self._week('WEEK-O1', 'MOD-ORPHAN', 1)
        self._component('COMP-O1', 'MOD-ORPHAN', 'WEEK-O1')

        # Archived module: only visible with include_programme_deleted.
        self._module('MOD-GONE', deleted=True)
        self._week('WEEK-G1', 'MOD-GONE', 1)
        self._component('COMP-G1', 'MOD-GONE', 'WEEK-G1')
        self._mapping('MAP-G1', 'MOD-GONE', 'K7')
        views.invalidate_curriculum_cache()

    # ------------------------------------------------------------------ tests

    def test_counts_only_summaries_match_full_summaries(self):
        self._seed()
        for include_deleted in (False, True):
            with self.subTest(include_programme_deleted=include_deleted):
                full = views.authoring_catalogue_summaries(include_programme_deleted=include_deleted)
                light = views.authoring_catalogue_summaries(
                    include_programme_deleted=include_deleted, include_content=False,
                )
                self.assertEqual(set(full), set(light))
                self.assertEqual('MOD-GONE' in full, include_deleted)
                for catalogue_id, summary in full.items():
                    counted = light[catalogue_id]
                    for field in set(summary) | set(counted):
                        if field in CONTENT_ONLY_FIELDS:
                            continue
                        self.assertEqual(summary.get(field), counted.get(field), (catalogue_id, field))
                    self.assertEqual(
                        views.authoring_summary_score(summary),
                        views.authoring_summary_score(counted),
                        catalogue_id,
                    )

    def test_counts_exclude_the_rows_the_full_read_excludes(self):
        self._seed()
        light = views.authoring_catalogue_summaries(include_content=False)
        # Three live components: deleted, programme-deleted, library and
        # retired rows are not lessons. K1 and S2 once each; blank, deleted
        # and programme-deleted mappings are not codes.
        self.assertEqual(light['MOD-A']['lessonCount'], 3)
        self.assertEqual(light['MOD-A']['ksbCount'], 2)
        self.assertEqual(light['MOD-A']['weeks'], 2)
        self.assertEqual(light['MOD-EMPTY']['lessonCount'], 0)
        self.assertEqual(light['MOD-EMPTY']['ksbCount'], 0)

    def test_tie_break_picks_the_same_summary(self):
        self._seed()
        full = views.authoring_catalogue_summaries()
        light = views.authoring_catalogue_summaries(include_content=False)
        for pair in (('MOD-A', 'MOD-B'), ('MOD-B', 'MOD-EMPTY'), ('MOD-EMPTY', 'MOD-ORPHAN')):
            with self.subTest(pair=pair):
                self.assertEqual(
                    views.best_authoring_summary([full[item] for item in pair])['catalogueId'],
                    views.best_authoring_summary([light[item] for item in pair])['catalogueId'],
                )

    def test_sql_prefilter_keeps_exactly_the_live_component_rows(self):
        self._seed()
        # A padded library state is one the SQL clause cannot see; the Python
        # filter behind it still has to drop it.
        self._component('COMP-A-LIB-PADDED', 'MOD-A', 'WEEK-A2', library_state=' library ')
        flags = ('deleted_at', 'is_programme_deleted', 'library_state')
        where_sql, params = views.live_authoring_rows_sql(views.AUTHORING_COMPONENTS_TABLE, flags)
        columns = views.CATALOGUE_SUMMARY_COMPONENT_COLUMNS
        unfiltered = views.active_component_rows(views.authoring_fetch_all(
            views.AUTHORING_COMPONENTS_TABLE, columns=columns,
        ))
        prefiltered = views.active_component_rows(views.authoring_fetch_all(
            views.AUTHORING_COMPONENTS_TABLE, where_sql, params, columns=columns,
        ))

        def key(row):
            return row['id']

        self.assertEqual(sorted(unfiltered, key=key), sorted(prefiltered, key=key))
        self.assertNotIn('COMP-A-LIB-PADDED', {row['id'] for row in prefiltered})

    # Learner assignment counts come from the enrolment database and play no part
    # in counting modules; both sides of the comparison skip them alike.
    @patch.object(views, 'attach_module_assignment_counts', lambda modules: None)
    def test_programmes_endpoint_matches_a_full_enrichment(self):
        self._seed()
        factory = RequestFactory()
        for visibility in ('operational', 'all'):
            with self.subTest(visibility=visibility):
                views.invalidate_curriculum_cache()
                payload = views.build_curriculum_payload(visibility, compact=True)
                expected = views.enrich_programmes_with_module_counts(
                    payload['programmes'],
                    views.enrich_modules_with_authoring(
                        payload['modules'], include_programme_deleted=visibility == 'all',
                    ),
                    modules_enriched=True,
                    include_archived=visibility == 'all',
                )
                views.invalidate_curriculum_cache()
                response = views.curriculum_programmes(
                    factory.get('/api/curriculum/programmes/', {'visibility': visibility}),
                )
                self.assertEqual(response.status_code, 200)
                body = json.loads(response.content)
                self.assertEqual(body['results'], json.loads(json.dumps(expected, cls=DjangoJSONEncoder)))
                self.assertTrue(body['results'])
