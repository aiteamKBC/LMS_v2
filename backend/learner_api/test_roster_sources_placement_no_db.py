"""Attendance roster sources read programme/group names through the FK placement.

Database and network are prohibited. A fake cursor captures the real SQL issued
by roster_sources and returns synthetic rows, so the statement text, the row
shape and module_roster's membership rules run unchanged.
"""
import re
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import attendance_assignments as roster
from curriculum_api.session_results import effective_module_register_rows


def cursor_returning(rows):
    cursor = MagicMock()
    cursor.fetchall.return_value = rows
    connection = MagicMock()
    connection.cursor.return_value.__enter__.return_value = cursor
    return cursor, {'enrolment': connection}


# (id, Username, Email, programme name, group name, training_plan, learning_plan)
ROWS = [
    (101, 'Commercial Learner', 'c@example.test', 'Programme A', 'Group 1', None, None),         # inherits preset
    (102, 'Apprentice Learner', 'a@example.test', 'Programme A', 'Group 1', [{'moduleId': 'OWN'}], None),
    (103, 'No Placement', 'n@example.test', None, None, None, None),                          # no profile/placement
    (104, 'Other Group', 'o@example.test', 'Programme A', 'Group 2', None, None),
]


class RosterSourcesSqlTests(SimpleTestCase):
    def read(self, rows=ROWS):
        cursor, connections = cursor_returning(rows)
        with patch.object(roster, 'connections', connections):
            sources = roster.roster_sources()
        return sources, cursor

    def test_no_obsolete_created_users_name_columns(self):
        _, cursor = self.read()
        sql = cursor.execute.call_args.args[0]
        self.assertNotIn('"Programme"', sql)
        self.assertNotIn('"Group"', sql)
        self.assertIsNone(re.search(r'u\."(Programme|Group|Cohort)"', sql))

    def test_names_come_from_the_enrolment_linked_profile_placement(self):
        _, cursor = self.read()
        sql = ' '.join(cursor.execute.call_args.args[0].split())
        self.assertIn('LEFT JOIN LATERAL', sql)
        self.assertIn('FROM "Learner".learners l', sql)
        self.assertIn('WHERE l.enrolment_id = u.id', sql)
        self.assertIn('LEFT JOIN curriculum.programmes p ON p.programme_id = l.programme_id', sql)
        self.assertIn('LEFT JOIN curriculum.groups g ON g.group_id = l.group_id', sql)
        self.assertIn('LIMIT 1', sql)                       # one row per enrolment
        self.assertIn('FROM enrolment."Created_users" u', sql)

    def test_single_read_only_statement_and_unchanged_row_shape(self):
        sources, cursor = self.read()
        self.assertEqual(cursor.execute.call_count, 1)
        self.assertTrue(cursor.execute.call_args.args[0].lstrip().upper().startswith('SELECT'))
        self.assertEqual(sorted(vars(sources[0])),
                         ['email', 'group', 'learning_plan', 'pk', 'programme', 'training_plan', 'username'])
        self.assertEqual((sources[0].pk, sources[0].programme, sources[0].group), (101, 'Programme A', 'Group 1'))
        self.assertEqual((sources[2].programme, sources[2].group), (None, None))   # missing placement stays NULL


class ModuleRosterMembershipTests(SimpleTestCase):
    def roster_for(self, module_id, presets):
        cursor, connections = cursor_returning(ROWS)
        with patch.object(roster, 'connections', connections), \
                patch.object(roster, 'group_module_ids_bulk', return_value=presets) as bulk, \
                patch.object(roster.LearnerProfile, 'objects') as profiles:
            def filtered(**kwargs):
                query = MagicMock()
                query.values.return_value = [{'id': 900 + pk, 'enrolment_id': pk, 'email': '', 'full_name': ''}
                                             for pk in sorted(kwargs['enrolment_id__in'])]
                return query
            profiles.filter.side_effect = filtered
            result = roster.module_roster(module_id)
            asked = bulk.call_args.args[0]
            enrolments = set(profiles.filter.call_args.kwargs['enrolment_id__in']) if profiles.filter.called else set()
        return result, asked, enrolments

    def test_preset_inheritance_uses_the_resolved_programme_and_group_names(self):
        presets = {('Programme A', 'Group 1'): ['NEW'], ('Programme A', 'Group 2'): [], ('', ''): []}
        result, asked, enrolments = self.roster_for('NEW', presets)
        self.assertIn(('Programme A', 'Group 1'), asked)
        self.assertIn((None, None), asked)                   # NULL placement asked as before, never guessed
        # 101 has no saved plan and inherits Group 1's preset. 102's non-explicit saved
        # plan also picks up Group 1's modules (existing _effective_plan_ids rule).
        # 103 has no placement, so no preset; 104 is in another group.
        self.assertEqual(enrolments, {101, 102})
        self.assertEqual(sorted(member['learner_profile_id'] for member in result), [1001, 1002])
        self.assertEqual({member['learner_email'] for member in result}, {'c@example.test', 'a@example.test'})

    def test_saved_plan_membership_is_independent_of_placement(self):
        result, _, enrolments = self.roster_for('OWN', {('Programme A', 'Group 1'): ['NEW'],
                                                        ('Programme A', 'Group 2'): [], ('', ''): []})
        self.assertEqual(enrolments, {102})
        self.assertEqual(result[0]['learner_name'], 'Apprentice Learner')

    def test_missing_placement_never_inherits_a_preset(self):
        result, _, enrolments = self.roster_for('NEW', {('Programme A', 'Group 1'): [],
                                                        ('Programme A', 'Group 2'): [], ('', ''): []})
        self.assertEqual((result, enrolments), ([], set()))


class SessionResultsConsumerTests(SimpleTestCase):
    def test_effective_register_rows_are_built_from_the_real_roster(self):
        cursor, connections = cursor_returning(ROWS)
        with patch.object(roster, 'connections', connections), \
                patch.object(roster, 'group_module_ids_bulk',
                             return_value={('Programme A', 'Group 1'): ['NEW'], ('Programme A', 'Group 2'): [], ('', ''): []}), \
                patch.object(roster.LearnerProfile, 'objects') as profiles:
            profiles.filter.return_value.values.return_value = [
                {'id': 1001, 'enrolment_id': 101, 'email': '', 'full_name': ''}]
            rows = effective_module_register_rows('NEW', [
                {'id': 'PAST', 'attendance_report_id': 'R', 'actual_end': '2026-10-01'}, {'id': 'FUTURE'}])
        self.assertEqual({row['learner_profile_id'] for row in rows}, {1001})
        self.assertEqual([row['attendance_status'] for row in rows], ['absent', 'pending'])
        self.assertTrue(all(row['attended_seconds'] == 0 for row in rows))
