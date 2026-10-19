"""Synthetic regressions; no database, Django startup or external requests."""
from copy import deepcopy
from datetime import datetime, timedelta, timezone
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))
import reconcile_legacy_learning as repair


class LearnerPartitionTests(unittest.TestCase):
    def test_partitions_cover_each_learner_once_without_changing_evidence(self):
        sources = {ident: {'courses': [ident + 100]} for ident in range(1, 388)}
        before = deepcopy(sources)
        collected, names = {}, set()
        for index in range(8):
            selected, name = repair.learner_partition(sources, 'learners', index, 8)
            self.assertFalse(collected.keys() & selected.keys())
            collected.update(selected)
            names.add(name)
        self.assertEqual(collected, sources)
        self.assertEqual(sources, before)
        self.assertEqual(len(names), 8)
        self.assertNotIn('learners', names)

    def test_partition_selection_is_stable_when_other_learners_change(self):
        sources = {1: 'a', 5: 'b', 9: 'c'}
        selected, _ = repair.learner_partition(sources, 'learners', 1, 4)
        reordered, _ = repair.learner_partition({9: 'c', 2: 'new', 1: 'a', 5: 'b'}, 'learners', 1, 4)
        self.assertEqual(selected, reordered)
        self.assertEqual(repair.learner_partition(sources, 'learners', 0, 1), (sources, 'learners'))

    def test_invalid_partition_cannot_silently_skip_learners(self):
        for index, count in [(-1, 4), (4, 4), (0, 0), (0, 9)]:
            with self.subTest(index=index, count=count), self.assertRaises(ValueError):
                repair.learner_partition({}, 'learners', index, count)


class SourceVerificationTests(unittest.TestCase):
    def setUp(self):
        self.account = {'id': 12, 'identity_id': 7, 'identity_fingerprint': 'saved',
                        'allowed_emails': ['synthetic@example.invalid']}
        self.row = {'user_id': 12, 'email': 'synthetic@example.invalid', 'course_id': 21,
                    'course': 'Synthetic course', 'materials': [{'component_id': 91,
                    'completed': True}], 'quizzes': [{'component_id': 91, 'passed': False}]}

    def test_equal_numeric_lesson_and_quiz_ids_keep_distinct_completion(self):
        facts = repair.normalize_courses([self.row], self.account)['21']['facts']
        self.assertEqual(set(facts), {'material:91', 'quiz:91'})
        self.assertTrue(repair.completed('material:91', facts['material:91']))
        self.assertFalse(repair.completed('quiz:91', facts['quiz:91']))

    def test_quiz_attempt_or_completed_flag_does_not_mean_passed(self):
        self.assertFalse(repair.completed('quiz:91', {'completed': True, 'attempts_count': 4}))
        self.assertFalse(repair.completed('material:91', {'completed': 'true'}))

    def test_wrong_source_id_or_email_is_rejected(self):
        for changes in ({'user_id': 13}, {'email': 'someone-else@example.invalid'}):
            with self.subTest(changes=changes), self.assertRaisesRegex(ValueError, 'identity'):
                repair.normalize_courses([{**self.row, **changes}], self.account)

    def test_empty_partial_and_duplicate_responses_cannot_remove_memberships(self):
        for rows in ([], [self.row, self.row], [{**self.row, 'materials': None}],
                     [{**self.row, 'materials': self.row['materials'] * 2}]):
            with self.subTest(rows=rows), self.assertRaises(ValueError):
                repair.normalize_courses(rows, self.account)

    def test_snapshots_exclude_personal_fields_answers_and_content(self):
        self.row.update(name='PRIVATE', answers='PRIVATE', tutor_email='PRIVATE')
        self.row['materials'][0].update(content='PRIVATE')
        self.assertNotIn('PRIVATE', json.dumps(repair.normalize_courses([self.row], self.account)))

    def test_snapshots_are_bound_to_database_identity_and_freshness(self):
        data = {'version': repair.VERSION, 'target': 'database-a', 'identity_fingerprint': 'saved',
                'source_account_id': 12, 'fetched_at': datetime.now(timezone.utc).isoformat()}
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'account-12.json'
            path.write_text(json.dumps(data))
            self.assertIsNotNone(repair.cached_account(Path(folder), self.account, 'database-a'))
            self.assertIsNone(repair.cached_account(Path(folder), self.account, 'database-b'))
            self.assertIsNone(repair.cached_account(Path(folder), {**self.account,
                'identity_fingerprint': 'changed'}, 'database-a'))
            data['fetched_at'] = (datetime.now(timezone.utc) - timedelta(days=2)).isoformat()
            path.write_text(json.dumps(data))
            self.assertIsNone(repair.cached_account(Path(folder), self.account, 'database-a'))

    def test_aliases_union_courses_and_keep_positive_completion(self):
        owner = {'accounts': [self.account, {**self.account, 'id': 13}]}
        courses = repair.normalize_courses([self.row], self.account)
        second = deepcopy(courses)
        second['21']['facts']['material:91']['completed'] = False
        second['22'] = deepcopy(second['21'])
        with patch.object(repair, 'cached_account', side_effect=[
                {'courses': courses, 'fetched_at': 'now'},
                {'courses': second, 'fetched_at': 'now'}]):
            result = repair.merged_courses(owner, Path('.'), 'database')
        self.assertEqual(set(result), {'21', '22'})
        self.assertTrue(result['21']['facts']['material:91']['completed'])
        self.assertEqual(result['21']['accounts'], [12, 13])

    def test_missing_alias_blocks_reconciliation_of_entire_owner(self):
        with patch.object(repair, 'cached_account', return_value=None), self.assertRaises(ValueError):
            repair.merged_courses({'accounts': [self.account]}, Path('.'), 'database')


class MembershipTests(unittest.TestCase):
    def setUp(self):
        self.owner = {'id': 1, 'enrolment_id': 2}
        self.catalogue = [{'id': n, 'source_course_ref': str(n), 'deleted_at': None} for n in (10, 20, 30)]
        self.members = [{'id': n, 'source_course_id': n, 'learner_id': 1, 'enrolment_id': 2,
                         'source_learner_id': '12', 'source_relationship': 'historical',
                         'deleted_at': None} for n in (10, 20)]

    def test_restore_missing_course_archive_extra_and_preserve_assigned_module(self):
        self.members[1]['source_relationship'] = 'assigned'
        native = {'modules': [{'module_id': 'new-assignment', 'assignmentMode': 'explicit'}]}
        before = deepcopy((self.members, native))
        plan = repair.membership_plan(self.owner, {'30': {'accounts': [12]}}, self.catalogue, self.members)
        self.assertEqual(plan['archive'], [10])
        self.assertEqual([x['course_ref'] for x in plan['add']], ['30'])
        self.assertEqual((self.members, native), before)

    def test_valid_alias_is_not_replaced_and_wrong_source_link_is_auditable(self):
        self.members[0]['source_learner_id'] = '13'
        self.members[1]['source_learner_id'] = '999'
        plan = repair.membership_plan(self.owner, {'10': {'accounts': [12, 13]},
            '20': {'accounts': [12]}}, self.catalogue, self.members)
        self.assertEqual(len(plan['repair_identity']), 1)
        self.assertEqual(plan['repair_identity'][0]['previous_source_account_id'], '999')

    def test_archived_membership_is_history_and_does_not_suppress_restoration(self):
        self.members[0]['deleted_at'] = 'previous-repair'
        plan = repair.membership_plan(self.owner, {'10': {'accounts': [12]}}, self.catalogue, self.members)
        self.assertEqual(len(plan['add']), 1)
        self.assertEqual(self.members[0]['deleted_at'], 'previous-repair')

    def test_missing_catalogue_is_reported_without_fabricating_a_mapping(self):
        plan = repair.membership_plan(self.owner, {'99': {'accounts': [12]}}, self.catalogue, [])
        self.assertEqual(plan['add'], [])
        self.assertEqual(len(plan['blocked']), 1)

    def test_owner_excluded_test_course_is_not_restored_from_old_account(self):
        self.catalogue[0].update(deleted_at='owner-retired', source_payload={
            'owner_exclusion': {'exclude_from_learning': True}})
        plan = repair.membership_plan(self.owner, {'10': {'accounts': [12]}, '30': {'accounts': [12]}},
                                      self.catalogue, self.members)
        self.assertEqual([item['course_ref'] for item in plan['add']], ['30'])
        self.assertIn(10, plan['archive'])
        self.assertEqual(plan['blocked'], [])


class CatalogueAndCompletionTests(unittest.TestCase):
    def test_new_catalogue_retains_original_upload_without_completion_timestamp(self):
        self.fact['created_at'] = '2026-03-14 09:33:13'
        self.verified['21']['timezone'] = '+00:00'
        plan = repair.catalogue_plan({9: self.verified}, self.courses, [])
        self.assertEqual(plan['definitions'][0]['source_payload'],
                         {'created_at_utc': '2026-03-14T09:33:13+00:00'})
        second = deepcopy(self.verified)
        second['21']['facts']['material:91']['created_at'] = '2026-04-14 09:33:13'
        plan = repair.catalogue_plan({9: self.verified, 10: second}, self.courses, [])
        self.assertEqual(plan['definitions'][0]['source_payload'], {})

    def test_explicit_test_course_exclusion_survives_catalogue_and_completion_recovery(self):
        self.courses[0].update(deleted_at='owner-retired', source_payload={
            'owner_exclusion': {'exclude_from_learning': True}})
        before = deepcopy((self.verified, self.courses, self.definition, self.state))
        catalogue = repair.catalogue_plan({9: self.verified}, self.courses, [self.definition])
        self.assertFalse(any(catalogue.values()))
        completion = repair.completion_plan(self.state, self.verified, self.courses,
                                             [self.definition], repair.projection_scope())
        self.assertEqual(completion['add'], [])
        self.assertEqual(completion['update'], [])
        self.assertEqual(completion['blocked'], [])
        self.assertEqual((self.verified, self.courses, self.definition, self.state), before)

    def setUp(self):
        self.courses = [{'id': 1, 'source_course_ref': '21', 'source_course_title': 'Synthetic',
                         'curriculum_module_ref': 'native-module', 'deleted_at': None}]
        self.definition = {'id': 5, 'source_course_id': 1, 'source_activity_id': 'material:91',
            'source_activity_title': 'Lesson', 'source_activity_kind': 'material',
            'source_activity_type': 'reading', 'source_position': 1,
            'curriculum_component_ref': None, 'source_section_ref': '1',
            'source_section_title': 'Section', 'source_payload': {}, 'deleted_at': None}
        self.fact = {'title': 'Lesson', 'completed': True, 'section_id': 1,
                     'post_type': 'stm-lessons', 'material_type': 'text'}
        self.verified = {'21': {'title': 'Synthetic', 'facts': {'material:91': self.fact},
                               'evidence': {'material:91': {'timezone': '+00:00'}}}}
        self.state = {'owner': {'id': 9}, 'progress': [], 'sources': [], 'journals': [],
                      'segments': [], 'modules': [], 'memberships': []}
        self.scope = repair.projection_scope()

    def test_missing_completed_material_gets_explicit_typed_course_route(self):
        plan = repair.completion_plan(self.state, self.verified, self.courses, [self.definition], self.scope)
        self.assertEqual(len(plan['add']), 1)
        self.assertEqual(plan['add'][0]['definition_id'], 5)
        self.assertEqual(plan['add'][0]['activity_ref'], 'material:91')
        self.assertIsNone(plan['add'][0]['submitted_at'])
        self.assertEqual(plan['blocked'], [])

    def test_shared_component_is_reported_instead_of_stealing_another_course_progress(self):
        self.verified['22'] = deepcopy(self.verified['21'])
        plan = repair.completion_plan(self.state, self.verified, self.courses, [self.definition], self.scope)
        self.assertEqual(plan['add'], [])
        self.assertTrue(plan['blocked'])

    def test_course_scoped_recovery_gives_shared_material_two_independent_source_ids(self):
        self.courses.append({**self.courses[0], 'id': 2, 'source_course_ref': '22'})
        self.verified['22'] = deepcopy(self.verified['21'])
        definitions = [self.definition, {**self.definition, 'id': 6, 'source_course_id': 2}]
        plan = repair.completion_plan(self.state, self.verified, self.courses, definitions,
                                      self.scope, course_scoped=True)
        self.assertEqual({p['source_ref'] for p in plan['add']},
                         {'course:21:material:91', 'course:22:material:91'})
        self.assertEqual(plan['blocked'], [])

    def test_proven_opposite_type_lineage_reuses_history_instead_of_duplicating_hours(self):
        self.state['progress'] = [{'id': 7, 'learner_id': 9, 'entry_order': 1, 'accepted': True,
            'actual_seconds': 3600, 'activity_status': 'completed', 'deleted_at': None}]
        self.state['sources'] = [{'id': 8, 'source_system': 'old_lms', 'source_activity_id': 'quiz:91',
            'source_catalog_activity_id': 6, 'canonical_progress_id': 7, 'completed': True, 'deleted_at': None}]
        definitions = [self.definition, {**self.definition, 'id': 6, 'source_activity_id': 'quiz:91'}]
        plan = repair.completion_plan(self.state, self.verified, self.courses, definitions, self.scope)
        self.assertEqual(plan['add'][0]['existing_progress_id'], 7)
        self.assertEqual(self.state['progress'][0]['actual_seconds'], 3600)

    def test_source_completion_update_does_not_rewrite_canonical_history(self):
        self.state['progress'] = [{'id': 7, 'learner_id': 9, 'entry_order': 1, 'accepted': False,
            'actual_seconds': None, 'activity_status': 'not_started', 'deleted_at': None}]
        self.state['sources'] = [{'id': 8, 'source_system': 'old_lms', 'source_activity_id': 'material:91',
            'source_catalog_activity_id': 5, 'source_course_ref': '21', 'canonical_progress_id': 7,
            'completed': False, 'activity_status': 'not_started', '_row_hash': 'previous', 'deleted_at': None}]
        before = deepcopy(self.state)
        plan = repair.completion_plan(self.state, self.verified, self.courses, [self.definition], self.scope)
        self.assertEqual(plan['add'], [])
        self.assertEqual(len(plan['update']), 1)
        self.assertEqual(self.state, before)

    def test_already_projected_completion_is_idempotent(self):
        self.state['progress'] = [{'id': 7, 'learner_id': 9, 'entry_order': 1, 'accepted': False,
            'activity_status': 'completed', 'actual_seconds': None, 'deleted_at': None}]
        self.state['sources'] = [{'id': 8, 'source_system': 'old_lms', 'source_activity_id': 'material:91',
            'source_catalog_activity_id': 5, 'source_course_ref': '21', 'canonical_progress_id': 7,
            'completed': True, 'activity_status': 'completed', 'deleted_at': None}]
        plan = repair.completion_plan(self.state, self.verified, self.courses, [self.definition], self.scope)
        self.assertEqual(plan['add'], [])
        self.assertEqual(plan['update'], [])

    def test_retired_progress_is_preserved_for_review(self):
        self.state['sources'] = [{'id': 8, 'source_system': 'old_lms', 'source_activity_id': 'material:91',
            'source_catalog_activity_id': 5, 'canonical_progress_id': 7, 'deleted_at': None}]
        plan = repair.completion_plan(self.state, self.verified, self.courses, [self.definition], self.scope)
        self.assertEqual(plan['add'], [])
        self.assertEqual(plan['update'], [])
        self.assertEqual(len(plan['blocked']), 1)

    def test_catalogue_collapses_only_proven_wrong_type_without_native_mapping(self):
        false_quiz = {**self.definition, 'id': 6, 'source_activity_id': 'quiz:91'}
        plan = repair.catalogue_plan({9: self.verified}, self.courses, [self.definition, false_quiz])
        self.assertEqual([d['id'] for d in plan['archive']], [6])
        false_quiz['curriculum_component_ref'] = 'new-native-content'
        self.assertEqual(repair.catalogue_plan({9: self.verified}, self.courses,
            [self.definition, false_quiz])['archive'], [])

    def test_unstarted_unplaced_posts_do_not_inflate_catalogue(self):
        self.verified['21']['facts']['material:92'] = {**self.fact, 'section_id': None, 'completed': False}
        plan = repair.catalogue_plan({9: self.verified}, self.courses, [self.definition])
        self.assertEqual(plan['definitions'], [])

    def test_existing_native_assignment_change_fails_verification(self):
        before = {**self.state, 'modules': [{'id': 99, '_row_hash': 'assigned'}]}
        after = {**self.state, 'modules': [{'id': 99, '_row_hash': 'removed'}]}
        with self.assertRaisesRegex(ValueError, 'native assignments'):
            repair.verify_owner(before, after, {}, {}, self.courses, [self.definition], self.scope, self.verified)

    def test_projection_honours_existing_historical_learner_exclusions(self):
        self.state['memberships'] = [{'id': 10, 'source_course_id': 1, 'deleted_at': None,
            'source_relationship': 'historical', 'verified_catalogue_scope': {
                'version': 1, 'basis': 'verified-legacy-account-inventory', 'course_ref': '21',
                'excluded_activity_refs': ['material:91']}}]
        self.assertEqual(repair.projected_items(self.state, self.courses,
            [self.definition], self.scope, owned_only=True), [])
        # A learner-specific exclusion cannot remove the shared definition.
        another = {**self.state, 'memberships': [{**self.state['memberships'][0],
            'verified_catalogue_scope': None}]}
        self.assertEqual(len(repair.projected_items(another, self.courses,
            [self.definition], self.scope, owned_only=True)), 1)
        self.assertIsNone(self.definition['deleted_at'])

    def test_content_alias_scope_keeps_quiz_bank_and_existing_exclusions(self):
        member = {'id': 10, 'learner_id': 9, 'source_course_id': 1,
            'source_relationship': 'historical', 'verified_catalogue_scope': {
                'version': 1, 'basis': 'verified-legacy-account-inventory', 'course_ref': '21',
                'excluded_activity_refs': ['material:92'], 'audit_run': 5}}
        aliases = [{'course_ref': '21', 'wrong_ref': 'material:91', 'verified_ref': 'quiz:91'}]
        updates = repair.content_alias_scopes([member], self.courses, aliases)
        self.assertEqual(updates[0]['new_exclusions'], ['material:91'])
        self.assertEqual(updates[0]['scope']['excluded_activity_refs'], ['material:91', 'material:92'])
        self.assertEqual(updates[0]['scope']['audit_run'], 5)
        self.assertEqual(member['verified_catalogue_scope']['excluded_activity_refs'], ['material:92'])
        reapplied = {**member, 'verified_catalogue_scope': updates[0]['scope']}
        self.assertEqual(repair.content_alias_scopes([reapplied], self.courses, aliases), [])
        self.assertIsNone(self.definition['deleted_at'])

    def test_content_alias_cannot_change_native_membership_scope(self):
        member = {'id': 10, 'learner_id': 9, 'source_course_id': 1,
                  'source_relationship': 'current'}
        with self.assertRaisesRegex(ValueError, 'non-historical'):
            repair.content_alias_scopes([member], self.courses,
                [{'course_ref': '21', 'wrong_ref': 'material:91'}])

    def test_content_alias_rejects_scope_for_another_course(self):
        member = {'id': 10, 'learner_id': 9, 'source_course_id': 1,
            'source_relationship': 'historical', 'verified_catalogue_scope': {
                'version': 1, 'basis': 'verified-legacy-account-inventory', 'course_ref': '22',
                'excluded_activity_refs': ['material:92']}}
        with self.assertRaisesRegex(ValueError, 'scope needs review'):
            repair.content_alias_scopes([member], self.courses,
                [{'course_ref': '21', 'wrong_ref': 'material:91'}])

    def test_owned_projection_does_not_include_another_course(self):
        self.state['memberships'] = [{'id': 10, 'source_course_id': 1,
            'deleted_at': None, 'source_relationship': 'historical'}]
        self.courses.append({**self.courses[0], 'id': 2, 'source_course_ref': '22'})
        definitions = [self.definition, {**self.definition, 'id': 6, 'source_course_id': 2}]
        result = repair.projected_items(self.state, self.courses, definitions,
                                       self.scope, owned_only=True)
        self.assertEqual({item['group_id'] for item in result}, {21})


if __name__ == '__main__':
    unittest.main()
