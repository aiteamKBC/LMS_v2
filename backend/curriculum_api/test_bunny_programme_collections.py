"""Synthetic journal rows only; Bunny discovery and creation are mocked."""
import uuid
from unittest.mock import Mock

from django.test import TestCase

from .bunny_programme_collections import PENDING, programme_collection
from .bunny_stream import MissingProgrammeCollection, VideoImportError
from .models import CurriculumVideoImport

COLLECTION = 'c1c2c3c4-1234-5678-abcd-123456789abc'


class ProgrammeCollectionTests(TestCase):
    def setUp(self):
        self.client = Mock()
        self.client.collection.side_effect = MissingProgrammeCollection('Missing')
        self.client.create_programme_collection.return_value = COLLECTION

    def asset(self, *, programme='P', name='Example programme', library='798153', kind='live_session'):
        return CurriculumVideoImport.objects.create(target_kind=kind, target_id='MODULE', component_id='COMP',
            fingerprint=uuid.uuid4().hex, library_id=library,
            scope={'programme_id': programme, 'programme_name': name})

    def test_new_programme_is_provisioned_once_for_recordings_and_materials(self):
        one, two = self.asset(), self.asset(kind='module')
        self.assertEqual(programme_collection(one, self.client), COLLECTION)
        self.assertEqual(programme_collection(two, self.client), COLLECTION)
        self.client.create_programme_collection.assert_called_once_with('P', 'Example programme')
        self.client.collection.assert_called_once()
        self.assertTrue(CurriculumVideoImport.objects.filter(collection_id=COLLECTION).exists())
        self.assertFalse(any(asset.scope.get(PENDING) for asset in CurriculumVideoImport.objects.all()))

    def test_existing_destination_is_reused_without_create(self):
        self.client.collection.side_effect = None
        self.client.collection.return_value = COLLECTION
        self.assertEqual(programme_collection(self.asset(), self.client), COLLECTION)
        self.client.create_programme_collection.assert_not_called()

    def test_concurrent_attempt_observes_claim_before_first_post_finishes(self):
        one, two = self.asset(), self.asset()
        def create(*args):
            self.assertEqual(sum(bool(asset.scope.get(PENDING)) for asset in CurriculumVideoImport.objects.all()), 1)
            with self.assertRaisesRegex(VideoImportError, 'awaiting confirmation'):
                programme_collection(two, self.client)
            return COLLECTION
        self.client.create_programme_collection.side_effect = create
        self.assertEqual(programme_collection(one, self.client), COLLECTION)
        self.assertEqual(programme_collection(two, self.client), COLLECTION)
        self.client.create_programme_collection.assert_called_once()

    def test_lost_post_response_is_recovered_without_second_create(self):
        one, two = self.asset(), self.asset()
        self.client.create_programme_collection.side_effect = VideoImportError('Bunny could not be reached.')
        with self.assertRaises(VideoImportError):
            programme_collection(one, self.client)
        with self.assertRaisesRegex(VideoImportError, 'awaiting confirmation'):
            programme_collection(two, self.client)
        self.client.collection.side_effect = None
        self.client.collection.return_value = COLLECTION
        self.assertEqual(programme_collection(two, self.client), COLLECTION)
        self.client.create_programme_collection.assert_called_once()

    def test_definite_rejection_allows_normal_worker_retry(self):
        one = self.asset()
        self.client.create_programme_collection.side_effect = VideoImportError('Not permitted', status_code=403)
        with self.assertRaises(VideoImportError):
            programme_collection(one, self.client)
        one.refresh_from_db()
        self.assertNotIn(PENDING, one.scope)
        self.client.create_programme_collection.side_effect = None
        self.assertEqual(programme_collection(one, self.client), COLLECTION)
        self.assertEqual(self.client.create_programme_collection.call_count, 2)

    def test_discovery_failure_does_not_claim_or_create_destination(self):
        one = self.asset()
        self.client.collection.side_effect = VideoImportError('Ambiguous or unavailable collection list')
        with self.assertRaises(VideoImportError):
            programme_collection(one, self.client)
        one.refresh_from_db()
        self.assertNotIn(PENDING, one.scope)
        self.client.create_programme_collection.assert_not_called()

    def test_another_programme_or_library_does_not_reuse_destination(self):
        first = self.asset()
        programme_collection(first, self.client)
        programme_collection(self.asset(programme='OTHER', name='Another programme'), self.client)
        programme_collection(self.asset(library='123'), self.client)
        self.assertEqual(self.client.create_programme_collection.call_count, 3)

    def test_same_name_across_programme_ids_reuses_destination(self):
        programme_collection(self.asset(), self.client)
        programme_collection(self.asset(programme='OTHER', name=' Example  Programme '), self.client)
        self.client.create_programme_collection.assert_called_once()

    def test_saved_guid_survives_programme_rename_without_moving_video(self):
        first = self.asset()
        first.collection_id = COLLECTION
        first.save()
        self.assertEqual(programme_collection(self.asset(name='Renamed programme'), self.client), COLLECTION)
        self.client.collection.assert_not_called()
        self.client.create_programme_collection.assert_not_called()

    def test_missing_programme_never_creates_unassigned_collection(self):
        with self.assertRaises(VideoImportError):
            programme_collection(self.asset(programme=''), self.client)
        self.client.collection.assert_not_called()
        self.client.create_programme_collection.assert_not_called()
