"""Soft-delete regression cover for ``repair_curriculum_parent_links``.

The repair pass keeps denormalized lineage coherent, but it resolved parents by
id alone. A soft-deleted cohort therefore still pushed its programme down onto a
surviving group, a soft-deleted group still pushed its names onto a surviving
module, and — the defect reported by the integrity audit — a soft-deleted group
id was written straight back into a surviving cohort's ``group_ids``.

Two rules are pinned here:

1. repair writes only to rows that are not effectively deleted;
2. what it writes never references an effectively deleted row.

Delete state is read-only to repair, so a surviving child still holding an old
parent id can never restore that parent. Restore stays explicit.
"""
from django.db import connection
from django.test import TestCase

from . import views


class CurriculumParentRepairSoftDeleteTests(TestCase):
    def setUp(self):
        views.reset_schema_ready_flags()
        views.invalidate_curriculum_cache()
        views.ensure_module_authoring_tables()
        self._clear()

    def _clear(self):
        for table in (
            views.AUTHORING_KSB_MAPPINGS_TABLE,
            views.AUTHORING_COMPONENTS_TABLE,
            views.AUTHORING_WEEKS_TABLE,
            views.AUTHORING_MODULES_TABLE,
            views.GROUPS_TABLE,
            views.COHORT_AUTHORING_DETAILS_TABLE,
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')

    # ------------------------------------------------------------------ setup

    def _deleted_columns(self, deleted, via_parent=''):
        if not deleted:
            return {}
        return {
            'deleted_at': views.datetime.utcnow(),
            'deleted_by': 'test',
            'deleted_via_parent': via_parent,
            'is_programme_deleted': True,
        }

    def _cohort(self, cohort_id, *, programme_id='PROG-1', programme_name='Programme One',
                name='Cohort One', deleted=False, group_ids=None):
        return views.insert_row(views.COHORT_AUTHORING_DETAILS_TABLE, {
            'cohort_id': cohort_id,
            'cohort_name': name,
            'programme_id': programme_id,
            'programme_name': programme_name,
            'group_ids': views.json_db_value(group_ids or []),
            **self._deleted_columns(deleted),
        })

    def _group(self, group_id, *, cohort_id, programme_id='PROG-1', programme_name='Programme One',
               cohort_name='Cohort One', name='Group A', deleted=False, module_ids=None):
        return views.insert_row(views.GROUPS_TABLE, {
            'group_id': group_id,
            'group_name': name,
            'cohort_id': cohort_id,
            'cohort_name': cohort_name,
            'programme_id': programme_id,
            'programme_name': programme_name,
            'module_ids': views.json_db_value(module_ids or []),
            'module_names': views.json_db_value([]),
            **self._deleted_columns(deleted),
        })

    def _module(self, module_id, *, group_id='', group_name='Group A', cohort_id='COHORT-1',
                cohort_name='Cohort One', programme_id='PROG-1', programme_name='Programme One',
                title='Module One', deleted=False):
        return views.insert_row(views.AUTHORING_MODULES_TABLE, {
            'module_catalogue_id': module_id,
            'title': title,
            'group_id': group_id,
            'group_name': group_name,
            'cohort_id': cohort_id,
            'cohort_name': cohort_name,
            'programme_id': programme_id,
            'programme_name': programme_name,
            **self._deleted_columns(deleted),
        })

    def _week(self, week_id, *, module_id, deleted=False):
        return views.insert_row(views.AUTHORING_WEEKS_TABLE, {
            'id': week_id,
            'module_catalogue_id': module_id,
            'week_number': 1,
            'title': 'Week 1',
            **self._deleted_columns(deleted),
        })

    def _component(self, component_id, *, week_id, module_id, deleted=False):
        return views.insert_row(views.AUTHORING_COMPONENTS_TABLE, {
            'id': component_id,
            'week_id': week_id,
            'module_catalogue_id': module_id,
            'type': 'podcast',
            'title': 'Podcast',
            **self._deleted_columns(deleted),
        })

    # ---------------------------------------------------------------- readers

    def _row(self, table, where, params):
        rows = views.authoring_fetch_all(table, where, params)
        return rows[0] if rows else None

    def _cohort_row(self, cohort_id):
        return self._row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id = %s', [cohort_id])

    def _group_row(self, group_id):
        return self._row(views.GROUPS_TABLE, 'group_id = %s', [group_id])

    def _module_row(self, module_id):
        return self._row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id])

    def _json(self, value):
        return [views.clean_str(item) for item in views.as_json_value(value, [])]

    # ------------------------------------------- active parent, deleted child

    def test_a_deleted_group_id_is_not_written_back_onto_a_surviving_cohort(self):
        """The reported defect, exactly."""
        self._cohort('COHORT-1')
        self._group('GRP-LIVE', cohort_id='COHORT-1')
        self._group('GRP-DEAD', cohort_id='COHORT-1', name='Group B', deleted=True)

        views.repair_curriculum_parent_links('PROG-1')

        self.assertEqual(self._json(self._cohort_row('COHORT-1').get('group_ids')), ['GRP-LIVE'])

    def test_a_deleted_module_is_not_written_back_onto_a_surviving_group(self):
        self._cohort('COHORT-1')
        self._group('GRP-1', cohort_id='COHORT-1')
        self._module('MOD-LIVE', group_id='GRP-1', title='Live module')
        self._module('MOD-DEAD', group_id='GRP-1', title='Dead module', deleted=True)

        views.repair_curriculum_parent_links('PROG-1')

        group = self._group_row('GRP-1')
        self.assertEqual(self._json(group.get('module_ids')), ['MOD-LIVE'])
        self.assertEqual(self._json(group.get('module_names')), ['Live module'])

    def test_an_active_week_keeps_a_deleted_component(self):
        """Soft-deleted rows are not authoring orphans and must not be swept."""
        self._cohort('COHORT-1')
        self._group('GRP-1', cohort_id='COHORT-1')
        self._module('MOD-1', group_id='GRP-1')
        self._week('WEEK-1', module_id='MOD-1')
        self._component('COMP-DEAD', week_id='WEEK-1', module_id='MOD-1', deleted=True)

        views.repair_curriculum_parent_links('PROG-1')

        component = self._row(views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-DEAD'])
        self.assertIsNotNone(component, 'a soft-deleted component must not be hard-deleted')
        self.assertTrue(views.curriculum_row_effectively_deleted(component))

    # ------------------------------------------- active child, deleted parent

    def test_a_surviving_group_does_not_inherit_a_deleted_cohorts_programme(self):
        self._cohort('COHORT-DEAD', programme_id='PROG-DEAD', programme_name='Withdrawn', deleted=True)
        self._group(
            'GRP-1', cohort_id='COHORT-DEAD',
            programme_id='PROG-1', programme_name='Programme One', cohort_name='Cohort One',
        )

        views.repair_curriculum_parent_links()

        group = self._group_row('GRP-1')
        self.assertEqual(views.clean_str(group.get('programme_id')), 'PROG-1')
        self.assertEqual(views.clean_str(group.get('programme_name')), 'Programme One')
        # The archive link is preserved: the group still records which cohort it
        # belonged to, so the withdrawn branch stays traceable.
        self.assertEqual(views.clean_str(group.get('cohort_id')), 'COHORT-DEAD')

    def test_a_surviving_module_does_not_inherit_a_deleted_groups_lineage(self):
        self._cohort('COHORT-1')
        self._group(
            'GRP-DEAD', cohort_id='COHORT-1', name='Withdrawn group',
            programme_id='PROG-DEAD', programme_name='Withdrawn', deleted=True,
        )
        self._module(
            'MOD-1', group_id='GRP-DEAD', group_name='Group A',
            programme_id='PROG-1', programme_name='Programme One',
        )

        views.repair_curriculum_parent_links()

        module = self._module_row('MOD-1')
        self.assertEqual(views.clean_str(module.get('programme_id')), 'PROG-1')
        self.assertEqual(views.clean_str(module.get('group_name')), 'Group A')
        self.assertEqual(views.clean_str(module.get('group_id')), 'GRP-DEAD')

    def test_an_active_module_keeps_a_deleted_week(self):
        self._cohort('COHORT-1')
        self._group('GRP-1', cohort_id='COHORT-1')
        self._module('MOD-1', group_id='GRP-1')
        self._week('WEEK-DEAD', module_id='MOD-1', deleted=True)
        self._component('COMP-1', week_id='WEEK-DEAD', module_id='MOD-1')

        views.repair_curriculum_parent_links('PROG-1')

        week = self._row(views.AUTHORING_WEEKS_TABLE, 'id = %s', ['WEEK-DEAD'])
        self.assertIsNotNone(week)
        self.assertTrue(views.curriculum_row_effectively_deleted(week))
        self.assertIsNotNone(self._row(views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-1']))

    def test_a_row_deleted_through_an_ancestor_is_treated_as_deleted(self):
        """The cascade stamps the child row itself and names the ancestor."""
        self._cohort('COHORT-1')
        group = self._group('GRP-VIA-PARENT', cohort_id='COHORT-1', deleted=True)
        with connection.cursor() as cursor:
            cursor.execute(
                f'update {views.authoring_table_name(views.GROUPS_TABLE)} '
                "set deleted_via_parent = 'programme' where group_id = %s",
                ['GRP-VIA-PARENT'],
            )
        self.assertTrue(views.curriculum_row_effectively_deleted(group))

        views.repair_curriculum_parent_links('PROG-1')

        self.assertEqual(self._json(self._cohort_row('COHORT-1').get('group_ids')), [])
        refreshed = self._group_row('GRP-VIA-PARENT')
        self.assertEqual(views.clean_str(refreshed.get('deleted_via_parent')), 'programme')

    # --------------------------------------------------- repair never restores

    def test_repair_never_clears_the_soft_delete_columns(self):
        """A surviving child holding an old parent id must not resurrect it."""
        self._cohort('COHORT-DEAD', deleted=True)
        self._group('GRP-DEAD', cohort_id='COHORT-DEAD', deleted=True)
        self._module('MOD-LIVE', group_id='GRP-DEAD')

        views.repair_curriculum_parent_links()

        for row in (self._cohort_row('COHORT-DEAD'), self._group_row('GRP-DEAD')):
            self.assertIsNotNone(row.get('deleted_at'))
            self.assertEqual(views.clean_str(row.get('deleted_by')), 'test')
            self.assertTrue(views.curriculum_row_effectively_deleted(row))
        # curriculum.cohorts carries no is_programme_deleted column; groups do,
        # and the flag must survive the pass too.
        self.assertTrue(views.truthy(self._group_row('GRP-DEAD').get('is_programme_deleted')))

    def test_repair_leaves_an_archived_rows_stored_lineage_untouched(self):
        """Archived rows keep exactly the lineage they were archived with."""
        self._cohort('COHORT-1')
        self._group(
            'GRP-DEAD', cohort_id='COHORT-1', cohort_name='Stale cohort name',
            programme_name='Stale programme name', deleted=True,
            module_ids=['MOD-ARCHIVED'],
        )

        views.repair_curriculum_parent_links('PROG-1')

        group = self._group_row('GRP-DEAD')
        self.assertEqual(views.clean_str(group.get('cohort_name')), 'Stale cohort name')
        self.assertEqual(views.clean_str(group.get('programme_name')), 'Stale programme name')
        self.assertEqual(self._json(group.get('module_ids')), ['MOD-ARCHIVED'])

    def test_an_explicit_restore_still_reconnects_the_branch(self):
        """Restore is the one operation allowed to change delete state."""
        self._cohort('COHORT-1')
        self._group('GRP-1', cohort_id='COHORT-1', cohort_name='stale', deleted=True)
        self._module('MOD-1', group_id='GRP-1')

        views.update_authoring_rows(
            views.GROUPS_TABLE, 'group_id = %s', ['GRP-1'],
            views.restore_soft_delete_payload(views.GROUPS_TABLE),
        )
        views.repair_curriculum_parent_links('PROG-1')

        group = self._group_row('GRP-1')
        self.assertFalse(views.curriculum_row_effectively_deleted(group))
        self.assertEqual(views.clean_str(group.get('cohort_name')), 'Cohort One')
        self.assertEqual(self._json(group.get('module_ids')), ['MOD-1'])
        self.assertEqual(self._json(self._cohort_row('COHORT-1').get('group_ids')), ['GRP-1'])

    # ------------------------------------------------ healthy behaviour intact

    def test_a_fully_active_tree_is_still_repaired(self):
        self._cohort('COHORT-1', name='Cohort One')
        self._group('GRP-1', cohort_id='COHORT-1', cohort_name='stale name', programme_name='stale programme')
        self._module('MOD-1', group_id='GRP-1', group_name='stale group', title='Module One')

        views.repair_curriculum_parent_links('PROG-1')

        group = self._group_row('GRP-1')
        self.assertEqual(views.clean_str(group.get('cohort_name')), 'Cohort One')
        self.assertEqual(views.clean_str(group.get('programme_name')), 'Programme One')
        self.assertEqual(self._json(group.get('module_ids')), ['MOD-1'])
        self.assertEqual(views.clean_str(self._module_row('MOD-1').get('group_name')), 'Group A')
        self.assertEqual(self._json(self._cohort_row('COHORT-1').get('group_ids')), ['GRP-1'])

    def test_a_group_whose_cohort_row_is_physically_gone_is_still_detached(self):
        self._group('GRP-ORPHAN', cohort_id='COHORT-VANISHED')

        views.repair_curriculum_parent_links()

        group = self._group_row('GRP-ORPHAN')
        self.assertEqual(views.clean_str(group.get('cohort_id')), '')
        self.assertEqual(views.clean_str(group.get('programme_id')), '')
