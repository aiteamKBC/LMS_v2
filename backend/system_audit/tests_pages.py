"""The route table: what a URL is called, which workspace it belongs to, and
which segment of it is a record id.

These are the assertions that keep the audit trail honest about pages. Every
page name in the trail is resolved here, from the URL alone, so a mistake in
this table is a mistake in the audit record -- an action attributed to the wrong
workspace, or a record id read out of the wrong segment.

Run with: python manage.py test system_audit
"""
from django.test import SimpleTestCase

from . import pages


class ResolveTests(SimpleTestCase):
    def test_reads_the_record_id_out_of_the_url(self):
        resolved = pages.resolve('/curriculum/cohorts/412')
        self.assertEqual(resolved['workspace'], 'curriculum')
        self.assertEqual(resolved['pageKey'], 'cohort-workspace')
        self.assertEqual(resolved['targetType'], 'cohort')
        self.assertEqual(resolved['targetId'], '412')

    def test_a_fixed_path_beats_a_wildcard_of_the_same_length(self):
        # `/curriculum/quiz-xml/manual` and `/curriculum/quiz-xml/{id}/edit` are
        # different lengths, but `/curriculum/quiz-xml/manual` competes with
        # nothing else at three segments and must not be read as a quiz id.
        self.assertEqual(pages.resolve('/curriculum/quiz-xml/manual')['pageKey'], 'quiz-xml-manual')
        self.assertEqual(pages.resolve('/curriculum/quiz-xml/7/edit')['targetId'], '7')

    def test_matches_a_route_with_several_wildcards(self):
        resolved = pages.resolve('/employers/12/learner/apprenticeship/5')
        self.assertEqual(resolved['workspace'], 'employer')
        self.assertEqual(resolved['targetType'], 'learner')
        # The learner is the record this page is about, not the employer in the
        # first segment -- which is why the target is named per route.
        self.assertEqual(resolved['targetId'], '5')

    def test_prefers_a_literal_segment_over_a_wildcard(self):
        # `/learner/clubs/events` and `/learner/clubs/{clubId}` are both three
        # segments. The literal one wins, or opening the events list would be
        # recorded as opening a club called "events".
        self.assertEqual(pages.resolve('/learner/clubs/events')['pageKey'], 'learner-club-events')
        self.assertEqual(pages.resolve('/learner/clubs/99')['targetId'], '99')

    def test_a_workspace_dashboard_belongs_to_its_own_workspace(self):
        # Not to some "workspace" area: the second segment names the workspace.
        self.assertEqual(pages.resolve('/workspace/coach')['workspace'], 'coach')
        self.assertEqual(pages.resolve('/workspace/safeguarding')['workspace'], 'safeguarding')
        self.assertEqual(pages.resolve('/workspace/auditor')['workspace'], 'audit')

    def test_aliased_roots_reach_their_workspace(self):
        self.assertEqual(pages.resolve('/users/7/wizard/step-1')['workspace'], 'admin')
        self.assertEqual(pages.resolve('/employers/12')['workspace'], 'employer')
        self.assertEqual(pages.resolve('/activity-categories')['workspace'], 'audit')

    def test_an_unknown_page_is_still_recorded(self):
        # A page that ships tomorrow appears in the trail tomorrow, not on the
        # day somebody remembers to add it to the table.
        resolved = pages.resolve('/coach/some-new-screen')
        self.assertFalse(resolved['known'])
        self.assertEqual(resolved['workspace'], 'coach')
        self.assertEqual(resolved['pageLabel'], 'Some New Screen')

    def test_query_and_fragment_are_not_part_of_the_page(self):
        resolved = pages.resolve('/curriculum/cohorts/412?tab=learners#top')
        self.assertEqual(resolved['path'], '/curriculum/cohorts/412')
        self.assertEqual(resolved['targetId'], '412')

    def test_a_record_id_that_is_not_id_shaped_is_dropped(self):
        # The id goes into an audit record. Anything that is not id-shaped is
        # refused rather than stored and explained away later.
        resolved = pages.resolve('/curriculum/cohorts/' + 'x' * 200)
        self.assertEqual(resolved['targetId'], '')
        self.assertEqual(resolved['targetType'], '')

    def test_every_workspace_key_has_a_label(self):
        for key, label in pages.WORKSPACES.items():
            self.assertTrue(label, f'workspace {key} has no label')

    def test_every_route_in_the_table_resolves_to_its_own_page(self):
        # Guards the table against itself: a template that some other template
        # shadows would silently record the wrong page name for real traffic.
        for workspace, routes in pages.PAGES_BY_WORKSPACE.items():
            for template, key, _label, _target_type, param in routes:
                sample = template
                for name in ('id', 'kind', param, 'month', 'stepSlug', 'weekNumber'):
                    if name:
                        sample = sample.replace('{' + name + '}', '7')
                sample = _fill_remaining(sample)
                resolved = pages.resolve(sample)
                self.assertEqual(
                    resolved['pageKey'], key,
                    f'{template} (as {sample}) resolved to {resolved["pageKey"]}, not {key}',
                )
                self.assertEqual(
                    resolved['workspace'], workspace,
                    f'{template} resolved to workspace {resolved["workspace"]}, not {workspace}',
                )


def _fill_remaining(template):
    """Replace any leftover `{name}` with a sample id."""
    out = []
    for part in template.split('/'):
        out.append('7' if part.startswith('{') and part.endswith('}') else part)
    return '/'.join(out)


class ExcludedTests(SimpleTestCase):
    def test_the_signed_out_pages_are_not_recorded(self):
        for path in ('/login', '/forgot-password', '/reset-password/tok', '/set-password/tok',
                     '/verify-certificate/abc', '/verify-personal-certificate/abc'):
            self.assertTrue(pages.excluded(path), path)

    def test_the_learner_content_runner_is_not_recorded(self):
        for path in ('/learner/quiz/apprenticeship/98/q1',
                     '/learner/video/apprenticeship/98/c4',
                     '/learner/component/apprenticeship/98/c9',
                     '/learner/historical-assignment/apprenticeship/98/a1',
                     '/learner/monthly-submission/apprenticeship/98',
                     '/old-otjh'):
            self.assertTrue(pages.excluded(path), path)

    def test_the_rest_of_the_learner_workspace_is_recorded(self):
        # The exclusion is the runner, not the learner. Somebody reading their
        # learning plan or their evidence is still part of the trail.
        for path in ('/learner', '/learner/my-learning', '/learner/evidence',
                     '/learner/monthly-submission', '/learner/quizzes'):
            self.assertFalse(pages.excluded(path), path)

    def test_a_workspace_is_never_excluded_wholesale(self):
        for key in pages.WORKSPACES:
            self.assertFalse(pages.excluded(f'/{key}'), key)
