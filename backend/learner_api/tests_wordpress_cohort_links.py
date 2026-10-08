"""No-database checks for staging verified WordPress course progress."""

from unittest.mock import patch

from django.test import SimpleTestCase

from login.management.commands.sync_wordpress_cohort_links import fetch_page

from .wordpress_cohort_links import collect_page, identity_index, verified_link


def source_group(source_id, email, completed):
    activities = [{'activity_id': number, 'title': f'Lesson {number}',
                   'activity_type': 'video'} for number in range(1, 9)]
    results = [{'activity_id': number,
                'status': 'completed' if number <= completed else 'not_started',
                'quiz_result': {'answers': [{'private': 'never store this'}]}}
               for number in range(1, 9)]
    return {'group_id': 50, 'group_name': 'Example course', 'activities': activities,
            'learners': [{'learner_id': source_id, 'learner_email': email,
                          'activity_results': results}]}


class WordPressCohortLinkTests(SimpleTestCase):
    def setUp(self):
        self.profiles = {
            '10': {'id': 1, 'enrolment_id': 100, 'email': 'first@example.invalid'},
            '20': {'id': 2, 'enrolment_id': 200, 'email': 'second@example.invalid'},
        }

    def test_exact_saved_identity_and_email_do_not_accept_another_learner(self):
        exact, fallback, known = identity_index(self.profiles, [
            (10, '7', 'first@example.invalid', True),
            (20, '8', 'second@example.invalid', True),
        ])
        matches = {}
        collect_page({'groups': [source_group(7, 'wrong@example.invalid', 8),
                                 source_group(8, 'second@example.invalid', 6)]},
                     exact, fallback, known, matches)
        self.assertNotIn('10', matches)
        self.assertEqual(set(matches), {'20'})
        result = verified_link('20', self.profiles['20'], matches['20'])
        self.assertEqual(result['match_status'], 'verified')
        self.assertEqual(result['eligible_course_count'], 1)
        self.assertEqual(result['courses'][0]['completedActivities'], 6)
        self.assertNotIn('private', str(result))
        self.assertNotIn('second@example.invalid', str(result))

    def test_email_only_fallback_for_missing_identity_requires_one_source_id(self):
        exact, fallback, known = identity_index(self.profiles, [(10, '7', 'first@example.invalid', True)])
        matches = {}
        collect_page({'groups': [source_group(9, 'second@example.invalid', 5)]},
                     exact, fallback, known, matches)
        five = verified_link('20', self.profiles['20'], matches['20'], fallback_identity=True)
        self.assertEqual((five['match_status'], five['eligible_course_count'],
                          five['enrolled_course_count']), ('verified', 0, 1))
        collect_page({'groups': [source_group(10, 'second@example.invalid', 8)]},
                     exact, fallback, known, matches)
        ambiguous = verified_link('20', self.profiles['20'], matches['20'], fallback_identity=True)
        self.assertEqual(ambiguous['match_status'], 'ambiguous')
        self.assertEqual(ambiguous['courses'], [])

    def test_duplicate_membership_merges_completion_without_double_counting(self):
        exact, fallback, known = identity_index(self.profiles, [(10, '7', 'first@example.invalid', True)])
        matches = {}
        collect_page({'groups': [source_group(7, 'first@example.invalid', 6),
                                 source_group(7, 'first@example.invalid', 5)]},
                     exact, fallback, known, matches)
        result = verified_link('10', self.profiles['10'], matches['10'])
        self.assertEqual(result['courses'][0]['completedActivities'], 6)
        self.assertEqual(len(result['courses'][0]['activities']), 8)

    def test_transport_retry_does_not_retry_invalid_source_data(self):
        with patch('login.management.commands.sync_wordpress_cohort_links._page',
                   side_effect=[OSError('interrupted'), {'groups': []}]) as read, \
                patch('login.management.commands.sync_wordpress_cohort_links.sleep'):
            self.assertEqual(fetch_page('https://example.invalid', 'secret', 1), {'groups': []})
            self.assertEqual(read.call_count, 2)
        with patch('login.management.commands.sync_wordpress_cohort_links._page',
                   side_effect=ValueError('invalid data')) as read:
            with self.assertRaises(ValueError):
                fetch_page('https://example.invalid', 'secret', 1)
            read.assert_called_once()
