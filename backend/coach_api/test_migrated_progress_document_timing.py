"""Synthetic progress/document sequences; never infer the production sequence."""
from copy import deepcopy
from io import BytesIO
import json
from types import SimpleNamespace
from unittest.mock import patch

from django.test import RequestFactory, TestCase
from pypdf import PdfReader

from . import migrated_completion as completion, migrated_completion_views as party, views
from . import test_migrated_progress as fixtures
from .test_migrated_pdf_download import create_review
from .test_migrated_pdf_parity import CONTEXT


def pdf_text(content):
    return '\n'.join(page.extract_text() for page in PdfReader(BytesIO(bytes(content))).pages)


class ProgressDocumentTimingTests(TestCase):
    setUp = fixtures.MigratedProgressPersistenceTests.setUp
    post = fixtures.MigratedProgressPersistenceTests.post
    context = fixtures.MigratedProgressPersistenceTests.context

    def finish_synthetic_review(self):
        completion.submit(self.overlay, self.overlay.answers)
        if self.overlay.status == 'awaiting-signature':
            for role in completion.required_roles(self.overlay):
                completion.sign(self.overlay, role, account=SimpleNamespace(pk=1,
                    email='synthetic@example.invalid', display_name='Synthetic signer'), signature=fixtures.PNG)
            completion.complete(self.overlay)
        self.overlay.refresh_from_db()

    def test_calculate_then_sign_and_first_document_retains_same_snapshot(self):
        response, _ = self.post()
        self.assertEqual(response.status_code, 200)
        returned = json.loads(response.content)['progressSnapshot']
        self.assertEqual(returned, fixtures.SNAPSHOT)
        self.assertEqual(views._imported_review_definition(fixtures.OWNER, self.overlay.event_key)['progressSnapshot'], returned)
        self.finish_synthetic_review()
        self.assertEqual(self.overlay.progress_snapshot, returned)
        for role in ('learner', 'employer'):
            with self.subTest(role=role), \
                 patch.object(party, 'authenticate_request', return_value=SimpleNamespace(role=role)), \
                 patch.object(party, '_party_overlay', return_value=self.overlay), \
                 patch.object(party.LearnerProfile.objects, 'filter') as profiles:
                profiles.return_value.first.return_value = SimpleNamespace(pk=self.overlay.learner_id)
                result = party.migrated_review_party_detail(RequestFactory().get('/'), self.overlay.event_key)
                self.assertEqual(json.loads(result.content)['progressSnapshot'], returned)
        document = completion.ensure_document(self.overlay, **CONTEXT)
        self.assertEqual(document.overlay_id, self.overlay.pk)
        self.assertIn('73%', pdf_text(document.pdf_bytes))
        self.assertNotIn('No progress snapshot was calculated', pdf_text(document.pdf_bytes))

    def test_completed_pdf_without_snapshot_rejects_late_calculate_and_preserves_bytes(self):
        self.finish_synthetic_review()
        document = completion.ensure_document(self.overlay, **CONTEXT)
        original, checksum, created = bytes(document.pdf_bytes), document.sha256, document.created_at
        self.assertIn('No progress snapshot was calculated', pdf_text(original))
        response, calculator = self.post()
        self.assertEqual(response.status_code, 409)
        calculator.assert_not_called()
        self.assertIsNone(self.overlay.progress_snapshot)
        same = completion.ensure_document(self.overlay, **CONTEXT)
        self.assertEqual((bytes(same.pdf_bytes), same.sha256, same.created_at), (original, checksum, created))

    def test_calculating_another_occurrence_cannot_populate_earlier_document(self):
        other = create_review(source_id=70000002)
        other.learner_id, other.owner_email, other.progress_snapshot = self.overlay.learner_id, fixtures.OWNER, None
        other.save()  # Synthetic fixture preparation only.
        document = completion.ensure_document(other, **CONTEXT)
        original = bytes(document.pdf_bytes)
        self.assertEqual(self.post()[0].status_code, 200)
        other.refresh_from_db()
        self.assertIsNone(other.progress_snapshot)
        self.assertNotEqual(other.event_key, self.overlay.event_key)
        self.assertEqual(bytes(completion.ensure_document(other, **CONTEXT).pdf_bytes), original)
        self.assertIn('No progress snapshot was calculated', pdf_text(original))

    def test_existing_document_is_not_regenerated_from_a_different_current_snapshot(self):
        # A historical fixture can contain mismatched versions. This is not a
        # supported API sequence or authorization to change a completed review.
        self.finish_synthetic_review()
        old = completion.ensure_document(self.overlay, **CONTEXT)
        display = deepcopy(self.overlay)
        display.progress_snapshot = deepcopy(fixtures.SNAPSHOT)
        with patch.object(completion, 'build_pdf', side_effect=AssertionError('Historical regeneration')):
            existing = completion.ensure_document(display, **CONTEXT)
        self.assertEqual(existing.pk, old.pk)
        self.assertEqual(existing.sha256, old.sha256)
        self.assertIn('No progress snapshot was calculated', pdf_text(existing.pdf_bytes))
