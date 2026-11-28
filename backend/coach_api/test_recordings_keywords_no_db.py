"""Keyword regression cases with synthetic templates, no Django/DB/network."""
import unittest
from unittest.mock import patch

from .recordings_keywords import classify_keywords, tokens


def references(support=False):
    rows = [
        {'id': 'm', 'name': 'Monthly', 'family': 'MCM', 'linked': True,
         'prompts': ['Learning goals', 'Study barriers', 'Portfolio achievements', 'Progress update']},
        {'id': 'p', 'name': 'Progress', 'family': 'PR', 'linked': False,
         'prompts': ['Employer feedback', 'Workplace performance', 'Occupational competence', 'Progress update']},
    ]
    if support:
        rows.append({'id': 's', 'name': 'Support', 'family': 'SUPPORT', 'linked': False,
                     'prompts': ['Technical access', 'Study adjustments']})
    return rows


class TranscriptKeywordTests(unittest.TestCase):
    def setUp(self):
        self.guard = patch('socket.socket', side_effect=AssertionError('Network forbidden'))
        self.guard.start(); self.addCleanup(self.guard.stop)

    def classify(self, text, title='', refs=None):
        return classify_keywords(text, title, references() if refs is None else refs)

    def test_multiple_distinct_monthly_topics_suggest_mcm(self):
        result = self.classify('We reviewed learning goals. We explored study barriers.', title='Progress Review')
        self.assertEqual([row['type'] for row in result['types']], ['MCM'])
        self.assertTrue(result['reviewOnly'])
        self.assertFalse(result['mixed'])
        self.assertEqual(result['types'][0]['confidence'], 'low')

    def test_actual_multi_type_topic_evidence_can_be_flagged_for_review(self):
        result = self.classify('Learning goals were updated. Study barriers were explored. '
                               'Employer feedback was reviewed. Workplace performance was evaluated.')
        self.assertEqual([row['type'] for row in result['types']], ['MCM', 'PR'])
        self.assertTrue(result['mixed'])
        self.assertNotIn('high', [row['confidence'] for row in result['types']])

    def test_title_and_bare_type_mentions_cannot_establish_type(self):
        result = self.classify('This is MCM. BR. Student support.', 'MCM and progress review')
        self.assertEqual(result['types'], [])
        self.assertTrue(result['insufficientEvidence'])
        self.assertTrue(result['keywordSignals'][0]['transcriptMentioned'])

    def test_partial_type_names_in_template_headers_are_not_content_evidence(self):
        refs = [{'id': 'm', 'name': 'Monthly', 'family': 'MCM', 'linked': True,
                 'prompts': ['Monthly coaching meeting', 'Monthly coaching review']}]
        self.assertEqual(self.classify('Monthly coaching meeting and monthly coaching review.', refs=refs)['types'], [])

    def test_one_long_prompt_cannot_be_counted_as_several_template_topics(self):
        refs = [{'id': 'm', 'name': 'Monthly', 'family': 'MCM', 'linked': True,
                 'prompts': ['Learning goals and portfolio achievements']}]
        result = self.classify('Learning goals. Portfolio achievements.', refs=refs)
        self.assertEqual(result['types'], [])
        self.assertEqual(result['keywordSignals'][0]['topicCount'], 1)

    def test_common_template_topics_cannot_distinguish_families(self):
        result = self.classify('We discussed the progress update. Progress updates continue.')
        self.assertEqual(result['types'], [])
        self.assertTrue(all(row['topicCount'] == 0 for row in result['keywordSignals']))

    def test_isolated_generic_words_cannot_falsely_label_a_mixed_meeting(self):
        result = self.classify('This employer is busy. The workplace is busy. '
                               'My study needs focus. My portfolio is large.')
        self.assertEqual(result['types'], [])
        self.assertFalse(result['mixed'])

    def test_repeated_phrase_and_overlapping_template_fields_count_as_one(self):
        result = self.classify('Learning goals were reviewed. ' * 100)
        self.assertEqual(result['types'], [])
        self.assertEqual(result['keywordSignals'][0]['topicCount'], 1)

    def test_short_labels_use_whole_tokens_not_substrings(self):
        result = self.classify('The fabric sample was brought to a printer.', 'April')
        self.assertFalse(any(row['transcriptMentioned'] or row['titleMentioned'] for row in result['keywordSignals']))

    def test_negated_future_and_template_readout_topics_are_not_positive_evidence(self):
        for text in ("We did not discuss learning goals or study barriers.",
                     'Next meeting covers learning goals and study barriers.',
                     'Tomorrow we will discuss employer feedback and workplace performance.',
                     'The form asks about employer feedback and workplace performance.'):
            with self.subTest(text=text):
                self.assertEqual(self.classify(text)['types'], [])

    def test_long_future_sentence_does_not_escape_context_filter_after_chunking(self):
        text = 'Next meeting ' + 'a detailed discussion ' * 20 + 'learning goals and study barriers'
        self.assertEqual(self.classify(text)['types'], [])

    def test_support_mention_inside_a_review_is_not_marked_as_separate_support(self):
        result = self.classify('Learning goals were reviewed. Study barriers were discussed. '
                               'Student support was mentioned as an available service.')
        self.assertEqual([row['type'] for row in result['types']], ['MCM'])
        self.assertFalse(result['keywordSignals'][2]['templateBased'])
        self.assertTrue(result['keywordSignals'][2]['transcriptMentioned'])

    def test_support_with_its_own_template_requires_distinct_topics_too(self):
        result = self.classify('Technical access was resolved. Study adjustments were agreed.', refs=references(support=True))
        self.assertEqual([row['type'] for row in result['types']], ['SUPPORT'])
        self.assertEqual(result['types'][0]['referenceIds'], ['s'])

    def test_confidence_is_capped_and_repetition_does_not_upgrade_it(self):
        result = self.classify('Learning goals. Study barriers. Portfolio achievements.')
        self.assertEqual(result['types'][0]['confidence'], 'medium')
        result = self.classify('Learning goals. Study barriers. ' * 20)
        self.assertEqual(result['types'][0]['confidence'], 'low')

    def test_complete_long_transcript_is_checked_including_its_end(self):
        text = 'General discussion. ' * 6000 + 'Learning goals were reviewed. Study barriers were explored.'
        result = self.classify(text)
        self.assertGreater(result['analysedCharacters'], 100_000)
        self.assertFalse(result['sampled'])
        self.assertEqual([row['type'] for row in result['types']], ['MCM'])

    def test_arabic_normalisation_preserves_original_quote(self):
        refs = [{'id': 'm', 'name': 'Monthly', 'family': 'MCM', 'linked': True,
                 'prompts': ['أهداف التعلم', 'عوائق الدراسة']}]
        text = 'راجعنا أهْداف  التعلم. ناقشنا عوائق الدراسه.'
        result = self.classify(text, refs=refs)
        self.assertEqual([row['type'] for row in result['types']], ['MCM'])
        for quote in result['types'][0]['evidence']:
            self.assertIn(quote, text)
        self.assertEqual(tokens('أهْداف'), tokens('اهداف'))

    def test_arabic_negation_is_a_weak_mention_not_topic_evidence(self):
        refs = [{'id': 'm', 'name': 'Monthly', 'family': 'MCM', 'linked': True,
                 'prompts': ['أهداف التعلم', 'عوائق الدراسة']}]
        self.assertEqual(self.classify('لم نناقش أهداف التعلم ولا عوائق الدراسة.', refs=refs)['types'], [])

    def test_deterministic_results_do_not_depend_on_template_order_or_transcript_repetition(self):
        text = 'Learning goals. Study barriers. Employer feedback. Workplace performance.'
        first = self.classify(text)
        second = self.classify(text, refs=list(reversed(references())))
        self.assertEqual(first['types'], second['types'])
        self.assertEqual(first['keywordSignals'], second['keywordSignals'])

    def test_missing_templates_do_not_produce_a_fabricated_type(self):
        result = self.classify('MCM learning goals and study barriers.', refs=[])
        self.assertEqual(result['types'], [])
