from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from .shared_live_delivery import read_shared_live_delivery


class SharedLiveDeliveryTests(SimpleTestCase):
    def test_booked_occurrence_supplies_clock_in_business_timezone(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [
            ('C-SHARED', 'SERIES', 'OCC', 11, datetime(2026, 10, 6, 23, 30),
             datetime(2026, 10, 7, 1, 30), 'GMT Standard Time', 'https://teams.example/override'),
        ]
        with patch('learner_api.shared_live_delivery.connections', {'enrolment': connection}):
            result = read_shared_live_delivery(['ASSIGNED'], ['C-SHARED'])
        self.assertEqual(cursor.execute.call_args.args[1], [['ASSIGNED'], ['C-SHARED']])
        self.assertEqual(result['C-SHARED'], {
            'teamsLiveSessionId': 'SERIES', 'teamsOccurrenceId': 'OCC', 'teamsSessionNumber': 11,
            'sessionDate': '2026-10-07', 'sessionTime': '00:30',
            'sessionDateTimeUtc': '2026-10-06T23:30:00+00:00', 'durationMinutes': 120,
            'liveSessionUrl': 'https://teams.example/override',
        })

    def test_timezone_aware_dates_and_unlinked_components(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchall.return_value = [('C', 'S', 'O', 1,
            datetime(2026, 12, 30, 12, tzinfo=timezone.utc),
            datetime(2026, 12, 30, 14, tzinfo=timezone.utc), '', None)]
        with patch('learner_api.shared_live_delivery.connections', {'enrolment': connection}):
            self.assertEqual(read_shared_live_delivery(['M'], ['C'])['C']['sessionTime'], '12:00')
            cursor.fetchall.return_value = []
            self.assertEqual(read_shared_live_delivery(['M'], ['C']), {})

    def test_empty_assignment_or_component_selection_never_reads_other_modules(self):
        with patch('learner_api.shared_live_delivery.connections') as connections:
            self.assertEqual(read_shared_live_delivery([], ['C']), {})
            self.assertEqual(read_shared_live_delivery(['M'], []), {})
            connections.__getitem__.assert_not_called()

    def test_a_new_pasted_link_requires_the_actual_occurrence_date_and_clock(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        occurrence = ('C', 'S', 'O', 1, datetime(2026, 10, 30, 9), datetime(2026, 10, 30, 11),
                      'GMT Standard Time', 'https://teams.microsoft.com/original', 'unverified')
        with patch('learner_api.shared_live_delivery.connections', {'enrolment': connection}):
            for day, clock in [('2026-10-23', '09:00'), ('2026-10-30', '14:00')]:
                cursor.fetchall.return_value = [(*occurrence, day, clock)]
                self.assertEqual(read_shared_live_delivery(['M'], ['C']), {})
            cursor.fetchall.return_value = [(*occurrence, '2026-10-30', '09:00')]
            self.assertEqual(read_shared_live_delivery(['M'], ['C'])['C']['teamsOccurrenceId'], 'O')
