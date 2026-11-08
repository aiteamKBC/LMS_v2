"""Names on curriculum rows, read by id, and the chosen tutor / coach written as its id.

Nothing here opens a connection: the PostgreSQL vendor and the cached lookups
are patched with synthetic records.
"""
from unittest import mock

from django.test import SimpleTestCase

from curriculum_api import curriculum_names as cn

LOOKUPS = {
    'programmes': {'PROG-1': {'name': 'Programme One', 'status': 'active'}},
    'cohorts': {'C-1': {'name': 'Cohort A', 'programme_id': 'PROG-1', 'status': 'active'}},
    'groups': {'G-1': {'name': 'Group 1', 'cohort_id': 'C-1', 'programme_id': 'PROG-1', 'coach_id': 'COACH-1',
                       'status': 'active'}},
    'modules': {
        'MOD-B': {'title': 'Beta', 'group_id': 'G-1', 'cohort_id': 'C-1', 'tutor_id': 'TUTOR-1', 'programme_id': 'PROG-1',
                  'status': 'active'},
        'MOD-A': {'title': 'Alpha', 'group_id': 'G-1', 'cohort_id': 'C-1', 'tutor_id': 'TUTOR-1', 'programme_id': 'PROG-1',
                  'status': 'active'},
        'MOD-X': {'title': 'Archived', 'group_id': 'G-1', 'cohort_id': 'C-1', 'tutor_id': 'TUTOR-1',
                  'programme_id': 'PROG-1', 'status': 'inactive'},
    },
    'tutors': {'TUTOR-1': {'name': 'Tutor One', 'email': 'tutor.one@example.invalid', 'status': 'active'}},
    'coaches': {'COACH-1': {'name': 'Coach One', 'email': 'coach.one@example.invalid', 'status': 'active'}},
    'at': 0,
}
MODULE_COLUMNS = {'module_catalogue_id', 'programme_id', 'cohort_id', 'group_id', 'tutor_id', 'status'}
GROUP_COLUMNS = {'group_id', 'group_name', 'cohort_id', 'programme_id', 'coach_id', 'status'}


class Postgres:
    def __enter__(self):
        self._vendor = mock.patch.object(cn, 'connections', {'default': mock.Mock(vendor='postgresql')})
        self._lookups = mock.patch.object(cn, 'lookups', return_value=LOOKUPS)
        self._vendor.start()
        self._lookups.start()
        return self

    def __exit__(self, *exc):
        self._lookups.stop()
        self._vendor.stop()


class AttachTests(SimpleTestCase):
    def test_module_rows_carry_their_parents_and_staff_names(self):
        row = {'module_catalogue_id': 'MOD-1', 'programme_id': 'PROG-1', 'cohort_id': 'C-1', 'group_id': 'G-1',
               'tutor_id': 'TUTOR-1'}
        with Postgres():
            cn.attach('modules', [row])
        self.assertEqual(row['programme_name'], 'Programme One')
        self.assertEqual(row['cohort_name'], 'Cohort A')
        self.assertEqual(row['group_name'], 'Group 1')
        self.assertEqual((row['tutor_name'], row['tutor_email']), ('Tutor One', 'tutor.one@example.invalid'))
        # A module's coach is its group's coach.
        self.assertEqual(row['coach_name'], 'Coach One')

    def test_unknown_ids_read_as_empty_names(self):
        row = {'module_catalogue_id': 'MOD-2', 'programme_id': 'GONE', 'tutor_id': None}
        with Postgres():
            cn.attach('modules', [row])
        self.assertEqual((row['programme_name'], row['tutor_name'], row['group_name']), ('', '', ''))

    def test_narrowed_reads_get_only_the_names_they_asked_for(self):
        row = {'group_id': 'G-1', 'programme_id': 'PROG-1', 'cohort_id': 'C-1', 'coach_id': 'COACH-1'}
        with Postgres():
            cn.attach('groups', [row], requested=['group_id', 'programme_name'])
        self.assertEqual(row['programme_name'], 'Programme One')
        self.assertNotIn('coach_name', row)
        excluded = {'cohort_id': 'C-1', 'programme_id': 'PROG-1'}
        with Postgres():
            cn.attach('cohorts', [excluded], excluded=['programme_name'])
        self.assertNotIn('programme_name', excluded)

    def test_a_selected_column_is_kept(self):
        row = {'programme_id': 'PROG-1', 'programme_name': 'As selected'}
        with Postgres():
            cn.attach('cohorts', [row])
        self.assertEqual(row['programme_name'], 'As selected')

    def test_off_postgres_nothing_is_read(self):
        row = {'programme_id': 'PROG-1'}
        with mock.patch.object(cn, 'connections', {'default': mock.Mock(vendor='sqlite')}), \
                mock.patch.object(cn, 'lookups') as lookups:
            cn.attach('cohorts', [row])
        lookups.assert_not_called()
        self.assertNotIn('programme_name', row)


class ListTests(SimpleTestCase):
    # The lists rows used to store are answered by key, from live rows only.
    def setUp(self):
        LOOKUPS.pop('_index', None)

    def test_a_groups_modules_are_the_live_modules_naming_it_by_title(self):
        row = {'group_id': 'G-1', 'cohort_id': 'C-1', 'programme_id': 'PROG-1', 'coach_id': 'COACH-1'}
        with Postgres():
            cn.attach('groups', [row])
        self.assertEqual(row['module_ids'], ['MOD-A', 'MOD-B'])
        self.assertEqual(row['module_names'], ['Alpha', 'Beta'])

    def test_a_cohorts_groups_and_module_titles(self):
        row = {'cohort_id': 'C-1', 'programme_id': 'PROG-1'}
        with Postgres():
            cn.attach('cohorts', [row])
        self.assertEqual(row['group_ids'], ['G-1'])
        self.assertEqual(row['module_names'], ['Alpha', 'Beta'])

    def test_staff_assignments_and_retired_profile_fields(self):
        tutor, coach = {'id': 'TUTOR-1'}, {'id': 'COACH-1'}
        with Postgres():
            cn.attach('tutors', [tutor])
            cn.attach('coaches', [coach])
        self.assertEqual(tutor['assigned_module_ids'], ['MOD-A', 'MOD-B'])
        self.assertEqual((tutor['job_title'], tutor['notes']), ('', ''))
        self.assertEqual(coach['assigned_group_ids'], ['G-1'])
        self.assertEqual(coach['phone'], '')

    def test_a_group_with_no_modules_has_empty_lists(self):
        row = {'group_id': 'G-EMPTY'}
        with Postgres():
            cn.attach('groups', [row], requested=['group_id', 'module_ids'])
        self.assertEqual(row['module_ids'], [])
        self.assertNotIn('module_names', row)


class StoreStaffTests(SimpleTestCase):
    def store(self, table, payload, columns, resolved='TUTOR-NEW'):
        with Postgres(), mock.patch.object(cn, 'staff_id', return_value=resolved) as staff_id:
            result = cn.store_staff(table, payload, columns)
        return result, staff_id

    def test_named_tutor_is_written_as_its_id(self):
        (payload, nullable), staff_id = self.store(
            'modules', {'tutor_name': 'Tutor Two', 'tutor_email': 'two@example.invalid'}, MODULE_COLUMNS)
        staff_id.assert_called_once_with('tutors', 'TUTOR', 'Tutor Two', 'two@example.invalid', using='default')
        self.assertEqual(payload['tutor_id'], 'TUTOR-NEW')
        self.assertEqual(nullable, set())

    def test_blank_tutor_clears_the_id(self):
        (payload, nullable), staff_id = self.store('modules', {'tutor_name': '', 'tutor_email': ''}, MODULE_COLUMNS)
        staff_id.assert_not_called()
        self.assertIsNone(payload['tutor_id'])
        self.assertEqual(nullable, {'tutor_id'})

    def test_coach_name_is_written_as_the_groups_coach_id(self):
        (payload, _), staff_id = self.store('groups', {'coach_name': 'Coach Two'}, GROUP_COLUMNS, resolved='COACH-2')
        staff_id.assert_called_once_with('coaches', 'COACH', 'Coach Two', None, using='default')
        self.assertEqual(payload['coach_id'], 'COACH-2')

    def test_an_id_that_still_matches_its_names_is_kept(self):
        stored = {'tutor_id': 'TUTOR-1', 'tutor_name': 'Tutor One', 'tutor_email': 'tutor.one@example.invalid'}
        (payload, _), staff_id = self.store('modules', stored, MODULE_COLUMNS)
        staff_id.assert_not_called()
        self.assertEqual(payload['tutor_id'], 'TUTOR-1')

    def test_a_new_choice_beside_the_stored_row_replaces_the_stale_id(self):
        # {**stored_row, 'tutor_name': new}: the old id and the old email came along.
        stored = {'tutor_id': 'TUTOR-1', 'tutor_name': 'Tutor Two', 'tutor_email': 'tutor.one@example.invalid'}
        (payload, _), staff_id = self.store('modules', stored, MODULE_COLUMNS)
        staff_id.assert_called_once_with('tutors', 'TUTOR', 'Tutor Two', '', using='default')
        self.assertEqual(payload['tutor_id'], 'TUTOR-NEW')

    def test_a_payload_without_staff_or_a_shape_that_stores_names_is_untouched(self):
        (payload, _), staff_id = self.store('modules', {'title': 'T'}, MODULE_COLUMNS)
        self.assertEqual(payload, {'title': 'T'})
        legacy = MODULE_COLUMNS | {'tutor_name'}
        (payload, _), _ = self.store('modules', {'tutor_name': 'Tutor Two'}, legacy)
        self.assertNotIn('tutor_id', payload)
        staff_id.assert_not_called()


class OrderSqlTests(SimpleTestCase):
    def test_programme_and_cohort_names_sort_from_their_own_rows(self):
        self.assertEqual(
            cn.programme_name_sql('groups'),
            '(select p.name from "curriculum"."programmes" p where p.programme_id = groups.programme_id)',
        )
        self.assertIn('c.cohort_id = groups.cohort_id', cn.cohort_name_sql('groups'))
