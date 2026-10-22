"""Read-only document access: mock storage/ORM, preserve the real ownership gates."""
import json
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.http import HttpResponse
from django.test import RequestFactory, SimpleTestCase
from django.urls import resolve

from learner_api import employer_portal
from learner_api.models import ApprenticeshipAgreement, TrainingPlanDocument, WrittenAgreement


class EmployerDocumentPreviewTests(SimpleTestCase):
    def setUp(self):
        self.account = SimpleNamespace(role="employer", subject_id=9)
        self.learner = SimpleNamespace(pk=101, employer_id=9, email="learner@example.invalid")
        model = MagicMock()
        model.all_learners.get.return_value = self.learner
        model.DoesNotExist = LookupError
        self.definition = {"template": {"visibleTo": {"employer": True}}, "instance": {"id": "ri-1"}}
        self.instance = {"learner_id": 201}
        self.snapshot = {"id": "doc-1", "particulars": {"standard": "Frozen standard"}}
        self.document_readers = {}
        for name, target, value in [
            ("auth", "login.permissions.authenticate_request", None),
            ("employer", "learner_api.employer_portal._employer_or_404", (SimpleNamespace(pk=9), None)),
            ("profile", "learner_api.calendar._calendar_profile", SimpleNamespace(pk=201)),
            ("event", "learner_api.employer_portal.CoachCalendarEvent.objects.filter", MagicMock()),
            ("instance_reader", "curriculum_api.review_instances.get_review_instance", self.instance),
            ("definition_reader", "curriculum_api.review_instances.review_instance_form_definition", self.definition),
        ]:
            mock = self.enterContext(patch(target, return_value=value))
            setattr(self, name, mock)
        self.auth.side_effect = lambda request: self.account
        self.event.return_value.first.return_value = None
        self.enterContext(patch.object(employer_portal, "SOURCE_MODELS", {"commercial": model, "apprenticeship": model}))
        self.enterContext(patch.dict("os.environ", {"LEARNER_API_REQUIRE_AUTH": "1"}))
        for model, serializer in [
            (ApprenticeshipAgreement, "learner_api.apprenticeship_agreement._agreement_json"),
            (TrainingPlanDocument, "learner_api.training_plan_document._document_json"),
            (WrittenAgreement, "learner_api.written_agreement._document_json"),
        ]:
            self.document_readers[model] = self.enterContext(patch.object(model.objects, "filter"))
            self.enterContext(patch(serializer, return_value=self.snapshot))

    def get(self, document_kind="agreement", kind="commercial", method="get"):
        return employer_portal.employer_document_preview(
            getattr(RequestFactory(), method)("/document/"), employer_id=9, kind=kind, learner_id=101,
            document_kind=document_kind, document_id="doc-1",
        )

    def review(self, *, as_pdf=False, kind="commercial", method="get"):
        return employer_portal.employer_review_instance(
            getattr(RequestFactory(), method)("/review/"), employer_id=9, kind=kind, learner_id=101,
            event_key="ri-1", as_pdf=as_pdf,
        )

    def test_returns_only_the_selected_issued_snapshot_for_each_kind(self):
        for kind in ("commercial", "apprenticeship"):
            for document_kind, model in (("agreement", ApprenticeshipAgreement),
                                         ("training-plan", TrainingPlanDocument), ("written-agreement", WrittenAgreement)):
                with self.subTest(kind=kind, document_kind=document_kind):
                    response = self.get(document_kind, kind)
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(json.loads(response.content)["document"], self.snapshot)
                    self.assertEqual(response["Cache-Control"], "private, no-store")
                    self.document_readers[model].assert_called_with(
                        pk="doc-1", learner_id=101, learner_kind=kind, status=model.STATUS_ACTIVE,
                    )

    def test_missing_or_superseded_snapshot_is_not_replaced_with_current_data(self):
        self.document_readers[ApprenticeshipAgreement].return_value.first.return_value = None
        self.assertEqual(self.get().status_code, 404)

    def test_other_employers_and_non_employer_roles_are_refused(self):
        for account, status in ((None, 401), (SimpleNamespace(role="learner", subject_id=101), 403),
                                (SimpleNamespace(role="employer", subject_id=10), 404)):
            self.account = account
            for read in (self.get, self.review, lambda: self.review(as_pdf=True)):
                with self.subTest(account=account, read=read):
                    self.assertEqual(read().status_code, status)

    def test_owned_employer_cannot_read_another_learner(self):
        self.learner.employer_id = 10
        for kind in ("commercial", "apprenticeship"):
            self.assertEqual(self.get(kind=kind).status_code, 403)
            self.assertEqual(self.review(kind=kind).status_code, 403)
            self.assertEqual(self.review(kind=kind, as_pdf=True).status_code, 403)

    def test_unknown_kinds_and_writes_are_refused(self):
        self.assertEqual(self.get("unknown").status_code, 404)
        self.assertEqual(self.get(kind="unknown").status_code, 404)
        self.assertEqual(self.get(method="post").status_code, 405)
        self.assertEqual(self.review(as_pdf=True, method="post").status_code, 405)

    def test_native_review_preview_returns_existing_definition_without_mutation(self):
        with patch("curriculum_api.review_instances.save_review_instance_answers_for_role") as save, \
                patch("curriculum_api.review_instances.record_review_instance_signature") as sign:
            for kind in ("commercial", "apprenticeship"):
                response = self.review(kind=kind)
                self.assertEqual(json.loads(response.content), self.definition)
                self.assertEqual(response["Cache-Control"], "private, no-store")
            save.assert_not_called()
            sign.assert_not_called()

    def test_native_pdf_uses_existing_export_and_signature_rules(self):
        expected = HttpResponse(b"%PDF-1.7 example", content_type="application/pdf")
        with patch("curriculum_api.review_pdf.mcm_pdf_response", return_value=expected) as render:
            for kind in ("commercial", "apprenticeship"):
                self.assertIs(self.review(as_pdf=True, kind=kind), expected)
                self.assertEqual(render.call_args.args[0], self.definition)
        # Real availability gate, with an incomplete definition, refuses export.
        self.definition.update({"template": {"visibleTo": {"employer": True}, "reviewTypeCode": "progress_review"},
                                "signatures": {}, "instance": {"id": "ri-1", "status": "draft"}})
        self.assertEqual(self.review(as_pdf=True).status_code, 409)

    def test_staff_can_preview_owned_documents_through_the_existing_portal_gate(self):
        for role in ("staff", "admin"):
            self.account = SimpleNamespace(role=role, subject_id=500)
            self.assertEqual(self.get().status_code, 200)
            self.assertEqual(self.review().status_code, 200)

    def test_native_review_from_another_profile_is_hidden(self):
        self.instance["learner_id"] = 202
        self.assertEqual(self.review().status_code, 404)
        self.assertEqual(self.review(as_pdf=True).status_code, 404)

    def test_native_review_hidden_from_employer_stays_hidden(self):
        self.definition["template"]["visibleTo"]["employer"] = False
        self.assertEqual(self.review().status_code, 403)
        self.assertEqual(self.review(as_pdf=True).status_code, 403)

    def test_pdf_route_does_not_resolve_as_an_event_key(self):
        route = resolve("/learner_api/employer-portal/9/learner/commercial/101/events/cal:ri-1/review/pdf/")
        self.assertTrue(route.kwargs["as_pdf"])
        self.assertEqual(route.kwargs["event_key"], "cal:ri-1")

    def test_stored_pdf_is_scoped_and_has_no_schema_side_effect(self):
        with patch("enrolment_api.documents._conn") as connection, \
                patch("enrolment_api.documents.azure_configured", return_value=True), \
                patch("enrolment_api.documents.get_download_sas", return_value="https://storage.example.invalid/document.pdf") as sas, \
                patch("enrolment_api.documents.ensure_enrolment_documents_table") as ensure:
            cursor = connection.return_value.cursor.return_value.__enter__.return_value
            cursor.fetchone.return_value = ("container", "saved.pdf", "custom-employer-document")
            response = self.get("document")
            self.assertEqual(response.status_code, 200)
            self.assertEqual(cursor.execute.call_args.args[1], ["doc-1", "commercial", 101])
            sas.assert_called_once_with("container", "saved.pdf")
            ensure.assert_not_called()
            cursor.fetchone.return_value = None
            self.assertEqual(self.get("document").status_code, 404)

    def test_learner_only_stored_document_is_hidden(self):
        with patch("enrolment_api.documents._conn") as connection, \
                patch("enrolment_api.documents.SIGNING_PARTIES", {"private": ("learner",)}), \
                patch("enrolment_api.documents.get_download_sas") as sas:
            connection.return_value.cursor.return_value.__enter__.return_value.fetchone.return_value = ("container", "saved.pdf", "private")
            self.assertEqual(self.get("document").status_code, 404)
            sas.assert_not_called()
