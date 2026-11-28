"""The SQL learner-count path must answer exactly what the Python one answers.

Two layers are checked separately, because they fail in different ways.

`ReductionTests` covers the Python half -- how a row of plan *facts* becomes a
count -- with no database at all, so the branch table of `_effective_plan_ids`
(cleared plan, explicit plan, inherited preset) is pinned cheaply.

`PlanFactSqlTests` covers the jsonb half against a real Postgres. It reads a
literal VALUES list rather than `enrolment."Created_users"`, so it needs no
table, no fixture and no migration -- only a live connection, which is why it
skips unless CURRICULUM_SQL_COUNT_LIVE_CHECK is set. The expressions under test
are the ones that decide which column holds the plan and which entries in it
count, and those are exactly the places a rewrite of this kind goes wrong.
"""
import json
import os
import unittest
from unittest.mock import patch

from django.test import SimpleTestCase

from . import learner_assignment_counts_sql as sqlcounts

LIVE = os.environ.get('CURRICULUM_SQL_COUNT_LIVE_CHECK', '').strip().lower() in {'1', 'true', 'yes', 'on'}


def fact(learner_id=1, programme='Business', grp='Group A', has_plan=True,
         id_count=1, has_explicit=False, matched=(), ambiguous=False):
    return {
        'learner_id': learner_id, 'programme': programme, 'grp': grp,
        'ambiguous': ambiguous, 'has_plan': has_plan, 'id_count': id_count,
        'has_explicit': has_explicit, 'matched': list(matched),
    }


class ReductionTests(SimpleTestCase):
    """`counts_from_plan_facts` against the rules in `_effective_plan_ids`."""

    def counts(self, facts, wanted=('MOD-1', 'MOD-2'), preset=()):
        with patch.object(sqlcounts.plans, '_group_module_ids', return_value=list(preset)):
            counts, ambiguous = sqlcounts.counts_from_plan_facts(facts, wanted)
        self.assertEqual(ambiguous, [])
        return counts

    def test_no_saved_plan_is_taught_the_group_preset(self):
        counts = self.counts([fact(has_plan=False, id_count=0)], preset=['MOD-1'])
        self.assertEqual(counts, {'MOD-1': 1, 'MOD-2': 0})

    def test_empty_plan_stays_empty_and_never_refills_from_the_group(self):
        # A cleared assignment is a decision, not an absent one.
        counts = self.counts([fact(id_count=0, matched=[])], preset=['MOD-1', 'MOD-2'])
        self.assertEqual(counts, {'MOD-1': 0, 'MOD-2': 0})

    def test_explicit_plan_is_the_whole_of_it(self):
        counts = self.counts(
            [fact(id_count=1, has_explicit=True, matched=['MOD-1'])],
            preset=['MOD-2'],
        )
        self.assertEqual(counts, {'MOD-1': 1, 'MOD-2': 0})

    def test_non_explicit_plan_inherits_the_rest_of_the_group(self):
        counts = self.counts([fact(id_count=1, matched=['MOD-1'])], preset=['MOD-2'])
        self.assertEqual(counts, {'MOD-1': 1, 'MOD-2': 1})

    def test_a_module_in_both_plan_and_preset_counts_the_learner_once(self):
        counts = self.counts([fact(id_count=1, matched=['MOD-1'])], preset=['MOD-1'])
        self.assertEqual(counts, {'MOD-1': 1, 'MOD-2': 0})

    def test_learner_without_a_group_has_no_preset_to_inherit(self):
        # A null programme/group has to reach _group_module_ids as ('', ''), the
        # blank pair its own guard answers [] to -- not as None, which would go
        # to the database as a parameter and match nothing in a different way.
        with patch.object(sqlcounts.plans, '_group_module_ids',
                          side_effect=lambda programme, group: ['MOD-2'] if group else []) as lookup:
            counts, _ = sqlcounts.counts_from_plan_facts(
                [fact(programme=None, grp=None, has_plan=False, id_count=0)],
                ('MOD-1', 'MOD-2'),
            )
        lookup.assert_called_once_with('', '')
        self.assertEqual(counts, {'MOD-1': 0, 'MOD-2': 0})

    def test_modules_outside_the_requested_set_are_not_counted(self):
        counts = self.counts([fact(id_count=2, matched=['MOD-1'])], preset=['MOD-9'])
        self.assertEqual(counts, {'MOD-1': 1, 'MOD-2': 0})

    def test_the_preset_lookup_is_shared_across_learners(self):
        facts = [fact(learner_id=i, has_plan=False, id_count=0) for i in range(1, 6)]
        with patch.object(sqlcounts.plans, '_group_module_ids', return_value=['MOD-1']) as lookup:
            counts, _ = sqlcounts.counts_from_plan_facts(facts, ('MOD-1',))
        self.assertEqual(lookup.call_count, 1)
        self.assertEqual(counts, {'MOD-1': 5})

    def test_a_plan_sql_could_not_decide_is_reported_not_guessed(self):
        counts, ambiguous = sqlcounts.counts_from_plan_facts(
            [fact(learner_id=7, ambiguous=True)], ('MOD-1',),
        )
        self.assertEqual((counts, ambiguous), ({'MOD-1': 0}, [7]))


def _jsonb(value):
    if value is None:
        return 'NULL::jsonb'
    return "'" + json.dumps(value).replace("'", "''") + "'::jsonb"


def _values_source(rows):
    """A stand-in for enrolment."Created_users" built from literals."""
    values = ',\n'.join(
        '({id}, {programme}, {grp}, {tp}, {lp})'.format(
            id=row['id'],
            programme="NULL::text" if row.get('programme') is None else "'%s'" % row['programme'].replace("'", "''"),
            grp="NULL::text" if row.get('group') is None else "'%s'" % row['group'].replace("'", "''"),
            tp=_jsonb(row.get('training_plan')),
            lp=_jsonb(row.get('learning_plan')),
        )
        for row in rows
    )
    return '(VALUES\n%s\n) AS u(id, "Programme", "Group", "Training_plan", "Learning_plan")' % values


@unittest.skipUnless(LIVE, 'set CURRICULUM_SQL_COUNT_LIVE_CHECK=1 to run against Postgres')
class PlanFactSqlTests(SimpleTestCase):
    """The jsonb expressions, run by the engine that will run them in anger."""

    databases = {'enrolment'}

    def facts(self, rows, wanted=('MOD-1', 'MOD-2')):
        found = sqlcounts.fetch_plan_facts(set(wanted), source=_values_source(rows))
        return {row['learner_id']: row for row in found}

    def test_training_plan_wins_over_learning_plan(self):
        facts = self.facts([{
            'id': 1, 'programme': 'P', 'group': 'G',
            'training_plan': [{'moduleId': 'MOD-1'}],
            'learning_plan': [{'moduleId': 'MOD-2'}],
        }])
        self.assertEqual(sorted(facts[1]['matched']), ['MOD-1'])

    def test_learning_plan_is_used_when_training_plan_is_not_an_array(self):
        facts = self.facts([{
            'id': 1, 'training_plan': {'moduleId': 'MOD-1'},
            'learning_plan': [{'moduleId': 'MOD-2'}],
        }])
        self.assertTrue(facts[1]['has_plan'])
        self.assertEqual(sorted(facts[1]['matched']), ['MOD-2'])

    def test_a_null_training_plan_does_not_suppress_the_learning_plan(self):
        # The ordinary production shape: Training_plan null, Learning_plan set.
        # jsonb_typeof(NULL) is NULL, so an `=` test here made `ambiguous` NULL
        # and `NOT ambiguous` silently dropped every learner's entries.
        facts = self.facts([{'id': 1, 'training_plan': None, 'learning_plan': [{'moduleId': 'MOD-1'}]}])
        self.assertFalse(facts[1]['ambiguous'])
        self.assertEqual((facts[1]['id_count'], sorted(facts[1]['matched'])), (1, ['MOD-1']))

    def test_no_plan_at_all_is_reported_as_no_plan(self):
        facts = self.facts([{'id': 1, 'training_plan': None, 'learning_plan': None}])
        self.assertEqual((facts[1]['has_plan'], facts[1]['id_count'], list(facts[1]['matched'])), (False, 0, []))

    def test_empty_plan_is_a_plan_with_no_ids(self):
        facts = self.facts([{'id': 1, 'learning_plan': []}])
        self.assertEqual((facts[1]['has_plan'], facts[1]['id_count']), (True, 0))

    def test_explicit_entry_anywhere_marks_the_whole_plan(self):
        facts = self.facts([{'id': 1, 'learning_plan': [
            {'moduleId': 'MOD-1'},
            {'moduleId': 'MOD-2', 'assignmentMode': 'explicit'},
        ]}])
        self.assertTrue(facts[1]['has_explicit'])

    def test_another_assignment_mode_is_not_explicit(self):
        facts = self.facts([{'id': 1, 'learning_plan': [
            {'moduleId': 'MOD-1', 'assignmentMode': 'inherited'},
        ]}])
        self.assertFalse(facts[1]['has_explicit'])

    def test_duplicate_module_ids_are_returned_once(self):
        facts = self.facts([{'id': 1, 'learning_plan': [
            {'moduleId': 'MOD-1'}, {'moduleId': 'MOD-1'}, {'moduleId': 'MOD-1'},
        ]}])
        self.assertEqual(sorted(facts[1]['matched']), ['MOD-1'])
        self.assertEqual(facts[1]['id_count'], 3)

    def test_entries_without_a_module_id_are_ignored_but_leave_the_plan_saved(self):
        facts = self.facts([{'id': 1, 'learning_plan': [
            {'moduleTitle': 'No id here'}, {'moduleId': None}, {'moduleId': '   '},
        ]}])
        self.assertEqual((facts[1]['has_plan'], facts[1]['id_count'], list(facts[1]['matched'])), (True, 0, []))

    def test_module_ids_are_trimmed_the_way_python_trims_them(self):
        facts = self.facts([{'id': 1, 'learning_plan': [{'moduleId': '  MOD-1  '}]}])
        self.assertEqual(sorted(facts[1]['matched']), ['MOD-1'])

    def test_non_object_entries_are_skipped(self):
        facts = self.facts([{'id': 1, 'learning_plan': ['MOD-1', 42, None, {'moduleId': 'MOD-2'}]}])
        self.assertEqual((facts[1]['id_count'], sorted(facts[1]['matched'])), (1, ['MOD-2']))

    def test_a_learner_without_programme_or_group_still_returns_a_row(self):
        facts = self.facts([{'id': 1, 'programme': None, 'group': None, 'learning_plan': None}])
        self.assertEqual((facts[1]['programme'], facts[1]['grp'], facts[1]['has_plan']), (None, None, False))

    def test_a_plan_stored_as_a_json_string_is_handed_back_to_python(self):
        facts = self.facts([{'id': 1, 'learning_plan': '[{"moduleId": "MOD-1"}]'}])
        self.assertTrue(facts[1]['ambiguous'])
        self.assertFalse(facts[1]['has_plan'])

    def test_every_learner_gets_exactly_one_row(self):
        rows = [
            {'id': 1, 'learning_plan': None},
            {'id': 2, 'learning_plan': []},
            {'id': 3, 'learning_plan': [{'moduleId': 'MOD-1'}, {'moduleId': 'MOD-2'}]},
        ]
        self.assertEqual(sorted(self.facts(rows)), [1, 2, 3])
