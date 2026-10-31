from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from . import models
from . import calendar


class CreatedUsersProgrammeReferenceTests(SimpleTestCase):
    def source_with_deferred_programme(self):
        source = models.EnrolmentUser(id=7)
        source.__dict__.pop("programme", None)
        source._state.db = "enrolment"
        return source

    def attach(self, *, uses_fk, value):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (value,)
        source = self.source_with_deferred_programme()
        with patch.object(models, "connections", {"enrolment": connection}), patch.object(
            models, "created_users_uses_programme_fk", return_value=uses_fk,
        ):
            result = models.attach_programme_name(source)
        return source, result, cursor

    def test_normalized_schema_resolves_the_fk_to_the_display_name(self):
        source, result, cursor = self.attach(uses_fk=True, value="Data Programme")

        self.assertIs(result, source)
        self.assertEqual(source.programme, "Data Programme")
        self.assertIn("u.programme_id", cursor.execute.call_args.args[0])

    def test_legacy_schema_reads_the_existing_display_column(self):
        source, _, cursor = self.attach(uses_fk=False, value="Legacy Programme")

        self.assertEqual(source.programme, "Legacy Programme")
        self.assertIn('"Programme"', cursor.execute.call_args.args[0])

    def test_already_loaded_programme_needs_no_database_lookup(self):
        source = models.EnrolmentUser(id=7, programme="Loaded Programme")
        connection = MagicMock()
        with patch.object(models, "connections", {"enrolment": connection}):
            models.attach_programme_name(source)

        self.assertEqual(source.programme, "Loaded Programme")
        connection.cursor.assert_not_called()

    def test_calendar_profile_reuses_normalized_canonical_programme_projection(self):
        owner = {
            'id': 70, 'enrolment_id': 7, 'aptem_id': None,
            'name': 'Synthetic Learner', 'email': 'learner@example.test',
            'lifecycle_status': 'active', 'learner_type': 'commercial',
            'programme': 'Data Programme', 'programme_id': 'P1',
            'programme_status': 'In learning', 'cohort': 'Cohort',
            'cohort_id': 'C1', 'group_name': 'Group', 'group_id': 'G1',
            'coach_name': 'Coach', 'coach_email': 'coach@example.test',
            'start_date': None, 'end_date': None,
        }
        with patch('learner_api.canonical_learning.profile', return_value=owner):
            profile = calendar._calendar_profile(models.EnrolmentUser(id=7), 7)

        self.assertEqual(profile.programme, 'Data Programme')
        self.assertEqual(profile.programme_id, 'P1')
