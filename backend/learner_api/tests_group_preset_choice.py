"""Which group row a preset comes from, when more than one row matches.

`_group_module_ids` looks a group up by name and programme, and that pair is not
unique -- the same group name recurs in every cohort of a programme. The query
used to end in a bare `LIMIT 1` with no `ORDER BY`, so the row that won was
whichever Postgres reached first: on the live data "G1" on Project Controls L6
matches three rows teaching 9, 1 and 0 modules, and the same learner could
inherit any of them from one request to the next.

The ordering is now explicit, and it is the only part of that function worth
testing -- every other caller's test mocks `_group_module_ids` wholesale, so a
tiebreak regression would be invisible everywhere else. These run the real query
against a literal VALUES list, so they need no fixture, no table and no
migration; only a live Postgres, which is why they skip unless
LEARNER_GROUP_PRESET_LIVE_CHECK is set.
"""
import json
import os
import unittest

from django.test import SimpleTestCase

from learner_api import learning_plan as plans

LIVE = os.environ.get('LEARNER_GROUP_PRESET_LIVE_CHECK', '').strip().lower() in {'1', 'true', 'yes', 'on'}

COLUMNS = ('group_id', 'group_name', 'programme_name', 'programme_id', 'module_ids',
           'deleted_at', 'is_programme_deleted', 'created_at', 'updated_at')


def group(group_id, modules=(), *, name='G1', programme_name='Business',
          programme_id='PROG-1', deleted=False, programme_deleted=False,
          created='2026-01-01', updated='2026-01-01'):
    return {
        'group_id': group_id, 'group_name': name,
        'programme_name': programme_name, 'programme_id': programme_id,
        # Not coerced: one case deliberately stores something that is not a list.
        'module_ids': list(modules) if isinstance(modules, (list, tuple)) else modules,
        'deleted_at': '2026-06-01' if deleted else None,
        'is_programme_deleted': programme_deleted,
        'created_at': created, 'updated_at': updated,
    }


def _literal(value, cast):
    if value is None:
        return 'NULL::%s' % cast
    if cast == 'jsonb':
        return "'%s'::jsonb" % json.dumps(value).replace("'", "''")
    if cast == 'boolean':
        return 'TRUE' if value else 'FALSE'
    return "'%s'::%s" % (str(value).replace("'", "''"), cast)


CASTS = {
    'group_id': 'varchar', 'group_name': 'varchar', 'programme_name': 'varchar',
    'programme_id': 'varchar', 'module_ids': 'jsonb', 'deleted_at': 'timestamptz',
    'is_programme_deleted': 'boolean', 'created_at': 'timestamp', 'updated_at': 'timestamp',
}


def _values_source(rows):
    """A stand-in for curriculum.groups built from literals."""
    body = ',\n'.join(
        '(%s)' % ', '.join(_literal(row[column], CASTS[column]) for column in COLUMNS)
        for row in rows
    )
    return '(VALUES\n%s\n) AS g(%s)' % (body, ', '.join(COLUMNS))


@unittest.skipUnless(LIVE, 'set LEARNER_GROUP_PRESET_LIVE_CHECK=1 to run against Postgres')
class GroupPresetChoiceTests(SimpleTestCase):
    databases = {'default'}

    def preset(self, rows, programme='Business', name='G1'):
        return plans._group_module_ids(programme, name, source=_values_source(rows))

    def test_a_single_matching_group_is_used(self):
        self.assertEqual(self.preset([group('A', ['MOD-1', 'MOD-2'])]), ['MOD-1', 'MOD-2'])

    def test_a_group_with_modules_beats_an_empty_one_in_another_cohort(self):
        # The failure that made this worth fixing: an empty row silently strips
        # every module the learner inherits.
        rows = [group('A', []), group('B', ['MOD-1'])]
        self.assertEqual(self.preset(rows), ['MOD-1'])
        self.assertEqual(self.preset(list(reversed(rows))), ['MOD-1'])

    def test_the_fuller_group_wins(self):
        rows = [group('A', ['MOD-1']), group('B', ['MOD-1', 'MOD-2', 'MOD-3'])]
        self.assertEqual(self.preset(rows), ['MOD-1', 'MOD-2', 'MOD-3'])

    def test_equally_full_groups_are_settled_by_the_later_update(self):
        rows = [
            group('A', ['MOD-1'], updated='2026-01-01'),
            group('B', ['MOD-2'], updated='2026-05-05'),
        ]
        self.assertEqual(self.preset(rows), ['MOD-2'])
        self.assertEqual(self.preset(list(reversed(rows))), ['MOD-2'])

    def test_group_id_is_the_last_word_so_the_answer_never_moves(self):
        rows = [group('B', ['MOD-2']), group('A', ['MOD-1'])]
        self.assertEqual(self.preset(rows), ['MOD-1'])
        self.assertEqual(self.preset(list(reversed(rows))), ['MOD-1'])

    def test_a_deleted_group_lends_nobody_its_curriculum(self):
        self.assertEqual(self.preset([group('A', ['MOD-1'], deleted=True)]), [])

    def test_a_group_deleted_with_its_programme_is_excluded_too(self):
        self.assertEqual(self.preset([group('A', ['MOD-1'], programme_deleted=True)]), [])

    def test_a_deleted_group_never_outranks_a_live_one(self):
        rows = [
            group('A', ['MOD-1', 'MOD-2', 'MOD-3'], deleted=True),
            group('B', ['MOD-9']),
        ]
        self.assertEqual(self.preset(rows), ['MOD-9'])

    def test_the_programme_matches_on_either_name_or_id(self):
        rows = [group('A', ['MOD-1'], programme_name='Business', programme_id='PROG-1')]
        self.assertEqual(self.preset(rows, programme='Business'), ['MOD-1'])
        self.assertEqual(self.preset(rows, programme='PROG-1'), ['MOD-1'])
        self.assertEqual(self.preset(rows, programme='Something else'), [])

    def test_another_programmes_group_of_the_same_name_is_not_borrowed(self):
        rows = [group('A', ['MOD-1'], programme_name='Other', programme_id='PROG-9')]
        self.assertEqual(self.preset(rows), [])

    def test_module_ids_are_trimmed_to_strings(self):
        self.assertEqual(self.preset([group('A', ['  MOD-1  ', 2])]), ['MOD-1', '2'])

    def test_a_module_ids_column_that_is_not_an_array_sorts_as_empty(self):
        # jsonb_array_length() errors on a scalar; the ORDER BY must not.
        rows = [group('A', 'not-a-list'), group('B', ['MOD-1'])]
        self.assertEqual(self.preset(rows), ['MOD-1'])

    def test_a_blank_group_is_answered_without_asking_the_database(self):
        self.assertEqual(plans._group_module_ids('Business', ''), [])
