"""Exercise actual Drive transport helpers without app startup, DB or network."""
import ast
import html
import http.cookiejar
from pathlib import Path
import re
import socket
import unittest
import urllib.error
import urllib.parse
import urllib.request
from unittest.mock import Mock, patch


def helpers():
    tree = ast.parse(Path(__file__).with_name("media_proxy.py").read_text(encoding="utf-8"))
    names = {"_google_drive_warning_download_url", "_open_google_drive_file_once", "_open_google_drive_file"}
    scope = dict(html=html, http=http, re=re, urllib=urllib)
    nodes = [node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name in names]
    exec(compile(ast.Module(body=nodes, type_ignores=[]), "media_proxy.py", "exec"), scope)
    return scope


class DriveMediaRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.scope = helpers()
        self.addCleanup(patch.stopall)
        patch.object(socket, "socket", side_effect=AssertionError("Network prohibited")).start()

    def response(self, content_type="video/mp4", body=b""):
        response = Mock(headers={"Content-Type": content_type})
        response.read.return_value = body
        return response

    def test_confirmation_that_still_returns_html_is_closed_and_retried(self):
        warning = b'<form id="download-form" action="https://drive.usercontent.google.com/download"><input name="id" value="synthetic-file"></form>'
        first, rejected, video = self.response("text/html", warning), self.response("text/html"), self.response()
        opener = Mock()
        opener.open.side_effect = [first, rejected, video]
        with patch.object(urllib.request, "build_opener", return_value=opener):
            result = self.scope["_open_google_drive_file"]("synthetic-file", "bytes=0-511")
        self.assertIs(result, video)
        first.close.assert_called_once()
        rejected.close.assert_called_once()
        video.close.assert_not_called()
        self.assertEqual(opener.open.call_count, 3)
        for call in opener.open.call_args_list:
            self.assertEqual(call.args[0].get_header("Range"), "bytes=0-511")

    def test_persistent_html_stops_after_two_attempts(self):
        page = self.response("text/html", b"<html>Unavailable</html>")
        opener = Mock()
        opener.open.return_value = page
        with patch.object(urllib.request, "build_opener", return_value=opener):
            self.assertIsNone(self.scope["_open_google_drive_file"]("synthetic-file"))
        self.assertEqual(opener.open.call_count, 2)
        self.assertEqual(page.close.call_count, 2)

    def test_successful_stream_is_not_retried_or_read(self):
        video = self.response()
        once = Mock(return_value=video)
        self.scope["_open_google_drive_file_once"] = once
        self.assertIs(self.scope["_open_google_drive_file"]("synthetic-file", "bytes=200-"), video)
        once.assert_called_once_with("synthetic-file", "bytes=200-")
        video.read.assert_not_called()

    def test_transient_http_errors_are_retried_once(self):
        for code in [429, 500, 502, 503, 504]:
            with self.subTest(code=code):
                error = urllib.error.HTTPError("https://drive.google.com", code, "Temporary", {}, None)
                video = self.response()
                once = Mock(side_effect=[error, video])
                self.scope["_open_google_drive_file_once"] = once
                self.assertIs(self.scope["_open_google_drive_file"]("synthetic-file"), video)
                self.assertEqual(once.call_count, 2)

    def test_denied_missing_and_invalid_range_are_not_retried(self):
        for code in [401, 403, 404, 416]:
            with self.subTest(code=code):
                error = urllib.error.HTTPError("https://drive.google.com", code, "Denied", {}, None)
                once = Mock(side_effect=error)
                self.scope["_open_google_drive_file_once"] = once
                with self.assertRaises(urllib.error.HTTPError) as caught:
                    self.scope["_open_google_drive_file"]("synthetic-file")
                self.assertIs(caught.exception, error)
                self.assertEqual(once.call_count, 1)

    def test_network_failure_then_success(self):
        for error in [urllib.error.URLError("Temporary"), TimeoutError()]:
            with self.subTest(error=type(error).__name__):
                video = self.response()
                self.scope["_open_google_drive_file_once"] = Mock(side_effect=[error, video])
                self.assertIs(self.scope["_open_google_drive_file"]("synthetic-file"), video)

    def test_persistent_network_error_stops_and_remains_an_error(self):
        once = Mock(side_effect=TimeoutError())
        self.scope["_open_google_drive_file_once"] = once
        with self.assertRaises(urllib.error.URLError):
            self.scope["_open_google_drive_file"]("synthetic-file")
        self.assertEqual(once.call_count, 2)

    def test_persistent_http_failure_keeps_status(self):
        error = urllib.error.HTTPError("https://drive.google.com", 503, "Temporary", {}, None)
        once = Mock(side_effect=error)
        self.scope["_open_google_drive_file_once"] = once
        with self.assertRaises(urllib.error.HTTPError) as caught:
            self.scope["_open_google_drive_file"]("synthetic-file")
        self.assertEqual(caught.exception.code, 503)
        self.assertEqual(once.call_count, 2)

    def test_shared_document_and_audio_sources_remain_supported(self):
        for content_type in ["application/pdf", "audio/mpeg", "application/octet-stream"]:
            with self.subTest(content_type=content_type):
                response = self.response(content_type)
                opener = Mock()
                opener.open.return_value = response
                with patch.object(urllib.request, "build_opener", return_value=opener):
                    self.assertIs(self.scope["_open_google_drive_file_once"]("synthetic-file"), response)
                response.read.assert_not_called()


if __name__ == "__main__":
    unittest.main()
