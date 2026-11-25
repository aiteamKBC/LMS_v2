"""Canonical replacements for retired timestamp-feed contracts.

See persistence_contract_cleanup.md for the old-to-new inventory.
Explicit revisions test read contracts; existing write/first-recorded suites
retain real writer coverage. Raw source rows are exclusion fixtures only.
"""
from unittest.mock import patch

from curriculum_api import views as curriculum_views
from system_audit import derived, writes
from system_audit.tests_hybrid import ATTACHED, HybridFixtures


class DerivedTrailTests(HybridFixtures):
    """Keep the existing suite selector while testing canonical behavior."""

    def seed_three_workspaces(self):
        for entity, ident, title in [('component', 'COMP-D1', 'Reading quiz'),
                                     ('staff_record', '1', 'Synthetic Staff'),
                                     ('absence_report', '1', 'Synthetic Learner')]:
            self.revision(entity, ident, self.at(hours=3), action='created', title=title)

    def seed_many(self):
        for index in range(1, 6):
            self.revision('staff_record', str(index), self.at(hours=index * 2), action='created')
            self.revision('absence_report', str(index), self.at(hours=index * 2 + 1), action='created')

    def save_component(self, title):
        self.committed(lambda: curriculum_views.authoring_upsert(curriculum_views.AUTHORING_COMPONENTS_TABLE, ['id'], {
            'id': 'COMP-D1', 'module_catalogue_id': 'MOD-D', 'week_id': 'WEEK-1',
            'type': 'quiz', 'title': title, 'display_order': 0,
        }))

    def test_curriculum_events_appear(self):
        self.save_component('Reading quiz')
        event = next(e for e in self.trail('?workspace=curriculum')['events'] if e['entityId'] == 'COMP-D1')
        self.assertEqual(event['action'], 'created')
        self.assertEqual(event['title'], 'Reading quiz')

    def test_an_admin_source_appears(self):
        self.revision('staff_record', '1', self.at(hours=5), action='created', title='Synthetic Staff')
        event, = self.trail('?workspace=admin')['events']
        self.assertEqual(event['action'], 'created')
        self.assertEqual(event['title'], 'Synthetic Staff')
        self.assertEqual(event['entityLabel'], 'Staff record')

    def test_a_coach_source_appears(self):
        self.revision('absence_report', '1', self.at(hours=3), action='created', title='Synthetic Learner')
        event, = self.trail('?workspace=coach')['events']
        self.assertEqual(event['action'], 'created')
        self.assertEqual(event['title'], 'Synthetic Learner')

    def test_the_system_wide_feed_carries_every_workspace_together(self):
        self.seed_three_workspaces()
        payload = self.trail()
        self.assertEqual({e['workspace'] for e in payload['events']}, {'curriculum', 'admin', 'coach'})
        self.assertEqual(payload['total'], 3)

    def assert_workspace(self, workspace):
        self.seed_three_workspaces()
        payload = self.trail(f'?workspace={workspace}')
        self.assertEqual({e['workspace'] for e in payload['events']}, {workspace})
        self.assertEqual(payload['total'], 1)

    def test_curriculum_excludes_admin_and_coach(self):
        self.assert_workspace('curriculum')

    def test_admin_excludes_curriculum_and_coach(self):
        self.assert_workspace('admin')

    def test_coach_excludes_curriculum_and_admin(self):
        self.assert_workspace('coach')

    def test_coverage_names_registered_revision_workspaces_not_source_tables(self):
        self.seed_three_workspaces()
        payload = self.trail()
        self.assertEqual(payload['derivedWorkspaces'], [])
        self.assertEqual(payload['revisionWorkspaces'], writes.change_workspaces())
        self.assertEqual(payload['changeWorkspaces'], writes.change_workspaces())
        all_workspaces = {item['value'] for item in payload['workspaces']}
        self.assertEqual(set(payload['uncoveredWorkspaces']), all_workspaces - set(writes.change_workspaces()))
        filtered = self.trail('?workspace=coach')
        for key in ('derivedWorkspaces', 'revisionWorkspaces', 'changeWorkspaces', 'uncoveredWorkspaces'):
            self.assertEqual(filtered[key], payload[key])

    def test_missing_source_table_does_not_remove_canonical_history_or_coverage(self):
        self.revision('staff_record', '1', self.at(hours=5), action='created', title='Saved history')
        before = self.trail('?workspace=admin')
        with self.connection_cursor() as cursor:
            cursor.execute('drop table "enrolment"."Staff_users"')
        after = self.trail('?workspace=admin')
        self.assertEqual(after['events'], before['events'])
        self.assertEqual(after['revisionStartedAt'], before['revisionStartedAt'])
        self.assertEqual(after['changeWorkspaces'], before['changeWorkspaces'])
        self.assertEqual(after['derivedWorkspaces'], [])

    def test_search_filters_the_whole_window_before_paging(self):
        for index in range(1, 6):
            self.revision('staff_record', str(index), self.at(hours=index), action='created', title=f'Staff {index}')
        self.revision('absence_report', '1', self.at(hours=10), action='created', title='Unique Learner Name')
        payload = self.trail('?limit=2&search=unique learner')
        self.assertEqual(payload['total'], 1)
        self.assertEqual(payload['pages'], 1)
        self.assertEqual([e['entity'] for e in payload['events']], ['absence_report'])

    def test_the_date_window_filters_before_paging(self):
        for index in range(1, 7):
            self.revision('staff_record', str(index), self.at(hours=index if index < 4 else 72 + index),
                          action='created', title=f'{"Recent" if index < 4 else "Older"} {index}')
        narrow = self.trail('?workspace=admin&days=1&limit=2')
        wide = self.trail('?workspace=admin&days=7&limit=2')
        self.assertEqual(narrow['total'], 3)
        self.assertEqual(narrow['pages'], 2)
        self.assertEqual(wide['total'], 6)
        self.assertTrue(all(e['title'].startswith('Recent') for e in narrow['events']))

    def test_pages_do_not_repeat_rows(self):
        self.seed_many()
        first, events = self.every_page('?days=7', 3)
        self.assertEqual(first['total'], 10)
        self.assertEqual(len(events), first['total'])
        self.assertEqual(len({e['id'] for e in events}), len(events))

    def test_the_pages_rebuild_the_whole_filtered_window_in_order(self):
        self.seed_many()
        whole = self.trail('?limit=200&action=created')['events']
        _, paged = self.every_page('?action=created', 3)
        self.assertEqual([e['id'] for e in paged], [e['id'] for e in whole])
        self.assertEqual([e['at'] for e in whole], sorted([e['at'] for e in whole], reverse=True))

    def test_the_headline_counts_stay_still_across_pages(self):
        self.seed_many()
        first = self.trail('?limit=3&page=1')
        last = self.trail(f'?limit=3&page={first["pages"]}')
        self.assertEqual(first['actionCounts'], last['actionCounts'])
        self.assertEqual(first['entityCounts'], last['entityCounts'])
        self.assertEqual(first['total'], sum(first['actionCounts'].values()))

    def test_missing_creation_stamps_never_synthesize_events(self):
        self.staff(1, 'Update stamp only', None, self.at(hours=2))
        self.staff(2, 'No stamps', None, None)
        self.revision('staff_record', '3', self.at(hours=1), action='recorded', title='Actually recorded')
        payload = self.trail('?workspace=admin')
        self.assertEqual(self.keyed(payload), [('revision', 'staff_record', '3', 'recorded')])
        self.assertEqual(payload['actionCounts']['created'], 0)

    def test_actual_create_then_edit_produces_two_canonical_events(self):
        self.save_component('First title')
        self.save_component('Edited title')
        self.save_component('Edited title')
        events = [e for e in self.trail('?workspace=curriculum')['events'] if e['entityId'] == 'COMP-D1']
        self.assertEqual([e['action'] for e in events], ['updated', 'created'])
        self.assertEqual(events[0]['changes'][0]['field'], 'title')

    def test_a_missing_author_is_not_filled_in(self):
        self.sign_in(name='Signed In Reader', email='reader@example.test')
        for entity in ('absence_report', 'attendance_intervention'):
            self.revision(entity, '1', self.at(hours=3), actor_email='', actor_name='')
        events = self.trail()['events']
        self.assertEqual(len(events), 2)
        for event in events:
            self.assertEqual(event['actorName'], '')
            self.assertEqual(event['actorEmail'], '')

    def test_an_author_the_revision_records_is_shown_and_filterable(self):
        self.revision('attendance_intervention', '1', self.at(hours=4), actor_email='coach.one@example.test')
        self.revision('attendance_intervention', '2', self.at(hours=5))
        payload = self.trail('?workspace=engagement')
        event = next(e for e in payload['events'] if e['entityId'] == '1')
        self.assertEqual(event['actorEmail'], 'coach.one@example.test')
        self.assertIn('coach.one@example.test', [a['email'] for a in payload['actors']])
        only = self.trail('?workspace=engagement&actor=coach.one@example.test')
        self.assertEqual(only['total'], 1)
        self.assertEqual(only['events'][0]['entityId'], '1')

    def test_every_derived_record_type_is_one_the_revision_log_knows(self):
        # Retain the previously passing registry consistency assertions.
        for source in derived.DERIVED_AUDIT_SOURCES:
            self.assertTrue(writes.workspace_for_entity(source.entity), source.entity)
            self.assertIn(source.created_action, {'created', 'recorded'}, source.entity)

    def test_canonical_start_is_unfiltered_and_refreshes_after_earlier_event_arrives(self):
        self.revision('staff_record', '1', self.at(hours=1), actor_email='one@example.test')
        first = self.trail('?workspace=admin&days=1&limit=1&actor=one@example.test')
        self.assertEqual(first['revisionStartedAt']['staff_record'].replace('T', ' ')[:19], self.at(hours=1))
        self.revision('staff_record', '2', self.at(hours=24 * 80), actor_email='other@example.test')
        again = self.trail('?workspace=admin&days=1&limit=1&actor=one@example.test&search=staff')
        self.assertEqual(again['revisionStartedAt']['staff_record'].replace('T', ' ')[:19], self.at(hours=24 * 80))
        self.assertEqual(again['total'], 1)
        self.assertNotIn('absence_report', again['revisionStartedAt'])

    def test_null_start_is_not_cached_or_fabricated_from_source_rows(self):
        self.intervention(1, 'Source only', self.at(hours=1))
        payload = self.trail('?entity=attendance_intervention')
        self.assertEqual(payload['revisionStartedAt'], {'attendance_intervention': None})
        self.revision('attendance_intervention', '1', self.at(hours=2), action='created')
        start = self.trail('?entity=attendance_intervention')['revisionStartedAt']
        self.assertEqual(start['attendance_intervention'].replace('T', ' ')[:19], self.at(hours=2))

    def test_revision_read_error_returns_503_without_timestamp_fallback(self):
        with patch.object(derived, 'read_hybrid', side_effect=RuntimeError('Synthetic read failure')), \
             patch.object(derived, 'resolve', side_effect=AssertionError('Retired source scan')):
            response = self.client.get('/curriculum_api/curriculum/quality/audit-trail/')
        self.assertEqual(response.status_code, 503)
        self.assertEqual(response.json(), {'error': 'Audit history could not be read. Please retry.'})
