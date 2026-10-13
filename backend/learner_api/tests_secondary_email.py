from django.test import SimpleTestCase

from learner_api.models import LearnerProfile


class LearnerSecondaryEmailModelTests(SimpleTestCase):
    def test_secondary_email_is_optional_and_is_not_a_login_identifier(self):
        field = LearnerProfile._meta.get_field("secondary_email")

        self.assertTrue(field.null)
        self.assertTrue(field.blank)
        self.assertFalse(field.unique)
        self.assertEqual(field.max_length, 320)
