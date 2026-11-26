"""Explicit email preference; no Django setup, credentials, database or network."""
import types
import unittest
from curriculum_api.teams_notification_preferences import lms_email_requested


class LmsEmailPreferenceTests(unittest.TestCase):
    def test_only_explicit_boolean_true_opts_into_lms_email(self):
        self.assertTrue(lms_email_requested(types.SimpleNamespace(body=b'{"sendLmsEmails":true}')))

    def test_missing_and_false_choices_never_send_email(self):
        for body in (b'{}', b'{"peopleOnly":true}', b'{"notifyAttendees":true}', b'{"sendLmsEmails":false}'):
            with self.subTest(body=body):
                self.assertFalse(lms_email_requested(types.SimpleNamespace(body=body)))

    def test_string_and_numeric_values_do_not_opt_into_email(self):
        for value in ('"true"', '"false"', '1', 'null', '[]', '{}'):
            with self.subTest(value=value):
                self.assertFalse(lms_email_requested(types.SimpleNamespace(body=(
                    '{"sendLmsEmails":' + value + '}').encode())))

    def test_missing_or_invalid_request_is_not_an_email_choice(self):
        for request in (None, object(), types.SimpleNamespace(body=b'not-json'), types.SimpleNamespace(body=b'[]')):
            with self.subTest(request=type(request).__name__):
                self.assertFalse(lms_email_requested(request))


if __name__ == '__main__':
    unittest.main()
