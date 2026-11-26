from django.test import SimpleTestCase

from .learner_exclusions import is_excluded_learner, normalize_learner_name


class LearnerExclusionTests(SimpleTestCase):
    def test_all_requested_names_are_excluded(self):
        names = [
            "Joseph Bailey",
            "Wemimo Buwanhot",
            "Jackson Cyprian",
            "Freya Johnson",
            "Colleen Stewart",
            "Celine Ababio",
            "Joanna Furnival",
            "Amber Deacon",
        ]
        for name in names:
            with self.subTest(name=name):
                self.assertTrue(is_excluded_learner(learner_name=name))

    def test_known_aptem_ids_are_excluded_without_a_name(self):
        for aptem_id in (3687, 4147, 4576, 6450, 6943, 9115):
            with self.subTest(aptem_id=aptem_id):
                self.assertTrue(is_excluded_learner(aptem_id=aptem_id))

    def test_name_matching_ignores_case_and_repeated_whitespace(self):
        self.assertEqual(normalize_learner_name("  CELINE   Ababio "), "celine ababio")
        self.assertTrue(is_excluded_learner(learner_name="  CELINE   Ababio "))

    def test_unlisted_learner_is_not_excluded(self):
        self.assertFalse(is_excluded_learner(12345, "Included Learner"))
