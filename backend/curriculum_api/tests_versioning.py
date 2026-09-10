"""Curriculum version history: the rules that make it trustworthy.

Every one of these is a rule the feature is worthless without, and each has a
failure mode that is silent rather than loud — a diff that reports fields nobody
touched, a save recorded twice, or history quietly disabling saves. They are
covered here because none of them shows up as an exception.
"""

from django.db import connection
from django.test import SimpleTestCase

from curriculum_api import versioning, views
from curriculum_api.tests import CurriculumPersistenceHarness


class SnapshotShapeTests(SimpleTestCase):
    """Both write paths must produce comparable snapshots.

    ``authoring_upsert`` hands over a database row; the programme-tree save hands
    over the payload it built. If those two shapes differ, alternating between
    them reports a change on every save and the history becomes noise.
    """

    def test_database_row_and_tree_payload_agree(self):
        row = {
            'id': 'COMP-1', 'module_catalogue_id': 'MOD-1', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Campaign brief', 'description': '',
            'expected_otjh': __import__('decimal').Decimal('2.00'), 'points': 0,
            'ksb_mappings': [{'code': 'K4'}], 'reflection_required': False,
            'Reflection_Question': None, 'workplace_evidence_required': False,
            'tutor_validation_required': False, 'coach_validation_required': True,
            'display_order': 0, 'settings_json': {'version': '0.1', 'contentStatus': 'Draft'},
            'live_sessions_link': '', 'deleted_at': None, 'deleted_by': None,
            # Columns a snapshot deliberately ignores.
            'created_at': 'then', 'updated_at': 'now', 'library_state': '',
            'is_programme_deleted': False, 'origin_week_id': 'WEEK-0',
        }
        payload = {
            'id': 'COMP-1', 'module_catalogue_id': 'MOD-1', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Campaign brief', 'description': '',
            'expected_otjh': 2.0, 'points': 0,
            'ksb_mappings': '[{"code": "K4"}]', 'reflection_required': False,
            'Reflection_Question': None, 'workplace_evidence_required': False,
            'tutor_validation_required': False, 'coach_validation_required': True,
            'display_order': 0,
            'settings_json': '{"version": "0.1", "contentStatus": "Draft"}',
            'live_sessions_link': '', 'deleted_at': None, 'deleted_by': None,
            'library_state': '', 'is_programme_deleted': False,
        }
        self.assertEqual(
            versioning.build_snapshot('component', row),
            versioning.build_snapshot('component', payload),
        )

    def test_snapshot_carries_declared_columns_only(self):
        snapshot = versioning.build_snapshot('component', {'id': 'COMP-1', 'updated_at': 'now'})
        self.assertEqual(set(snapshot), set(versioning.SNAPSHOT_COLUMNS['component']))
        self.assertNotIn('updated_at', snapshot)

    def test_diff_reaches_inside_the_material(self):
        before = versioning.build_snapshot('component', {
            'id': 'C', 'title': 'Brief', 'settings_json': {'contentHtml': '<p>old</p>', 'version': '0.1'},
        })
        after = versioning.build_snapshot('component', {
            'id': 'C', 'title': 'Brief v2', 'settings_json': {'contentHtml': '<p>new</p>', 'version': '0.2'},
        })
        fields = {change['field']: change for change in versioning.diff_snapshots(before, after)}
        # The material is reported field by field, not as "settings_json changed".
        self.assertIn('settings.contentHtml', fields)
        self.assertIn('settings.version', fields)
        self.assertIn('title', fields)
        self.assertNotIn('settings_json', fields)
        self.assertEqual(fields['title']['from'], 'Brief')
        self.assertEqual(fields['title']['to'], 'Brief v2')

    def test_unchanged_snapshots_produce_no_diff(self):
        snapshot = versioning.build_snapshot('week', {'id': 'W', 'title': 'Week 1', 'week_number': 1})
        self.assertEqual(versioning.diff_snapshots(snapshot, snapshot), [])

    def test_long_values_are_cut_and_flagged(self):
        before = versioning.build_snapshot('component', {'id': 'C', 'description': 'a'})
        after = versioning.build_snapshot('component', {'id': 'C', 'description': 'b' * 500})
        change = versioning.diff_snapshots(before, after)[0]
        self.assertTrue(change['truncated'])
        self.assertLessEqual(len(change['to']), versioning.DIFF_VALUE_LIMIT + 1)


class HistoryCaptureTests(CurriculumPersistenceHarness):
    """The capture path, driven through the real write helpers."""

    def setUp(self):
        super().setUp()
        versioning.reset_availability()
        self.assertTrue(versioning.provision_history_tables())
        with connection.cursor() as cursor:
            cursor.execute(f'delete from {versioning.qualified(versioning.VERSIONS_TABLE)}')
            cursor.execute(f'delete from {versioning.qualified(versioning.REVISIONS_TABLE)}')
        versioning.set_actor(None)

    def tearDown(self):
        versioning.set_actor(None)
        super().tearDown()

    def revisions(self, entity_type='component', entity_id='COMP-1'):
        return views.fetch_all(
            f'select revision_no, action, changed_fields, actor_name, version_label '
            f'from {versioning.qualified(versioning.REVISIONS_TABLE)} '
            f'where entity_type = %s and entity_id = %s order by revision_no',
            [entity_type, entity_id],
        )

    def save_component(self, **overrides):
        payload = {
            'id': 'COMP-1', 'module_catalogue_id': 'MOD-1', 'week_id': 'WEEK-1',
            'type': 'reading', 'title': 'Campaign brief', 'display_order': 0,
            'settings_json': views.json_db_value({'version': '0.1', 'contentStatus': 'Draft'}),
        }
        payload.update(overrides)
        return views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], payload)

    def test_first_save_creates_one_revision(self):
        self.save_component()
        rows = self.revisions()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]['action'], 'created')

    def test_resaving_identical_content_adds_nothing(self):
        self.save_component()
        self.save_component()
        self.save_component()
        # This is the rule that keeps the tree save from burying real edits:
        # it rewrites every component in a module whether or not it changed.
        self.assertEqual(len(self.revisions()), 1)

    def test_a_real_edit_adds_a_revision_carrying_its_diff(self):
        self.save_component()
        self.save_component(title='Campaign brief (revised)')
        rows = self.revisions()
        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[1]['action'], 'updated')
        fields = [change['field'] for change in versioning.as_list(rows[1]['changed_fields'])]
        self.assertIn('title', fields)

    def test_the_signed_in_account_is_recorded(self):
        class Account:
            email = 'rachel@kentbusinesscollege.com'
            display_name = 'Rachel Myers'

        versioning.set_actor(Account())
        self.save_component()
        self.assertEqual(self.revisions()[0]['actor_name'], 'Rachel Myers')

    def test_moving_the_version_label_pins_a_named_version(self):
        self.save_component()
        self.save_component(settings_json=views.json_db_value({'version': '0.2', 'contentStatus': 'Approved'}))
        named = views.fetch_all(
            f'select version_label, content_status from {versioning.qualified(versioning.VERSIONS_TABLE)} '
            f'where entity_type = %s and entity_id = %s order by version_label',
            ['component', 'COMP-1'],
        )
        # 0.1 on creation, then 0.2 when the author moved it. Re-saving on 0.2
        # must not mint a second one.
        self.assertEqual([row['version_label'] for row in named], ['0.1', '0.2'])
        self.save_component(settings_json=views.json_db_value({'version': '0.2', 'contentStatus': 'Approved'}),
                            title='Touched again')
        named_again = views.fetch_all(
            f'select version_label from {versioning.qualified(versioning.VERSIONS_TABLE)} '
            f'where entity_type = %s and entity_id = %s',
            ['component', 'COMP-1'],
        )
        self.assertEqual(len(named_again), 2)

    def test_archiving_records_what_the_record_held(self):
        self.save_component()
        views.authoring_soft_delete(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', ['COMP-1'], deleted_by='component-delete',
        )
        rows = self.revisions()
        self.assertEqual(rows[-1]['action'], 'archived')
        # Recorded once, not twice: soft_delete_rows writes through update_rows.
        self.assertEqual([row['action'] for row in rows].count('archived'), 1)

    def test_saving_still_works_when_history_is_switched_off(self):
        with connection.cursor() as cursor:
            cursor.execute(f'drop table {versioning.qualified(versioning.VERSIONS_TABLE)}')
            cursor.execute(f'drop table {versioning.qualified(versioning.REVISIONS_TABLE)}')
        versioning.reset_availability()
        # The whole safety contract: no history tables, saves carry on.
        saved = self.save_component(title='Written with history off')
        self.assertEqual(saved['title'], 'Written with history off')
