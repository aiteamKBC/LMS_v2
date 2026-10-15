"""Issuing the four onboarding reviews from the learner's board, instead of the
learner booking them: the list of reviews and their state, and the staff-only
issue endpoint.

SimpleTestCase with the database layer mocked: nothing here queries a database.
"""
import json
import os
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import IntegrityError
from django.test import RequestFactory, SimpleTestCase

from learner_api import review_form
from learner_api.calendar import ONBOARDING_REVIEW_TYPES
from learner_api.models import EnrolmentReview

LEARNER = SimpleNamespace(pk=41, username="Sam Example", email="sam@example.test", programme="Marketing Executive Level 4")


def row(review_type, **extra):
    fields = {
        "event_key": f"key-{review_type}", "review_type": review_type, "status": EnrolmentReview.STATUS_ISSUED,
        "booked_at": None, "started_at": None, "form_completed": False, "form_completed_at": None,
        "section_status": {}, "reviewed_by": "", "coach_name": "Case Owner",
        "learner_signature": "", "learner_signed_name": "", "learner_signed_at": None,
        "admin_signature": "", "admin_signed_name": "", "admin_signed_at": None,
        "employer_signature": "", "employer_signed_name": "", "employer_signed_at": None,
        "employer_signature_required": None,
    }
    fields.update(extra)
    return SimpleNamespace(**fields)


class FakeRows(list):
    """Stands in for the EnrolmentReview queryset chain the views use."""

    def exclude(self, **_kwargs):
        return self

    def order_by(self, *_args):
        return self


class Base(SimpleTestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.rows = FakeRows()
        model = MagicMock()
        model.all_learners.filter.return_value.first.return_value = LEARNER
        for p in (
            patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "0"}),
            patch.dict(review_form.SOURCE_MODELS, {"apprenticeship": model, "commercial": model}),
            patch.object(EnrolmentReview.objects, "filter", side_effect=lambda **_kw: self.rows),
            patch.object(review_form, "_case_owner_record", return_value=("owner@example.test", "Case Owner", 7)),
        ):
            p.start()
            self.addCleanup(p.stop)
        create = patch.object(EnrolmentReview.objects, "create")
        self.create = create.start()
        self.addCleanup(create.stop)

    def list_reviews(self, kind="apprenticeship"):
        res = review_form.onboarding_reviews(self.factory.get("/"), kind=kind, pk=41)
        return res.status_code, json.loads(res.content)

    def issue(self, body, kind="apprenticeship"):
        request = self.factory.post("/", data=json.dumps(body), content_type="application/json")
        request.login_account = SimpleNamespace(display_name="Staff Member", email="staff@example.test")
        res = review_form.issue_onboarding_review(request, kind=kind, pk=41)
        return res.status_code, json.loads(res.content)


class ListTests(Base):
    def test_nothing_issued_yet(self):
        status, data = self.list_reviews()
        self.assertEqual(status, 200)
        self.assertEqual([r["type"] for r in data["reviews"]], list(ONBOARDING_REVIEW_TYPES))
        self.assertTrue(all(r["issued"] is False for r in data["reviews"]))
        self.assertFalse(data["allIssued"])

    def test_issued_and_previously_booked_reviews_both_count(self):
        self.rows.extend([
            row("eligibility-review", status=EnrolmentReview.STATUS_BOOKED, started_at="x"),
            row("uln-privacy", form_completed=True, section_status={"ulnPrivacyNotice": True, "learnerAcknowledgement": True, "comments": True}),
        ])
        _status, data = self.list_reviews()
        by_type = {r["type"]: r for r in data["reviews"]}
        self.assertTrue(by_type["eligibility-review"]["issued"])
        self.assertTrue(by_type["eligibility-review"]["started"])
        self.assertEqual(by_type["uln-privacy"]["eventKey"], "key-uln-privacy")
        self.assertTrue(by_type["uln-privacy"]["completed"])
        self.assertFalse(by_type["workspace"]["issued"])

    def test_commercial_learners_have_none(self):
        _status, data = self.list_reviews(kind="commercial")
        self.assertEqual(data["reviews"], [])
        self.assertFalse(data["allIssued"])


class IssueTests(Base):
    def test_issues_a_review_with_no_booking_behind_it(self):
        status, data = self.issue({"type": "workspace"})
        self.assertEqual(status, 201)
        kwargs = self.create.call_args.kwargs
        self.assertEqual(kwargs["event_key"], "review:apprenticeship:41:workspace")
        self.assertEqual(kwargs["status"], EnrolmentReview.STATUS_ISSUED)
        self.assertEqual((kwargs["coach_name"], kwargs["coach_email"], kwargs["coach_id"]), ("Case Owner", "owner@example.test", 7))
        self.assertEqual(kwargs["notes"], "Issued by Staff Member")
        # No meeting: nothing about a calendar slot is set.
        for field in ("scheduled_date", "scheduled_time", "meeting_link", "graph_event_id"):
            self.assertNotIn(field, kwargs)
        self.assertIn("reviews", data)

    def test_a_review_is_issued_once(self):
        self.rows.append(row("workspace"))
        status, data = self.issue({"type": "workspace"})
        self.assertEqual(status, 409)
        self.assertIn("already been issued", data["error"])
        self.create.assert_not_called()

    def test_a_concurrent_issue_hits_the_unique_key(self):
        self.create.side_effect = IntegrityError("duplicate key")
        status, _data = self.issue({"type": "training-plan"})
        self.assertEqual(status, 409)

    def test_refuses_unknown_types_commercial_learners_and_other_methods(self):
        self.assertEqual(self.issue({"type": "coffee"})[0], 400)
        self.assertEqual(self.issue({"type": "workspace"}, kind="commercial")[0], 400)
        res = review_form.issue_onboarding_review(self.factory.get("/"), kind="apprenticeship", pk=41)
        self.assertEqual(res.status_code, 405)
        self.create.assert_not_called()


class AccessTests(SimpleTestCase):
    """Only staff may issue; a learner may list their own reviews."""

    def setUp(self):
        self.factory = RequestFactory()
        p = patch.dict(os.environ, {"LEARNER_API_REQUIRE_AUTH": "1"})
        p.start()
        self.addCleanup(p.stop)

    def post_as(self, account):
        request = self.factory.post("/", data=json.dumps({"type": "workspace"}), content_type="application/json")
        with patch("login.permissions.authenticate_request", return_value=account), \
                patch.object(review_form, "_learner_for") as learner_for:
            res = review_form.issue_onboarding_review(request, kind="apprenticeship", pk=41)
        return res.status_code, learner_for

    def test_learners_and_anonymous_callers_cannot_issue(self):
        learner = SimpleNamespace(role="learner", subject_id=41, subject_type="learner", is_active=True)
        status, learner_for = self.post_as(learner)
        self.assertEqual(status, 403)
        learner_for.assert_not_called()
        status, learner_for = self.post_as(None)
        self.assertEqual(status, 401)
        learner_for.assert_not_called()


class EligibilityReviewSectionsTests(SimpleTestCase):
    def test_the_programme_status_selector_is_not_part_of_the_eligibility_review(self):
        sections = review_form.sections_for("eligibility-review")
        self.assertNotIn("programmeStatus", sections)
        self.assertEqual(sections, ("ilr", "extendedIlr", "functionalSkills", "fsJobRoleDiscussion", "comments"))
        # Its progress no longer counts it: five sections, all done, is complete.
        done, total = review_form._progress(SimpleNamespace(review_type="eligibility-review", section_status={s: True for s in sections}))
        self.assertEqual((done, total), (5, 5))
