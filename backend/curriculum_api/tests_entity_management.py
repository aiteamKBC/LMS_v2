"""Cover the canonical operations the entity-based Curriculum pages call.

The redesigned Curriculum area manages Programmes, Cohorts, Groups and Modules
from dedicated pages instead of walking the structure wizard. Those pages call
the per-entity endpoints rather than ``/programmes/tree/``, so the rules the tree
save enforces have to hold on the per-entity path too:

* the persisted hierarchy stays Programme -> Cohort -> Group -> Module, and a
  module's programme/cohort are derived through its group rather than sent
  alongside it;
* a cohort is independently creatable, and its practical end / EPA /
  apprenticeship end dates are calculated the same way the wizard's are;
* assigning a tutor straight onto one module mirrors onto the tutor's profile
  and raises the assignment notification -- the flow the Modules page turns into
  "search module -> edit tutor", which previously only existed inside a tree save.
"""

from unittest.mock import patch

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


class EntityCohortCreationTests(CurriculumPersistenceHarness):
    """`Cohorts -> Add Cohort -> pick Programme -> Save`, with no group step."""

    def create_programme(self, name='Data Analyst', programme_id='PROG-ENTITY'):
        response = self.post_json('/curriculum_api/curriculum/programmes/', {
            'name': name,
            'programId': programme_id,
            'standard': name,
            'level': '4',
        })
        self.assertIn(response.status_code, (200, 201), response.content)
        return response.json()['programme']

    def test_programme_saves_without_any_child_structure(self):
        programme = self.create_programme()
        self.assertTrue(programme.get('sourceId'))

        listing = self.client.get('/curriculum_api/curriculum/programmes/')
        self.assertEqual(listing.status_code, 200, listing.content)
        names = [item.get('name') for item in listing.json()['results']]
        self.assertIn('Data Analyst', names)

    def test_cohort_is_created_against_a_programme_with_no_groups(self):
        programme = self.create_programme()
        response = self.post_json('/curriculum_api/curriculum/cohorts/', {
            'name': 'September 2026',
            'programme': programme['name'],
            'programmeId': programme['sourceId'],
            'startDate': '2026-09-01',
            'durationMonths': 12,
            'epaMonths': 3,
        })
        self.assertEqual(response.status_code, 201, response.content)
        cohort = response.json()['cohort']

        # The practical end date is derived from start + duration, and the
        # apprenticeship end date adds the EPA window on top of it.
        self.assertEqual(cohort['startDate'], '2026-09-01')
        self.assertEqual(cohort['endDate'], cohort['practicalEndDate'])
        self.assertEqual(cohort['epaMonths'], 3)
        self.assertEqual(
            cohort['apprenticeshipEndDate'],
            views.format_date(views.cohort_apprenticeship_end_date(cohort['endDate'], 3, '')),
        )
        # No group step was walked, and none was invented.
        self.assertEqual(cohort.get('groups') or [], [])

    def test_patching_a_cohort_moves_the_apprenticeship_end_date_with_it(self):
        programme = self.create_programme()
        created = self.post_json('/curriculum_api/curriculum/cohorts/', {
            'name': 'September 2026',
            'programme': programme['name'],
            'programmeId': programme['sourceId'],
            'startDate': '2026-09-01',
            'durationMonths': 12,
            'epaMonths': 3,
        }).json()['cohort']

        response = self.patch_json(
            f'/curriculum_api/curriculum/cohorts/{created["id"]}/',
            {'durationMonths': 18},
        )
        self.assertEqual(response.status_code, 200, response.content)

        row = self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', created['id'])
        detail = views.serialize_cohort_authoring_detail(row)
        self.assertEqual(
            detail['endDate'],
            views.format_date(views.calculate_cohort_end_date('2026-09-01', 18)),
        )
        self.assertEqual(
            detail['apprenticeshipEndDate'],
            views.format_date(views.cohort_apprenticeship_end_date(detail['endDate'], 3, '')),
        )


class EntityGroupCreationTests(CurriculumPersistenceHarness):
    """`Groups -> Add Group -> Programme (UI only) -> Cohort -> Save`."""

    def seed_cohort(self):
        self.post_json('/curriculum_api/curriculum/programmes/', {
            'name': 'Data Analyst',
            'programId': 'PROG-ENTITY',
            'level': '4',
        })
        return self.post_json('/curriculum_api/curriculum/cohorts/', {
            'name': 'September 2026',
            'programme': 'Data Analyst',
            'programmeId': 'PROG-ENTITY',
            'startDate': '2026-09-01',
            'durationMonths': 12,
        }).json()['cohort']

    def test_group_parent_is_the_cohort_and_programme_is_inherited(self):
        cohort = self.seed_cohort()
        response = self.post_json('/curriculum_api/curriculum/groups/', {
            'name': 'Group A',
            'cohortId': cohort['id'],
            # The Groups page sends a programme for convenience; the stored
            # parent must still come from the cohort.
            'programmeId': 'SOMETHING-ELSE',
            'coach': 'Coach One',
            'weekDays': 'Wednesday',
            'startTime': '10:00',
            'endTime': '12:00',
        })
        self.assertEqual(response.status_code, 201, response.content)
        group = response.json()['group']

        row = self.row(views.GROUPS_TABLE, 'group_id', group['id'])
        self.assertEqual(views.clean_str(row.get('cohort_id')), cohort['id'])
        self.assertEqual(views.clean_str(row.get('programme_id')), cohort['programmeId'])

        # The cohort now lists the group, which is what makes it reachable
        # through the contextual Programme -> Cohort -> Groups views.
        cohort_row = self.row(views.COHORT_AUTHORING_DETAILS_TABLE, 'cohort_id', cohort['id'])
        self.assertIn(group['id'], views.parse_json_value(cohort_row.get('group_ids'), []))


    def test_a_group_can_be_recreated_after_its_namesake_is_archived(self):
        """Archive Group A, then add Group A to the same cohort again.

        Archiving soft-deletes the row rather than removing it, so the archived
        group is still readable. It must not be mistaken for a duplicate: doing
        so turned the create into an update of the archived row, which left the
        caller with created=False and no group anywhere in the listing.
        """
        cohort = self.seed_cohort()
        first = self.post_json('/curriculum_api/curriculum/groups/', {
            'name': 'Group A',
            'cohortId': cohort['id'],
            'coach': 'Coach One',
        }).json()['group']

        archived = self.client.delete(f'/curriculum_api/curriculum/groups/{first["id"]}/')
        self.assertEqual(archived.status_code, 200, archived.content)

        response = self.post_json('/curriculum_api/curriculum/groups/', {
            'name': 'Group A',
            'cohortId': cohort['id'],
            'coach': 'Coach Two',
        })
        self.assertEqual(response.status_code, 201, response.content)
        body = response.json()
        self.assertTrue(body['created'])
        recreated = body['group']

        # A brand new row, not the tombstone written over.
        self.assertNotEqual(recreated['id'], first['id'])
        self.assertIsNotNone(self.row(views.GROUPS_TABLE, 'group_id', first['id']).get('deleted_at'))
        self.assertIsNone(self.row(views.GROUPS_TABLE, 'group_id', recreated['id']).get('deleted_at'))

        # And it is listed, which is the whole point of creating it again.
        listing = self.client.get('/curriculum_api/curriculum/groups/')
        self.assertEqual(listing.status_code, 200, listing.content)
        listed = [item['id'] for item in listing.json()['results']]
        self.assertIn(recreated['id'], listed)
        self.assertNotIn(first['id'], listed)

    def test_recreating_a_group_leaves_the_archived_one_archived(self):
        cohort = self.seed_cohort()
        first = self.post_json('/curriculum_api/curriculum/groups/', {
            'name': 'Group A', 'cohortId': cohort['id'],
        }).json()['group']
        self.client.delete(f'/curriculum_api/curriculum/groups/{first["id"]}/')
        self.post_json('/curriculum_api/curriculum/groups/', {
            'name': 'Group A', 'cohortId': cohort['id'],
        })

        archived_row = self.row(views.GROUPS_TABLE, 'group_id', first['id'])
        self.assertTrue(views.curriculum_row_effectively_deleted(archived_row))

    def test_a_live_namesake_is_still_a_duplicate(self):
        """The archive carve-out must not turn every create into a new row."""
        cohort = self.seed_cohort()
        first = self.post_json('/curriculum_api/curriculum/groups/', {
            'name': 'Group A', 'cohortId': cohort['id'],
        }).json()['group']

        response = self.post_json('/curriculum_api/curriculum/groups/', {
            'name': 'Group A', 'cohortId': cohort['id'], 'coach': 'Coach Two',
        })
        self.assertEqual(response.status_code, 200, response.content)
        body = response.json()
        self.assertFalse(body['created'])
        self.assertEqual(body['group']['id'], first['id'])


class EntityModuleTests(CurriculumPersistenceHarness):
    """`Modules -> Add Module` and `Modules -> select module -> edit Tutor`."""

    def seed_group(self):
        response = self.post_json('/curriculum_api/curriculum/programmes/tree/', self.tree_payload())
        self.assertEqual(response.status_code, 200, response.content)
        return 'GROUP-DATA-1'

    def test_module_created_from_the_modules_page_hangs_off_its_group(self):
        group_id = self.seed_group()
        response = self.post_json(
            f'/curriculum_api/curriculum/groups/{group_id}/modules/',
            {
                'moduleName': 'Data Modelling',
                'startDate': '2026-09-16',
                'sessionsNumber': 2,
                'weekDays': 'Wednesday',
                'tutor': 'Tutor One',
            },
        )
        self.assertEqual(response.status_code, 200, response.content)
        created = response.json()['created']
        self.assertEqual(len(created), 1)

        catalogue_id = created[0]['catalogueId']
        row = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', catalogue_id)
        # Group is the parent; cohort and programme are derived from it rather
        # than being an independent relationship the page had to supply.
        self.assertEqual(views.clean_str(row.get('group_id')), group_id)
        self.assertEqual(views.clean_str(row.get('cohort_id')), 'COHORT-DATA-1')
        self.assertEqual(views.clean_str(row.get('programme_id')), 'PROG-DATA')

    def test_module_start_date_is_still_validated_against_the_cohort(self):
        group_id = self.seed_group()
        response = self.post_json(
            f'/curriculum_api/curriculum/groups/{group_id}/modules/',
            {'moduleName': 'Too Early', 'startDate': '2026-01-01', 'sessionsNumber': 1},
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('cannot start before', response.json()['error'])

    def test_module_cannot_start_after_the_cohort_has_finished(self):
        group_id = self.seed_group()
        response = self.post_json(
            f'/curriculum_api/curriculum/groups/{group_id}/modules/',
            {'moduleName': 'Too Late', 'startDate': '2027-10-06', 'sessionsNumber': 1, 'weekDays': 'Wednesday'},
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('cannot start after', response.json()['error'])

    def test_module_sessions_cannot_run_past_the_cohort_end_date(self):
        """A start date inside the cohort is not enough on its own.

        The cohort finishes 2027-08-31, so four weekly sessions from 2027-08-25
        land two of them after it. Nothing sends an end date here -- the plan
        generates it -- which is exactly the case the start-date bound misses.
        """
        group_id = self.seed_group()
        response = self.post_json(
            f'/curriculum_api/curriculum/groups/{group_id}/modules/',
            {'moduleName': 'Overruns', 'startDate': '2027-08-25', 'sessionsNumber': 4, 'weekDays': 'Wednesday'},
        )
        self.assertEqual(response.status_code, 400, response.content)
        self.assertIn('cannot finish after', response.json()['error'])
        self.assertNotIn(
            'Overruns',
            [views.clean_str(row.get('title')) for row in views.safe_authoring_module_rows()],
        )

    def test_module_that_fits_inside_the_cohort_is_accepted(self):
        group_id = self.seed_group()
        response = self.post_json(
            f'/curriculum_api/curriculum/groups/{group_id}/modules/',
            {'moduleName': 'Fits', 'startDate': '2027-08-11', 'sessionsNumber': 2, 'weekDays': 'Wednesday'},
        )
        self.assertEqual(response.status_code, 200, response.content)
        catalogue_id = response.json()['created'][0]['catalogueId']
        row = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', catalogue_id)
        self.assertEqual(views.format_date(row.get('start_date')), '2027-08-11')

    def test_patching_a_module_cannot_push_it_outside_the_cohort(self):
        """The edit path carries the same bound as the create path.

        Both ends are checked: a start date before the cohort opens and an end
        date after it closes are each refused, and the stored dates stay put.
        """
        self.seed_group()

        early = self.patch_json(
            '/curriculum_api/curriculum/modules/MOD-DATA-1/',
            {'startDate': '2026-08-05'},
        )
        self.assertEqual(early.status_code, 400, early.content)
        self.assertIn('cannot start before', early.json()['error'])

        late = self.patch_json(
            '/curriculum_api/curriculum/modules/MOD-DATA-1/',
            {'endDate': '2027-09-30'},
        )
        self.assertEqual(late.status_code, 400, late.content)
        self.assertIn('cannot finish after', late.json()['error'])

        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(views.format_date(module.get('start_date')), '2026-09-02')

    def test_editing_a_module_tutor_moves_the_assignment_and_notifies(self):
        """The headline UX win — Modules -> edit Tutor — must still notify.

        The module row is the assignment: there is no staff-side copy of it to
        keep in step, so what this pins is that the row moves and the tutor is
        told.
        """
        self.seed_group()

        with patch.object(views.tutor_notifications, 'schedule_assignment_notifications') as scheduled:
            response = self.patch_json(
                '/curriculum_api/curriculum/modules/MOD-DATA-1/',
                {'tutor': 'Tutor Two'},
            )
        self.assertEqual(response.status_code, 200, response.content)
        self.assertTrue(scheduled.called, 'tutor assignment notification was not scheduled')

        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(views.clean_str(module.get('tutor_name')), 'Tutor Two')

    def test_clearing_a_module_tutor_releases_the_assignment(self):
        self.seed_group()
        response = self.patch_json(
            '/curriculum_api/curriculum/modules/MOD-DATA-1/',
            {'tutor': ''},
        )
        self.assertEqual(response.status_code, 200, response.content)

        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertTrue(views.is_blank_staff_assignment(module.get('tutor_name')), module.get('tutor_name'))

    def test_patching_an_unrelated_field_leaves_the_assignment_alone(self):
        """A rename must not churn the tutor's assignment.

        (It may still *schedule* a notification pass — the dispatcher diffs
        against what has already been sent, so an extra pass mails nobody.)
        """
        self.seed_group()

        response = self.patch_json(
            '/curriculum_api/curriculum/modules/MOD-DATA-1/',
            {'name': 'Data Foundations (revised)'},
        )
        self.assertEqual(response.status_code, 200, response.content)

        module = self.row(views.AUTHORING_MODULES_TABLE, 'module_catalogue_id', 'MOD-DATA-1')
        self.assertEqual(views.clean_str(module.get('title')), 'Data Foundations (revised)')
        self.assertEqual(views.clean_str(module.get('tutor_name')), 'Tutor One')


class TeamsMeetingSummaryTests(CurriculumPersistenceHarness):
    """The Modules page's Teams column reads one grouped row per module.

    Without it the only way to know whether a module has a meeting is to pull
    every module's full week structure and inspect the live-session component's
    settings -- the single heaviest part of the module payload.
    """

    def setUp(self):
        super().setUp()
        views.ensure_live_session_tracking_tables()
        views.authoring_delete(views.LIVE_SESSION_OCCURRENCES_TABLE)
        views.authoring_delete(views.LIVE_SESSIONS_TABLE)

    def seed_module(self, module_id, title='Module'):
        # live_sessions.module_catalogue_id is a real foreign key onto
        # curriculum.modules, so a meeting can only exist for a stored module.
        views.insert_row(views.AUTHORING_MODULES_TABLE, {
            'module_catalogue_id': module_id,
            'programme_id': 'PROG-TEAMS',
            'programme_name': 'Teams Programme',
            'title': title,
        })
        return module_id

    def summary(self, query=''):
        response = self.client.get(f'/curriculum_api/curriculum/teams-meetings/summary/{query}')
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()['results']

    def seed_meeting(self, session_id, module_id, *, status='active', occurrences=()):
        self.seed_module(module_id)
        views.authoring_upsert(views.LIVE_SESSIONS_TABLE, ['id'], {
            'id': session_id,
            'module_catalogue_id': module_id,
            'organizer_email': 'tutor@example.com',
            'join_url': f'https://teams.microsoft.com/{session_id}',
            'start_datetime': '2026-09-02T09:00:00Z',
            'duration_minutes': 120,
            'repeat_pattern': 'weekly',
            'status': status,
        })
        for index, start in enumerate(occurrences, start=1):
            views.authoring_upsert(views.LIVE_SESSION_OCCURRENCES_TABLE, ['id'], {
                'id': f'{session_id}-OCC-{index}',
                'live_session_id': session_id,
                'session_number': index,
                'scheduled_start': start,
                'scheduled_end': start,
                'status': 'scheduled',
            })

    def test_reports_one_row_per_module_with_occurrence_counts(self):
        self.seed_meeting(
            'LIVE-SUMMARY-1',
            'MOD-SUMMARY-1',
            occurrences=('2020-01-01T09:00:00Z', '2099-01-01T09:00:00Z'),
        )

        rows = self.summary()
        self.assertEqual(len(rows), 1)
        row = rows[0]
        self.assertEqual(row['moduleCatalogueId'], 'MOD-SUMMARY-1')
        self.assertEqual(row['liveSessionId'], 'LIVE-SUMMARY-1')
        self.assertEqual(row['occurrenceCount'], 2)
        # One occurrence is in the past, one is not.
        self.assertEqual(row['upcomingCount'], 1)
        self.assertTrue(row['nextOccurrence'].startswith('2099-01-01'))
        self.assertTrue(row['joinUrl'])

    def test_cancelled_meetings_are_not_reported(self):
        self.seed_meeting('LIVE-SUMMARY-2', 'MOD-SUMMARY-2', status='cancelled')
        self.assertEqual(self.summary(), [])

    def test_can_be_narrowed_to_the_modules_a_page_is_showing(self):
        self.seed_meeting('LIVE-SUMMARY-3', 'MOD-SUMMARY-3')
        self.seed_meeting('LIVE-SUMMARY-4', 'MOD-SUMMARY-4')

        rows = self.summary('?module_catalogue_ids=MOD-SUMMARY-4')
        self.assertEqual([row['moduleCatalogueId'] for row in rows], ['MOD-SUMMARY-4'])
