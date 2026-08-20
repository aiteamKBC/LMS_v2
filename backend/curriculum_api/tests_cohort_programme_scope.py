"""Regression cover for cohort scoping across same-named programmes.

Two live programmes can carry the same name: deleting one leaves the name free,
so recreating it produces a second row with the same name and a different id.
The tree detail used to scope a programme's cohorts by *name* as well as by id,
so opening the new programme in the wizard listed the old programme's cohorts —
including the ones soft-deleted along with it — and saving the wizard then wrote
the new programme's id onto them. That is how a cohort deleted with one
programme ended up attached to another, and how a module authored in the new
programme ended up hanging off a deleted cohort.

Four rules are pinned here:

1. a cohort that points at another existing programme is never claimed by name;
2. the name fallback still covers a cohort whose stored programme id is orphaned
   (migration 0038 added the foreign key NOT VALID, so such rows survive);
3. a soft-deleted cohort or group is never served as a live tree node, whatever
   visibility the caller asks for, and the tree save refuses to write into one;
4. recreating a deleted programme's name never derives an id already in use.
"""
import json

from django.db import connection
from django.test import TestCase

from . import views


class CohortProgrammeScopeTests(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        views.ensure_module_authoring_tables()
        self._ensure_programmes_table()
        self._clear()

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
                    level varchar(64),
                    color varchar(32),
                    description text,
                    status varchar(32),
                    is_active boolean,
                    is_archived boolean,
                    ksb_profile_source_id varchar(128),
                    created_at timestamp,
                    updated_at timestamp
                )
                """
            )

    def _clear(self):
        for table in (
            views.AUTHORING_MODULES_TABLE,
            views.GROUPS_TABLE,
            views.COHORT_AUTHORING_DETAILS_TABLE,
            'programmes',
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')
        views.invalidate_curriculum_cache()

    # ------------------------------------------------------------------ setup

    def _programme(self, programme_id, name, archived=False):
        views.insert_row('programmes', {
            'id': programme_id,
            'programme_id': programme_id,
            'program_id': programme_id,
            'name': name,
            'color': '#6941c6',
            'status': 'archived' if archived else 'active',
            'is_archived': archived,
            'is_active': not archived,
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _cohort(self, cohort_id, programme_id, programme_name, name='February 2025'):
        views.authoring_upsert(views.COHORT_AUTHORING_DETAILS_TABLE, ['cohort_id'], {
            'cohort_id': cohort_id,
            'cohort_name': name,
            'programme_id': programme_id,
            'programme_name': programme_name,
            'start_date': '2025-02-01',
            'end_date': '2027-02-01',
            'duration_months': 24,
            'status': 'active',
            'group_ids': views.json_db_value([]),
        })
        views.invalidate_curriculum_cache()
        return cohort_id

    def _group(self, group_id, cohort_id, programme_id, programme_name):
        views.authoring_upsert(views.GROUPS_TABLE, ['group_id'], {
            'group_id': group_id,
            'group_name': 'Group A',
            'cohort_id': cohort_id,
            'cohort_name': 'February 2025',
            'programme_id': programme_id,
            'programme_name': programme_name,
        })
        views.invalidate_curriculum_cache()
        return group_id

    def _soft_delete_cohort(self, cohort_id, via_parent=''):
        views.authoring_soft_delete(
            views.COHORT_AUTHORING_DETAILS_TABLE,
            'cohort_id = %s',
            [cohort_id],
            via_parent=via_parent,
            deleted_by='test',
            extra={'status': 'archived'},
        )
        views.invalidate_curriculum_cache()

    def _detail(self, programme_id):
        response = self.client.get(
            f'/curriculum_api/curriculum/programmes/{programme_id}/detail/?visibility=all'
        )
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()

    # --------------------------------------------------------------- scoping

    def test_detail_does_not_claim_a_same_named_programmes_cohort(self):
        self._programme('PROG-MBA-OLD', 'MBA', archived=True)
        self._programme('PROG-MBA-NEW', 'MBA')
        self._cohort('COHORT-OLD', 'PROG-MBA-OLD', 'MBA')
        self._cohort('COHORT-NEW', 'PROG-MBA-NEW', 'MBA')
        self._group('GROUP-OLD', 'COHORT-OLD', 'PROG-MBA-OLD', 'MBA')
        self._group('GROUP-NEW', 'COHORT-NEW', 'PROG-MBA-NEW', 'MBA')

        payload = self._detail('PROG-MBA-NEW')

        self.assertEqual([item['id'] for item in payload['flat']['cohorts']], ['COHORT-NEW'])
        self.assertEqual([item['id'] for item in payload['flat']['groups']], ['GROUP-NEW'])

    def test_detail_still_matches_a_cohort_whose_programme_id_is_orphaned(self):
        self._programme('PROG-MBA-NEW', 'MBA')
        self._cohort('COHORT-LEGACY', 'PROG-GONE', 'MBA')

        payload = self._detail('PROG-MBA-NEW')

        self.assertEqual([item['id'] for item in payload['flat']['cohorts']], ['COHORT-LEGACY'])

    # ---------------------------------------------------------- soft deletes

    def test_deleted_cohort_and_group_are_never_live_tree_nodes(self):
        self._programme('PROG-MBA-OLD', 'MBA', archived=True)
        self._cohort('COHORT-OLD', 'PROG-MBA-OLD', 'MBA')
        self._group('GROUP-OLD', 'COHORT-OLD', 'PROG-MBA-OLD', 'MBA')
        self._soft_delete_cohort('COHORT-OLD', via_parent='PROG-MBA-OLD')
        views.authoring_soft_delete(
            views.GROUPS_TABLE,
            'group_id = %s',
            ['GROUP-OLD'],
            via_parent='COHORT-OLD',
            deleted_by='test',
        )
        views.invalidate_curriculum_cache()

        for include_archived in (False, True):
            cohorts, groups = views.build_cohorts_and_groups(include_archived=include_archived)
            self.assertNotIn('COHORT-OLD', [item['id'] for item in cohorts], include_archived)
            self.assertNotIn('GROUP-OLD', [item['id'] for item in groups], include_archived)

    def test_tree_save_does_not_write_into_a_deleted_cohort(self):
        self._programme('PROG-MBA-OLD', 'MBA', archived=True)
        self._programme('PROG-MBA-NEW', 'MBA')
        self._cohort('COHORT-OLD', 'PROG-MBA-OLD', 'MBA')
        self._soft_delete_cohort('COHORT-OLD', via_parent='PROG-MBA-OLD')

        saved = views.save_tree_cohort(
            {
                'id': 'COHORT-OLD',
                'name': 'February 2025',
                'startDate': '2025-02-01',
                'durationMonths': 24,
            },
            'PROG-MBA-NEW',
            'MBA',
        )

        self.assertNotEqual(saved['id'], 'COHORT-OLD')
        deleted = views.fetch_cohort_row('COHORT-OLD')
        self.assertEqual(views.clean_str(deleted.get('programme_id')), 'PROG-MBA-OLD')
        self.assertTrue(views.row_has_deleted_at(deleted))
        self.assertEqual(
            views.clean_str(views.fetch_cohort_row(saved['id']).get('programme_id')),
            'PROG-MBA-NEW',
        )

    # --------------------------------------------------------- programme ids

    def test_recreating_a_deleted_programme_name_skips_taken_ids(self):
        # 'PROG-MBA' is written last, so it is the more recently updated of the
        # two archived rows and therefore the one the name lookup prefers. The
        # id derived from it ('PROG-MBA-2') is already taken by the other row.
        self._programme('PROG-MBA-2', 'MBA', archived=True)
        self._programme('PROG-MBA', 'MBA', archived=True)

        response = self.client.post(
            '/curriculum_api/curriculum/programmes/',
            data=json.dumps({'name': 'MBA', 'level': '7'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 201, response.content)
        source_id = response.json()['programme']['sourceId']
        self.assertNotIn(source_id, {'PROG-MBA', 'PROG-MBA-2'})
        self.assertEqual(len(views.fetch_all(f'select * from {views.table_name("programmes")}')), 3)
