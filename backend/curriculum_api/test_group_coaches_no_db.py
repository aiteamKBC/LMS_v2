"""A group's coaches, read from and written to curriculum.group_coaches.

curriculum.groups no longer carries coach_id; a group may have several coaches,
one group_coaches row each. Nothing here opens a connection: cursors and the
PostgreSQL vendor are mocked with synthetic records.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import curriculum_names as cn
from curriculum_api import group_coaches


def lookup_cursor(rows):
    cursor = mock.MagicMock()
    cursor.__enter__.return_value = cursor
    cursor.fetchall.return_value = rows
    db = mock.Mock(vendor='postgresql')
    db.cursor.return_value = cursor
    return db, cursor


LOOKUP_ROWS = [
    ('g', 'G-1', 'Group 1', 'C-1', 'PROG-1', None, None, 'active'),
    ('g', 'G-2', 'Group 2', 'C-1', 'PROG-1', None, None, 'active'),
    ('m', 'MOD-1', 'Module', 'G-1', 'C-1', None, 'PROG-1', 'active'),
    ('k', 'COACH-Z', 'Zara Coach', 'z@example.invalid', None, None, None, 'active'),
    ('k', 'COACH-A', 'Adam Coach', 'a@example.invalid', None, None, None, 'active'),
    ('gc', 'G-1', 'COACH-Z', None, None, None, None, None),
    ('gc', 'G-1', 'COACH-A', None, None, None, None, None),
]


class LookupTests(SimpleTestCase):
    def read(self, optional):
        db, cursor = lookup_cursor(LOOKUP_ROWS)
        cn.invalidate()
        self.addCleanup(cn.invalidate)
        with mock.patch.object(cn, 'connections', {'default': db}), \
                mock.patch.object(cn, '_optional_tables', return_value=optional):
            data = cn.lookups()
        return data, cursor.execute.call_args[0][0]

    def test_without_a_coach_column_the_group_query_selects_no_coach_id(self):
        _, sql = self.read({'choices': False, 'standards': False, 'group_coaches': True, 'group_coach_column': False})
        group_line = next(line for line in sql.splitlines() if 'from curriculum.groups' in line)
        self.assertNotIn('coach_id', group_line)
        self.assertIn('from curriculum.group_coaches', sql)

    def test_a_schema_that_still_stores_the_coach_on_the_group_reads_it(self):
        _, sql = self.read({'choices': False, 'standards': False, 'group_coaches': False, 'group_coach_column': True})
        self.assertIn('coach_id::text', sql)
        self.assertNotIn('group_coaches', sql)

    def test_every_coach_of_a_group_is_read_in_name_order(self):
        data, _ = self.read({'choices': False, 'standards': False, 'group_coaches': True, 'group_coach_column': False})
        self.assertEqual(data['groups']['G-1']['coach_ids'], ['COACH-A', 'COACH-Z'])
        self.assertEqual(data['groups']['G-1']['coach_id'], 'COACH-A')
        self.assertEqual(data['groups']['G-2']['coach_ids'], [])
        self.assertIsNone(data['groups']['G-2']['coach_id'])

    def test_group_and_module_rows_carry_every_coach(self):
        data, _ = self.read({'choices': False, 'standards': False, 'group_coaches': True, 'group_coach_column': False})
        with mock.patch.object(cn, 'connections', {'default': mock.Mock(vendor='postgresql')}), \
                mock.patch.object(cn, 'lookups', return_value=data):
            group = cn.attach('groups', [{'group_id': 'G-1', 'programme_id': 'PROG-1', 'cohort_id': 'C-1'}])[0]
            empty = cn.attach('groups', [{'group_id': 'G-2'}])[0]
            module = cn.attach('modules', [{'module_catalogue_id': 'MOD-1', 'group_id': 'G-1'}])[0]
            coach = cn.attach('coaches', [{'id': 'COACH-Z'}])[0]
        self.assertEqual(group['coach_name'], 'Adam Coach, Zara Coach')
        self.assertEqual(group['coach_names'], ['Adam Coach', 'Zara Coach'])
        self.assertEqual((empty['coach_name'], empty['coach_names']), ('', []))
        self.assertEqual(module['coach_name'], 'Adam Coach, Zara Coach')
        self.assertEqual(coach['assigned_group_ids'], ['G-1'])


class NameTests(SimpleTestCase):
    def test_split_names_accepts_a_list_or_the_joined_string(self):
        self.assertEqual(group_coaches.split_names('Adam Coach, Zara Coach'), ['Adam Coach', 'Zara Coach'])
        self.assertEqual(group_coaches.split_names(['Adam Coach', ' zara coach ', 'Adam coach']),
                         ['Adam Coach', 'zara coach'])
        self.assertEqual(group_coaches.split_names('Unassigned'), [])
        self.assertEqual(group_coaches.split_names(None), [])
        self.assertEqual(group_coaches.join_names(['Adam Coach', '', 'Zara Coach']), 'Adam Coach, Zara Coach')

    def test_a_coaches_list_is_folded_into_the_coach_key_the_writers_read(self):
        from curriculum_api import views
        self.assertEqual(views.with_group_coaches({'coaches': ['Adam Coach', 'Zara Coach'], 'name': 'G'}),
                         {'coaches': ['Adam Coach', 'Zara Coach'], 'name': 'G', 'coach': 'Adam Coach, Zara Coach'})
        self.assertEqual(views.with_group_coaches({'coaches': []})['coach'], '')
        self.assertEqual(views.with_group_coaches({'coach': 'Adam Coach'}), {'coach': 'Adam Coach'})
        self.assertIsNone(views.with_group_coaches(None))

    def test_each_coach_is_canonicalised_on_its_own(self):
        from curriculum_api import views
        with mock.patch.object(views, 'canonical_staff_assignment_name', side_effect=lambda role, name: name.title()):
            self.assertEqual(views.canonical_group_coaches('adam coach, zara coach'), 'Adam Coach, Zara Coach')
            self.assertEqual(views.canonical_group_coaches(''), '')


class StoreTests(SimpleTestCase):
    def setUp(self):
        self.cursor = mock.MagicMock()
        self.cursor.__enter__.return_value = self.cursor
        db = mock.Mock(vendor='postgresql')
        db.cursor.return_value = self.cursor
        patches = [
            mock.patch.object(group_coaches, 'connections', {'default': db}),
            mock.patch.object(group_coaches, 'in_use', return_value=True),
            mock.patch.object(cn, 'staff_id', side_effect=lambda kind, prefix, name, email, using='default': f'ID:{name}'),
            mock.patch.object(cn, 'lookups', return_value={
                'groups': {'G-1': {'coach_ids': ['ID:Adam Coach', 'ID:Zara Coach']}},
                'coaches': {'ID:Adam Coach': {'name': 'Adam Coach'}, 'ID:Zara Coach': {'name': 'Zara Coach'}},
            }),
        ]
        for patch in patches:
            patch.start()
            self.addCleanup(patch.stop)

    def statements(self):
        return [' '.join(call.args[0].split()) for call in self.cursor.execute.call_args_list]

    def test_a_save_without_coach_name_leaves_the_coaches_alone(self):
        group_coaches.store({'group_id': 'G-1', 'group_name': 'Renamed'}, [{'group_id': 'G-1'}])
        self.cursor.execute.assert_not_called()

    def test_the_named_coaches_replace_the_set_and_the_row_shows_them(self):
        row = {'group_id': 'G-1', 'coach_name': ''}
        group_coaches.store({'group_id': 'G-1', 'coach_name': 'Zara Coach, Adam Coach'}, [row])
        delete, insert = self.statements()
        self.assertIn('delete from "curriculum"."group_coaches" where group_id = %s and not (coach_id = any(%s))', delete)
        self.assertIn('on conflict (group_id, coach_id) do nothing', insert)
        self.assertEqual(self.cursor.execute.call_args_list[1].args[1], ['G-1', ['ID:Zara Coach', 'ID:Adam Coach']])
        self.assertEqual(row['coach_name'], 'Adam Coach, Zara Coach')
        self.assertEqual(row['coach_names'], ['Adam Coach', 'Zara Coach'])

    def test_naming_nobody_clears_the_group(self):
        group_coaches.store({'group_id': 'G-1', 'coach_name': 'Unassigned'}, [{'group_id': 'G-1'}])
        self.assertEqual(self.statements(), ['delete from "curriculum"."group_coaches" where group_id = %s'])
