"""Synthetic Aptem respondent permissions; no Graph, source or evidence writes."""
from copy import deepcopy
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from inspect import unwrap
import json
from threading import Event
from types import SimpleNamespace
from unittest import skipUnless
from unittest.mock import patch

from django.db import connections, transaction
from django.test import RequestFactory, SimpleTestCase, TestCase, TransactionTestCase

from . import migrated_completion_views as endpoints, views
from .migrated_completion import requirements_for_family
from .migrated_reviews import render_sections
from .migrated_summary_binding import answer_version
from .migrated_template_sync import synchronize_locked
from .migrated_templates import snapshot_for, validate_managed_definition
from .models import ImportedReviewInstance, MigratedReviewTemplate
from .test_migrated_auto_completion import source_identity
from .test_migrated_template_sync import SOURCE_TYPES, field, form


def fixture(family="PR"):
    template = MigratedReviewTemplate.objects.create(scope="GLOBAL", review_family=family,
        name="Synthetic respondent form", is_active=True, definition_json=form(
            field("coach"), field("learner", respondentRoles=["participant"], mandatory=True),
            field("employer", respondentRoles=["employer"]),
            field("shared", respondentRoles=["participant", "employer"]),
            field("gate", 6, respondentRoles=["participant"], ifTrue=[
                field("child", respondentRoles=["participant"], mandatory=True)])))
    review = ImportedReviewInstance.objects.create(event_key="imported-review:respondent-test",
        learner_id=17, source_review_id=7001, owner_email="coach@example.invalid",
        migrated_template=template, template_snapshot=snapshot_for(template), status="scheduled",
        answers={"coach": "Coach notes", "employer": "Employer notes", "gate": "no", "child": "Retained hidden answer"},
        signature_requirements=requirements_for_family(family))
    return template, review


def definition(owner, key, *, learners=None):
    review = ImportedReviewInstance.objects.get(event_key=key)
    if learners is not None:
        assert len(learners) == 1 and learners[0].id == review.learner_id
    sections, _ = render_sections(review.template_snapshot, review.answers,
                                 answer_audit=review.meeting_intelligence.get("answerEdits", {}))
    return {"migratedForm": True, "readOnly": review.status not in {"not-scheduled", "scheduled", "in-progress"},
            "localStatus": review.status, "migratedProgrammeKey": "id:synthetic",
            "instance": {"id": review.event_key, "learnerId": 17, "status": review.status},
            "historicalReview": {"id": "7001", "type": SOURCE_TYPES[review.migrated_template.review_family]},
            "sections": sections, "answerVersion": answer_version(review)}


@contextmanager
def identities(kind="apprenticeship", source_status="Scheduled"):
    with source_identity(kind, source_status=source_status), patch.object(views, "_imported_review_definition", side_effect=definition):
        yield


def post(review, answers, *, role="learner", subject_id=None, version=None, csrf=False, query="", extra=None):
    account = SimpleNamespace(pk=11, role=role, email=f"{role}@example.invalid",
                              subject_id=subject_id if subject_id is not None else (91 if role == "employer" else 71))
    request = RequestFactory().post("/party-answers" + query, json.dumps({"answers": answers,
        "answerVersion": answer_version(review) if version is None else version, **(extra or {})}), content_type="application/json")
    request._dont_enforce_csrf_checks = not csrf
    with patch.object(endpoints, "authenticate_request", return_value=account):
        return endpoints.migrated_review_party_answers(request, review.event_key)


class RespondentTemplateTests(SimpleTestCase):
    def test_employer_is_allowed_only_on_pr_families_including_conditional_questions(self):
        definition = form(field("gate", 6, ifTrue=[field("child", respondentRoles=["employer"])]))
        for family in ("PR", "PR_SKILLS_RADAR"):
            validate_managed_definition(definition, family=family)
        with self.assertRaisesRegex(ValueError, "Progress Reviews only"):
            validate_managed_definition(definition, family="MCM")

    def test_roles_are_optional_and_round_trip_at_every_depth(self):
        source = form(field("coach"), field("gate", 6, respondentRoles=["employer"],
            ifTrue=[field("child", respondentRoles=["participant"])]))
        validate_managed_definition(source)
        sections, _ = render_sections(source, {})
        self.assertEqual(sections[0]["fields"][0]["configuration"]["respondentRoles"], [])
        self.assertEqual(sections[0]["fields"][1]["configuration"]["respondentRoles"], ["employer"])
        self.assertEqual(sections[0]["fields"][1]["yesFields"][0]["configuration"]["respondentRoles"], ["participant"])

    def test_invalid_roles_and_headings_are_rejected(self):
        for roles in (None, "participant", ["advisor"], ["referrer"], ["participant", "participant"], [{}]):
            with self.subTest(roles=roles), self.assertRaises(ValueError):
                validate_managed_definition(form(field("a", respondentRoles=roles)))
        with self.assertRaisesRegex(ValueError, "Headings"):
            validate_managed_definition(form(field("heading", 11, respondentRoles=["participant"])))


class RespondentAnswersTests(TestCase):
    def setUp(self):
        self.template, self.review = fixture()

    def test_each_family_and_learner_type_can_save_only_its_fields(self):
        base = deepcopy(self.template.definition_json)
        for family in SOURCE_TYPES:
            self.template.review_family = family
            self.template.definition_json = deepcopy(base)
            if family == "MCM":
                for item in self.template.definition_json["sections"][0]["fields"]:
                    item["respondentRoles"] = [role for role in item.get("respondentRoles", []) if role != "employer"]
            self.template.save()
            self.review.template_snapshot = snapshot_for(self.template)
            self.review.save()
            for kind in ("apprenticeship", "commercial"):
                for role, key in (("learner", "learner"),) if family == "MCM" else (("learner", "learner"), ("employer", "employer")):
                    with self.subTest(family=family, kind=kind, role=role), identities(kind):
                        before = deepcopy(self.review.answers)
                        response = post(self.review, {key: f"{family} {kind} {role}"}) if role == "learner" else post(self.review, {key: kind}, role=role)
                        self.assertEqual(response.status_code, 200, response.content)
                        self.review.refresh_from_db()
                        for other, value in before.items():
                            if other != key:
                                self.assertEqual(self.review.answers[other], value)
                        self.assertEqual(self.review.status, "scheduled")
                        self.assertEqual(json.loads(response.content)["answerVersion"], answer_version(self.review))
                        audit = self.review.meeting_intelligence["answerEdits"][key]
                        self.assertEqual(audit["role"], "participant" if role == "learner" else role)
                        self.assertEqual(audit["accountId"], 11)

    def test_mcm_rejects_employer_even_if_an_old_snapshot_contains_the_role(self):
        self.template.review_family = "MCM"
        self.template.definition_json = form(field("employer"))
        self.template.save()
        self.review.template_snapshot = snapshot_for(self.template)
        self.review.save()
        with identities():
            self.assertEqual(post(self.review, {"employer": "Not allowed"}, role="employer").status_code, 403)
        from .migrated_respondents import merge_party_answers
        self.review.template_snapshot["sections"][0]["fields"][0]["respondentRoles"] = ["employer"]
        with self.assertRaises(PermissionError):
            merge_party_answers(self.review, {"employer": "Still forbidden"}, "employer")

    def test_server_derives_role_and_rejects_entire_mixed_payload(self):
        before = deepcopy(self.review.answers)
        with identities():
            for answers in ({"coach": "spoof"}, {"employer": "spoof"}, {"unknown": "spoof"}, {"learner": "allowed", "coach": "spoof"}):
                response = post(self.review, answers, extra={"role": "advisor", "respondentRoles": ["participant"]})
                self.assertEqual(response.status_code, 403, response.content)
        self.review.refresh_from_db()
        self.assertEqual(self.review.answers, before)
        self.assertEqual(self.review.meeting_intelligence, {})

    def test_wrong_learner_employer_staff_and_view_as_cannot_write(self):
        with identities():
            for role, subject_id, expected in (("learner", 999, 404), ("employer", 999, 404), ("staff", 71, 403)):
                self.assertEqual(post(self.review, {"shared": "x"}, role=role, subject_id=subject_id).status_code, expected)
            self.assertEqual(post(self.review, {"learner": "x"}, query="?viewAsLearner=71").status_code, 403)
        with patch.object(endpoints, "authenticate_request", return_value=None):
            request = RequestFactory().post("/", "{}", content_type="application/json")
            request._dont_enforce_csrf_checks = True
            self.assertEqual(endpoints.migrated_review_party_answers(request, self.review.event_key).status_code, 401)

    def test_csrf_is_required(self):
        with identities():
            self.assertEqual(post(self.review, {"learner": "x"}, csrf=True).status_code, 403)

    def test_shared_answer_accepts_both_roles_and_rejects_stale_writes(self):
        old_version = answer_version(self.review)
        with identities():
            self.assertEqual(post(self.review, {"shared": "Learner draft"}).status_code, 200)
            self.assertEqual(post(self.review, {"shared": "Stale employer"}, role="employer", version=old_version).status_code, 409)
            self.review.refresh_from_db()
            self.assertEqual(post(self.review, {"shared": "Agreed draft"}, role="employer").status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.answers["shared"], "Agreed draft")
        self.assertEqual(self.review.meeting_intelligence["answerEdits"]["shared"]["role"], "employer")

    def test_conditions_use_merged_parent_and_preserve_hidden_answers(self):
        with identities():
            self.assertEqual(post(self.review, {"child": "Hidden write"}).status_code, 403)
            self.assertEqual(post(self.review, {"gate": "yes", "child": "Visible write"}).status_code, 200)
            self.review.refresh_from_db()
            self.assertEqual(post(self.review, {"gate": "no"}).status_code, 200)
        self.review.refresh_from_db()
        self.assertEqual(self.review.answers["child"], "Visible write")

    def test_child_can_be_answered_when_parent_is_coach_only(self):
        self.template.definition_json["sections"][0]["fields"][-1]["respondentRoles"] = []
        self.template.save()
        self.review.template_snapshot = snapshot_for(self.template)
        self.review.answers["gate"] = "yes"
        self.review.save()
        with identities():
            self.assertEqual(post(self.review, {"child": "Own child answer"}).status_code, 200)

    def test_draft_can_be_incomplete_and_invalid_values_do_not_persist(self):
        with identities():
            self.assertEqual(post(self.review, {"learner": ""}).status_code, 200)
            self.review.refresh_from_db()
            self.assertEqual(post(self.review, {"learner": {"spoof": "object"}}).status_code, 400)
            self.assertEqual(post(self.review, {"gate": "maybe"}).status_code, 400)
        self.review.refresh_from_db()
        self.assertEqual(self.review.answers["learner"], "")

    def test_submitted_completed_and_historical_source_cannot_be_changed(self):
        before = deepcopy(self.review.answers)
        for status in ("awaiting-signature", "completed"):
            self.review.status = status
            self.review.save()
            with identities():
                self.assertEqual(post(self.review, {"learner": "x"}).status_code, 409)
        with identities(source_status="Completed"):
            self.assertEqual(post(self.review, {"learner": "x"}).status_code, 404)
        self.review.refresh_from_db()
        self.assertEqual(self.review.answers, before)

    def test_new_template_permissions_are_checked_before_save_and_frozen_records_do_not_sync(self):
        self.template.definition_json["sections"][0]["fields"][1]["respondentRoles"] = []
        self.template.save()
        before = deepcopy(self.review.answers)
        with identities():
            self.assertEqual(post(self.review, {"learner": "Stale access"}).status_code, 409)
            self.review.refresh_from_db()
            self.assertEqual(post(self.review, {"learner": "Revoked access"}).status_code, 403)
        self.assertEqual(self.review.answers, before)
        self.review.status = "awaiting-signature"
        self.review.save()
        frozen = deepcopy(self.review.template_snapshot)
        self.template.definition_json["sections"][0]["fields"][1]["respondentRoles"] = ["participant"]
        self.template.save()
        with transaction.atomic():
            self.assertFalse(synchronize_locked(self.review, "PR", "id:synthetic"))
        self.assertEqual(self.review.template_snapshot, frozen)

    def test_read_does_not_write_or_expose_coach_tools_and_default_is_coach_only(self):
        version = answer_version(self.review)
        account = SimpleNamespace(role="learner", subject_id=71)
        with identities(), patch.object(endpoints, "authenticate_request", return_value=account):
            response = endpoints.migrated_review_party_detail(RequestFactory().get("/"), self.review.event_key)
        data = json.loads(response.content)
        self.assertFalse(data["readOnly"])
        self.assertFalse(data["canCalculateProgress"])
        self.assertNotIn("historicalReview", data)
        self.assertEqual(data["answerVersion"], version)
        self.review.refresh_from_db()
        self.assertEqual(answer_version(self.review), version)
        self.review.template_snapshot = form(field("coach"))
        self.review.save()
        with identities(), patch.object(endpoints, "authenticate_request", return_value=account):
            response = endpoints.migrated_review_party_detail(RequestFactory().get("/"), self.review.event_key)
        self.assertTrue(json.loads(response.content)["readOnly"])

    def test_coach_keeps_access_to_all_roles_and_records_real_actor(self):
        request = RequestFactory().post("/", json.dumps({"answers": {"coach": "C", "learner": "L", "employer": "E"},
            "answerVersion": answer_version(self.review)}), content_type="application/json")
        request.coach_email = self.review.owner_email
        with identities():
            response = unwrap(views.coach_review_instance_answers)(request, self.review.event_key)
        self.assertEqual(response.status_code, 200, response.content)
        self.review.refresh_from_db()
        self.assertEqual(self.review.meeting_intelligence["answerEdits"]["learner"]["role"], "advisor")
        data = json.loads(response.content)
        self.assertEqual(data["sections"][0]["fields"][1]["answeredBy"], self.review.owner_email)


@skipUnless(connections["default"].vendor == "postgresql", "Real row locking requires isolated PostgreSQL")
class RespondentRaceTests(TransactionTestCase):
    def test_waiting_save_rechecks_latest_version_and_submitted_status(self):
        for mutation in ("answer", "submit"):
            with self.subTest(mutation=mutation):
                template, review = fixture()
                attempted = Event()
                def worker():
                    def observe(execute, sql, params, many, context):
                        if "FOR UPDATE" in sql:
                            attempted.set()
                        return execute(sql, params, many, context)
                    try:
                        with source_identity(), connections["default"].execute_wrapper(observe):
                            return post(review, {"learner": "Stale learner"}).status_code
                    finally:
                        connections.close_all()
                with identities(), ThreadPoolExecutor(max_workers=1) as pool:
                    with transaction.atomic():
                        locked = ImportedReviewInstance.objects.select_for_update().get(pk=review.pk)
                        future = pool.submit(worker)
                        self.assertTrue(attempted.wait(10))
                        self.assertFalse(future.done())
                        if mutation == "answer":
                            locked.answers["learner"] = "New coach answer"
                        else:
                            locked.status = "awaiting-signature"
                        locked.save()
                    self.assertEqual(future.result(timeout=15), 409)
                review.refresh_from_db()
                self.assertNotEqual(review.answers.get("learner"), "Stale learner")
                review.delete()
                template.delete()
