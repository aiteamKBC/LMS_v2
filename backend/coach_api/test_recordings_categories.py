from datetime import datetime, timezone
from unittest.mock import patch

from django.core.cache import cache
from django.test import SimpleTestCase
from coach_api import recordings_categories as categories

START = datetime(2026, 10, 22, 9, tzinfo=timezone.utc)
END = START.replace(hour=10)
LINK = 'https://teams.microsoft.com/l/meetup-join/synthetic'


class CategoryTests(SimpleTestCase):
    def setUp(self):
        cache.clear()
        self.event = {'id': 'coach-copy', 'start': {'dateTime': START.isoformat()},
            'end': {'dateTime': END.isoformat()}, 'onlineMeeting': {'joinUrl': LINK}}

    def test_original_calendar_titles_are_categorised_without_claiming_booking_matches(self):
        for title, expected in [('Monthly Coaching Meeting with Sample Coach', 'MCM'),
                ('Sample Learner - Monthly Coaching Review', 'MCM'), ('MCM - sample', 'MCM'),
                ('Sample - Progress Review', 'PR'), ('BR appointment', 'PR'),
                ('Learner support session', 'SUPPORT'), ('Student Support', 'SUPPORT'),
                ('Portfolio discussion', 'OTHER'), ('MCM and Progress Review', 'OTHER')]:
            row = {'title': title, 'family': None}
            self.assertEqual(categories.category(row, self.event, [])[0], expected)
            self.assertIsNone(row['family'])

    def test_a_subject_title_alone_does_not_prove_a_curriculum_lecture(self):
        self.assertEqual(categories.category({'title': 'Project Management', 'family': None}, self.event, []), ('OTHER', 'other'))

    def test_curriculum_matching_uses_verified_identity_and_same_utc_occurrence(self):
        lectures = [{'event': 'organizer-copy', 'link': categories.meeting_key(LINK), 'start': START, 'end': END}]
        row = {'title': 'Martech - Thur', 'family': None}
        self.assertEqual(categories.category(row, self.event, lectures), ('LECTURE', 'curriculum'))
        for changed in ({'start': START.replace(day=21)}, {'link': '/l/meetup-join/another'}):
            self.assertEqual(categories.category(row, self.event, [{**lectures[0], **changed}]), ('OTHER', 'other'))
        self.assertEqual(categories.category({**row, 'family': 'MCM'}, self.event, lectures), ('MCM', 'lms-booking'))

    def test_lecture_dates_follow_existing_utc_storage_and_one_cached_read(self):
        with patch.object(categories.router, 'db_for_read', return_value='default'), \
                patch.object(categories.connections['default'], 'cursor') as connection:
            cursor = connection.return_value.__enter__.return_value
            cursor.fetchall.return_value = [('event', LINK, START.replace(tzinfo=None), END.replace(tzinfo=None))]
            result = categories.lecture_occurrences(START, END)
            self.assertEqual(result[0]['start'], START)
            self.assertEqual(result[0]['end'], END)
            self.assertEqual(categories.lecture_occurrences(START, END), result)
            cursor.execute.assert_called_once()
            self.assertEqual(cursor.execute.call_args.args[1], [END.replace(tzinfo=None), START.replace(tzinfo=None)])
