from unittest.mock import MagicMock, patch
from django.test import SimpleTestCase
from .legacy_ksbs import read_legacy_learner_ksbs


class LearnerKsbLegacyRelationCompatibilityTests(SimpleTestCase):
    def test_rejects_the_removed_definition_shape(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (['id','learner_id','position','code','number','ksb_type','description'],)
        with patch.dict('learner_api.legacy_ksbs.connections', {'enrolment':connection}):
            self.assertEqual(read_legacy_learner_ksbs(41), [])
        self.assertEqual(cursor.execute.call_count, 1)

    def test_accepts_only_the_retained_self_assessment_shape(self):
        connection = MagicMock()
        cursor = connection.cursor.return_value.__enter__.return_value
        cursor.fetchone.return_value = (['learner_id','category','code','title','level'],)
        cursor.fetchall.return_value = [('Skill','S1','Saved skill','Frequently')]
        with patch.dict('learner_api.legacy_ksbs.connections', {'enrolment':connection}):
            result = read_legacy_learner_ksbs(41)
        self.assertEqual(result[0]['level'], 'Frequently')
        self.assertEqual(cursor.execute.call_args.args[1], [41])
