"""A module's week count and its session count are two numbers, stored apart.

`sessions_number` used to carry both. For a group delivering one day a week they
agree, so nothing looked wrong -- but a Mon+Thu group runs two sessions for every
authored week, and the single column made each save round-trip through the Edit
module drawer multiply the weeks shown by the delivery days (5 -> 10 -> 20 -> 40).

These tests pin the split at the boundary that broke: what a PATCH stores, and
what the next read hands back to the drawer. Asserted through the endpoints
rather than the helpers, because the bug was never in the arithmetic -- it was in
one field being asked to mean two things on the way in and out.
"""

import json

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


class WeeksAndSessionsAreStoredApart(CurriculumPersistenceHarness):
    """The counts a module carries, and which of them each feature reads."""

    def create_module(self, *, week_days='Monday, Thursday', weeks=5, sessions=10):
        response = self.client.post(
            '/curriculum_api/curriculum/modules/',
            data=json.dumps({
                'name': 'Delivered Twice A Week',
                'moduleType': 'authoring',
                'sourceType': 'authoring',
                'programmeId': 'PROG-SPLIT',
                'programmeName': 'Split Programme',
                'weeks': weeks,
                'sessionsNumber': sessions,
                'weekDays': week_days,
                'startDate': '2026-09-07',
            }),
            content_type='application/json',
        )
        self.assertIn(response.status_code, (200, 201), response.content)
        body = json.loads(response.content)
        catalogue_id = (
            body.get('moduleCatalogueId')
            or body.get('catalogueId')
            or (body.get('module') or {}).get('catalogueId')
            or (body.get('module') or {}).get('moduleCatalogueId')
        )
        self.assertTrue(catalogue_id, body)
        return catalogue_id

    def stored_row(self, catalogue_id):
        rows = views.authoring_fetch_all(
            views.AUTHORING_MODULES_TABLE, 'module_catalogue_id = %s', [catalogue_id],
        )
        self.assertTrue(rows, f'no stored row for {catalogue_id}')
        return rows[0]

    def test_creating_a_module_keeps_the_two_counts_distinct(self):
        catalogue_id = self.create_module(weeks=5, sessions=10)
        row = self.stored_row(catalogue_id)

        self.assertEqual(views.parse_int(row.get('weeks_number'), 0), 5)
        self.assertEqual(views.parse_int(row.get('sessions_number'), 0), 10)

    def test_editing_the_weeks_does_not_multiply_them_on_the_way_back(self):
        # The reported bug, end to end: type 5 into "Weeks" on a Mon+Thu module,
        # save, reopen. The drawer used to offer 10, then 20, then 40.
        catalogue_id = self.create_module(weeks=8, sessions=16)

        for _ in range(3):
            response = self.client.patch(
                f'/curriculum_api/curriculum/modules/{catalogue_id}/',
                data=json.dumps({'weeks': 5, 'sessionsNumber': 10}),
                content_type='application/json',
            )
            self.assertEqual(response.status_code, 200, response.content)

            structure = views.get_authoring_structure_payload(catalogue_id)
            self.assertEqual(structure.get('weeks'), 5)
            self.assertEqual(structure.get('sessionsNumber'), 10)

    def test_a_patch_that_only_renames_leaves_both_counts_alone(self):
        catalogue_id = self.create_module(weeks=6, sessions=12)

        response = self.client.patch(
            f'/curriculum_api/curriculum/modules/{catalogue_id}/',
            data=json.dumps({'name': 'Renamed Only'}),
            content_type='application/json',
        )
        self.assertEqual(response.status_code, 200, response.content)

        row = self.stored_row(catalogue_id)
        self.assertEqual(views.parse_int(row.get('weeks_number'), 0), 6)
        self.assertEqual(views.parse_int(row.get('sessions_number'), 0), 12)

    def test_the_session_plan_runs_to_the_sessions_not_the_weeks(self):
        # What the Teams series and the calendar are built from. Reading the week
        # count here produced half the meetings a twice-weekly module needs.
        catalogue_id = self.create_module(weeks=5, sessions=10)
        row = self.stored_row(catalogue_id)

        self.assertEqual(views.module_stored_session_count(row), 10)
        self.assertEqual(views.module_stored_week_count(row), 5)

    def test_a_row_predating_the_split_reads_its_weeks_back_out_of_its_sessions(self):
        # weeks_number is NULL for every row written before the column existed.
        # A Mon+Thu row holding 10 sessions is 5 weeks, not 10.
        legacy = {'sessions_number': 10, 'session_week_day': 'Monday, Thursday', 'weeks_number': None}

        self.assertEqual(views.module_stored_week_count(legacy), 5)
        self.assertEqual(views.module_stored_session_count(legacy), 10)

    def test_a_legacy_single_day_row_is_unchanged_by_the_split(self):
        # The case that always agreed, and must keep agreeing.
        legacy = {'sessions_number': 6, 'session_week_day': 'Monday', 'weeks_number': None}

        self.assertEqual(views.module_stored_week_count(legacy), 6)
        self.assertEqual(views.module_stored_session_count(legacy), 6)

    def test_authored_week_rows_win_over_a_derived_guess(self):
        legacy = {'sessions_number': 10, 'session_week_day': 'Monday, Thursday', 'weeks_number': None}

        self.assertEqual(views.module_stored_week_count(legacy, week_count=7), 7)

    def test_delivery_days_never_reads_as_zero(self):
        # A zero would divide the week count away entirely.
        for value in ('', None, ',', ' , '):
            self.assertEqual(views.delivery_days_per_week({'session_week_day': value}), 1, value)
        self.assertEqual(views.delivery_days_per_week({'session_week_day': 'Monday, Thursday'}), 2)
        self.assertEqual(views.delivery_days_per_week({'session_week_day': 'Mon,Tue,Wed'}), 3)

    def test_two_live_sessions_in_one_week_get_distinct_delivery_dates(self):
        """Each live component uses its delivery slot, not the week's first date."""
        module_id = 'MOD-TWO-SESSIONS-SAME-WEEK'
        views.authoring_upsert(views.AUTHORING_MODULES_TABLE, ['module_catalogue_id'], {
            'module_catalogue_id': module_id,
            'programme_id': 'PROG-SPLIT',
            'programme_name': 'Split Programme',
            'title': 'Monday and Wednesday module',
            'weeks_number': 2,
            'sessions_number': 4,
            'start_date': '2026-09-07',
            'session_week_day': 'Monday, Wednesday',
            'session_start_time': '09:00',
            'session_end_time': '10:00',
        })
        for week_number in (1, 2):
            week_id = f'WEEK-TWICE-{week_number}'
            views.authoring_upsert(views.AUTHORING_WEEKS_TABLE, ['id'], {
                'id': week_id,
                'module_catalogue_id': module_id,
                'week_number': week_number,
                'display_order': week_number,
                'title': f'Week {week_number}',
            })
            for slot in (1, 2):
                views.authoring_upsert(views.AUTHORING_COMPONENTS_TABLE, ['id'], {
                    'id': f'COMP-TWICE-{week_number}-{slot}',
                    'week_id': week_id,
                    'module_catalogue_id': module_id,
                    'type': 'live_session',
                    'title': f'Live session {slot}',
                    'display_order': slot,
                    'settings_json': views.json_db_value({}),
                })

        payload = views.get_authoring_structure_payload(module_id)
        visible_dates = [
            component['settings'].get('sessionDate') or week['sessionDate']
            for week in payload['weekStructure']
            for component in week['components']
            if component['type'] == 'live-session'
        ]

        self.assertEqual(
            visible_dates,
            ['2026-09-07', '2026-09-09', '2026-09-14', '2026-09-16'],
        )
