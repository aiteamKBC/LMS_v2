"""Assembling the inputs for reflection validation.

A reflection is a different job from an assignment: no work product, no EPA
plan, and the central question is whether the writing engages with the activity
it claims to be about. These cover what the model is handed, because the ways
this goes wrong are all silent -- it will happily assess a video it was never
told anything about, or name a KSB the activity does not carry.
"""
from unittest.mock import patch

from django.test import SimpleTestCase

from .ai_marking import PROMPT_PATH, REFLECTION_PROMPT_PATH
from .ai_reflection import build_reflection_messages


class PromptSeparationTests(SimpleTestCase):
    def test_reflections_and_assignments_use_different_documents(self):
        # The whole point of the split. One prompt for both produced a thousand
        # words of portfolio assessment about a fifteen-minute video.
        self.assertNotEqual(PROMPT_PATH, REFLECTION_PROMPT_PATH)

    def test_the_reflection_prompt_exists_on_disk(self):
        # It degrades to an error rather than a bad draft if missing, so this
        # is the only place the file's presence is actually checked.
        self.assertTrue(REFLECTION_PROMPT_PATH.exists(), REFLECTION_PROMPT_PATH)

    def test_the_reflection_prompt_asks_for_a_very_short_draft(self):
        # A coach validating a queue reads these in seconds. The first version
        # asked for 250-400 words and produced 318, which was too long to be
        # useful; the brief is now 90-130.
        text = REFLECTION_PROMPT_PATH.read_text(encoding="utf-8")

        self.assertIn("90 to 130 words", text)
        self.assertIn("never more than 150", text)
        self.assertIn("relevance", text.lower())

    def test_the_structure_is_three_short_sections(self):
        # Sentences, not paragraphs — the headings themselves are what keep the
        # draft from growing back.
        text = REFLECTION_PROMPT_PATH.read_text(encoding="utf-8")

        for heading in ("Strengths", "Relevance", "Next time"):
            self.assertIn(f"\n{heading}\n", text, heading)
        self.assertIn("One sentence", text)

    def test_the_reflection_budget_leaves_room_for_reasoning(self):
        # This model spends most of its completion budget on internal
        # reasoning (~900 tokens observed) before emitting any prose, so a
        # ceiling sized to the prose alone returns an empty response.
        from .ai_marking import MAX_REFLECTION_OUTPUT_TOKENS

        self.assertGreaterEqual(MAX_REFLECTION_OUTPUT_TOKENS, 1_500)

    def test_the_reflection_prompt_does_not_ask_for_an_epa_rating(self):
        # That belongs to assignment marking; asking for it here would invite a
        # portfolio judgement on a fifteen-minute video.
        self.assertNotIn("EPA portfolio contribution", REFLECTION_PROMPT_PATH.read_text(encoding="utf-8"))


class BuildReflectionMessagesTests(SimpleTestCase):
    def _submission(self, **overrides):
        base = {
            "learner": "Aya Khater",
            "activityTitle": "Recorded Session 1",
            "activityType": "video",
            "module": "Module 1",
            "week": "Week 1",
            "plannedOtjh": "1",
            "actualTimeHours": "01:00:00",
            "learningReflection": "I learned how governance shapes reporting.",
            "applicationType": "planned",
            "applicationText": "I will restructure the weekly report.",
            "selectedBenefits": ["Better data use"],
        }
        base.update(overrides)
        return base

    def _messages(self, submission=None, ksb_text="K1: Something", context="Title: X\nType: video"):
        with patch("coach_api.ai_reflection.load_prompt_document", return_value="POLICY"):
            return build_reflection_messages(
                submission or self._submission(), ksb_text, context,
            )

    def test_the_learners_own_writing_is_sent(self):
        _system, user = self._messages()

        self.assertIn("I learned how governance shapes reporting.", user)
        self.assertIn("I will restructure the weekly report.", user)
        self.assertIn("Better data use", user)

    def test_the_activity_is_described_so_relevance_can_be_judged(self):
        # Without this the model cannot tell a specific reflection from one
        # that would fit any activity, which is the main thing a coach wants.
        _system, user = self._messages(context="Title: Governance\nType: video\nDescription: Reporting lines")

        self.assertIn("Description: Reporting lines", user)

    def test_both_times_are_sent_so_a_mismatch_is_visible(self):
        _system, user = self._messages()

        self.assertIn("Planned off-the-job hours: 1", user)
        self.assertIn("Time the learner recorded: 01:00:00", user)

    def test_with_no_description_the_model_is_told_not_to_infer_one(self):
        # Otherwise it describes a video it was never shown.
        system, _user = self._messages(context="")

        self.assertIn("rather than inferring what the activity contained", system)

    def test_with_a_description_the_model_is_held_to_it(self):
        system, _user = self._messages(context="Title: X\nType: video")

        self.assertIn("Judge relevance against those and nothing more", system)

    def test_the_ksb_list_is_marked_authoritative(self):
        _system, user = self._messages(ksb_text="K1: Organisational strategy")

        self.assertIn("authoritative", user)
        self.assertIn("K1: Organisational strategy", user)

    def test_with_no_ksbs_the_model_is_told_to_name_none(self):
        system, user = self._messages(ksb_text="")

        self.assertIn("do not name any", system)
        self.assertIn("(none assigned)", user)

    def test_the_model_is_forbidden_from_deciding(self):
        system, _user = self._messages()

        self.assertIn("Do not state or imply a decision", system)
        self.assertIn("do not award KSBs", system)

    def test_an_empty_reflection_is_stated_not_hidden(self):
        _system, user = self._messages(self._submission(learningReflection=""))

        self.assertIn("(the learner wrote nothing)", user)

    def test_a_missing_prompt_yields_nothing_to_send(self):
        # The caller turns this into one clear error rather than calling the
        # model with an empty policy.
        with patch("coach_api.ai_reflection.load_prompt_document", return_value=""):
            system, user = build_reflection_messages(self._submission(), "K1: x", "Title: X")

        self.assertEqual((system, user), ("", ""))
