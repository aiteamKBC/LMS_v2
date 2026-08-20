"""Deleting a tutor or coach has to stick.

A delete removes the profile row outright. That alone is not enough: the staff
member's *name* also lives on ``curriculum.modules.tutor_name`` /
``curriculum.groups.coach_name``, and the curriculum read model derives stand-in
profiles from those names — a row deleted while its name was left behind came
straight back on the next read. These tests pin both halves: the row is really
gone from the database, and the name is released from the curriculum it was
assigned to so nothing can rebuild it.
"""

from io import StringIO

from django.core.management import call_command

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


STAFF_ENDPOINTS = {'tutor': 'tutors', 'coach': 'coaches'}


class StaffProfileDeleteStaysDeletedTests(CurriculumPersistenceHarness):
    def staff_profiles(self, role, visibility=''):
        path = f'/curriculum_api/curriculum/{STAFF_ENDPOINTS[role]}/'
        if visibility:
            path += f'?visibility={visibility}'
        response = self.client.get(path)
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        return body.get('results') if isinstance(body, dict) else body

    def profile_names(self, role, visibility=''):
        return [item.get('name') for item in self.staff_profiles(role, visibility) or []]

    def seed_tree(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        # The wizard save creates both profiles from the tree's staff names.
        self.assertIn('Tutor One', self.profile_names('tutor'))
        self.assertIn('Coach One', self.profile_names('coach'))

    def delete_profile(self, role, name):
        row = views.find_staff_profile_row(role, name, include_archived=True)
        self.assertIsNotNone(row, f'Expected a {role} profile for {name}')
        response = self.client.delete(f'/curriculum_api/curriculum/{STAFF_ENDPOINTS[role]}/{row["id"]}/')
        self.assertEqual(response.status_code, 200, response.content)
        return row['id']

    def test_deleted_tutor_is_not_rebuilt_from_its_module_assignment(self):
        self.seed_tree()
        deleted_id = self.delete_profile('tutor', 'Tutor One')

        self.assertNotIn('Tutor One', self.profile_names('tutor'))

        # The row is gone from the table, not just hidden behind is_archived.
        rows = views.get_staff_profile_rows('tutor', include_archived=True)
        self.assertEqual([row for row in rows if row.get('id') == deleted_id], [])

        # ...and the module no longer claims the deleted tutor, so nothing can
        # derive a stand-in profile from it.
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertTrue(views.is_blank_staff_assignment(module.get('tutor_name')), module.get('tutor_name'))

    def test_deleted_coach_is_not_rebuilt_from_its_group_assignment(self):
        self.seed_tree()
        deleted_id = self.delete_profile('coach', 'Coach One')

        self.assertNotIn('Coach One', self.profile_names('coach'))

        rows = views.get_staff_profile_rows('coach', include_archived=True)
        self.assertEqual([row for row in rows if row.get('id') == deleted_id], [])

        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        self.assertTrue(views.is_blank_staff_assignment(group.get('coach_name')), group.get('coach_name'))

    def test_later_curriculum_write_does_not_resurrect_deleted_staff(self):
        """Any curriculum save re-runs the assignment mirror; it must not undo a delete."""
        self.seed_tree()
        self.delete_profile('tutor', 'Tutor One')
        self.delete_profile('coach', 'Coach One')

        views.rebuild_staff_profile_assignments_from_authoring(allow_writes=True)
        views.invalidate_curriculum_cache()

        self.assertNotIn('Tutor One', self.profile_names('tutor'))
        self.assertNotIn('Coach One', self.profile_names('coach'))

        overview = views.build_curriculum_payload('operational')
        self.assertNotIn('Tutor One', [item.get('name') for item in overview['tutors']])
        self.assertNotIn('Coach One', [item.get('name') for item in overview['coaches']])

    def test_reassigning_the_name_after_a_delete_builds_a_new_profile(self):
        """The delete leaves nothing behind — including nothing that remembers the person.

        Putting the name back on a module is a fresh assignment, not a
        resurrection: the profile is rebuilt from the curriculum under a newly
        minted id. Suppressing it would mean a module that names a tutor could
        not show one.
        """
        self.seed_tree()
        original_id = self.delete_profile('tutor', 'Tutor One')

        views.update_authoring_rows(
            views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', ['MOD-DATA-1'], {'tutor_name': 'Tutor One'},
        )
        views.rebuild_staff_profile_assignments_from_authoring(allow_writes=True)
        views.invalidate_curriculum_cache()

        rebuilt = views.find_staff_profile_row('tutor', 'Tutor One', include_archived=True)
        self.assertIsNotNone(rebuilt)
        self.assertNotEqual(rebuilt['id'], original_id)
        self.assertRegex(rebuilt['id'], r'^TUTOR-\d{14,}$')

    def test_deleted_staff_are_gone_from_the_archive_view_too(self):
        """There is no archived copy to fall back on: the row was deleted."""
        self.seed_tree()
        self.delete_profile('tutor', 'Tutor One')

        remaining = [
            item for item in self.staff_profiles('tutor', visibility='all') or []
            if item.get('name') == 'Tutor One'
        ]
        self.assertEqual(remaining, [])

    def test_recreating_a_deleted_tutor_starts_a_new_row(self):
        """Deleting must not block re-hiring: the person is added again from scratch."""
        created = self.post_json('/curriculum_api/curriculum/tutors/', {
            'name': 'Tutor Rehire',
            'email': 'tutor.rehire@example.com',
        })
        self.assertEqual(created.status_code, 201, created.content)
        created_id = created.json()['profile']['id']

        deleted_id = self.delete_profile('tutor', 'tutor.rehire@example.com')
        self.assertEqual(deleted_id, created_id)
        self.assertNotIn('Tutor Rehire', self.profile_names('tutor'))

        recreated = self.post_json('/curriculum_api/curriculum/tutors/', {
            'name': 'Tutor Rehire',
            'email': 'tutor.rehire@example.com',
        })
        self.assertEqual(recreated.status_code, 201, recreated.content)
        self.assertTrue(recreated.json()['created'])
        self.assertNotEqual(recreated.json()['profile']['id'], created_id)

        self.assertIn('Tutor Rehire', self.profile_names('tutor'))
        rows = views.staff_profile_rows_by_identity(
            'tutor', 'Tutor Rehire', 'tutor.rehire@example.com', include_archived=True,
        )
        self.assertEqual(len(rows), 1)
        self.assertFalse(views.staff_profile_is_archived(rows[0]))

    def test_deleting_one_staff_member_leaves_another_untouched(self):
        self.seed_tree()
        created = self.post_json('/curriculum_api/curriculum/tutors/', {
            'name': 'Tutor Two',
            'email': 'tutor.two@example.com',
        })
        self.assertEqual(created.status_code, 201, created.content)

        self.delete_profile('tutor', 'Tutor One')

        names = self.profile_names('tutor')
        self.assertIn('Tutor Two', names)
        self.assertNotIn('Tutor One', names)


class ReleaseArchivedStaffAssignmentsCommandTests(CurriculumPersistenceHarness):
    """The repair command for staff deleted before the release was wired into DELETE."""

    def seed_tree_with_stale_assignments(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        for role, name in (('tutor', 'Tutor One'), ('coach', 'Coach One')):
            row = views.find_staff_profile_row(role, name, include_archived=True)
            self.assertIsNotNone(row)
            # Archive the profile the way the pre-fix delete did: row only, name left behind.
            views.update_rows(views.staff_profile_table(role), 'id = %s', [row['id']], {'is_archived': True})
        views.invalidate_curriculum_cache()

    def run_command(self, *args):
        out = StringIO()
        call_command('release_archived_staff_assignments', *args, stdout=out)
        return out.getvalue()

    def test_dry_run_reports_without_writing(self):
        self.seed_tree_with_stale_assignments()

        output = self.run_command()

        self.assertIn('Tutor One', output)
        self.assertIn('Coach One', output)
        self.assertIn('Dry run', output)
        self.assertEqual(
            self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['tutor_name'], 'Tutor One',
        )
        self.assertEqual(self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')['coach_name'], 'Coach One')

    def test_apply_releases_the_stale_names(self):
        self.seed_tree_with_stale_assignments()

        output = self.run_command('--apply')

        self.assertIn('Released 2 stale staff assignment(s).', output)
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        self.assertTrue(views.is_blank_staff_assignment(module['tutor_name']), module['tutor_name'])
        self.assertTrue(views.is_blank_staff_assignment(group['coach_name']), group['coach_name'])

    def test_a_rehired_staff_member_keeps_their_assignment(self):
        """An archived duplicate alongside a live row means the name is still in use."""
        self.seed_tree_with_stale_assignments()
        restored = views.find_staff_profile_row('tutor', 'Tutor One', include_archived=True)
        views.insert_row('tutors', views.staff_profile_payload('tutor', {
            'id': 'TUTOR-REHIRED',
            'name': 'Tutor One',
            'email': 'tutor.one@example.com',
        }))
        self.assertTrue(views.staff_profile_is_archived(restored))
        views.invalidate_curriculum_cache()

        output = self.run_command('--apply')

        self.assertNotIn('Tutor One', output)
        self.assertEqual(
            self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['tutor_name'], 'Tutor One',
        )

    def test_active_staff_are_never_released(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)

        output = self.run_command('--apply')

        self.assertIn('No stale staff assignments found.', output)
        self.assertEqual(
            self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['tutor_name'], 'Tutor One',
        )


class PurgeArchivedStaffProfilesCommandTests(CurriculumPersistenceHarness):
    """The repair command for staff the old soft delete left archived in the table."""

    def seed_tree_with_archived_staff(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        for role, name in (('tutor', 'Tutor One'), ('coach', 'Coach One')):
            row = views.find_staff_profile_row(role, name, include_archived=True)
            self.assertIsNotNone(row)
            # Archive the row the way the pre-fix delete did: row kept, name left behind.
            views.update_rows(views.staff_profile_table(role), 'id = %s', [row['id']], {'is_archived': True})
        views.invalidate_curriculum_cache()

    def run_command(self, *args):
        out = StringIO()
        call_command('purge_archived_staff_profiles', *args, stdout=out)
        return out.getvalue()

    def staff_ids(self, role):
        return [row['id'] for row in views.get_staff_profile_rows(role, include_archived=True)]

    def test_dry_run_reports_without_deleting(self):
        self.seed_tree_with_archived_staff()

        output = self.run_command()

        self.assertIn('Tutor One', output)
        self.assertIn('Coach One', output)
        self.assertIn('Dry run', output)
        self.assertEqual(len(self.staff_ids('tutor')), 1)
        self.assertEqual(len(self.staff_ids('coach')), 1)

    def test_apply_deletes_the_rows_and_releases_their_names(self):
        self.seed_tree_with_archived_staff()

        output = self.run_command('--apply')

        self.assertIn('Deleted 2 archived staff profile(s)', output)
        self.assertEqual(self.staff_ids('tutor'), [])
        self.assertEqual(self.staff_ids('coach'), [])
        # The name has to go with the row, or the assignment mirror rebuilds the
        # person as an active profile on the next save.
        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        group = self.row(views.GROUPS_TABLE, 'group_id', 'GROUP-DATA-1')
        self.assertTrue(views.is_blank_staff_assignment(module['tutor_name']), module['tutor_name'])
        self.assertTrue(views.is_blank_staff_assignment(group['coach_name']), group['coach_name'])

        views.rebuild_staff_profile_assignments_from_authoring(allow_writes=True)
        self.assertEqual(self.staff_ids('tutor'), [])
        self.assertEqual(self.staff_ids('coach'), [])

    def test_role_option_limits_the_purge(self):
        self.seed_tree_with_archived_staff()

        self.run_command('--apply', '--role', 'tutor')

        self.assertEqual(self.staff_ids('tutor'), [])
        self.assertEqual(len(self.staff_ids('coach')), 1)

    def test_active_staff_are_never_purged(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)

        output = self.run_command('--apply')

        self.assertIn('No archived staff profiles found.', output)
        self.assertEqual(len(self.staff_ids('tutor')), 1)
        self.assertEqual(len(self.staff_ids('coach')), 1)

    def test_a_rehired_staff_member_keeps_their_assignment(self):
        """An archived duplicate alongside a live row: purge the row, keep the name."""
        self.seed_tree_with_archived_staff()
        views.insert_row('tutors', views.staff_profile_payload('tutor', {
            'name': 'Tutor One',
            'email': 'tutor.one@example.com',
        }))
        views.invalidate_curriculum_cache()

        self.run_command('--apply')

        live = views.get_staff_profile_rows('tutor', include_archived=True)
        self.assertEqual(len(live), 1)
        self.assertFalse(views.staff_profile_is_archived(live[0]))
        self.assertEqual(
            self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')['tutor_name'], 'Tutor One',
        )
