import json

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceTransactionHarness


OLD_LINK = 'https://teams.example/old'
NEW_LINK = 'https://teams.microsoft.com/l/meetup-join/new'
SOURCE_LINK = 'https://teams.example/source-meeting'


class TeamsLinksReplaceTests(CurriculumPersistenceTransactionHarness):
    """The Replace Teams links save: stored join links only, selected weeks only."""

    def setUp(self):
        super().setUp()
        self.addCleanup(self.clean_source_series)
        response = self.post_json('/curriculum_api/curriculum/modules/', {
            'moduleType': 'authoring', 'title': 'Link replacement', 'weeks': 3, 'sessionsNumber': 3,
            'weekStructure': [{'weekNumber': index + 1, 'title': f'Week {index + 1}', 'components': []} for index in range(3)],
        })
        self.assertEqual(response.status_code, 201, response.content)
        self.module_id = response.json()['moduleCatalogueId']
        self.fixture_module_ids = {self.module_id}
        self.addCleanup(self.clean_shared_links)
        structure = views.get_authoring_structure_payload(self.module_id)
        live = {'liveSessionUrl': OLD_LINK, 'teamsMeetingUrl': OLD_LINK, 'teamsEventId': 'EVENT-1'}
        for week in structure['weekStructure']:
            week['components'] = [
                {'id': f"LIVE-{week['weekNumber']}", 'type': 'live-session', 'title': f"Live {week['weekNumber']}", 'settings': dict(live)},
                {'id': f"VIDEO-{week['weekNumber']}", 'type': 'video', 'title': 'Video', 'settings': {'videoUrl': 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'}},
            ]
        saved = views.save_module_authoring_structure(self.module_id, structure)
        self.weeks = saved['weekStructure']
        self.live_ids = [component['id'] for week in self.weeks for component in week['components'] if component['type'] == 'live-session']
        # Week 2's live session is an additional one-off meeting: booked on its
        # own, so a bulk replacement must leave its link alone.
        row = self.component_row(self.live_ids[1])
        settings = json.loads(row['settings_json']) if isinstance(row['settings_json'], str) else row['settings_json']
        views.update_authoring_rows(views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [row['id']], {
            'settings_json': json.dumps({**settings, 'extraTeamsMeetingUrl': OLD_LINK}),
        })
        self.url = f'/curriculum_api/curriculum/modules/{self.module_id}/teams-links/'

    def component_row(self, component_id):
        return views.authoring_fetch_all(views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])[0]

    def clean_source_series(self):
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM curriculum.session_result_jobs WHERE live_session_id=%s', ['SOURCE-SERIES'])
        views.authoring_delete(views.LIVE_SESSIONS_TABLE, 'id = %s', ['SOURCE-SERIES'])

    def clean_shared_links(self):
        from django.db import connection
        with connection.cursor() as cursor:
            cursor.execute('DELETE FROM curriculum.module_teams_shares WHERE module_catalogue_id=ANY(%s) '
                           'OR source_module_catalogue_id=ANY(%s)',
                           [list(self.fixture_module_ids), list(self.fixture_module_ids)])

    def settings_of(self, component_id):
        return views.component_builder_settings(self.component_row(component_id))

    def test_replaces_only_the_selected_weeks_live_session_links(self):
        revision = views.module_structure_revision(self.module_id)
        response = self.post_json(self.url, {
            'weekIds': [self.weeks[0]['id'], self.weeks[1]['id']],
            'link': NEW_LINK,
            'expectedRevision': revision,
        })

        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertEqual(body['updatedComponentIds'], [self.live_ids[0]])
        self.assertEqual(body['updated'], 1)
        self.assertTrue(body['revisionWasCurrent'])
        self.assertEqual(body['structureRevision'], views.module_structure_revision(self.module_id))
        self.assertNotEqual(body['structureRevision'], revision)

        replaced = self.settings_of(self.live_ids[0])
        self.assertEqual(replaced['liveSessionUrl'], NEW_LINK)
        self.assertEqual(replaced['teamsMeetingUrl'], NEW_LINK)
        self.assertEqual(replaced['liveSessionLinkOverride'], NEW_LINK)
        # Pasting another URL cannot retain the former meeting's identity.
        # Historical occurrence/artifact rows are not deleted by this edit.
        self.assertFalse(replaced.get('teamsEventId'))
        self.assertEqual(replaced['teamsCalendarBinding'], 'unverified')
        self.assertEqual(self.component_row(self.live_ids[0])['live_sessions_link'], NEW_LINK)
        # The one-off meeting and the unselected week keep their own link.
        self.assertEqual(self.settings_of(self.live_ids[1])['liveSessionUrl'], OLD_LINK)
        self.assertEqual(self.settings_of(self.live_ids[2])['liveSessionUrl'], OLD_LINK)

    def test_a_later_full_module_save_keeps_the_replaced_link(self):
        self.post_json(self.url, {'weekIds': [self.weeks[0]['id']], 'link': NEW_LINK})

        saved = views.save_module_authoring_structure(self.module_id, views.get_authoring_structure_payload(self.module_id))

        first_live = next(c for c in saved['weekStructure'][0]['components'] if c['type'] == 'live-session')
        self.assertEqual(first_live['settings']['liveSessionUrl'], NEW_LINK)

    def test_a_single_pasted_link_does_not_switch_the_unselected_weeks_source_calendar(self):
        """A module-wide alias must not be introduced by a per-week link edit."""
        source_id = self.make_source_module()
        views.ensure_live_session_tracking_tables()
        views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], {
            'id': 'SOURCE-SERIES',
            'module_catalogue_id': source_id,
            'module_title': 'Meeting owner',
            'organizer_email': 'tutor@example.invalid',
            'join_url': SOURCE_LINK,
            'status': 'active',
        })
        # A new card has no old URL to replace; it must still be selectable.
        first = self.component_row(self.live_ids[0])
        settings = self.settings_of(self.live_ids[0])
        views.update_authoring_rows(views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [first['id']], {
            'settings_json': json.dumps({key: value for key, value in settings.items()
                                         if key not in {'liveSessionUrl', 'teamsMeetingUrl'}}),
            'live_sessions_link': '',
        })

        response = self.post_json(self.url, {'weekIds': [self.weeks[0]['id']], 'link': SOURCE_LINK})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(response.json()['updatedComponentIds'], [self.live_ids[0]])
        self.assertEqual(response.json()['recordingsSourceModuleId'], '')
        target = views.authoring_module_exists(self.module_id)
        self.assertFalse(target.get('teams_shared_source_module_id'))
        self.assertEqual(self.settings_of(self.live_ids[2])['liveSessionUrl'], OLD_LINK)
        # A per-week URL does not create another owner of the Teams series.
        self.assertEqual(
            views.authoring_fetch_all(views.LIVE_SESSIONS_TABLE, 'module_catalogue_id = %s', [self.module_id]),
            [],
        )

    def test_a_stale_revision_still_saves_but_is_reported(self):
        response = self.post_json(self.url, {'weekIds': [self.weeks[0]['id']], 'link': NEW_LINK, 'expectedRevision': 'stale'})

        self.assertEqual(response.status_code, 200, response.content)
        self.assertFalse(response.json()['revisionWasCurrent'])
        self.assertEqual(self.settings_of(self.live_ids[0])['liveSessionUrl'], NEW_LINK)

    def test_refuses_without_writing(self):
        cases = [
            ({'weekIds': [self.weeks[0]['id']], 'link': 'not a link'}, 400),
            ({'weekIds': [], 'link': NEW_LINK}, 400),
        ]
        for body, status in cases:
            with self.subTest(body=body):
                self.assertEqual(self.post_json(self.url, body).status_code, status)
        missing = self.post_json('/curriculum_api/curriculum/modules/MOD-DOES-NOT-EXIST/teams-links/', {'weekIds': ['W'], 'link': NEW_LINK})
        self.assertEqual(missing.status_code, 404)
        self.assertEqual(self.client.get(self.url).status_code, 405)
        self.assertEqual(self.settings_of(self.live_ids[0])['liveSessionUrl'], OLD_LINK)

    def make_source_module(self):
        """A second module that owns the meeting this one will share."""
        response = self.post_json('/curriculum_api/curriculum/modules/', {
            'moduleType': 'authoring', 'title': 'Meeting owner', 'weeks': 3, 'sessionsNumber': 3,
            'weekStructure': [{'weekNumber': index + 1, 'title': f'Week {index + 1}', 'components': []} for index in range(3)],
        })
        source_id = response.json()['moduleCatalogueId']
        self.fixture_module_ids.add(source_id)
        structure = views.get_authoring_structure_payload(source_id)
        for week in structure['weekStructure']:
            week['components'] = [{'id': f"SRC-LIVE-{week['weekNumber']}", 'type': 'live-session', 'title': 'Live',
                                   'settings': {'liveSessionUrl': SOURCE_LINK, 'teamsMeetingUrl': SOURCE_LINK}}]
        views.save_module_authoring_structure(source_id, structure)
        return source_id

    def test_a_module_sharing_another_modules_meeting_keeps_its_own_replaced_link(self):
        source_id = self.make_source_module()
        views.update_authoring_rows(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [self.module_id], {
            'teams_shared_source_module_id': source_id,
        })
        # Saved as an alias, its rows hold no link of their own: it is read from the source.
        views.save_module_authoring_structure(self.module_id, views.get_authoring_structure_payload(self.module_id))
        self.assertEqual(self.component_row(self.live_ids[0])['live_sessions_link'], '')
        before = views.get_authoring_structure_payload(self.module_id)
        self.assertEqual(before['weekStructure'][0]['components'][0]['settings']['liveSessionUrl'], SOURCE_LINK)

        response = self.post_json(self.url, {'weekIds': [self.weeks[0]['id'], self.weeks[2]['id']], 'link': NEW_LINK})

        self.assertEqual(response.status_code, 200, response.content)
        # The endpoint returns a set of changed IDs; SQL row order is not a
        # delivery-order contract. Both selected main cards must be present.
        self.assertCountEqual(response.json()['updatedComponentIds'], [self.live_ids[0], self.live_ids[2]])
        after = views.get_authoring_structure_payload(self.module_id)
        links = [week['components'][0]['settings']['liveSessionUrl'] for week in after['weekStructure']]
        # Weeks 1 and 3 replaced; week 2 is the one-off meeting and keeps its own.
        self.assertEqual(links[0], NEW_LINK)
        self.assertEqual(links[2], NEW_LINK)
        self.assertNotEqual(links[1], NEW_LINK)
        # What learner and coach views read first.
        self.assertEqual(self.component_row(self.live_ids[0])['live_sessions_link'], NEW_LINK)
        # The source, and so every other module sharing it, is untouched.
        source = views.get_authoring_structure_payload(source_id)
        self.assertEqual({c['settings']['liveSessionUrl'] for w in source['weekStructure'] for c in w['components']}, {SOURCE_LINK})

        # A later full save of the alias keeps its link, in the settings and the column.
        saved = views.save_module_authoring_structure(self.module_id, after)
        self.assertEqual(saved['weekStructure'][0]['components'][0]['settings']['liveSessionUrl'], NEW_LINK)
        self.assertEqual(self.component_row(self.live_ids[0])['live_sessions_link'], NEW_LINK)
        # The source's meeting identity is still not stored on the alias.
        stored = self.settings_of(self.live_ids[0])
        self.assertNotIn('teamsEventId', stored)
