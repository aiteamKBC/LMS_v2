from contextlib import ExitStack
from datetime import date
from unittest.mock import patch

from django.db import DatabaseError
from django.test import SimpleTestCase

from coach_api import views
from coach_api.test_review_source_selection_no_db import learner


class TimetableIdentityIsolationTests(SimpleTestCase):
    def setUp(self):
        self.stack = ExitStack()
        self.addCleanup(self.stack.close)
        self.pairs = self.stack.enter_context(patch.object(views.EnrolmentUser, "all_learners"))
        self.pairs.filter.return_value.values_list.return_value = [(101, 501), (102, None)]
        self.imported = self.stack.enter_context(patch.object(views, "fetch_aptem_review_events"))
        self.source_events = [
            {"eventKey": f"imported-review:{kind}", "source": kind,
             "reviewSource": "aptem", "learnerId": "1"}
            for kind in ("mcr", "progress-review", "review")
        ]
        self.imported.return_value = (self.source_events, {1})
        self.stack.enter_context(patch.object(views, "fetch_source_schedule_rows", return_value=({}, {})))
        self.stack.enter_context(patch.object(views, "resolve_curriculum_programme_id", return_value="P1"))
        self.stack.enter_context(patch.object(views.curriculum_review_instances, "programme_review_template_identifiers", return_value=[("T1", "mcr")]))
        self.stack.enter_context(patch.object(views, "resolve_review_anchor_date", return_value=(date(2026, 1, 1), None)))
        self.stack.enter_context(patch.object(views, "resolve_schedule_window", return_value=(date(2026, 1, 1), date(2027, 1, 1))))
        self.stack.enter_context(patch.object(views, "resolve_caseload_source_row", return_value=None))
        self.stack.enter_context(patch.object(views, "learner_employer_attendee", return_value=None))
        self.generate = self.stack.enter_context(patch.object(views, "resolve_curriculum_review_occurrences", return_value=[{
            "reviewTypeCode": "mcr", "occurrenceNumber": 1, "targetDate": date(2026, 10, 1),
            "reviewTemplateId": "T1", "reviewName": "Coaching", "occurrenceSource": "generated",
        }]))
        self.build = self.stack.enter_context(patch.object(views, "build_generated_calendar_event", side_effect=lambda **kw: {
            "eventKey": f"review:{kw['learner'].id}:T1:1", "source": "mcr",
        }))

    def unresolved(self, profile_id, **kwargs):
        row = learner(profile_id, **kwargs)
        row._caseload_source = None
        return row

    def test_missing_links_isolate_only_affected_learners_across_coach_contexts(self):
        for owner in ("coach-a@example.invalid", "coach-b@example.invalid"):
            for broken_ids in ((3,), (8, 9)):
                with self.subTest(owner=owner, broken_ids=broken_ids):
                    self.generate.reset_mock()
                    rows = [self.unresolved(1), self.unresolved(2)] + [self.unresolved(pk) for pk in broken_ids]
                    result = views.resolve_coach_review_events(owner, "Coach", rows)
                    self.assertEqual(result["events"], self.source_events + [{
                        "eventKey": "review:2:T1:1", "source": "mcr", "reviewSource": "curriculum",
                    }])
                    self.assertEqual(result["reviewGenerationIssues"], [
                        {"learnerId": str(pk), "code": "review_identity_unavailable"} for pk in broken_ids
                    ])
                    self.assertEqual(self.generate.call_count, 1)
                    self.assertEqual(self.generate.call_args.kwargs["learner_id"], 2)
                    self.assertEqual([r.id for r in self.imported.call_args.args[0]], [1, 2])
                    self.assertEqual(self.imported.call_args.args[1], {1: 501})
                    self.assertEqual(result["sourceCounts"]["curriculumLearners"], 1)
                    self.assertEqual(result["sourceCounts"]["curriculumMcmFallbackLearners"], 0)

    def test_broken_link_with_positive_profile_id_is_not_guessed_as_aptem_or_native(self):
        row = self.unresolved(3, aptem_id=503)
        self.imported.return_value = ([], set())
        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [row])
        self.assertEqual(result["events"], [])
        self.assertEqual(result["aptemProfileIds"], set())
        self.assertEqual(result["reviewGenerationIssues"], [{"learnerId": "3", "code": "review_identity_unavailable"}])
        self.generate.assert_not_called()
        self.assertEqual(self.imported.call_args.args[0], [])

    def test_absent_optional_link_preserves_profile_fallback(self):
        row = self.unresolved(1, aptem_id=501)
        row.enrolment_id = None
        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", [row])
        self.assertEqual(result["events"], self.source_events)
        self.assertEqual(result["reviewGenerationIssues"], [])
        self.assertEqual(result["aptemProfileIds"], {1})
        self.generate.assert_not_called()
        self.pairs.filter.assert_not_called()

    def test_all_profiles_sharing_a_missing_link_are_isolated(self):
        rows = [self.unresolved(3), self.unresolved(4)]
        rows[1].enrolment_id = rows[0].enrolment_id
        self.imported.return_value = ([], set())
        result = views.resolve_coach_review_events("coach@example.invalid", "Coach", rows)
        self.assertEqual(result["reviewGenerationIssues"], [
            {"learnerId": str(pk), "code": "review_identity_unavailable"} for pk in (3, 4)
        ])
        self.generate.assert_not_called()

    def test_database_failure_still_fails_closed_without_generation(self):
        self.pairs.filter.side_effect = DatabaseError("connection unavailable")
        with self.assertRaisesMessage(DatabaseError, "connection unavailable"):
            views.resolve_coach_review_events("coach@example.invalid", "Coach", [self.unresolved(1)])
        self.generate.assert_not_called()
        self.imported.assert_not_called()

    def test_strict_identity_api_still_rejects_missing_link(self):
        with self.assertRaisesMessage(DatabaseError, "Review enrolment identity unavailable"):
            views.resolve_effective_aptem_ids([self.unresolved(3)], strict=True)

