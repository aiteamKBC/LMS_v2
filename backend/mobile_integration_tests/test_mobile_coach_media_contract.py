"""Coach media routing tests; no LMS settings, databases or network providers."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch

from django.conf import settings
if not settings.configured:
    settings.configure(DEFAULT_CHARSET="utf-8", SECRET_KEY="synthetic-coach-media-only")
from django.http import HttpResponse, HttpResponseRedirect, StreamingHttpResponse
from django.test import RequestFactory

path = Path(__file__).resolve().parents[1] / "learner_api/mobile_coach_media.py"
spec = importlib.util.spec_from_file_location("isolated_coach_media", path)
media = importlib.util.module_from_spec(spec)
spec.loader.exec_module(media)


class CoachMediaContract(unittest.TestCase):
    def setUp(self):
        self.factory = RequestFactory()
        self.request = self.factory.get("/coach/preview/?url=https://evil.invalid&learnerId=other&preview=1", HTTP_RANGE="bytes=2-5")
        self.component = {"mobileMode": "audio", "audioUrl": "/learner_api/media/google-drive/abcdefghijk123/", "videoUrl": "https://www.youtube.com/watch?v=73fLWh97kZQ"}

    def test_known_protected_sources_bind_to_selected_profile_and_component(self):
        links = [
            "/learner_api/media/google-drive/abcdefghijk123/",
            "https://lms.kentbusinesscollege.org/learner_api/media/legacy-attachment/123/",
            "/curriculum_api/curriculum/uploads/MOD/COMP/Weekly%20audio.mp3",
            "https://drive.google.com/file/d/abcdefghijk123/view?usp=sharing",
            "https://drive.google.com/uc?id=abcdefghijk123&export=download",
        ]
        for value in links:
            with self.subTest(value=value):
                self.assertEqual(media.rewrite_media_url(42, "COMP:1", value), "/learner_api/mobile/coach/learners/42/components/COMP%3A1/media/")

    def test_public_youtube_and_external_media_are_not_server_fetched(self):
        for value in ["https://www.youtube.com/watch?v=73fLWh97kZQ", "https://example.blob.core.windows.net/material/podcast.mp3"]:
            self.assertEqual(media.rewrite_media_url(42, "COMP", value), value)
            with patch.object(media, "_dispatch") as dispatch:
                response = media.stream(self.request, {"mobileMode": "audio", "audioUrl": value})
            self.assertEqual(response.status_code, 404)
            dispatch.assert_not_called()

    def test_sources_cannot_turn_into_arbitrary_fetches_or_file_traversal(self):
        bad = [
            "https://lms.kentbusinesscollege.org.evil.invalid/learner_api/media/google-drive/abcdefghijk123/",
            "https://user:secret@lms.kentbusinesscollege.org/learner_api/media/google-drive/abcdefghijk123/",
            "https://lms.kentbusinesscollege.org:444/learner_api/media/google-drive/abcdefghijk123/",
            "//lms.kentbusinesscollege.org/learner_api/media/google-drive/abcdefghijk123/",
            "http://lms.kentbusinesscollege.org/learner_api/media/google-drive/abcdefghijk123/",
            "/curriculum_api/curriculum/uploads/../secret",
            "/curriculum_api/curriculum/uploads/%2e%2e/secret",
            "/curriculum_api/curriculum/uploads/%252e%252e/secret",
            "/curriculum_api/curriculum/uploads/folder%5csecret",
            "/curriculum_api/curriculum/uploads//etc/passwd",
            "/curriculum_api/curriculum/uploads/file%00.mp3",
            "https://drive.google.com/open?id=abcdefghijk123&id=another12345",
            "https://drive.google.com/file/d/abcdefghijk123/view?id=another12345",
        ]
        with patch.object(media, "_dispatch") as dispatch:
            for value in bad:
                with self.subTest(value=value):
                    self.assertEqual(media.stream(self.request, {"mobileMode": "audio", "audioUrl": value}).status_code, 404)
        dispatch.assert_not_called()

    def test_stream_keeps_range_but_drops_caller_selectors_and_prevents_cache_reuse(self):
        def dispatch(child, source):
            self.assertEqual(source, ("drive", "abcdefghijk123"))
            self.assertEqual(dict(child.GET), {})
            self.assertEqual(child.headers["Range"], "bytes=2-5")
            return StreamingHttpResponse(iter([b"2345"]), status=206, content_type="audio/mpeg", headers={"Content-Range": "bytes 2-5/10", "Content-Length": "4"})
        with patch.object(media, "_dispatch", side_effect=dispatch):
            response = media.stream(self.request, self.component)
        self.assertEqual(response.status_code, 206)
        self.assertEqual(response["Content-Range"], "bytes 2-5/10")
        self.assertEqual(response["Content-Length"], "4")
        self.assertEqual(response["Cache-Control"], "private, no-store")
        self.assertEqual(b"".join(response.streaming_content), b"2345")
        self.assertEqual(self.request.GET["learnerId"], "other", "Original request remains untouched")

    def test_only_canonical_zero_byte_upload_legacy_fallback_is_followed(self):
        component = {"mobileMode": "audio", "audioUrl": "/curriculum_api/curriculum/uploads/_legacy_files/123/audio.mp3"}
        with patch.object(media, "_dispatch", side_effect=[HttpResponseRedirect("/learner_api/media/legacy-attachment/123/"), HttpResponse(b"audio", content_type="audio/mpeg")]) as dispatch:
            response = media.stream(self.request, component)
        self.assertEqual(response.content, b"audio")
        self.assertEqual(dispatch.call_args_list[1].args[1], ("legacy", "123"))
        for target in ["https://evil.invalid/", "https://drive.google.com/open?id=abcdefghijk123", "/login"]:
            with patch.object(media, "_dispatch", return_value=HttpResponseRedirect(target)) as dispatch:
                self.assertEqual(media.stream(self.request, component).status_code, 404)
                self.assertEqual(dispatch.call_count, 1)

    def test_reject_non_get_quiz_and_missing_media_before_dispatch(self):
        with patch.object(media, "_dispatch") as dispatch:
            self.assertEqual(media.stream(self.factory.post("/coach/preview/"), self.component).status_code, 405)
            self.assertEqual(media.stream(self.request, {"mobileMode": "quiz", "audioUrl": self.component["audioUrl"]}).status_code, 404)
            self.assertEqual(media.stream(self.request, {"mobileMode": "video", "audioUrl": self.component["audioUrl"]}).status_code, 404)
        dispatch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
