"""Created_users."Attendance_type" mapping and validation; no database access."""
from types import SimpleNamespace

from django.test import SimpleTestCase

from .mappers import (
    APTEM_TEXT_FIELDS,
    ValidationError,
    restrict_to_self_writable,
    to_edit_fields,
    write_commercial_fields,
    write_fields,
)
from .models import EnrolmentUser


class AttendanceTypeTests(SimpleTestCase):
    def test_exact_database_column(self):
        self.assertEqual(EnrolmentUser._meta.get_field("attendance_type").column, "Attendance_type")

    def test_both_choices_are_stored_as_given(self):
        for value in ("Recorded", "Not recorded"):
            with self.subTest(value=value):
                self.assertEqual(write_fields({"attendanceType": value})["attendance_type"], value)
                self.assertEqual(write_commercial_fields({"attendanceType": value})["attendance_type"], value)

    def test_blank_and_null_clear_to_null(self):
        # The column's CHECK admits NULL but not '', so a cleared select must
        # reach the database as NULL.
        for value in ("", None):
            with self.subTest(value=value):
                self.assertIsNone(write_fields({"attendanceType": value})["attendance_type"])
                self.assertIsNone(write_commercial_fields({"attendanceType": value})["attendance_type"])

    def test_omitted_leaves_column_untouched(self):
        self.assertNotIn("attendance_type", write_fields({"phone": "07123456789"}))
        created = write_fields({"username": "New Learner", "email": "new@example.test"}, require_create=True)
        self.assertNotIn("attendance_type", created)

    def test_unknown_value_is_rejected(self):
        for value in ("recorded", "Live", "Yes"):
            with self.subTest(value=value), self.assertRaises(ValidationError):
                write_fields({"attendanceType": value})

    def test_edit_prefill_round_trips(self):
        user = SimpleNamespace(**{attr: None for attr in APTEM_TEXT_FIELDS.values()})
        for attr in (
            "id", "username", "email", "phone_number", "date_of_birth", "type", "status",
            "programme", "cohort", "group", "employer", "employer_id", "organization",
            "line_manager", "learner_type", "invite_to_platform", "allow_access_to_checkpoint",
            "allow_access_to_console", "allow_access_to_classic", "programme_status",
        ):
            setattr(user, attr, None)
        user.id = 1
        user.attendance_type = "Not recorded"
        self.assertEqual(to_edit_fields(user)["attendanceType"], "Not recorded")

    def test_learner_cannot_set_it_on_themselves(self):
        allowed, rejected = restrict_to_self_writable({"attendanceType": "Recorded"})
        self.assertNotIn("attendanceType", allowed)
        self.assertIn("attendanceType", rejected)
