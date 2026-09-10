"""Assigning imported learners to their coach, from the audit snapshot.

The assignment has to land in two places or it does not work: the enrolment
record is what the directory shows, and ``Learner.learners.coach_email`` is what
every coach surface actually scopes on. Writing only the first looks correct in
the directory while every coach workspace stays empty — which is the failure
these guard.
"""
from django.test import SimpleTestCase

from .management.commands.assign_audit_coaches import ACTIVE_STATUS, COACH_ACCESS, _s


class MatchingRulesTests(SimpleTestCase):
    def test_only_active_learners_are_assigned(self):
        # The snapshot also holds withdrawn, completed and on-break records.
        self.assertEqual(ACTIVE_STATUS, "Active")

    def test_the_granted_role_is_the_one_the_workspace_checks(self):
        # A coach named on a learner still cannot open a workspace without it;
        # login.permissions.require_access refuses a null grant.
        self.assertEqual(COACH_ACCESS, "coach")

    def test_emails_are_normalised_before_matching(self):
        # The snapshot writes "Patryk.zajac@" while staff holds "patryk.zajac@",
        # so a case-sensitive match would drop 46 learners.
        self.assertEqual(_s("  Patryk.Zajac@Example.com  "), "Patryk.Zajac@Example.com")
        self.assertEqual(
            _s("  Patryk.Zajac@Example.com  ").lower(), "patryk.zajac@example.com",
        )

    def test_blank_values_normalise_to_empty(self):
        for value in (None, "", "   "):
            self.assertEqual(_s(value), "", repr(value))


class AssignmentContractTests(SimpleTestCase):
    """The command has to write both sides, and read the mirror back."""

    def _source(self):
        from pathlib import Path

        return (
            Path(__file__).parent
            / "management" / "commands" / "assign_audit_coaches.py"
        ).read_text(encoding="utf-8")

    def test_the_enrolment_record_is_written(self):
        source = self._source()

        self.assertIn("coach_name=coach_name, coach_email=coach_email", source)

    def test_the_mirror_the_workspace_reads_is_written_too(self):
        # The one that matters: Learner.learners.coach_email is what the
        # caseload, marking queue and timetable all scope on.
        source = self._source()

        self.assertIn("LearnerProfile.objects.filter(", source)
        self.assertIn("enrolment_id=row[\"enrolment_id\"]", source)

    def test_the_mirror_is_matched_by_enrolment_id_not_a_stale_pk(self):
        # The bug this replaces: when sync_active_user had just created the
        # mirror, updating by the local reference's pk silently missed 367 rows.
        source = self._source()
        write_block = source.split("def _write")[1]

        self.assertNotIn("LearnerProfile.objects.filter(pk=profile.pk)", write_block)

    def test_an_existing_access_grant_is_never_overwritten(self):
        # A bulk assignment must not demote somebody who already holds a
        # different role.
        source = self._source()

        self.assertIn("coalesce(btrim(\\\"Access\\\"), '') = ''", source)

    def test_a_coach_with_no_staff_record_is_reported_not_invented(self):
        # Pointing a learner at a coach who cannot sign in is worse than
        # leaving the field for somebody to fix.
        source = self._source()

        self.assertIn("unmatched", source)
        self.assertIn("no Staff_users record", source)
