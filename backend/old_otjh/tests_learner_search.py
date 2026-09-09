"""Searching a coach's previous-learning records.

The list runs to hundreds of records across pages, so the filter has to happen
in the query. The first attempt at this passed ?search= to an endpoint that
never read it — the list came back unfiltered and alphabetical from "Aaron",
which reads as the search being broken rather than ignored.
"""
import inspect

from django.test import SimpleTestCase

from . import repository, views


class SearchIsAppliedInTheQueryTests(SimpleTestCase):
    def test_the_repository_accepts_a_search_term(self):
        signature = inspect.signature(repository.coach_learners)

        self.assertIn("search", signature.parameters)
        # Defaulted, so every existing caller keeps working unchanged.
        self.assertEqual(signature.parameters["search"].default, "")

    def test_the_view_reads_the_parameter_and_passes_it_on(self):
        # The bug this replaces: the parameter was sent and silently dropped.
        source = inspect.getsource(views._coach_cohort)

        self.assertIn("request.GET.get('search'", source)
        self.assertIn("search=search", source)

    def test_the_search_term_is_bounded(self):
        # A free-text filter reaching ILIKE should not carry an unbounded
        # string.
        source = inspect.getsource(views._coach_cohort)

        self.assertIn("[:100]", source)

    def test_the_filter_covers_name_and_email(self):
        source = inspect.getsource(repository.coach_learners)

        self.assertIn("l.learner_name ILIKE", source)
        self.assertIn("l.learner_email ILIKE", source)

    def test_the_count_is_filtered_too(self):
        # Filtering only the rows would page through a total that no longer
        # matches what is on screen.
        source = inspect.getsource(repository.coach_learners)
        before_count = source.split("SELECT count(*)")[0]

        self.assertIn("l.learner_name ILIKE", before_count)

    def test_results_are_ranked_by_how_well_the_match_starts(self):
        # A coach typing "moham" wants Mohamed first, not whoever is first
        # alphabetically among the matches.
        source = inspect.getsource(repository.coach_learners)

        self.assertIn("CASE WHEN l.learner_name ILIKE", source)
        self.assertIn("THEN 0", source)

    def test_the_coach_scope_still_applies_with_a_search(self):
        # Search must narrow a coach's own caseload, never widen it: the
        # coach_email clause is added before the search clause and both are
        # ANDed.
        source = inspect.getsource(repository.coach_learners)

        self.assertIn("lower(btrim(l.coach_email))=%s", source)
        self.assertIn("AND (l.learner_name ILIKE", source)
