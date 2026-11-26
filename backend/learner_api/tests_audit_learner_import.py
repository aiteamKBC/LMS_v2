"""Mapping audit-snapshot programme titles onto authored programmes.

``Last_audit.learners.programme_name`` is a cohort-flavoured title -- 21
variants across the active rows for four actual programmes -- so the import has
to recognise the qualification inside the title. Getting it wrong files a
learner under a programme they are not on, which is not visible in the import
output: the counts still add up.
"""
from django.test import SimpleTestCase

from .management.commands.import_audit_learners import PROGRAMME_RULES, target_programme

ME = "Marketing Executive Level 4"
MM = "Marketing Manager Level 6"
PCP = "Project Controls Professional Level 6"
APM = "Associate Project Manager Level 4"


class TargetProgrammeTests(SimpleTestCase):
    def test_every_live_marketing_executive_title(self):
        for title in (
            "Level 4 Marketing Executive - May 25",
            "Marketing Executive Level 4 - June 2026",
            "Marketing Executive Level 4 - Feb 2026",
            "Oct 2025 Level 4 Marketing Executive",
            "July 2025- Level 4 Marketing Executive",
            "Level 4 Marketing Executive",
            "Marketing Executive Level 4 (Onboarding Stage)",
            "Marketing Executive Level 4 Onboarding v1.1",
        ):
            self.assertEqual(target_programme(title), ME, title)

    def test_market_research_executive_is_the_same_qualification(self):
        # The Level 4 marketing qualification under its older name.
        self.assertEqual(target_programme("Level 4 Market Research Executive"), ME)

    def test_every_live_marketing_manager_title(self):
        for title in (
            "Marketing Manager Level 6 - Feb 2026",
            "New Level 6 Marketing Manager Oct.25",
            "Marketing Manager Level 6 - June 2026",
            "Level 6 Marketing Manager - May 25",
            "July 2025- Level 6 Marketing Manager",
            "Oct 2025 Level 6 Marketing Manager",
            "Marketing Manager Level 6 (Onboarding Stage)",
            "Marketing Manager Level 6 Onboarding v1.1",
        ):
            self.assertEqual(target_programme(title), MM, title)

    def test_every_live_project_controls_title(self):
        for title in (
            "Project Controls Professional Level 6 - Feb 2026",
            "Level 6 Project Controls Professional PCP - May 25",
            "NEW Level 6 Project Controls Professional PCP July 25",
            "Level 6 Project Controls Professional Oct.25",
            "Project Controls Professional Level 6 - June 2026",
            "Level 6 Project Controls Professional",
            "August 2025 - Lv6 Project Controls Professional",
            "Project Controls Professional Level 6 (Onboarding Stage)",
            "Project Controls Professional Level 6 Onboarding v1.1",
        ):
            self.assertEqual(target_programme(title), PCP, title)

    def test_every_live_associate_project_manager_title(self):
        for title in (
            "Associate Project Manager Level 4 - Feb 2026",
            "Associate Project Manager Level 4 - June 2026",
            "Level 4 Associate Project Manager Oct.25",
            "Associate Project Manager Level 4 (Onboarding Stage)",
        ):
            self.assertEqual(target_programme(title), APM, title)

    def test_associate_project_manager_is_not_read_as_project_controls(self):
        # The two share "project", and APM is checked first for exactly this
        # reason. Reversing the rule order would silently move nine learners
        # onto the wrong programme.
        self.assertEqual(target_programme("Associate Project Manager Level 4"), APM)

    def test_apm_is_matched_before_project_controls(self):
        # Asserts the ordering the case above depends on, rather than the
        # symptom, so a reordering fails here too.
        order = [programme for _needles, programme in PROGRAMME_RULES]
        self.assertLess(order.index(APM), order.index(PCP))

    def test_an_unrecognised_title_maps_to_nothing(self):
        # Reported and skipped by the caller: filing somebody under a guessed
        # programme is worse than leaving them out.
        for title in ("Level 3 Business Administrator", "Data Analyst L4", "Some New Standard"):
            self.assertEqual(target_programme(title), "", title)

    def test_a_blank_title_maps_to_nothing(self):
        for value in (None, "", "   ", "None"):
            self.assertEqual(target_programme(value), "", repr(value))

    def test_matching_ignores_case_and_spacing(self):
        self.assertEqual(target_programme("  MARKETING MANAGER LEVEL 6  "), MM)
        self.assertEqual(target_programme("pcp level 6"), PCP)
