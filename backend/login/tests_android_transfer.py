import hashlib
import io
from django.test import SimpleTestCase, RequestFactory
from learner_api.android_download import installer_response

class InstallerTransferTests(SimpleTestCase):
    data = bytes(range(256)) * 10000

    def response(self, **headers):
        return installer_response(RequestFactory().get("/download", **headers), io.BytesIO(self.data))

    def test_full_file_length_digest_and_private_headers(self):
        response = self.response()
        self.assertEqual(b"".join(response.streaming_content), self.data)
        self.assertEqual(response["Content-Length"], str(len(self.data)))
        self.assertEqual(response["X-APK-SHA256"], hashlib.sha256(self.data).hexdigest())
        self.assertIn("no-transform", response["Cache-Control"])
        response.close()
        self.assertTrue(response.source.closed)

    def test_interrupted_download_can_resume_without_lost_or_duplicate_bytes(self):
        first = self.response(HTTP_RANGE="bytes=0-1048575")
        part = b"".join(first.streaming_content)
        etag = first["ETag"]
        first.close()
        second = self.response(HTTP_RANGE="bytes=1048576-", HTTP_IF_RANGE=etag)
        self.assertEqual(second.status_code, 206)
        self.assertEqual(part + b"".join(second.streaming_content), self.data)
        self.assertEqual(second["Content-Range"], f"bytes 1048576-{len(self.data)-1}/{len(self.data)}")
        second.close()

    def test_suffix_bounds_and_invalid_ranges(self):
        response = self.response(HTTP_RANGE="bytes=-12")
        self.assertEqual(b"".join(response.streaming_content), self.data[-12:])
        response.close()
        for value in ("bytes=-0", "bytes=5-2", "bytes=999999999-", "bytes=0-1,3-4", "bytes=-"):
            response = self.response(HTTP_RANGE=value)
            self.assertEqual(response.status_code, 416)
            self.assertEqual(response["Content-Range"], f"bytes */{len(self.data)}")

    def test_if_range_changed_returns_whole_new_file(self):
        response = self.response(HTTP_RANGE="bytes=10-20", HTTP_IF_RANGE='"old-build"')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(b"".join(response.streaming_content), self.data)
        response.close()

    def test_closing_before_first_read_releases_file(self):
        response = self.response(HTTP_RANGE="bytes=0-100")
        response.close()
        self.assertTrue(response.source.closed)

