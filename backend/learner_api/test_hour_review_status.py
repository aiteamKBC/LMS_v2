"""Approval classification uses synthetic records; no database or app startup."""
from copy import deepcopy
import unittest

from learner_api.hour_review_status import review_hour_totals


class HourReviewStatusTests(unittest.TestCase):
    def test_completed_unapproved_hours_are_not_a_tutor_marking_backlog(self):
        records = [
            {'accepted': False, 'activity_status': 'completed', 'actual_seconds': 3600, 'reporting_month': '2026-08'},
            {'accepted': False, 'activity_status': 'passed', 'actual_seconds': 1800, 'reporting_month': '2026-08'},
            {'accepted': False, 'activity_status': ' Submitted ', 'actual_seconds': 900, 'reporting_month': '2026-08'},
            {'accepted': True, 'activity_status': 'submitted', 'actual_seconds': 7200, 'reporting_month': '2026-08'},
        ]
        before = deepcopy(records)
        self.assertEqual(review_hour_totals(records, lambda record: [record]), {
            '2026-08': {'submitted_hours': .25, 'verification_hours': 1.5}})
        self.assertEqual(records, before)

    def test_allocations_retain_their_months_and_unknown_time_adds_no_hours(self):
        records = [{'parts': [
            {'accepted': False, 'activity_status': 'pending_review', 'actual_seconds': 1800, 'reporting_month': '2026-09'},
            {'accepted': False, 'activity_status': 'submitted_for_tutor_review', 'actual_seconds': 900, 'reporting_month': '2026-10'},
            {'accepted': False, 'activity_status': '', 'actual_seconds': None, 'reporting_month': '2026-10'},
            {'accepted': False, 'actual_seconds': 500, 'reporting_month': ''},
        ]}]
        self.assertEqual(review_hour_totals(records, lambda record: record['parts']), {
            '2026-09': {'submitted_hours': .5, 'verification_hours': 0},
            '2026-10': {'submitted_hours': .25, 'verification_hours': 0}})
