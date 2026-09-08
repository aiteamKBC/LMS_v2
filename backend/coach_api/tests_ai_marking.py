"""Assembling the inputs for AI-assisted marking.

The model call itself is not tested here -- what matters is what it is handed.
Three things go wrong silently if unguarded: the n8n template syntax in the
prompt file reaching the model as content, a programme failing to resolve to its
KSB framework so the model maps codes against nothing, and evidence text being
described as read when the file could not actually be parsed.
"""
from unittest.mock import patch

from django.test import SimpleTestCase

from .ai_marking import (
    EPA_BY_NAME,
    EPA_BY_STANDARD,
    EPA_DIR,
    N8N_PLACEHOLDER,
    _render_prompt,
    build_evidence_text,
    build_messages,
    extract_file_text,
    load_epa_plan,
)


class RenderPromptTests(SimpleTestCase):
    """The prompt file is written for n8n; this deployment is not n8n."""

    def test_a_known_placeholder_is_replaced_with_our_value(self):
        rendered = _render_prompt(
            "Student Name: {{ $('Webhook').item.json.body.student_name }}",
            {"student_name": "Aya Khater"},
        )

        self.assertEqual(rendered, "Student Name: Aya Khater")

    def test_an_unknown_placeholder_says_so_rather_than_leaking_syntax(self):
        # The prompt tells the model not to invent details beyond the fields
        # provided. "not provided" lets that instruction work; raw {{ ... }}
        # would read as content.
        rendered = _render_prompt("Employer: {{ $('SQL').first().json.company_name }}", {})

        self.assertEqual(rendered, "Employer: not provided")

    def test_an_empty_value_is_treated_as_absent(self):
        rendered = _render_prompt("Name: {{ student_name }}", {"student_name": "   "})

        self.assertEqual(rendered, "Name: not provided")

    def test_no_template_syntax_survives_rendering(self):
        # The guarantee that matters: whatever the training team writes, the
        # model never sees a raw expression.
        document = (
            "A {{ $('Webhook').item.json.body.student_name }} B {{ $json.KSB_Framework }} "
            "C {{ $('Extract from File1').first().json.text }}"
        )

        rendered = _render_prompt(document, {"student_name": "X"})

        self.assertEqual(N8N_PLACEHOLDER.findall(rendered), [])


class EvidenceTextTests(SimpleTestCase):
    def _submission(self, **overrides):
        base = {
            "activityTitle": "Recorded Session 1",
            "activityType": "video",
            "module": "Module 1",
            "week": "Week 1",
            "learningReflection": "I learned how governance shapes reporting.",
            "applicationType": "planned",
            "applicationText": "I will restructure the weekly report.",
            "selectedBenefits": ["Stronger innovation"],
            "benefitExplanation": "Clearer decisions.",
            "ksbExplanations": {"K1": "Covered in the session."},
            "actualTimeHours": "2h",
            "plannedOtjh": "2",
        }
        base.update(overrides)
        return base

    def test_the_learners_own_writing_is_included(self):
        text = build_evidence_text(self._submission(), [])

        self.assertIn("I learned how governance shapes reporting.", text)
        self.assertIn("I will restructure the weekly report.", text)
        self.assertIn("Clearer decisions.", text)

    def test_suggested_ksbs_are_passed_as_the_learners_own_claim(self):
        # The policy treats these as suggestions to verify, not as mapping.
        text = build_evidence_text(self._submission(), [])

        self.assertIn("KSBs the learner suggested", text)
        self.assertIn("K1: Covered in the session.", text)

    def test_readable_file_text_is_included_under_its_filename(self):
        files = [{"filename": "report.pdf", "text": "Quarterly KPI results."}]

        text = build_evidence_text(self._submission(), files)

        self.assertIn("Uploaded evidence file: report.pdf", text)
        self.assertIn("Quarterly KPI results.", text)

    def test_an_unreadable_file_is_named_but_fenced_off(self):
        # A screenshot is real evidence and the model should know it exists,
        # but it was never given the contents -- so it must be told not to
        # assess them rather than left free to imagine them.
        files = [{"filename": "kpi.png", "text": ""}]

        text = build_evidence_text(self._submission(), files)

        self.assertIn("kpi.png", text)
        self.assertIn("could not be read as text", text)
        self.assertIn("Do not describe or assess its contents", text)

    def test_empty_fields_are_left_out_rather_than_labelled_blank(self):
        text = build_evidence_text(
            self._submission(benefitExplanation="", ksbExplanations={}), [],
        )

        self.assertNotIn("Employer benefit explanation", text)
        self.assertNotIn("KSBs the learner suggested", text)

    def test_evidence_is_capped(self):
        from .ai_marking import MAX_EVIDENCE_CHARS

        files = [{"filename": "big.pdf", "text": "x" * (MAX_EVIDENCE_CHARS * 2)}]

        text = build_evidence_text(self._submission(), files)

        self.assertLessEqual(len(text), MAX_EVIDENCE_CHARS)


class BuildMessagesTests(SimpleTestCase):
    def test_the_framework_is_handed_over_as_authoritative(self):
        with patch("coach_api.ai_marking.load_prompt_document", return_value="POLICY"):
            _system, user = build_messages(
                {"learner": "Aya", "activityTitle": "Session 1", "activityId": "COMP-1"},
                "evidence text",
                "K1: Something",
            )

        self.assertIn("KSB Framework (authoritative", user)
        self.assertIn("K1: Something", user)

    def test_the_framework_is_named_as_scoped_to_this_activity(self):
        # The model is told the list is the activity's own, so "map only to
        # this list" is a rule about the task rather than about the programme.
        with patch("coach_api.ai_marking.load_prompt_document", return_value="POLICY"):
            system, user = build_messages(
                {"learner": "Aya", "activityTitle": "S", "activityId": "C"}, "evidence", "K1: x",
            )

        self.assertIn("limited to this activity", user)
        self.assertIn("Map only to codes in that list", system)

    def test_the_epa_plan_is_sent_when_one_applies(self):
        with patch("coach_api.ai_marking.load_prompt_document", return_value="POLICY"):
            system, user = build_messages(
                {"learner": "Aya", "activityTitle": "S", "activityId": "C"},
                "evidence", "K1: x", "EPA PLAN TEXT",
            )

        self.assertIn("EPA PLAN TEXT", user)
        self.assertIn("ground the EPA portfolio contribution rating", system)

    def test_without_a_plan_the_model_is_told_not_to_name_a_standard(self):
        # Otherwise it fills the gap with a plausible-sounding standard.
        with patch("coach_api.ai_marking.load_prompt_document", return_value="POLICY"):
            system, _user = build_messages(
                {"learner": "Aya", "activityTitle": "S", "activityId": "C"}, "evidence", "K1: x",
            )

        self.assertIn("do not name an EPA or IFaTE standard", system)

    def test_an_activity_with_no_ksbs_says_so_rather_than_going_quiet(self):
        # A component with nothing assigned must not silently fall back to the
        # programme's whole profile -- that is what invited a mapping the
        # activity was never designed to evidence.
        with patch("coach_api.ai_marking.load_prompt_document", return_value="POLICY"):
            _system, user = build_messages(
                {"learner": "Aya", "activityTitle": "S", "activityId": "C"}, "evidence", "",
            )

        self.assertIn("no KSBs are assigned to this activity", user)

    def test_the_system_message_forbids_deciding(self):
        with patch("coach_api.ai_marking.load_prompt_document", return_value="POLICY"):
            system, _user = build_messages(
                {"learner": "Aya", "activityTitle": "S", "activityId": "C"}, "evidence", "K1: x",
            )

        self.assertIn("POLICY", system)
        self.assertIn("do not award KSBs", system)


class ExtractFileTextTests(SimpleTestCase):
    def test_plain_text_is_read(self):
        self.assertEqual(extract_file_text("text/plain", "notes.txt", b"hello"), "hello")

    def test_an_unsupported_type_yields_nothing(self):
        self.assertEqual(extract_file_text("image/png", "shot.png", b"\x89PNG"), "")

    def test_a_corrupt_file_does_not_raise(self):
        # This runs while a coach waits on a button; a malformed upload must
        # degrade to "unreadable", never to a stack trace.
        self.assertEqual(extract_file_text("application/pdf", "broken.pdf", b"not a pdf"), "")


class ViewAsGuardTests(SimpleTestCase):
    """Who may generate a draft while reading a coach's workspace.

    A super-admin browsing somebody else's workspace is refused unsafe methods,
    so that no write is ever recorded against the coach whose workspace is
    open. Generating a draft is a POST but writes nothing, so it opts out of
    that refusal -- and the opt-out has to stay opt-in, or the guard stops
    protecting the endpoints that do write.
    """

    def test_generating_a_draft_is_marked_safe_for_view_as(self):
        from .ai_marking import coach_marking_ai_feedback

        self.assertTrue(getattr(coach_marking_ai_feedback, "coach_view_as_safe", False))

    def test_the_marking_decision_endpoint_is_not_marked_safe(self):
        # The endpoint that actually records a decision must stay refused.
        from .views import coach_marking_queue

        self.assertFalse(getattr(coach_marking_queue, "coach_view_as_safe", False))

    def test_the_view_reads_its_identity_from_the_decorator(self):
        # The crash this replaces: the view called authenticated_coach_email()
        # without coach_access_required having installed request.coach_email.
        from .ai_marking import coach_marking_ai_feedback

        self.assertTrue(hasattr(coach_marking_ai_feedback, "__wrapped__"))


class EpaSelectionTests(SimpleTestCase):
    """The right plan, or none -- never a plausible-looking wrong one."""

    def test_every_configured_plan_exists_on_disk(self):
        # A missing file degrades silently to "no plan", so this is the only
        # place the mapping is checked against reality.
        for filename in set(EPA_BY_STANDARD.values()):
            self.assertTrue((EPA_DIR / filename).exists(), filename)

    def test_the_standards_map_to_the_documented_plans(self):
        self.assertEqual(EPA_BY_STANDARD["st0845"], "PCP_EPA.pdf")
        self.assertEqual(EPA_BY_STANDARD["st0596"], "ME_EPA.pdf")
        self.assertEqual(EPA_BY_STANDARD["st0612"], "MM_EPA.pdf")

    def test_associate_project_manager_follows_the_pcp_plan(self):
        # Stated by the training team: APM is assessed against the PCP plan.
        with patch("coach_api.ai_marking._programme_standard", return_value=""):
            _text, filename = load_epa_plan("Associate Project Manager")

        self.assertEqual(filename, "PCP_EPA.pdf")

    def test_the_marketing_programmes_follow_their_own_plans(self):
        with patch("coach_api.ai_marking._programme_standard", return_value=""):
            self.assertEqual(load_epa_plan("Marketing Executive L4")[1], "ME_EPA.pdf")
            self.assertEqual(load_epa_plan("Marketing Manager")[1], "MM_EPA.pdf")

    def test_an_unrecognised_programme_gets_no_plan(self):
        # Better than guessing: a wrong plan would ground the rating in
        # criteria that do not govern this apprenticeship.
        with patch("coach_api.ai_marking._programme_standard", return_value=""):
            text, filename = load_epa_plan("Some Unrelated Programme")

        self.assertEqual(filename, "")
        self.assertEqual(text, "")

    def test_the_name_fallback_is_only_consulted_without_a_standard(self):
        # The standard reference is data; the name match is a guess. Data wins.
        with patch("coach_api.ai_marking._programme_standard", return_value="st0596"):
            _text, filename = load_epa_plan("Project Control Professional")

        self.assertEqual(filename, "ME_EPA.pdf")
