"""The three component assurance flags survive a save that does not mention them.

Reflection, tutor validation and coach validation are authored on one screen and
written by two different save paths, and the module-structure save rewrites every
component in a module whether or not the author touched it. That combination is
what made these flags unstable in production: the structure save could not tell
an explicit ``false`` from an absent key, answered ``False`` to both for
reflection and tutor validation, and answered ``True`` to both for coach
validation. A component payload that had lost the keys therefore came back with
reflection cleared and coach validation switched on -- and because the two
defaults point in opposite directions, the pair flipped together in opposite
directions every time the author moved between a screen that carried the flags
and one that did not.

The revision log shows it plainly: ~1,100 paired flips across ~600 components in
one week, every one of them from the structure save, and the same component
flipping back and forth as often as four times an hour.

Nothing here tests the audit trail. The trail is how the bug was found; these are
the assertions about the data.
"""

from curriculum_api import views
from curriculum_api.tests import CurriculumPersistenceHarness


class ComponentAssuranceFlagTests(CurriculumPersistenceHarness):

    MODULE = 'MOD-FLAGS'

    def component(self, **overrides):
        payload = {'id': 'COMP-FLAG', 'title': 'Reading', 'type': 'reading', 'expectedOtjh': 1}
        payload.update(overrides)
        return payload

    def save(self, component, module=None):
        views.save_module_authoring_structure(module or self.MODULE, {
            'title': 'Flags module',
            'programmeName': 'Flags Programme',
            'weekStructure': [{'id': 'WEEK-1', 'title': 'Week 1', 'components': [component]}],
        }, repair_links=False)
        return self.stored(component['id'])

    def stored(self, component_id='COMP-FLAG'):
        row = views.authoring_fetch_all(
            views.AUTHORING_COMPONENTS_TABLE, 'id = %s', [component_id])[0]
        return {
            'reflection': bool(row['reflection_required']),
            'tutor': bool(row['tutor_validation_required']),
            'coach': bool(row['coach_validation_required']),
        }

    # -- what the author asked for is what is stored ------------------------

    def test_the_authored_values_are_stored(self):
        stored = self.save(self.component(
            reflectionRequired=True, tutorValidationRequired=True, coachValidationRequired=False))
        self.assertEqual(stored, {'reflection': True, 'tutor': True, 'coach': False})

    def test_the_opposite_authored_values_are_stored(self):
        stored = self.save(self.component(
            reflectionRequired=False, tutorValidationRequired=False, coachValidationRequired=True))
        self.assertEqual(stored, {'reflection': False, 'tutor': False, 'coach': True})

    # -- the bug ------------------------------------------------------------

    def test_true_survives_a_save_that_does_not_mention_the_flags(self):
        """The exact shape that was corrupting live data.

        A structure payload whose components carry no assurance keys is saying
        nothing about them, not clearing them. Before the fix this stored
        reflection=False and coach=True -- the inverse of what the author set,
        in one save.
        """
        self.save(self.component(
            reflectionRequired=True, tutorValidationRequired=True, coachValidationRequired=False))
        stored = self.save(self.component(title='Reading (retitled)'))
        self.assertEqual(stored, {'reflection': True, 'tutor': True, 'coach': False})

    def test_false_survives_a_save_that_does_not_mention_the_flags(self):
        self.save(self.component(
            reflectionRequired=False, tutorValidationRequired=False, coachValidationRequired=True))
        stored = self.save(self.component(title='Reading (retitled)'))
        self.assertEqual(stored, {'reflection': False, 'tutor': False, 'coach': True})

    def test_the_flags_do_not_ping_pong_across_repeated_saves(self):
        """Five saves, none of them mentioning the flags. Nothing moves.

        The live symptom was alternation, not a single loss, so alternation is
        what this asserts: the same values at every step, not merely at the end.
        """
        self.save(self.component(
            reflectionRequired=True, tutorValidationRequired=False, coachValidationRequired=False))
        expected = {'reflection': True, 'tutor': False, 'coach': False}
        for index in range(5):
            stored = self.save(self.component(title=f'Reading {index}'))
            self.assertEqual(stored, expected, f'the flags moved on save {index + 1}')

    def test_an_unrelated_edit_does_not_touch_the_flags(self):
        self.save(self.component(
            reflectionRequired=True, tutorValidationRequired=True, coachValidationRequired=False))
        stored = self.save(self.component(
            expectedOtjh=7, description='A longer description', points=12))
        self.assertEqual(stored, {'reflection': True, 'tutor': True, 'coach': False})

    def test_an_explicit_false_still_turns_a_flag_off(self):
        """Preserving an absent key must not make the flag unclearable."""
        self.save(self.component(reflectionRequired=True, coachValidationRequired=True))
        stored = self.save(self.component(reflectionRequired=False, coachValidationRequired=False))
        self.assertEqual(stored['reflection'], False)
        self.assertEqual(stored['coach'], False)

    def test_snake_case_is_accepted_too(self):
        self.save(self.component(reflectionRequired=False, coachValidationRequired=True))
        stored = self.save(self.component(reflection_required=True, coach_validation_required=False))
        self.assertEqual(stored['reflection'], True)
        self.assertEqual(stored['coach'], False)

    # -- a brand new component follows the schema ---------------------------

    def test_a_new_component_that_says_nothing_takes_the_schema_defaults(self):
        """Nothing to preserve, so the column defaults stand: coach validation
        on, reflection and tutor validation off."""
        stored = self.save(self.component(id='COMP-NEW'), module='MOD-FLAGS-NEW')
        self.assertEqual(self.stored('COMP-NEW'), {'reflection': False, 'tutor': False, 'coach': True})
        self.assertEqual(stored['coach'], True)

    def test_preservation_is_per_component_not_per_module(self):
        """Two components, opposite settings, one save mentioning neither."""
        def save_pair(first, second):
            views.save_module_authoring_structure('MOD-FLAGS-PAIR', {
                'title': 'Pair module',
                'programmeName': 'Flags Programme',
                'weekStructure': [{'id': 'WEEK-P', 'title': 'Week 1', 'components': [first, second]}],
            }, repair_links=False)

        save_pair(
            self.component(id='COMP-ON', reflectionRequired=True, coachValidationRequired=False),
            self.component(id='COMP-OFF', reflectionRequired=False, coachValidationRequired=True),
        )
        save_pair(
            self.component(id='COMP-ON', title='On (retitled)'),
            self.component(id='COMP-OFF', title='Off (retitled)'),
        )
        self.assertEqual(self.stored('COMP-ON')['reflection'], True)
        self.assertEqual(self.stored('COMP-ON')['coach'], False)
        self.assertEqual(self.stored('COMP-OFF')['reflection'], False)
        self.assertEqual(self.stored('COMP-OFF')['coach'], True)
