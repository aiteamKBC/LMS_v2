"""Run only via a verified disposable PostgreSQL fixture runner."""
import copy
import json
import time
from types import SimpleNamespace
from unittest.mock import patch

from django.test import Client, override_settings

from . import module_collaboration as service, views
from .module_collaboration_state import CoordinationUnavailable, field_key
from .module_collaboration_store import MemoryRoomStore
from .tests import CurriculumTeamsRequestTestCase


@override_settings(CURRICULUM_COLLABORATION_ENABLED=True, CURRICULUM_COLLABORATION_MODULES=('MOD-COLLAB-SYNTHETIC',),
    CHANNEL_LAYERS={'default': {'BACKEND': 'channels.layers.InMemoryChannelLayer'}})
class ModuleCollaborationPersistenceTests(CurriculumTeamsRequestTestCase):
    def setUp(self):
        self.client = Client()
        views.reset_schema_ready_flags()
        views.ensure_module_authoring_tables()
        views.ensure_live_sessions_table()
        self.prepare_teams_fixtures('PROG-RESTORE')
        self.module_id = 'MOD-COLLAB-SYNTHETIC'
        self.url = f'/curriculum_api/curriculum/modules/{self.module_id}/structure/'
        fixed_time = time.time()
        self.store = MemoryRoomStore(lambda: fixed_time)
        clock_patch = patch.object(service, 'time', SimpleNamespace(time=lambda: fixed_time))
        clock_patch.start(); self.addCleanup(clock_patch.stop)
        store_patch = patch.object(service, 'get_store', return_value=self.store)
        store_patch.start(); self.addCleanup(store_patch.stop)
        views.save_module_authoring_structure(self.module_id, {
            'title': 'Synthetic collaboration', 'programmeName': 'Synthetic programme', 'weeksNumber': 1,
            'weekStructure': [{'id': 'WEEK-SYNTHETIC-W1', 'title': 'Week', 'weekNumber': 1,
                'components': [{'id': 'COMP-SYNTHETIC-C1', 'type': 'reading', 'title': 'Original', 'expectedOtjh': 1,
                    'settings': {'readingContent': '<p>Synthetic</p>'}}]}],
        })
        self.actor = dict(account=str(self.account.pk), editor='aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa', connection='a', name='Synthetic editor')
        service.apply_event(self.module_id, 'join', self.actor)
        self.key = field_key('component', 'COMP-SYNTHETIC-C1', 'title')
        self.proof = service.claim(self.module_id, self.actor, self.key)['token']

    def read(self):
        response = self.client.get(self.url, HTTP_CACHE_CONTROL='no-cache')
        self.assertEqual(200, response.status_code, response.content)
        return response.json()

    def save(self, base, draft, metadata=None):
        return self.client.patch(self.url, json.dumps({**draft, 'expectedRevision': base['structureRevision'],
            **({'collaboration': metadata} if metadata is not None else {})}), content_type='application/json')

    def test_held_title_does_not_block_another_field_and_only_owner_can_save_title(self):
        base = self.read(); draft = copy.deepcopy(base)
        draft['weekStructure'][0]['components'][0]['expectedOtjh'] = 2
        response = self.save(base, draft)
        self.assertEqual(200, response.status_code, response.content)
        self.assertEqual('Original', self.read()['weekStructure'][0]['components'][0]['title'])
        base = self.read(); draft = copy.deepcopy(base)
        draft['weekStructure'][0]['components'][0]['title'] = 'Owner edit'
        refused = self.save(base, draft)
        self.assertEqual(409, refused.status_code, refused.content)
        self.assertEqual('module_edit_reserved', refused.json()['code'])
        self.assertEqual(base['structureRevision'], self.read()['structureRevision'])
        accepted = self.save(base, draft, dict(editorId=self.actor['editor'], proofs={self.key: self.proof}))
        self.assertEqual(200, accepted.status_code, accepted.content)
        self.assertEqual('Owner edit', self.read()['weekStructure'][0]['components'][0]['title'])

    def test_coordinator_outage_and_week_removal_do_not_change_saved_content(self):
        base = self.read(); draft = copy.deepcopy(base)
        draft['weekStructure'][0]['components'][0]['expectedOtjh'] = 3
        with patch.object(self.store, 'read', side_effect=CoordinationUnavailable()):
            response = self.save(base, draft)
        self.assertEqual(503, response.status_code, response.content)
        self.assertEqual(base['structureRevision'], self.read()['structureRevision'])
        draft['weekStructure'] = []
        response = self.save(base, draft)
        self.assertEqual(409, response.status_code, response.content)
        self.assertEqual(1, len(self.read()['weekStructure']))
