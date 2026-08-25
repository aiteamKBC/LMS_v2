"""Regression cover for the module delete flag and the group module cache.

``modules.is_programme_deleted`` records the *programme's* state. Saving a module
used to carry the flag over from the row being written, so a module archived with
one programme and then re-attached to a live one stayed flagged: the curriculum
tree filtered it out and the parent repair stripped it from ``groups.module_ids``,
which is how a cohort with attached modules came to read as having none.

Two rules are pinned here:

1. an unsent flag is re-derived from the programme the module is saved against;
2. a group's cached module list contains only its surviving modules.
"""
from django.db import connection
from django.test import SimpleTestCase, TestCase
from unittest.mock import patch

from . import views


class ModuleQuizArchiveTests(SimpleTestCase):
    def test_archives_a_quiz_owned_by_the_deleted_module(self):
        def authoring_rows(table, where_sql='', params=None):
            if table == views.AUTHORING_COMPONENTS_TABLE:
                if 'module_catalogue_id <>' in where_sql:
                    return []
                return [{'id': 'COMP-1', 'settings_json': {'linkedQuizId': '17'}}]
            if table == views.AUTHORING_WEEKS_TABLE:
                return []
            if table == views.AUTHORING_MODULES_TABLE:
                return [{'module_catalogue_id': 'MOD-1', 'title': ''}]
            return []

        with (
            patch.object(views, 'table_exists', side_effect=lambda table: table == 'quizzes'),
            patch.object(views, 'has_column', return_value=True),
            patch.object(views, 'fetch_all', return_value=[{'id': 17, 'status': 'published'}]),
            patch.object(views, 'authoring_fetch_all', side_effect=authoring_rows),
            patch.object(views, 'update_rows', return_value=[{'id': 17, 'status': 'trash'}]) as update,
        ):
            archived = views.archive_module_child_quizzes('MOD-1')

        self.assertEqual(archived, [17])
        args = update.call_args.args
        self.assertEqual(args[:3], (
            'quizzes',
            "id in (%s) and lower(coalesce(status, '')) <> 'trash'",
            [17],
        ))
        self.assertEqual(args[3]['status'], 'trash')
        self.assertIsNotNone(args[3]['updated_at'])

    def test_keeps_a_quiz_live_when_another_active_module_uses_it(self):
        def table_exists(table):
            return table in {'quizzes', 'quiz_course_links'}

        def fetch_rows(query, params=None):
            if 'where module_catalogue_id = %s' in query:
                return [{'quiz_id': 17}]
            if 'select id, status' in query:
                return [{'id': 17, 'status': 'published'}]
            if 'module_catalogue_id <> %s' in query:
                return [{'quiz_id': 17, 'module_catalogue_id': 'MOD-2'}]
            return []

        def authoring_rows(table, where_sql='', params=None):
            if table == views.AUTHORING_MODULES_TABLE and ' in (' in where_sql:
                return [{'module_catalogue_id': 'MOD-2', 'deleted_at': None, 'is_programme_deleted': False}]
            if table == views.AUTHORING_MODULES_TABLE:
                return [{'module_catalogue_id': 'MOD-1', 'title': ''}]
            return []

        with (
            patch.object(views, 'table_exists', side_effect=table_exists),
            patch.object(views, 'has_column', return_value=True),
            patch.object(views, 'fetch_all', side_effect=fetch_rows),
            patch.object(views, 'authoring_fetch_all', side_effect=authoring_rows),
            patch.object(views, 'update_rows') as update,
        ):
            archived = views.archive_module_child_quizzes('MOD-1')

        self.assertEqual(archived, [])
        update.assert_not_called()


class ModuleDeleteFlagTests(TestCase):
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
        ):
            with connection.cursor() as cursor:
                cursor.execute(f'delete from {views.authoring_table_name(table)}')
        with connection.cursor() as cursor:
            cursor.execute('delete from ' + views.authoring_table_name('programmes'))

    # ------------------------------------------------------------------ setup

    def _programme(self, programme_id='PROG-LIVE', name='Live Programme', archived=False):
        views.insert_row('programmes', {
            'id': programme_id,
            'programme_id': programme_id,
            'program_id': programme_id,
            'name': name,
            'status': 'archived' if archived else 'active',
            'is_archived': archived,
            'is_active': not archived,
            'created_at': views.datetime.utcnow(),
            'updated_at': views.datetime.utcnow(),
        })
        views.invalidate_curriculum_cache()
        return programme_id

    def _group(self, group_id='GROUP-1', *, cohort_id='COHORT-1', programme_id='PROG-LIVE',
               module_ids=None, module_names=None):
        views.insert_row(views.GROUPS_TABLE, {
            'group_id': group_id,
            'group_name': 'Group A',
            'cohort_id': cohort_id,
            'cohort_name': 'Cohort One',
            'programme_id': programme_id,
            'programme_name': 'Live Programme',
            'module_ids': views.json_db_value(module_ids or []),
            'module_names': views.json_db_value(module_names or []),
        })
        return group_id

    def _module(self, module_id, *, programme_id='PROG-LIVE', group_id='GROUP-1',
                title='Module One', deleted=False, stale_flag=False):
        views.insert_row(views.AUTHORING_MODULES_TABLE, {
            'module_catalogue_id': module_id,
            'programme_id': programme_id,
            'programme_name': 'Live Programme',
            'cohort_id': 'COHORT-1',
            'cohort_name': 'Cohort One',
            'group_id': group_id,
            'group_name': 'Group A',
            'title': title,
            'is_programme_deleted': deleted or stale_flag,
            **({'deleted_at': views.datetime.utcnow(), 'deleted_by': 'test'} if deleted else {}),
        })
        return module_id

    def _module_row(self, module_id):
        rows = views.authoring_fetch_all(
            views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [module_id]
        )
        return rows[0] if rows else {}

    # ------------------------------------------------------------------ flags

    def test_save_clears_stale_flag_when_programme_is_live(self):
        """A module re-attached to a live programme must lose the inherited flag."""
        self._programme()
        self._group()
        self._module('MOD-1', stale_flag=True)

        views.save_module_authoring_structure('MOD-1', {
            'title': 'Module One',
            'programmeId': 'PROG-LIVE',
            'programmeName': 'Live Programme',
            'groupId': 'GROUP-1',
            'cohortId': 'COHORT-1',
            'weekStructure': [],
        })

        row = self._module_row('MOD-1')
        self.assertFalse(views.truthy(row.get('is_programme_deleted')))
        self.assertIsNone(row.get('deleted_at'))
        self.assertFalse(views.programme_deleted_row(row))

    def test_save_keeps_flag_when_programme_is_archived(self):
        """Saving against an archived programme still flags the module."""
        self._programme('PROG-DEAD', 'Dead Programme', archived=True)
        self._group('GROUP-2', programme_id='PROG-DEAD')
        self._module('MOD-2', programme_id='PROG-DEAD', group_id='GROUP-2', stale_flag=True)

        views.save_module_authoring_structure('MOD-2', {
            'title': 'Module Two',
            'programmeId': 'PROG-DEAD',
            'programmeName': 'Dead Programme',
            'groupId': 'GROUP-2',
            'cohortId': 'COHORT-1',
            'weekStructure': [],
        })

        self.assertTrue(views.truthy(self._module_row('MOD-2').get('is_programme_deleted')))

    def test_save_does_not_resurrect_a_module_deleted_on_purpose(self):
        """A real delete stamp survives a save, even under a live programme."""
        self._programme()
        self._group()
        self._module('MOD-DELETED', title='Withdrawn', deleted=True)

        views.save_module_authoring_structure('MOD-DELETED', {
            'title': 'Withdrawn',
            'programmeId': 'PROG-LIVE',
            'programmeName': 'Live Programme',
            'groupId': 'GROUP-1',
            'cohortId': 'COHORT-1',
            'weekStructure': [],
        })

        row = self._module_row('MOD-DELETED')
        self.assertIsNotNone(row.get('deleted_at'))
        self.assertTrue(views.truthy(row.get('is_programme_deleted')))

    def test_explicit_flag_in_payload_still_wins(self):
        self._programme()
        self._group()
        self._module('MOD-3', stale_flag=False)

        views.save_module_authoring_structure('MOD-3', {
            'title': 'Module Three',
            'programmeId': 'PROG-LIVE',
            'programmeName': 'Live Programme',
            'groupId': 'GROUP-1',
            'cohortId': 'COHORT-1',
            'isProgrammeDeleted': True,
            'weekStructure': [],
        })

        self.assertTrue(views.truthy(self._module_row('MOD-3').get('is_programme_deleted')))

    # ------------------------------------------------------------------ cache

    def test_refresh_group_module_cache_drops_deleted_modules(self):
        self._programme()
        self._group(module_ids=['MOD-LIVE', 'MOD-GONE'], module_names=['Live', 'Gone'])
        self._module('MOD-LIVE', title='Live')
        self._module('MOD-GONE', title='Gone', deleted=True)

        views.refresh_group_module_cache('GROUP-1')

        group = views.fetch_group_row('GROUP-1')
        self.assertEqual(views.parse_json_value(group.get('module_ids'), []), ['MOD-LIVE'])
        self.assertEqual(views.parse_json_value(group.get('module_names'), []), ['Live'])

    def test_refresh_group_module_cache_adds_missing_live_modules(self):
        self._programme()
        self._group(module_ids=[], module_names=[])
        self._module('MOD-LIVE', title='Live')

        views.refresh_group_module_cache('GROUP-1')

        group = views.fetch_group_row('GROUP-1')
        self.assertEqual(views.parse_json_value(group.get('module_ids'), []), ['MOD-LIVE'])

    def test_group_authoring_payload_ignores_deleted_module_rows(self):
        self._programme()
        self._group()
        rows = [
            {'module_catalogue_id': 'MOD-LIVE', 'title': 'Live', 'group_id': 'GROUP-1', 'group_name': 'Group A'},
            {
                'module_catalogue_id': 'MOD-GONE',
                'title': 'Gone',
                'group_id': 'GROUP-1',
                'group_name': 'Group A',
                'deleted_at': views.datetime.utcnow(),
                'is_programme_deleted': True,
            },
        ]

        payload = views.group_authoring_payload(
            {'id': 'GROUP-1', 'name': 'Group A', 'cohortId': 'COHORT-1', 'programmeId': 'PROG-LIVE'},
            [],
            rows,
        )

        self.assertEqual(views.parse_json_value(payload.get('module_ids'), []), ['MOD-LIVE'])
        self.assertEqual(views.parse_json_value(payload.get('module_names'), []), ['Live'])
