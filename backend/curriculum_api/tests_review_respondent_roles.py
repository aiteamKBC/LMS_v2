"""Who besides the Coach may answer one Review field (reviews.FIELD_RESPONDENT_ROLES).

Stored in the field's existing JSON `configuration` -- see the
FIELD_RESPONDENT_ROLES constant and validate_field_payload in reviews.py, and
review_instances.writable_field_ids_for_role / save_review_instance_answers_for_role
for how a Learner/Employer save is restricted to exactly these fields.
"""
from django.test import SimpleTestCase

from . import reviews


class FieldRespondentRolesValidationTests(SimpleTestCase):
    def validate(self, field):
        errors = {}
        cleaned = reviews.validate_field_payload(field, 'sections[0].fields[0]', errors)
        return cleaned, errors

    def test_participant_and_employer_roles_are_kept(self):
        cleaned, errors = self.validate({
            'title': 'Learner note', 'fieldType': 'text',
            'configuration': {'respondentRoles': ['participant', 'employer']},
        })
        self.assertEqual(errors, {})
        self.assertEqual(cleaned['configuration']['respondentRoles'], ['employer', 'participant'])

    def test_unknown_roles_are_dropped_not_rejected(self):
        cleaned, errors = self.validate({
            'title': 'Learner note', 'fieldType': 'text',
            'configuration': {'respondentRoles': ['participant', 'advisor', 'made-up-role']},
        })
        self.assertEqual(errors, {})
        self.assertEqual(cleaned['configuration']['respondentRoles'], ['participant'])

    def test_duplicate_roles_are_deduplicated(self):
        cleaned, _errors = self.validate({
            'title': 'Learner note', 'fieldType': 'text',
            'configuration': {'respondentRoles': ['participant', 'participant']},
        })
        self.assertEqual(cleaned['configuration']['respondentRoles'], ['participant'])

    def test_field_with_no_roles_posted_defaults_to_coach_only(self):
        cleaned, _errors = self.validate({'title': 'Coach only note', 'fieldType': 'text'})
        self.assertEqual(cleaned['configuration']['respondentRoles'], [])

    def test_display_only_fields_never_carry_a_respondent_list(self):
        cleaned, _errors = self.validate({
            'title': 'Instructions', 'fieldType': 'title_description',
            'configuration': {'description': 'Read this first.', 'respondentRoles': ['participant']},
        })
        self.assertNotIn('respondentRoles', cleaned['configuration'])
        self.assertEqual(cleaned['configuration']['description'], 'Read this first.')
