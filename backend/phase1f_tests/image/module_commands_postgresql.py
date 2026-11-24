"""Module commands on disposable PostgreSQL only, with synthetic state.

Save tests use real Django transactions and fixture persistence capabilities.
Artwork tests execute the exact production UPDATE. Providers remain mocked.
"""
from curriculum_api.catalogue.tests.parity.composition_test_support import composition_fixture
import json
import sys
from contextlib import ExitStack
import unittest
from types import ModuleType, SimpleNamespace
from unittest.mock import Mock, patch

from django.db import connection, transaction
from curriculum_api import views, learning_storage, models
from curriculum_api.catalogue.application import module_authoring
from curriculum_api.catalogue.infrastructure import module_cover
from curriculum_api.test_module_commands_boundary_no_db import (
    fixture_scope, save_ports, structure_ports, request, response_value,
)


class ModuleCommandsPostgreSQL(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        assert connection.settings_dict['HOST'] == '127.0.0.1'
        assert connection.settings_dict['NAME'] == 'phase1f'
        with connection.cursor() as cursor:
            cursor.execute('CREATE SCHEMA phase1f_module_commands')
            cursor.execute('CREATE TABLE phase1f_module_commands.writes (position integer GENERATED ALWAYS AS IDENTITY, kind text, payload jsonb)')
            # Test-schema supplement only. No production migration or bootstrap.
            cursor.execute('ALTER TABLE curriculum.modules ADD COLUMN IF NOT EXISTS cover_image_url text')

    def stored(self):
        with connection.cursor() as cursor:
            cursor.execute('SELECT kind, payload FROM phase1f_module_commands.writes ORDER BY position')
            return cursor.fetchall()

    def scenario(self, original, *, fail=False, http=False, outer_rollback=False):
        with connection.cursor() as cursor:
            cursor.execute('TRUNCATE phase1f_module_commands.writes RESTART IDENTITY')
        events, phases = [], []
        values = save_ports(events)
        def persist(kind, payload):
            self.assertTrue(connection.in_atomic_block)
            with connection.cursor() as cursor:
                cursor.execute('INSERT INTO phase1f_module_commands.writes(kind,payload) VALUES (%s,%s::jsonb)', [kind, json.dumps(payload, default=str)])
        def upsert(table, keys, payload, **kwargs):
            if original and table == views.AUTHORING_MODULES_TABLE:
                # Reviewed dev addition for this legacy fixture: persisted
                # layout is explicitly null. Current output is not rewritten.
                payload = {**payload, 'week_boundary_mode': None}
            persist(table, payload)
            return payload
        def bulk(table, keys, payloads):
            for payload in payloads:
                persist(table, payload)
            if fail and table == views.AUTHORING_COMPONENTS_TABLE:
                raise ValueError('synthetic failure after component INSERT')
        values.update(authoring_upsert=Mock(side_effect=upsert), authoring_bulk_upsert=Mock(side_effect=bulk))
        if http:
            http_ports = structure_ports(events)
            http_ports.pop('save_module_authoring_structure')
            http_ports.pop('get_authoring_structure_payload')
            values.update(http_ports)
            values['module_structure_revision'] = Mock(side_effect=lambda i: (phases.append(('revision', connection.in_atomic_block)) or 'current'))
        payload = {'title': 'Synthetic module', 'expectedRevision': 'current', 'weekStructure': [
            {'id': 'WEEK-A', 'components': [{'id': 'COMP-A', 'type': 'reading', 'title': 'Synthetic reading', 'settings': {}}]},
        ]}
        with fixture_scope(original, values, atomic=False) as (stack, _):
            stack.enter_context(composition_fixture(learning_storage, 'refresh_totals', return_value=None))
            stack.enter_context(patch.object(views.ksb_mapping_placement, 'where', return_value=('module_catalogue_id = %s', ['MOD-A'])))
            def perform():
                if http:
                    return response_value(views.curriculum_module_structure(request('PATCH', payload), 'MOD-A'))
                return views.save_module_authoring_structure('MOD-A', payload)
            error = None
            try:
                if outer_rollback:
                    with transaction.atomic():
                        result = perform()
                        inside = self.stored()
                        transaction.set_rollback(True)
                else:
                    result = perform()
                    inside = self.stored()
            except ValueError as exc:
                result, inside, error = None, [], str(exc)
        return result, inside, self.stored(), error, phases

    def test_save_commits_content_rows_and_calls_actual_application(self):
        with patch.object(module_authoring, 'save_module_authoring_structure', wraps=module_authoring.save_module_authoring_structure) as invoked:
            actual = self.scenario(False)
        invoked.assert_called_once()
        self.assertEqual(actual, self.scenario(True))
        self.assertEqual([row[0] for row in actual[2]], [views.AUTHORING_MODULES_TABLE, views.AUTHORING_WEEKS_TABLE, views.AUTHORING_COMPONENTS_TABLE, views.AUTHORING_COMPLETION_TABLE, views.AUTHORING_ADVANCED_TABLE])

    def test_save_failure_rolls_back_module_week_and_component(self):
        actual = self.scenario(False, fail=True)
        self.assertEqual(actual, self.scenario(True, fail=True))
        self.assertEqual(actual[2], [])
        self.assertEqual(actual[3], 'synthetic failure after component INSERT')

    def test_http_save_commits_before_response_revision(self):
        actual = self.scenario(False, http=True)
        self.assertEqual(actual, self.scenario(True, http=True))
        self.assertEqual(actual[0][0], 200)
        self.assertEqual(actual[4], [('revision', True), ('revision', False)])
        self.assertEqual(len(actual[2]), 5)

    def test_http_error_rolls_back_nested_save_before_500(self):
        actual = self.scenario(False, http=True, fail=True)
        self.assertEqual(actual, self.scenario(True, http=True, fail=True))
        self.assertEqual((actual[0][0], actual[2]), (500, []))

    def test_callers_outer_rollback_preserves_transaction_ownership(self):
        actual = self.scenario(False, outer_rollback=True)
        self.assertEqual(actual, self.scenario(True, outer_rollback=True))
        self.assertEqual(len(actual[1]), 5)
        self.assertEqual(actual[2], [])

    def cover_scenario(self, original, status='active', rollback=False):
        models.ModuleAuthoringModule.objects.filter(module_catalogue_id='MOD-COVER-PARITY').delete()
        models.ModuleAuthoringModule.objects.create(module_catalogue_id='MOD-COVER-PARITY', title='Synthetic artwork', status=status)
        # Image validation/storage are fixture ports. Do not initialize the
        # unrelated learner audit/material readers just to exercise this UPDATE.
        image_validation = ModuleType('learner_api.student_activity')
        image_validation._builder_cover_url = Mock(side_effect=lambda value: value)
        with fixture_scope(original, {'stored_module_cover_image': Mock(side_effect=lambda i, v: v), 'note_live_rows': Mock()}, atomic=False), \
             patch('login.permissions.authenticate_request', return_value=SimpleNamespace(role='staff')), \
             patch.dict(sys.modules, {'learner_api.student_activity': image_validation}):
            with transaction.atomic():
                response = views._update_module_cover(request('PATCH'), 'MOD-COVER-PARITY', {'coverImage': 'https://example.invalid/cover.png'})
                if rollback:
                    transaction.set_rollback(True)
        with connection.cursor() as cursor:
            cursor.execute('SELECT cover_image_url FROM curriculum.modules WHERE module_catalogue_id=%s', ['MOD-COVER-PARITY'])
            value = cursor.fetchone()[0]
        return response_value(response), value

    def test_cover_update_uses_exact_sql_and_live_predicate(self):
        for status in ('active', 'inactive'):
            with patch.object(module_cover, 'update_module_cover_row', wraps=module_cover.update_module_cover_row) as invoked:
                actual = self.cover_scenario(False, status)
            invoked.assert_called_once()
            self.assertEqual(actual, self.cover_scenario(True, status))
            self.assertEqual(actual[0][0], 200 if status == 'active' else 404)
            self.assertEqual(actual[1], 'https://example.invalid/cover.png' if status == 'active' else None)

    def test_cover_update_participates_in_callers_rollback(self):
        actual = self.cover_scenario(False, rollback=True)
        self.assertEqual(actual, self.cover_scenario(True, rollback=True))
        self.assertEqual(actual[0][0], 200)
        self.assertIsNone(actual[1])
