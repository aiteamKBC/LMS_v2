"""KSB standards migration: consumers resolve the applied source and keep history.

SimpleTestCase only -- no test database is created and nothing is written;
every database read is replaced.
"""
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api import canonical_learning, ksb_exclusions, review_form
from learner_api.student_activity_data import read_evidenced_ksb_counts_bulk

ARCHIVED_PROFILE_RESULTS = (
    {'id': 'KSBP-1', 'label': 'Marketing executive (archived)'},
    [
        {'id': 'KSBP-1-0', 'theme': 'Knowledge', 'kind': 'Knowledge', 'codes': ['K1'], 'title': 'Concepts'},
        {'id': 'KSBP-1-1', 'theme': 'Knowledge', 'kind': 'Knowledge', 'codes': ['K1.1'], 'title': 'Theory'},
    ],
)
STANDARD_RESULTS = (
    {'id': 'standard:st0596-v1-0', 'label': 'Marketing executive'},
    [{'id': 'st0596-v1-0-K1', 'theme': 'Knowledge', 'kind': 'Knowledge', 'codes': ['K1'], 'title': 'Theory'}],
)


class SkillsRadarHistoryTests(SimpleTestCase):
    """A signed Skills Radar keeps its titles after the programme changes source."""

    def context(self, radar_standard_id, answers, *, by_source, by_programme):
        review = SimpleNamespace(review_type='workspace', learner_id=7)
        learner = SimpleNamespace(programme='Marketing Executive Level 4')
        radar = SimpleNamespace(standard_id=radar_standard_id)
        rows = [SimpleNamespace(ksb_id=ksb_id, level=level, score=score, note='')
                for ksb_id, level, score in answers]
        with patch('enrolment_api.models.WizardSkillsRadar') as radar_model, \
             patch('enrolment_api.models.WizardKsbAssessment') as answer_model, \
             patch('learner_api.curriculum.ksb_profile_for_source', return_value=by_source) as from_source, \
             patch('learner_api.curriculum.ksb_profile_for_programme', return_value=by_programme) as from_programme:
            radar_model.objects.filter.return_value.first.return_value = radar
            answer_model.objects.filter.return_value = rows
            result = review_form._skills_radar_context(review, learner)['skillsRadar']
        return result, from_source, from_programme

    def test_answers_resolve_against_the_archived_profile_they_were_given_against(self):
        result, from_source, from_programme = self.context(
            'KSBP-1', [('KSBP-1-1', 'Confident', 4)],
            by_source=ARCHIVED_PROFILE_RESULTS, by_programme=STANDARD_RESULTS)
        from_source.assert_called_once_with('KSBP-1', 'Marketing Executive Level 4')
        from_programme.assert_not_called()
        answered = [item for item in result['items'] if item['level']]
        self.assertEqual(answered[0]['ksbId'], 'KSBP-1-1')
        self.assertEqual(answered[0]['codes'], ['K1.1'])
        self.assertEqual(answered[0]['title'], 'Theory')
        self.assertEqual(result['standardLabel'], 'Marketing executive (archived)')
        # No orphaned answer rows: every answer found its KSB.
        self.assertEqual([i for i in result['items'] if not i['title']], [])

    def test_falls_back_to_the_programme_source_when_none_was_recorded(self):
        result, from_source, from_programme = self.context(
            '', [('st0596-v1-0-K1', 'Developing', 2)],
            by_source=(None, []), by_programme=STANDARD_RESULTS)
        from_source.assert_not_called()
        from_programme.assert_called_once()
        self.assertEqual(result['items'][0]['codes'], ['K1'])
        self.assertEqual(result['items'][0]['level'], 'Developing')

    def test_an_unknown_answer_is_kept_not_dropped(self):
        result, _from_source, _from_programme = self.context(
            'KSBP-404', [('KSBP-404-9', 'Confident', 4)],
            by_source=(None, []), by_programme=(None, []))
        self.assertEqual(result['items'][0]['ksbId'], 'KSBP-404-9')
        self.assertEqual(result['items'][0]['level'], 'Confident')


class ReaderExclusionTests(SimpleTestCase):
    """Achievement readers outside curriculum_api skip registered rows."""

    def test_canonical_learning_reads_apply_the_registry(self):
        with patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=True):
            predicate = canonical_learning._ksb_not_excluded()
        self.assertIn('learner_progress_ksb_exclusions', predicate)
        with patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=False):
            self.assertEqual(canonical_learning._ksb_not_excluded(), '1 = 1')

    def test_point_counts_query_carries_the_predicate(self):
        with patch.object(canonical_learning, 'query', return_value=[]) as query, \
             patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=True):
            canonical_learning.read_ksb_point_counts(315)
        sql = query.call_args.args[0]
        self.assertIn('learner_progress_ksb_exclusions', sql)
        self.assertIn('WHERE p.learner_id=%s', sql)

    def test_evidenced_counts_keep_the_learner_but_drop_registered_codes(self):
        cursor = MagicMock()
        cursor.db = SimpleNamespace(alias='default')
        cursor.fetchall.return_value = []
        with patch.object(ksb_exclusions, 'exclusions_table_exists', return_value=True):
            read_evidenced_ksb_counts_bulk(cursor, [123])
        sql = cursor.execute.call_args.args[0]
        join = sql.split('LEFT JOIN "Learner".learner_progress_ksbs k ON')[1].split('WHERE l.aptem_id')[0]
        self.assertIn('learner_progress_ksb_exclusions', join)
