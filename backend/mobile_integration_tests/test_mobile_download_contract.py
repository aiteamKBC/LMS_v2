"""Protect the assigned-course internal APK against anonymous/staff/unassigned access."""
import tempfile,unittest
from pathlib import Path
from unittest.mock import patch
from django.test import override_settings
import test_mobile_contract as base

class DownloadTests(unittest.TestCase):
    setUp=base.MobileFacadeTests.setUp
    request=base.MobileFacadeTests.request

    def test_anonymous_denied(self):
        base.mobile.authenticate_request.return_value=None
        self.assertEqual(base.mobile.download_android(self.request()).status_code,401)

    def test_staff_denied(self):
        self.account.role='admin'
        self.assertEqual(base.mobile.download_android(self.request()).status_code,403)

    def test_unassigned_denied_even_with_stale_content(self):
        self.plan.clear()
        self.detail['week']=[];self.detail['components']=[{'moduleId':'OTHER'}]
        self.assertEqual(base.mobile.download_android(self.request()).status_code,403)

    def test_closed_learning_access_denied(self):
        self.detail['learningAccess']['blocked']=True
        self.assertEqual(base.mobile.download_android(self.request()).status_code,403)

    @override_settings(KBC_MOBILE_API_ENABLED=False)
    def test_release_gate(self):
        self.assertEqual(base.mobile.download_android(self.request()).status_code,503)

    def test_missing_artifact_is_unavailable(self):
        with patch.object(base.mobile,'ANDROID_APK_PATH','/does-not-exist/kbc.apk'):
            self.assertEqual(base.mobile.download_android(self.request()).status_code,503)

    def test_entitled_learner_gets_private_attachment(self):
        self.plan[:] = [{"moduleId": "RISK-M01", "moduleTitle": "Risk"}]
        with tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent) as d:
            assert Path(d).resolve().is_relative_to(Path(__file__).resolve().parent)
            p=Path(d)/'test.apk';p.write_bytes(b'synthetic-apk-fixture')
            with patch.object(base.mobile,'ANDROID_APK_PATH',str(p)):
                response=base.mobile.download_android(self.request())
                try:
                    self.assertEqual(response.status_code,200)
                    self.assertEqual(response['Cache-Control'],'private, no-store, no-transform')
                    self.assertIn('attachment',response['Content-Disposition'])
                    self.assertEqual(b''.join(response.streaming_content),b'synthetic-apk-fixture')
                finally:response.close()
