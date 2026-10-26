"""Run directly with Python. No Django imports, DB setup, credentials or network.

The item merge decides, under the module's lock, what a partial Module Builder
save writes when somebody else saved first. Every rule here is one a person
can lose work to if it is wrong: a colleague's component silently replaced, a
deleted row brought back by a stale tab, a meeting link re-pointed.
"""
import copy
import importlib.util
import unittest
from pathlib import Path

ROOT = Path(__file__).parent
spec = importlib.util.spec_from_file_location('module_merge', ROOT / 'module_merge.py')
merge = importlib.util.module_from_spec(spec)
spec.loader.exec_module(merge)


def component(component_id, week_id, title, **extra):
    return {
        'id': component_id, 'weekId': week_id, 'moduleId': 'MOD-1', 'type': 'reading',
        'title': title, 'description': '', 'expectedOtjh': 1.0, 'points': 0,
        'ksbMappings': [], 'settings': {'body': f'<p>{title}</p>'}, **extra,
    }


def stored_module():
    return {
        'catalogueId': 'MOD-1', 'title': 'Module', 'description': 'Intro',
        'teamsSharedSourceModuleId': '', 'programmeName': 'Prog',
        'weekStructure': [
            {'id': 'W1', 'weekNumber': 1, 'title': 'Week 1', 'summary': '', 'components': [
                component('C1', 'W1', 'Reading one'),
                component('C2', 'W1', 'Reading two'),
            ]},
            {'id': 'W2', 'weekNumber': 2, 'title': 'Week 2', 'summary': '', 'components': [
                component('C3', 'W2', 'Reading three'),
            ]},
        ],
    }


def find(module, component_id):
    for week in module['weekStructure']:
        for item in week['components']:
            if item['id'] == component_id:
                return week['id'], item
    return None, None


def save(base, local, *, restore=()):
    """The partial save body a Builder holding ``base`` sends for ``local``."""
    base_weeks = {week['id']: week for week in base['weekStructure']}
    base_components = {item['id']: item for week in base['weekStructure'] for item in week['components']}
    local_components = {item['id']: item for week in local['weekStructure'] for item in week['components']}
    delta = {'weekOrder': [], 'componentOrder': {}, 'weeks': {}, 'components': {}}
    for week in local['weekStructure']:
        fields = merge.week_fields(week)
        delta['weekOrder'].append(week['id'])
        delta['componentOrder'][week['id']] = [item['id'] for item in week['components']]
        if week['id'] not in base_weeks or not merge.same(fields, merge.week_fields(base_weeks[week['id']])):
            delta['weeks'][week['id']] = fields
        for item in week['components']:
            if item['id'] not in base_components or not merge.same(item, base_components[item['id']]):
                delta['components'][item['id']] = item
    touched = set(delta['components']) | (set(base_components) - set(local_components))
    return {
        **{key: value for key, value in local.items() if key != 'weekStructure'},
        'saveMode': 'partial',
        'expectedRevision': 'rev-base',
        'structureDelta': delta,
        'structureBase': {
            'fingerprints': merge.structure_fingerprints(base),
            'module': {key: value for key, value in base.items() if key != 'weekStructure'},
            'weekOrder': [week['id'] for week in base['weekStructure']],
            'componentOrder': {week['id']: [item['id'] for item in week['components']] for week in base['weekStructure']},
            'weeks': {week_id: merge.week_fields(week) for week_id, week in base_weeks.items()},
            'components': {item_id: base_components[item_id] for item_id in touched if item_id in base_components},
        },
        'restoreIds': list(restore),
    }


class DifferentItems(unittest.TestCase):
    def test_two_people_editing_two_components_both_land(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C2')[1]['title'] = 'Theirs'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Mine'
        merged, summary = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(find(merged, 'C1')[1]['title'], 'Mine')
        self.assertEqual(find(merged, 'C2')[1]['title'], 'Theirs')
        self.assertEqual(summary['taken_local'], 1)

    def test_different_fields_of_one_component_both_land(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['description'] = 'Their description'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['settings']['body'] = '<p>My rich text</p>'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        item = find(merged, 'C1')[1]
        self.assertEqual(item['description'], 'Their description')
        self.assertEqual(item['settings']['body'], '<p>My rich text</p>')

    def test_module_fields_merge_field_by_field(self):
        base = stored_module()
        stored = {**copy.deepcopy(base), 'description': 'Their intro'}
        local = {**copy.deepcopy(base), 'title': 'My title'}
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual((merged['title'], merged['description']), ('My title', 'Their intro'))

    def test_two_new_components_in_one_week_keep_both(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        stored['weekStructure'][0]['components'].append(component('C9', 'W1', 'Their new one'))
        local = copy.deepcopy(base)
        local['weekStructure'][0]['components'].insert(0, component('C8', 'W1', 'My new one'))
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual([item['id'] for item in merged['weekStructure'][0]['components']], ['C8', 'C1', 'C2', 'C9'])

    def test_their_reorder_and_my_edit_both_land(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        stored['weekStructure'][0]['components'].reverse()
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Mine'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual([item['id'] for item in merged['weekStructure'][0]['components']], ['C2', 'C1'])
        self.assertEqual(find(merged, 'C1')[1]['title'], 'Mine')

    def test_my_move_and_their_edit_of_the_same_component_both_land(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['description'] = 'Their description'
        local = copy.deepcopy(base)
        moved = local['weekStructure'][0]['components'].pop(0)
        moved['weekId'] = 'W2'
        local['weekStructure'][1]['components'].append(moved)
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        week_id, item = find(merged, 'C1')
        self.assertEqual(week_id, 'W2')
        self.assertEqual(item['description'], 'Their description')

    def test_an_unchanged_week_they_edited_keeps_their_title(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        stored['weekStructure'][1]['title'] = 'Their week title'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Mine'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(merged['weekStructure'][1]['title'], 'Their week title')

    def test_weeks_are_renumbered_in_merged_order(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        stored['weekStructure'].insert(0, {'id': 'W0', 'weekNumber': 1, 'title': 'Theirs', 'components': []})
        local = copy.deepcopy(base)
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual([(week['id'], week['weekNumber']) for week in merged['weekStructure']], [('W0', 1), ('W1', 2), ('W2', 3)])
        self.assertEqual(merged['weeksNumber'], 3)


class RealConflicts(unittest.TestCase):
    def assertConflict(self, stored, payload, path, kind):
        with self.assertRaises(merge.ModuleMergeConflicts) as raised:
            merge.merge_partial_save(stored, payload)
        found = [(item['path'], item['kind']) for item in raised.exception.conflicts]
        self.assertIn((path, kind), found)
        return raised.exception.conflicts

    def test_same_field_two_values_is_refused(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['title'] = 'Theirs'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Mine'
        conflicts = self.assertConflict(stored, save(base, local), 'weekStructure[W1].components[C1].title', 'value')
        self.assertEqual((conflicts[0]['local'], conflicts[0]['remote']), ('Mine', 'Theirs'))

    def test_same_rich_text_field_is_refused(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['settings']['body'] = '<p>Theirs</p>'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['settings']['body'] = '<p>Mine</p>'
        self.assertConflict(stored, save(base, local), 'weekStructure[W1].components[C1].settings.body', 'value')

    def test_same_field_same_value_is_not_a_conflict(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['title'] = 'Agreed'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Agreed'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(find(merged, 'C1')[1]['title'], 'Agreed')

    def test_ksb_mappings_both_changed_are_compared_whole(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['ksbMappings'] = [{'id': 'K1', 'code': 'K1'}]
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['ksbMappings'] = [{'id': 'K2', 'code': 'K2'}]
        self.assertConflict(stored, save(base, local), 'weekStructure[W1].components[C1].ksbMappings', 'value')

    def test_editing_a_component_they_deleted_is_refused(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        stored['weekStructure'][0]['components'].pop(0)
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Mine'
        self.assertConflict(stored, save(base, local), 'weekStructure[W1].components[C1]', 'remote-deleted')

    def test_a_deleted_component_is_never_brought_back_unasked(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        stored['weekStructure'][0]['components'].pop(0)
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Mine'
        payload = save(base, local)
        with self.assertRaises(merge.ModuleMergeConflicts):
            merge.merge_partial_save(stored, payload, deleted_ids={'C1'})
        # The author chose "restore": now it is a decision, not an accident.
        merged, _ = merge.merge_partial_save(stored, save(base, local, restore=['C1']), deleted_ids={'C1'})
        self.assertEqual(find(merged, 'C1')[1]['title'], 'Mine')

    def test_deleting_a_component_they_edited_is_refused(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['title'] = 'Theirs'
        local = copy.deepcopy(base)
        local['weekStructure'][0]['components'].pop(0)
        self.assertConflict(stored, save(base, local), 'weekStructure[W1].components[C1]', 'local-deleted')

    def test_deleting_an_untouched_component_goes_through(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C3')[1]['title'] = 'Their edit elsewhere'
        local = copy.deepcopy(base)
        local['weekStructure'][0]['components'].pop(0)
        merged, summary = merge.merge_partial_save(stored, save(base, local))
        self.assertIsNone(find(merged, 'C1')[1])
        self.assertEqual(summary['deleted'], 1)

    def test_deleting_a_week_they_added_content_to_is_refused(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        stored['weekStructure'][1]['components'].append(component('C9', 'W2', 'Their new one'))
        local = copy.deepcopy(base)
        local['weekStructure'].pop(1)
        self.assertConflict(stored, save(base, local), 'weekStructure[W2]', 'local-deleted')

    def test_both_reordering_one_week_differently_is_refused(self):
        base = stored_module()
        base['weekStructure'][0]['components'].append(component('C4', 'W1', 'Reading four'))
        stored = copy.deepcopy(base)
        components = stored['weekStructure'][0]['components']
        stored['weekStructure'][0]['components'] = [components[2], components[0], components[1]]
        local = copy.deepcopy(base)
        components = local['weekStructure'][0]['components']
        local['weekStructure'][0]['components'] = [components[1], components[2], components[0]]
        self.assertConflict(stored, save(base, local), 'weekStructure[W1].components', 'reorder')

    def test_same_module_field_two_values_is_refused(self):
        base = stored_module()
        stored = {**copy.deepcopy(base), 'title': 'Their title'}
        local = {**copy.deepcopy(base), 'title': 'My title'}
        self.assertConflict(stored, save(base, local), 'title', 'value')


class OwnedValues(unittest.TestCase):
    def test_teams_meeting_keys_always_keep_the_stored_value(self):
        base = stored_module()
        find(base, 'C1')[1]['settings']['teamsMeetingUrl'] = 'https://teams/old'
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['settings']['teamsMeetingUrl'] = 'https://teams/new'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['settings']['teamsMeetingUrl'] = 'https://teams/stale-edit'
        find(local, 'C1')[1]['title'] = 'Mine'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        item = find(merged, 'C1')[1]
        self.assertEqual(item['settings']['teamsMeetingUrl'], 'https://teams/new')
        self.assertEqual(item['title'], 'Mine')

    def test_a_stale_teams_share_never_clears_the_stored_one(self):
        base = stored_module()
        stored = {**copy.deepcopy(base), 'teamsSharedSourceModuleId': 'MOD-SOURCE'}
        local = copy.deepcopy(base)  # still holds '' from before the share was made
        find(local, 'C1')[1]['title'] = 'Mine'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(merged['teamsSharedSourceModuleId'], 'MOD-SOURCE')

    def test_an_explicit_teams_share_change_is_kept(self):
        base = {**stored_module(), 'teamsSharedSourceModuleId': 'MOD-SOURCE'}
        stored = copy.deepcopy(base)
        local = {**copy.deepcopy(base), 'teamsSharedSourceModuleId': ''}
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(merged['teamsSharedSourceModuleId'], '')

    def test_planned_session_dates_never_conflict(self):
        base = stored_module()
        find(base, 'C1')[1]['settings']['sessionDate'] = '2026-11-02'
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['settings']['sessionDate'] = '2026-11-09'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['settings']['sessionDate'] = '2026-11-16'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(find(merged, 'C1')[1]['settings']['sessionDate'], '2026-11-09')

    def test_sessions_number_never_conflicts(self):
        base = {**stored_module(), 'sessionsNumber': 9}
        stored = {**copy.deepcopy(base), 'sessionsNumber': 11}
        local = {**copy.deepcopy(base), 'sessionsNumber': 10}
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(merged['sessionsNumber'], 10)

    def test_derived_week_fields_never_conflict(self):
        base = stored_module()
        base['weekStructure'][0]['sessionDate'] = '2026-11-02'
        stored = copy.deepcopy(base)
        stored['weekStructure'][0]['sessionDate'] = '2026-11-09'
        local = copy.deepcopy(base)
        local['weekStructure'][0]['sessionDate'] = '2026-11-16'
        local['weekStructure'][0]['title'] = 'My week'
        merged, _ = merge.merge_partial_save(stored, save(base, local))
        self.assertEqual(merged['weekStructure'][0]['title'], 'My week')


class BrowserNormalisation(unittest.TestCase):
    def test_a_default_the_browser_filled_in_is_not_the_authors_change(self):
        # The server's copy has no readingSource; the Builder's copy of the
        # same version shows the default 'Text'. A colleague then sets 'File'.
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['settings']['readingSource'] = 'File'
        browser_base = copy.deepcopy(base)
        find(browser_base, 'C1')[1]['settings']['readingSource'] = 'Text'
        local = copy.deepcopy(browser_base)
        find(local, 'C1')[1]['title'] = 'Mine'
        payload = save(base, local)
        without_browser_base = copy.deepcopy(payload)
        with self.assertRaises(merge.ModuleMergeConflicts):
            merge.merge_partial_save(stored, without_browser_base)
        payload['structureBase']['localComponents'] = {'C1': find(browser_base, 'C1')[1]}
        merged, _ = merge.merge_partial_save(stored, payload)
        item = find(merged, 'C1')[1]
        self.assertEqual((item['title'], item['settings']['readingSource']), ('Mine', 'File'))

    def test_module_fields_use_the_browsers_base_for_the_authors_side(self):
        base = {**stored_module(), 'completionCriteria': {'averageScoreRequired': 80}}
        stored = {**copy.deepcopy(base), 'completionCriteria': {'averageScoreRequired': 70}}
        browser_base = {**copy.deepcopy(base), 'completionCriteria': {'averageScoreRequired': 80, 'quizzesCompletedRequired': False}}
        local = {**copy.deepcopy(browser_base), 'title': 'My title'}
        payload = save(base, local)
        payload['structureBase']['localModule'] = {k: v for k, v in browser_base.items() if k != 'weekStructure'}
        merged, _ = merge.merge_partial_save(stored, payload)
        self.assertEqual(merged['title'], 'My title')
        self.assertEqual(merged['completionCriteria']['averageScoreRequired'], 70)

    def test_a_real_clash_is_still_a_clash_with_both_bases(self):
        base = stored_module()
        stored = copy.deepcopy(base)
        find(stored, 'C1')[1]['title'] = 'Theirs'
        local = copy.deepcopy(base)
        find(local, 'C1')[1]['title'] = 'Mine'
        payload = save(base, local)
        payload['structureBase']['localComponents'] = {'C1': find(base, 'C1')[1]}
        with self.assertRaises(merge.ModuleMergeConflicts):
            merge.merge_partial_save(stored, payload)


class Equality(unittest.TestCase):
    def test_serialiser_noise_is_not_a_change(self):
        self.assertTrue(merge.same({'a': 1, 'b': ''}, {'a': 1.0}))
        self.assertTrue(merge.same(None, ''))
        self.assertTrue(merge.same([], None))
        self.assertFalse(merge.same('a', 'b'))

    def test_fingerprints_are_stable_and_content_sensitive(self):
        one = merge.structure_fingerprints(stored_module())
        two = merge.structure_fingerprints(stored_module())
        self.assertEqual(one, two)
        changed = stored_module()
        find(changed, 'C1')[1]['title'] = 'Changed'
        three = merge.structure_fingerprints(changed)
        self.assertNotEqual(one['components']['C1'], three['components']['C1'])
        self.assertEqual(one['components']['C2'], three['components']['C2'])
        self.assertEqual(one['weeks'], three['weeks'])


class FastPath(unittest.TestCase):
    def test_restore_check_refuses_a_stale_resurrection(self):
        stored = stored_module()
        delta = {'components': {'C7': component('C7', 'W1', 'Deleted elsewhere')}}
        found = merge.restore_conflicts(delta, stored, {'C7'}, [])
        self.assertEqual([(item['path'], item['kind']) for item in found], [('weekStructure[W1].components[C7]', 'remote-deleted')])
        self.assertEqual(merge.restore_conflicts(delta, stored, {'C7'}, ['C7']), [])
        self.assertEqual(merge.restore_conflicts(delta, stored, set(), []), [])

    def test_candidate_ids_are_only_the_ones_not_stored(self):
        stored = stored_module()
        delta = {'weeks': {'W1': {}, 'W9': {}}, 'components': {'C1': {}, 'C9': {}}}
        self.assertEqual(merge.candidate_new_ids(delta, stored), {'weeks': ['W9'], 'components': ['C9']})

    def test_a_save_without_its_base_cannot_be_merged(self):
        stored = stored_module()
        with self.assertRaises(merge.ModuleMergeUnavailable):
            merge.merge_partial_save(stored, {'structureDelta': {}})


if __name__ == '__main__':
    unittest.main()
