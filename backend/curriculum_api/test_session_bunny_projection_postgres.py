"""Real PostgreSQL projection checks; only run on an isolated test database."""
import json
from unittest import skipUnless
from unittest.mock import patch

from django.db import connection
from django.test import TestCase
from django.test import RequestFactory

from .bunny_stream import VideoImportError
from .models import CurriculumVideoImport
from .session_bunny import publish_outcome


@skipUnless(connection.vendor == 'postgresql', 'Requires isolated PostgreSQL JSONB and scope checks')
class SessionBunnyProjectionTests(TestCase):
    def setUp(self):
        with connection.cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.programmes
                (programme_id,name,color,created_at,updated_at)
                VALUES ('BUNNY-P','Synthetic Bunny programme','#123456',now(),now())''')
            cursor.execute('''INSERT INTO curriculum.modules
                (module_catalogue_id,title,programme_id,cohort_id,group_id)
                VALUES ('BUNNY-M','Synthetic Bunny module','BUNNY-P','BUNNY-C','BUNNY-G')''')
            cursor.execute('''INSERT INTO curriculum.live_sessions
                (id,module_catalogue_id,organizer_email,status)
                VALUES ('BUNNY-S','BUNNY-M','owner@example.invalid','active')''')
            cursor.execute('''INSERT INTO curriculum.live_session_occurrences
                (id,live_session_id,session_number,scheduled_start,scheduled_end,status)
                VALUES ('BUNNY-O','BUNNY-S',7,'2026-11-06 09:00','2026-11-06 11:00','completed')''')
            cursor.execute('''INSERT INTO curriculum.live_session_artifacts
                (id,occurrence_id,artifact_type,graph_artifact_id,metadata)
                VALUES ('BUNNY-A','BUNNY-O','recording','BUNNY-REC',
                        '{"lmsHiddenFromLearners":true,"unrelated":"retained"}'::jsonb)''')
        self.asset = CurriculumVideoImport.objects.create(
            target_kind='live_session', target_id='BUNNY-S', component_id='BUNNY-A',
            fingerprint='synthetic-bunny-projection', title='Synthetic recording', status='ready',
            library_id='798153', video_id='c1c2c3c4-1234-5678-abcd-123456789abc',
            collection_id='synthetic-collection', scope={
                'module_id': 'BUNNY-M', 'programme_id': 'BUNNY-P', 'cohort_id': 'BUNNY-C',
                'group_id': 'BUNNY-G', 'occurrence_id': 'BUNNY-O', 'graph_artifact_id': 'BUNNY-REC'})

    def archive(self, name):
        with connection.cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.session_result_archive
                (artifact_id,occurrence_id,container,blob_name,status)
                VALUES ('BUNNY-A','BUNNY-O','session-recordings',%s,'ready')''', [name])

    def saved(self):
        with connection.cursor() as cursor:
            cursor.execute('''SELECT a.metadata,r.container,r.blob_name,r.status
                FROM curriculum.live_session_artifacts a
                LEFT JOIN curriculum.session_result_archive r ON r.artifact_id=a.id
                WHERE a.id='BUNNY-A' ''')
            row = cursor.fetchone()
            return (json.loads(row[0]) if isinstance(row[0], str) else row[0], *row[1:])

    def test_bunny_identity_mislabeled_as_azure_is_repaired_idempotently(self):
        name = self.asset.library_id + '/' + self.asset.video_id
        self.archive(name)
        publish_outcome(self.asset)
        first = self.saved()
        publish_outcome(self.asset)
        self.assertEqual(self.saved(), first)
        metadata, container, saved_name, status = first
        self.assertEqual((container, saved_name, status), ('bunny-stream', name, 'ready'))
        self.assertEqual(metadata['lmsBunnyRecording']['videoId'], self.asset.video_id)
        self.assertTrue(metadata['lmsHiddenFromLearners'])
        self.assertEqual(metadata['unrelated'], 'retained')
        self.assertEqual(CurriculumVideoImport.objects.count(), 1)

    def test_valid_historical_azure_reference_is_retained_for_rollback(self):
        self.archive('original/module/session/recording.mp4')
        publish_outcome(self.asset)
        metadata, container, name, status = self.saved()
        self.assertEqual((container, name, status),
                         ('session-recordings', 'original/module/session/recording.mp4', 'ready'))
        self.assertEqual(metadata['lmsBunnyRecording']['state'], 'ready')

    def test_metadata_only_repair_preserves_archive_readiness_and_the_original_path(self):
        from .session_recording_review import queue_missing_recording
        path = 'original/module/session/recording.mp4'
        self.archive(path)
        self.assertTrue(queue_missing_recording('BUNNY-A', 'BUNNY-S', 'session-recordings', path, provider='bunny'))
        self.assertEqual(self.saved()[1:], ('session-recordings', path, 'ready'))
        publish_outcome(self.asset)
        metadata, container, name, status = self.saved()
        self.assertEqual((container, name, status), ('session-recordings', path, 'ready'))
        self.assertEqual(metadata['lmsBunnyRecording']['state'], 'ready')

    def test_other_delivery_cannot_publish_or_repair_the_reference(self):
        self.archive(self.asset.library_id + '/' + self.asset.video_id)
        before = self.saved()
        self.asset.scope['group_id'] = 'OTHER-GROUP'
        with self.assertRaises(VideoImportError):
            publish_outcome(self.asset)
        self.assertEqual(self.saved(), before)

    def test_other_occurrence_cannot_publish_or_repair_the_reference(self):
        before = self.saved()
        self.asset.scope['occurrence_id'] = 'OTHER-OCCURRENCE'
        with self.assertRaises(VideoImportError):
            publish_outcome(self.asset)
        self.assertEqual(self.saved(), before)

    def test_mismatched_archive_occurrence_cannot_bypass_the_cutover(self):
        from .session_results import stored_content
        self.archive('original/recording.mp4')
        with connection.cursor() as cursor:
            cursor.execute('''INSERT INTO curriculum.live_session_occurrences
                (id,live_session_id,session_number,scheduled_start,scheduled_end,status)
                VALUES ('BUNNY-OLD','BUNNY-S',6,'2026-10-30 09:00','2026-10-30 11:00','completed')''')
            cursor.execute("UPDATE curriculum.session_result_archive SET occurrence_id='BUNNY-OLD' WHERE artifact_id='BUNNY-A'")
        with patch('learner_api.evidence_storage.get_read_sas', return_value='https://storage.invalid/old.mp4') as azure:
            response = stored_content(RequestFactory().get('/recording/'), 'BUNNY-S', 'BUNNY-A')
        self.assertEqual(response.status_code, 409)
        azure.assert_not_called()
