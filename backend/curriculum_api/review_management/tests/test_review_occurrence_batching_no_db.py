from datetime import date
from unittest.mock import patch
from curriculum_api.review_management.tests.instance_test_support import instance_fixture

from django.test import SimpleTestCase

import curriculum_api.review_management.application.learner_occurrences as review_application_learner_occurrences
import curriculum_api.review_management.infrastructure.instance_rows as review_infrastructure_instance_rows


class ReviewOccurrenceBatchingTests(SimpleTestCase):
    def test_groups_all_template_overrides_from_one_query(self):
        rows = [
            {'review_id': 'REV-1', 'occurrence_date': date(2026, 10, 1), 'action': 'skip'},
            {'review_id': 'REV-2', 'occurrence_date': date(2026, 11, 1), 'action': 'skip'},
        ]
        with instance_fixture('fetch_all', return_value=rows) as fetch:
            grouped = review_infrastructure_instance_rows._fetch_learner_scoped_overrides_for_reviews(
                ['REV-2', 'REV-1', 'REV-1'], 42,
            )

        self.assertEqual(set(grouped), {'REV-1', 'REV-2'})
        self.assertEqual(grouped['REV-1']['2026-10-01']['action'], 'skip')
        self.assertEqual(fetch.call_count, 1)
        self.assertIn('review_id in (%s, %s)', fetch.call_args.args[0])
        self.assertEqual(fetch.call_args.args[1], ['REV-1', 'REV-2', 42])

    def test_programme_projection_passes_prefetched_overrides_to_each_template(self):
        templates = [
            {'id': 'REV-1', 'review_type_id': 'TYPE-1'},
            {'id': 'REV-2', 'review_type_id': 'TYPE-2'},
        ]
        grouped = {'REV-1': {'2026-10-01': {'action': 'skip'}}, 'REV-2': {}}
        with instance_fixture('list_enabled_review_templates', return_value=templates), \
             instance_fixture('review_applies_to_placement', return_value=True), \
             instance_fixture('review_type_index', return_value={}), \
             instance_fixture('_fetch_learner_scoped_overrides_for_reviews', return_value=grouped) as batch, \
             instance_fixture('resolve_learner_occurrences', return_value=[]) as resolve, \
             instance_fixture('resolve_learner_manual_occurrences', return_value=[]):
            review_application_learner_occurrences.resolve_programme_review_occurrences(
                'PROG-1', 42, 'Active', date(2026, 1, 1),
                date(2026, 1, 1), date(2026, 12, 31),
            )

        batch.assert_called_once_with({'REV-1': templates[0], 'REV-2': templates[1]}, 42)
        self.assertEqual(resolve.call_count, 2)
        self.assertEqual(resolve.call_args_list[0].kwargs['overrides_by_date'], grouped['REV-1'])
        self.assertEqual(resolve.call_args_list[1].kwargs['overrides_by_date'], grouped['REV-2'])
