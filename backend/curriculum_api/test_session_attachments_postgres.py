"""Real SQL/transactions; only run on the verified disposable PostgreSQL runner."""
import io
from datetime import datetime, timedelta, timezone
from unittest.mock import patch

from django.db import connections
from django.test import TransactionTestCase

from .models import LiveSession, LiveSessionOccurrence
from .session_attachments import save_file
from .session_results import read
from .session_attachment_policy import AttachmentError


class SessionAttachmentPersistenceTests(TransactionTestCase):
    databases = {'default', 'enrolment'}

    def setUp(self):
        target = connections['default'].settings_dict
        assert target['HOST'] == '127.0.0.1' and target['NAME'].startswith('test_lms_gate_')
        LiveSession.objects.create(id='ATTACH-S1', module_catalogue_id=None, module_title='Synthetic session')
        start = datetime(2030, 1, 1, 9, tzinfo=timezone.utc)
        for number in (1, 2):
            LiveSessionOccurrence.objects.create(id=f'ATTACH-O{number}', live_session_id='ATTACH-S1',
                session_number=number, scheduled_start=start + timedelta(days=number), scheduled_end=start + timedelta(days=number, hours=1))
        self.occurrence = {'id': 'ATTACH-O1', 'live_session_id': 'ATTACH-S1'}

    def tearDown(self):
        with connections['default'].cursor() as cursor:
            cursor.execute("DELETE FROM curriculum.session_result_archive WHERE occurrence_id IN ('ATTACH-O1','ATTACH-O2')")
            cursor.execute("DELETE FROM curriculum.live_session_artifacts WHERE occurrence_id IN ('ATTACH-O1','ATTACH-O2')")
        LiveSessionOccurrence.objects.filter(live_session_id='ATTACH-S1').delete()
        LiveSession.objects.filter(id='ATTACH-S1').delete()

    def test_repeated_upload_keeps_one_artifact_one_object_and_original_name(self):
        with patch('curriculum_api.session_attachment_storage.store', return_value='private-test-container') as store:
            first = save_file(self.occurrence, io.BytesIO(b'%PDF-synthetic'), 'Original.pdf', source_reference='first')
            again = save_file(self.occurrence, io.BytesIO(b'%PDF-synthetic'), 'Renamed.pdf', source_reference='second')
        self.assertEqual(first, again); self.assertEqual(store.call_count, 1)
        rows = read('SELECT metadata FROM curriculum.live_session_artifacts WHERE id=%s', [first])
        meta = rows[0]['metadata']
        if isinstance(meta, str): meta = __import__('json').loads(meta)
        self.assertEqual(meta['lmsSessionAttachment']['fileName'], 'Original.pdf')
        self.assertEqual(meta['lmsSessionAttachment']['sourceReferences'], ['first', 'second'])
        self.assertEqual(read('SELECT status FROM curriculum.session_result_archive WHERE artifact_id=%s', [first])[0]['status'], 'ready')

    def test_failed_storage_retries_the_same_identity_and_object_path(self):
        with patch('curriculum_api.session_attachment_storage.store', side_effect=RuntimeError('opaque upstream')):
            with self.assertRaises(AttachmentError): save_file(self.occurrence, io.BytesIO(b'%PDF-retry'), 'Slides.pdf')
        before = read('SELECT artifact_id,blob_name,status FROM curriculum.session_result_archive WHERE occurrence_id=%s', ['ATTACH-O1'])
        self.assertEqual(before[0]['status'], 'failed')
        with patch('curriculum_api.session_attachment_storage.store', return_value='private-test-container') as store:
            result = save_file(self.occurrence, io.BytesIO(b'%PDF-retry'), 'Changed.pdf')
        self.assertEqual(result, before[0]['artifact_id'])
        self.assertEqual(store.call_args.args[1], before[0]['blob_name'])

    def test_another_session_is_isolated_and_a_forged_series_is_rejected(self):
        with patch('curriculum_api.session_attachment_storage.store', return_value='private-test-container'):
            first = save_file(self.occurrence, io.BytesIO(b'%PDF-synthetic'), 'Slides.pdf')
            other = save_file({'id': 'ATTACH-O2', 'live_session_id': 'ATTACH-S1'}, io.BytesIO(b'%PDF-synthetic'), 'Slides.pdf')
            self.assertNotEqual(first, other)
            with self.assertRaises(AttachmentError):
                save_file({'id': 'ATTACH-O1', 'live_session_id': 'OTHER-SERIES'}, io.BytesIO(b'%PDF-forged'), 'Slides.pdf')
