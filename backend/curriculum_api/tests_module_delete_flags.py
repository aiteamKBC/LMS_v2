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
import json

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
               module_ids=None, module_names=None, withdrawn_via=''):
        views.insert_row(views.GROUPS_TABLE, {
            'group_id': group_id,
            'group_name': 'Group A',
            'cohort_id': cohort_id,
            'cohort_name': 'Cohort One',
            'programme_id': programme_id,
            'programme_name': 'Live Programme',
            'module_ids': views.json_db_value(module_ids or []),
            'module_names': views.json_db_value(module_names or []),
            # A group carried off by its programme's archive, so a module under
            # it is hidden by the group as well as by its own flag -- which is
            # what the real cascade leaves behind.
            **({
                'is_programme_deleted': True,
                'deleted_at': views.datetime.utcnow(),
                'deleted_by': 'programme-delete',
                'deleted_via_parent': withdrawn_via,
            } if withdrawn_via else {}),
        })
        return group_id

    def _module(self, module_id, *, programme_id='PROG-LIVE', group_id='GROUP-1',
                title='Module One', deleted=False, stale_flag=False, withdrawn_via='',
                deleted_on_purpose=False):
        views.insert_row(views.AUTHORING_MODULES_TABLE, {
            'module_catalogue_id': module_id,
            'programme_id': programme_id,
            'programme_name': 'Live Programme',
            'cohort_id': 'COHORT-1',
            'cohort_name': 'Cohort One',
            'group_id': group_id,
            'group_name': 'Group A',
            'title': title,
            'is_programme_deleted': deleted or stale_flag or bool(withdrawn_via) or deleted_on_purpose,
            **({'deleted_at': views.datetime.utcnow(), 'deleted_by': 'test'} if deleted else {}),
            # Exactly what delete_programme_authoring_structure writes onto a
            # module when its programme is archived: the delete stamp plus the
            # parent it was carried off by.
            **({
                'deleted_at': views.datetime.utcnow(),
                'deleted_by': 'programme-delete',
                'deleted_via_parent': withdrawn_via,
            } if withdrawn_via else {}),
            # And what the module DELETE endpoint writes: a stamp with no parent.
            **({
                'deleted_at': views.datetime.utcnow(),
                'deleted_by': 'module-delete',
                'deleted_via_parent': '',
            } if deleted_on_purpose else {}),
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

    # --------------------------------------------------- editing under archive

    def test_editing_a_visible_module_under_an_archived_programme_is_refused(self):
        """The "I edited it and it vanished" report, at the endpoint.

        The flag is re-derived from the programme on every save, so a module
        still visible under a programme that has since been archived was
        withdrawn from every list by any edit at all -- while the response read
        `updated: True`. The edit is refused instead, and the module is left
        exactly as it was.
        """
        self._programme('PROG-ARCHIVED', 'Archived Programme', archived=True)
        self._group('GROUP-ARCH', programme_id='PROG-ARCHIVED')
        self._module('MOD-VISIBLE', programme_id='PROG-ARCHIVED', group_id='GROUP-ARCH')

        response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-VISIBLE/',
            data=json.dumps({'name': 'Renamed While Archived'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('archived programme', response.content.decode().lower())
        row = self._module_row('MOD-VISIBLE')
        self.assertFalse(views.programme_deleted_row(row))
        self.assertEqual(row.get('title'), 'Module One')

    def test_editing_a_module_under_a_live_programme_is_not_blocked(self):
        """The guard must only catch the archived case, never a normal edit."""
        self._programme()
        self._group()
        self._module('MOD-LIVE-EDIT')

        response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-LIVE-EDIT/',
            data=json.dumps({'name': 'Renamed Normally'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._module_row('MOD-LIVE-EDIT').get('title'), 'Renamed Normally')

    # ------------------------------------- structure endpoint (Module Builder)

    def _seed_structure(self, module_id, *, programme_id='PROG-LIVE', programme_name='Live Programme'):
        """Author a real week/component/KSB structure through the save path."""
        views.save_module_authoring_structure(module_id, {
            'catalogueId': module_id,
            'title': 'Module One',
            'programmeId': programme_id,
            'programmeName': programme_name,
            'groupId': 'GROUP-1',
            'cohortId': 'COHORT-1',
            'weeksNumber': 2,
            'sessionsNumber': 2,
            'moduleKsbMappings': [{'code': 'K1', 'type': 'main', 'weight': 40}],
            'weekStructure': [
                {
                    'weekNumber': 1,
                    'title': 'Week One',
                    'ksbMappings': [{'code': 'S1', 'type': 'secondary', 'weight': 30}],
                    'components': [
                        # Component-level mappings are validated against a real
                        # KSB source, which these disposable rows have none of.
                        # Module- and week-level mappings exercise the same
                        # mappings table and are what the fingerprint compares.
                        {'type': 'reading', 'title': 'Reading A', 'expectedOtjh': 2.5, 'ksbMappings': []},
                        {'type': 'assignment', 'title': 'Assignment A', 'expectedOtjh': 1.5, 'ksbMappings': []},
                    ],
                },
                {
                    'weekNumber': 2,
                    'title': 'Week Two',
                    'ksbMappings': [],
                    'components': [
                        {'type': 'podcast', 'title': 'Podcast B', 'expectedOtjh': 3.0, 'ksbMappings': []},
                    ],
                },
            ],
        })
        views.invalidate_curriculum_cache()

    def _structure_fingerprint(self, module_id):
        """Everything the structure endpoint would replace, as comparable data.

        Row ids are included on purpose: a partial write that deleted and
        re-inserted the same-looking weeks would still change them.
        """
        payload = views.get_authoring_structure_payload(module_id) or {}
        row = self._module_row(module_id)
        return {
            'weeksNumber': payload.get('weeksNumber'),
            'sessionsNumber': payload.get('sessionsNumber'),
            'totalOtjh': payload.get('totalOtjh'),
            'declaredTotalOtjh': payload.get('declaredTotalOtjh'),
            'moduleKsbMappings': [
                (m.get('code'), m.get('type'), m.get('weight')) for m in payload.get('moduleKsbMappings') or []
            ],
            'weeks': [
                {
                    'id': week.get('id'),
                    'weekNumber': week.get('weekNumber'),
                    'title': week.get('title'),
                    'ksbMappings': [(m.get('code'), m.get('weight')) for m in week.get('ksbMappings') or []],
                    'components': [
                        {
                            'id': component.get('id'),
                            'type': component.get('type'),
                            'title': component.get('title'),
                            'expectedOtjh': component.get('expectedOtjh'),
                            'ksbMappings': [
                                (m.get('code'), m.get('weight')) for m in component.get('ksbMappings') or []
                            ],
                        }
                        for component in week.get('components') or []
                    ],
                }
                for week in payload.get('weekStructure') or []
            ],
            'row': {
                'title': row.get('title'),
                'weeks_number': row.get('weeks_number'),
                'sessions_number': row.get('sessions_number'),
                'total_otjh': row.get('total_otjh'),
                'is_programme_deleted': views.truthy(row.get('is_programme_deleted')),
                'deleted_at': row.get('deleted_at'),
            },
        }

    def _rewrite_payload(self, module_id, programme_id, programme_name):
        """A structure PATCH body that would definitely change the module."""
        return {
            'catalogueId': module_id,
            'title': 'Rewritten By Builder',
            'programmeId': programme_id,
            'programmeName': programme_name,
            'groupId': 'GROUP-1',
            'cohortId': 'COHORT-1',
            'weeksNumber': 1,
            'sessionsNumber': 1,
            'moduleKsbMappings': [{'code': 'K9', 'type': 'main', 'weight': 99}],
            'weekStructure': [
                {
                    'weekNumber': 1,
                    'title': 'Rewritten Week',
                    'ksbMappings': [],
                    'components': [
                        {'type': 'reading', 'title': 'Rewritten Component', 'expectedOtjh': 9.0, 'ksbMappings': []},
                    ],
                },
            ],
        }

    def _patch_structure(self, module_id, body):
        return self.client.patch(
            '/curriculum_api/curriculum/modules/' + module_id + '/structure/',
            data=json.dumps(body),
            content_type='application/json',
        )

    def test_structure_save_under_an_archived_programme_is_refused(self):
        """Case A. The Builder must be blocked exactly as the drawer is.

        The structure endpoint used to save happily while the programme was
        archived: the save re-derived ``is_programme_deleted`` from the
        programme, so the work landed and the module stayed hidden.
        """
        self._programme('PROG-ARCH-STRUCT', 'Archived Programme', archived=True)
        self._group('GROUP-1', programme_id='PROG-ARCH-STRUCT')
        self._module('MOD-STRUCT-ARCH', programme_id='PROG-ARCH-STRUCT')
        # Authored while the programme still reads live to the save path, so the
        # module starts visible -- which is the case under test.
        with patch.object(views, 'programme_archived_for_authoring', return_value=False):
            self._seed_structure(
                'MOD-STRUCT-ARCH', programme_id='PROG-ARCH-STRUCT', programme_name='Archived Programme',
            )
        self.assertFalse(views.programme_deleted_row(self._module_row('MOD-STRUCT-ARCH')))

        before = self._structure_fingerprint('MOD-STRUCT-ARCH')
        self.assertEqual(len(before['weeks']), 2)

        response = self._patch_structure(
            'MOD-STRUCT-ARCH',
            self._rewrite_payload('MOD-STRUCT-ARCH', 'PROG-ARCH-STRUCT', 'Archived Programme'),
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('archived programme', response.content.decode().lower())
        views.invalidate_curriculum_cache()
        self.assertEqual(self._structure_fingerprint('MOD-STRUCT-ARCH'), before)
        # And the module is still visible -- the refusal must not withdraw it.
        self.assertFalse(views.programme_deleted_row(self._module_row('MOD-STRUCT-ARCH')))

    def test_structure_save_under_a_live_programme_still_works(self):
        """Case B. The new guard must not touch a normal Builder save."""
        self._programme()
        self._group()
        self._module('MOD-STRUCT-LIVE')
        self._seed_structure('MOD-STRUCT-LIVE')

        response = self._patch_structure(
            'MOD-STRUCT-LIVE', self._rewrite_payload('MOD-STRUCT-LIVE', 'PROG-LIVE', 'Live Programme'),
        )

        self.assertEqual(response.status_code, 200, response.content)
        views.invalidate_curriculum_cache()
        after = self._structure_fingerprint('MOD-STRUCT-LIVE')
        self.assertEqual(after['row']['title'], 'Rewritten By Builder')
        self.assertEqual([week['title'] for week in after['weeks']], ['Rewritten Week'])
        self.assertEqual(
            [component['title'] for week in after['weeks'] for component in week['components']],
            ['Rewritten Component'],
        )
        self.assertEqual([m[0] for m in after['moduleKsbMappings']], ['K9'])
        self.assertFalse(after['row']['is_programme_deleted'])

    def test_structure_save_is_refused_when_only_the_programme_NAME_is_archived(self):
        """The guard has to resolve the programme the way the save does.

        ``save_module_authoring_structure`` attaches by id first and then by
        NAME, so a module carrying no usable programme id still lands on the
        programme its name matches -- and is withdrawn if that one is archived.
        Judging the id alone let exactly that case through.
        """
        self._programme('PROG-NAMED-ARCH', 'Named Archived Programme', archived=True)
        self._group('GROUP-1', programme_id='PROG-NAMED-ARCH')
        self._module('MOD-NAME-ONLY', programme_id=None)
        views.update_rows(
            views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-NAME-ONLY'],
            {'programme_name': 'Named Archived Programme'},
        )
        views.invalidate_curriculum_cache()

        payload = self._rewrite_payload('MOD-NAME-ONLY', '', 'Named Archived Programme')
        response = self._patch_structure('MOD-NAME-ONLY', payload)

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('archived programme', response.content.decode().lower())
        self.assertEqual(self._module_row('MOD-NAME-ONLY').get('title'), 'Module One')

    def test_structure_save_for_a_withdrawn_module_moving_to_a_live_programme(self):
        """Case D. The recovery path must survive the shared guard.

        A withdrawn module is deliberately left editable: re-attaching it to a
        live programme is how it comes back. Guarding it would strand it.
        """
        self._programme()
        self._programme('PROG-ARCH-RECOVER', 'Archived Programme', archived=True)
        self._group('GROUP-1')
        self._module('MOD-WITHDRAWN', programme_id='PROG-ARCH-RECOVER', stale_flag=True)
        self.assertTrue(views.programme_deleted_row(self._module_row('MOD-WITHDRAWN')))

        response = self._patch_structure(
            'MOD-WITHDRAWN', self._rewrite_payload('MOD-WITHDRAWN', 'PROG-LIVE', 'Live Programme'),
        )

        self.assertEqual(response.status_code, 200, response.content)
        row = self._module_row('MOD-WITHDRAWN')
        self.assertFalse(views.truthy(row.get('is_programme_deleted')))
        self.assertFalse(views.programme_deleted_row(row))

    def test_withdrawn_module_still_editable_while_under_the_archived_programme(self):
        """Case D, the other half: the guard must never catch a withdrawn row.

        Saving it where it stands has to stay possible too -- that is what lets
        the Builder open it, edit it and only then move it.
        """
        self._programme('PROG-ARCH-STAY', 'Archived Programme', archived=True)
        self._group('GROUP-1', programme_id='PROG-ARCH-STAY')
        self._module('MOD-WITHDRAWN-STAY', programme_id='PROG-ARCH-STAY', stale_flag=True)

        response = self._patch_structure(
            'MOD-WITHDRAWN-STAY',
            self._rewrite_payload('MOD-WITHDRAWN-STAY', 'PROG-ARCH-STAY', 'Archived Programme'),
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(self._module_row('MOD-WITHDRAWN-STAY').get('title'), 'Rewritten By Builder')

    def test_drawer_patch_can_still_move_a_withdrawn_module_to_a_live_programme(self):
        """Case D on the drawer path, so the shared guard is proven on both.

        The guard must let the move through: what re-derives the flag afterwards
        is ``save_module_authoring_structure``, pinned separately by
        ``test_save_clears_stale_flag_when_programme_is_live``. This asserts only
        what the guard owns -- the request is not refused, and the module really
        does land on the live programme.
        """
        self._programme()
        self._programme('PROG-ARCH-DRAWER', 'Archived Programme', archived=True)
        self._group('GROUP-1')
        self._module('MOD-WITHDRAWN-DRAWER', programme_id='PROG-ARCH-DRAWER', stale_flag=True)

        response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-WITHDRAWN-DRAWER/',
            data=json.dumps({'programmeId': 'PROG-LIVE', 'programmeName': 'Live Programme'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        self.assertNotIn('archived programme', response.content.decode().lower())
        self.assertEqual(self._module_row('MOD-WITHDRAWN-DRAWER').get('programme_id'), 'PROG-LIVE')

    # ------------------------------------------- recovery onto a live programme

    def _seed_withdrawn_under_archive(self, module_id='MOD-RESCUE'):
        """A module withdrawn the way a programme archive actually withdraws it.

        ``is_programme_deleted`` set, ``deleted_at`` stamped, ``deleted_via_parent``
        naming the programme that took it down, and the group above it in the
        same state. This is the row the report is about.
        """
        self._programme('PROG-RESCUE-LIVE', 'Rescue Live', archived=False)
        self._programme('PROG-RESCUE-DEAD', 'Rescue Dead', archived=True)
        self._group('GROUP-RESCUE-LIVE', programme_id='PROG-RESCUE-LIVE')
        self._group('GROUP-RESCUE-DEAD', programme_id='PROG-RESCUE-DEAD', withdrawn_via='PROG-RESCUE-DEAD')
        self._module(
            module_id,
            programme_id='PROG-RESCUE-DEAD',
            group_id='GROUP-RESCUE-DEAD',
            withdrawn_via='PROG-RESCUE-DEAD',
        )
        views.invalidate_curriculum_cache()
        row = self._module_row(module_id)
        self.assertTrue(views.truthy(row.get('is_programme_deleted')))
        self.assertIsNotNone(row.get('deleted_at'))
        self.assertNotIn(module_id, views.authoring_catalogue_summaries())
        return module_id

    def _move_to_live_body(self, module_id):
        return {
            'catalogueId': module_id,
            'title': 'Module One',
            'programmeId': 'PROG-RESCUE-LIVE',
            'programmeName': 'Rescue Live',
            'groupId': 'GROUP-RESCUE-LIVE',
            'cohortId': 'COHORT-1',
        }

    def _assert_recovered(self, module_id):
        """Restored in the database, and back in the list people actually read."""
        row = self._module_row(module_id)
        self.assertEqual(views.clean_str(row.get('programme_id')), 'PROG-RESCUE-LIVE')
        self.assertFalse(views.truthy(row.get('is_programme_deleted')))
        self.assertIsNone(row.get('deleted_at'))
        self.assertFalse(views.programme_deleted_row(row))
        views.invalidate_curriculum_cache()
        self.assertIn(module_id, views.authoring_catalogue_summaries())
        return row

    def test_drawer_move_to_a_live_programme_restores_a_withdrawn_module(self):
        """Case 1. The drawer moved the module and left it hidden.

        ``curriculum_module_detail`` builds its save body from
        ``get_authoring_structure_payload``, which reports ``isProgrammeDeleted``
        -- so the module being rescued handed its own stale ``true`` back to the
        save, which honoured it. ``programme_id`` changed, the module stayed
        withdrawn, and nothing in the UI explained why.
        """
        module_id = self._seed_withdrawn_under_archive('MOD-RESCUE-DRAWER')

        response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-RESCUE-DRAWER/',
            data=json.dumps(self._move_to_live_body(module_id)),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        self._assert_recovered(module_id)

    def test_structure_move_to_a_live_programme_restores_a_withdrawn_module(self):
        """Case 2. The Builder must land on exactly the same state."""
        module_id = self._seed_withdrawn_under_archive('MOD-RESCUE-STRUCT')

        response = self._patch_structure(module_id, {
            **self._move_to_live_body(module_id),
            'weeksNumber': 1,
            'weekStructure': [{'weekNumber': 1, 'title': 'Week One', 'ksbMappings': [], 'components': []}],
        })

        self.assertEqual(response.status_code, 200, response.content)
        self._assert_recovered(module_id)

    def test_drawer_and_structure_recovery_reach_identical_state(self):
        """The two paths are the same rule, so the rows they leave must match."""
        drawer_id = self._seed_withdrawn_under_archive('MOD-PARITY-DRAWER')
        self._module(
            'MOD-PARITY-STRUCT',
            programme_id='PROG-RESCUE-DEAD',
            group_id='GROUP-RESCUE-DEAD',
            withdrawn_via='PROG-RESCUE-DEAD',
        )
        views.invalidate_curriculum_cache()

        drawer_response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-PARITY-DRAWER/',
            data=json.dumps(self._move_to_live_body(drawer_id)),
            content_type='application/json',
        )
        structure_response = self._patch_structure('MOD-PARITY-STRUCT', {
            **self._move_to_live_body('MOD-PARITY-STRUCT'),
            'weeksNumber': 0,
            'weekStructure': [],
        })

        self.assertEqual(drawer_response.status_code, 200, drawer_response.content)
        self.assertEqual(structure_response.status_code, 200, structure_response.content)

        def recovery_state(row):
            return (
                views.clean_str(row.get('programme_id')),
                views.truthy(row.get('is_programme_deleted')),
                row.get('deleted_at'),
                row.get('deleted_by'),
                row.get('deleted_via_parent'),
            )

        self.assertEqual(
            recovery_state(self._module_row('MOD-PARITY-DRAWER')),
            recovery_state(self._module_row('MOD-PARITY-STRUCT')),
        )
        self.assertEqual(
            recovery_state(self._module_row('MOD-PARITY-DRAWER')),
            ('PROG-RESCUE-LIVE', False, None, None, None),
        )

    def test_a_stale_withdrawn_flag_in_the_payload_cannot_block_recovery(self):
        """Case 6. The frontend's echoed flag must not win over the move.

        Sent explicitly here, which is what both save paths do in practice: the
        Builder posts back the module it loaded, and the drawer rebuilds its
        body from the stored structure payload.
        """
        module_id = self._seed_withdrawn_under_archive('MOD-RESCUE-STALE')

        response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-RESCUE-STALE/',
            data=json.dumps({**self._move_to_live_body(module_id), 'isProgrammeDeleted': True}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        self._assert_recovered(module_id)

    def test_the_snake_case_stale_flag_cannot_block_recovery_either(self):
        """Both spellings are read by the save, so both have to be overridden."""
        module_id = self._seed_withdrawn_under_archive('MOD-RESCUE-SNAKE')

        views.save_module_authoring_structure(module_id, {
            **self._move_to_live_body(module_id),
            'is_programme_deleted': True,
            'weekStructure': [],
        })

        self._assert_recovered(module_id)

    def test_a_withdrawn_module_edited_under_its_archived_programme_is_not_restored(self):
        """Case 4. Editing in place is allowed, and must not revive anything.

        Recovery is the *move*. A save that leaves the module where it is has
        not changed why it was withdrawn, so the delete stamp stands.
        """
        module_id = self._seed_withdrawn_under_archive('MOD-RESCUE-STAY')
        before = self._module_row(module_id)

        response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-RESCUE-STAY/',
            data=json.dumps({
                'catalogueId': module_id,
                'title': 'Edited In Place',
                'programmeId': 'PROG-RESCUE-DEAD',
                'programmeName': 'Rescue Dead',
            }),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 200, response.content)
        row = self._module_row(module_id)
        self.assertEqual(row.get('title'), 'Edited In Place')
        self.assertTrue(views.truthy(row.get('is_programme_deleted')))
        self.assertEqual(row.get('deleted_at'), before.get('deleted_at'))
        views.invalidate_curriculum_cache()
        self.assertNotIn(module_id, views.authoring_catalogue_summaries())

    def test_a_module_withdrawn_on_its_own_is_not_revived_by_a_move(self):
        """Restoring a deliberately archived module stays an explicit operation.

        It carries no ``deleted_via_parent``: nothing took it down but the
        module delete itself, so re-parenting it must not quietly undo that.
        """
        self._programme('PROG-RESCUE-LIVE', 'Rescue Live')
        self._programme('PROG-OTHER-LIVE', 'Other Live')
        self._group('GROUP-RESCUE-LIVE', programme_id='PROG-RESCUE-LIVE')
        self._module(
            'MOD-DELETED-ON-PURPOSE',
            programme_id='PROG-OTHER-LIVE',
            group_id='GROUP-RESCUE-LIVE',
            deleted_on_purpose=True,
        )

        views.save_module_authoring_structure('MOD-DELETED-ON-PURPOSE', {
            'catalogueId': 'MOD-DELETED-ON-PURPOSE',
            'title': 'Module One',
            'programmeId': 'PROG-RESCUE-LIVE',
            'programmeName': 'Rescue Live',
            'groupId': 'GROUP-RESCUE-LIVE',
            'cohortId': 'COHORT-1',
            'weekStructure': [],
        })

        row = self._module_row('MOD-DELETED-ON-PURPOSE')
        self.assertTrue(views.truthy(row.get('is_programme_deleted')))
        self.assertIsNotNone(row.get('deleted_at'))

    def test_moving_a_withdrawn_module_to_another_archived_programme_keeps_it_withdrawn(self):
        """Recovery needs a live destination, not merely a different one."""
        module_id = self._seed_withdrawn_under_archive('MOD-RESCUE-DEAD-TO-DEAD')
        self._programme('PROG-SECOND-DEAD', 'Second Dead', archived=True)

        views.save_module_authoring_structure(module_id, {
            'catalogueId': module_id,
            'title': 'Module One',
            'programmeId': 'PROG-SECOND-DEAD',
            'programmeName': 'Second Dead',
            'weekStructure': [],
        })

        row = self._module_row(module_id)
        self.assertEqual(views.clean_str(row.get('programme_id')), 'PROG-SECOND-DEAD')
        self.assertTrue(views.truthy(row.get('is_programme_deleted')))

    def test_recovery_does_not_loosen_the_guard_on_a_visible_module(self):
        """Case 3. The archived-programme refusal is untouched by all of this."""
        self._programme('PROG-RESCUE-DEAD', 'Rescue Dead', archived=True)
        self._group('GROUP-VISIBLE', programme_id='PROG-RESCUE-DEAD')
        self._module('MOD-STILL-VISIBLE', programme_id='PROG-RESCUE-DEAD', group_id='GROUP-VISIBLE')
        views.invalidate_curriculum_cache()

        response = self.client.patch(
            '/curriculum_api/curriculum/modules/MOD-STILL-VISIBLE/',
            data=json.dumps({'title': 'Renamed', 'programmeId': 'PROG-RESCUE-DEAD'}),
            content_type='application/json',
        )

        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('archived programme', response.content.decode().lower())
        row = self._module_row('MOD-STILL-VISIBLE')
        self.assertEqual(row.get('title'), 'Module One')
        self.assertFalse(views.truthy(row.get('is_programme_deleted')))

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
