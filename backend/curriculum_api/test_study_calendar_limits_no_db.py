"""Long calendars, bounded provider paging and legacy limits; no live I/O."""
from datetime import datetime, timedelta, timezone
from unittest.mock import Mock, patch
from django.test import SimpleTestCase
from . import views
from .meetings.infrastructure import invitation_runtime
from .catalogue.tests.parity.composition_test_support import composition_fixture
from .teams_calendar_checks import CalendarMismatch, calendar_targets, local_calendar_recurrence, read_calendar_instances


class StudyCalendarLimitTests(SimpleTestCase):
    def test_only_the_saved_new_layout_can_raise_the_review_limit(self):
        for row, weeks, expected in ((None, 0, 52), ({'weeks_number': 104, 'week_starts_on': 'Monday'}, 104, 52),
                                     ({'weeks_number': 0, 'week_boundary_mode': 'calendar'}, 16, 112),
                                     ({'weeks_number': 1, 'week_boundary_mode': 'calendar'}, 104, 728)):
            with self.subTest(row=row), composition_fixture(views, 'authoring_module_exists', return_value=row), \
                 patch.object(invitation_runtime, '_authored_week_count', return_value=weeks) as read_weeks:
                self.assertEqual(views.teams_module_session_limit('MODULE'), expected)
                if row and row.get('week_boundary_mode') == 'calendar':
                    read_weeks.assert_called_once_with('MODULE')
                else:
                    read_weeks.assert_not_called()

    def test_week_reader_uses_current_rows_without_schema_bootstrap(self):
        rows = [{'id': 'ACTIVE', 'status': 'active'}, {'id': 'NULL', 'status': None},
                {'id': 'INACTIVE', 'status': 'inactive'}, {'id': 'ARCHIVED', 'status': 'archived'}]
        with patch.object(invitation_runtime, 'authoring_fetch_all', return_value=rows) as read:
            self.assertEqual(invitation_runtime._authored_week_count('MODULE'), 2)
        read.assert_called_once_with('weeks', 'module_catalogue_id = %s', ['MODULE'],
                                     columns=('id', 'status'), ensure_tables=False)

    def test_112_sessions_are_complete_while_legacy_and_nonrecurring_limits_stay_in_force(self):
        start = datetime(2027, 3, 1, 9, tzinfo=timezone.utc)
        payload = {'scheduledOccurrences': [{'sessionNumber': i + 1, 'startDateTimeUtc': (start + timedelta(days=i)).isoformat()}
                                            for i in range(112)]}
        targets = calendar_targets(payload, start, 60, 'weekly', 112, 'UTC', max_sessions=112)
        self.assertEqual(len(targets), 112)
        self.assertEqual(local_calendar_recurrence(targets, 'weekly', 'UTC', 'UTC', max_sessions=112)['range']['numberOfOccurrences'], 112)
        with self.assertRaisesRegex(ValueError, 'maximum of 52'):
            calendar_targets(payload, start, 60, 'weekly', 112, 'UTC')
        with self.assertRaisesRegex(ValueError, '52 recurrence slots'):
            local_calendar_recurrence(targets, 'weekly', 'UTC', 'UTC')
        with self.assertRaisesRegex(ValueError, 'one session'):
            calendar_targets(payload, start, 60, 'none', 112, 'UTC', max_sessions=112)
        payload['scheduledOccurrences'].append({'sessionNumber': 113, 'startDateTimeUtc': (start + timedelta(days=112)).isoformat()})
        with self.assertRaisesRegex(ValueError, 'maximum of 112'):
            calendar_targets(payload, start, 60, 'weekly', 113, 'UTC', max_sessions=112)

    def test_large_calendars_still_reject_duplicate_numbers_and_overlapping_times(self):
        start = datetime(2027, 3, 1, 9, tzinfo=timezone.utc)
        for second, message in (({'sessionNumber': 1, 'startDateTimeUtc': (start + timedelta(days=1)).isoformat()}, 'unique'),
                                ({'sessionNumber': 2, 'startDateTimeUtc': (start + timedelta(minutes=30)).isoformat()}, 'overlap')):
            with self.subTest(second=second), self.assertRaisesRegex(ValueError, message):
                calendar_targets({'scheduledOccurrences': [{'sessionNumber': 1, 'startDateTimeUtc': start.isoformat()}, second]},
                                 start, 60, 'weekly', 2, 'UTC', max_sessions=728)


class CalendarPagingTests(SimpleTestCase):
    resource = 'users/synthetic%40example.invalid/events/MASTER/instances'

    def test_reads_every_instance_and_preserves_the_opaque_continuation_query(self):
        query = '%24skiptoken=A%2BB%2F%3D'
        read = Mock(side_effect=[{'value': [{'id': f'I{i}'} for i in range(200)],
                                 '@odata.nextLink': 'https://graph.microsoft.com/v1.0/' + self.resource + '?' + query},
                                {'value': [{'id': f'I{i}'} for i in range(200, 728)]}])
        values = read_calendar_instances(read, self.resource + '?%24top=200')
        self.assertEqual([item['id'] for item in values], [f'I{i}' for i in range(728)])
        self.assertEqual(read.call_args_list[1].args, ('GET', self.resource + '?' + query))

    def test_foreign_or_malformed_continuations_are_rejected_before_following(self):
        for following in ('https://evil.invalid/v1.0/' + self.resource + '?skip=1',
                          'https://graph.microsoft.com/v1.0/users/other/events/MASTER/instances?skip=1',
                          'https://graph.microsoft.com/v1.0/' + self.resource.replace('MASTER', 'OTHER') + '?skip=1',
                          'http://graph.microsoft.com/v1.0/' + self.resource + '?skip=1',
                          'https://graph.microsoft.com/beta/' + self.resource + '?skip=1',
                          self.resource + '?skip=1#fragment', 'unrelated-page', {'bad': 'url'}):
            with self.subTest(following=following):
                read = Mock(return_value={'value': [{'id': 'I1'}], '@odata.nextLink': following})
                with self.assertRaises(CalendarMismatch):
                    read_calendar_instances(read, self.resource + '?top=200')
                self.assertEqual(read.call_count, 1)

    def test_repeated_pages_duplicate_ids_and_oversized_responses_fail_visibly(self):
        for pages in ([{'value': [], '@odata.nextLink': self.resource + '?skip=1'}] * 2,
                      [{'value': [{'id': 'I1'}], '@odata.nextLink': self.resource + '?skip=1'}, {'value': [{'id': 'I1'}]}],
                      [{'value': [{'id': f'I{i}'} for i in range(1001)]}],
                      [{'value': [{'id': []}]}], [None],
                      [{'value': [], '@odata.nextLink': self.resource + f'?skip={index}'} for index in range(65)]):
            with self.subTest(pages=len(pages)):
                read = Mock(side_effect=pages)
                with self.assertRaises(CalendarMismatch):
                    read_calendar_instances(read, self.resource + '?top=200')
