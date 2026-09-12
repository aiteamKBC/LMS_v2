"""Pure parser tests; no database connection or schema setup."""

import unittest
from datetime import date

from aptem_programme_cohorts import parse_programme_intake


class ProgrammeIntakeTests(unittest.TestCase):
    def test_actual_programme_name_formats(self):
        examples = {
            'Marketing Manager Level 6 - Feb 2026': date(2026, 2, 1),
            'Marketing Executive Level 4 - June 2026': date(2026, 6, 1),
            'Level 6 Project Controls Professional Oct.25': date(2025, 10, 1),
            'Oct 2025 Level 4 Marketing Executive': date(2025, 10, 1),
            'Level 4 Marketing Executive - May 25': date(2025, 5, 1),
            'NEW Level 6 Project Controls Professional PCP July 25': date(2025, 7, 1),
            'July 2025- Level 6 Marketing Manager': date(2025, 7, 1),
            'August 2025 - Lv6 Project Controls Professional': date(2025, 8, 1),
            'New Level 6 Marketing Manager Oct.25': date(2025, 10, 1),
        }
        for programme_name, expected in examples.items():
            with self.subTest(programme_name=programme_name):
                result = parse_programme_intake(programme_name)
                self.assertEqual(result.cohort_start, expected)
                self.assertIsNone(result.issue)

    def test_case_spacing_and_short_year(self):
        for name in ('Programme OCTOBER  2025', 'Programme oct-25', 'Programme Oct25'):
            self.assertEqual(parse_programme_intake(name).cohort_name, 'Oct 2025')

    def test_undated_names_are_unresolved(self):
        for name in ('Marketing Manager Level 6 (Onboarding Stage)',
                     'Marketing Manager Level 6 Onboarding v1.1',
                     'Level 4 Marketing Executive', 'Project Control Professional Level 6 - Al Fanar'):
            with self.subTest(name=name):
                result = parse_programme_intake(name)
                self.assertIsNone(result.cohort_start)
                self.assertEqual(result.issue, 'intake_not_in_programme_name')

    def test_missing_programme(self):
        for name in (None, '', ' '):
            self.assertEqual(parse_programme_intake(name).issue, 'missing_programme_name')

    def test_ambiguous_names_are_unresolved(self):
        result = parse_programme_intake('Programme Feb 2025 / June 2025')
        self.assertIsNone(result.cohort_start)
        self.assertEqual(result.issue, 'multiple_intakes_in_programme_name')

    def test_repeated_same_intake_is_unambiguous(self):
        self.assertEqual(parse_programme_intake('Feb 2025 - February 25').cohort_name, 'Feb 2025')

    def test_level_version_and_long_number_are_not_years(self):
        for name in ('Marketing Level 6 v1.1', 'Programme October 20250'):
            self.assertIsNone(parse_programme_intake(name).cohort_start)


if __name__ == '__main__':
    unittest.main()
