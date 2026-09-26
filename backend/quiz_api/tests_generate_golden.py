"""Golden tests for the AI question generator (generate_ai_questions).

They pin the exact request the generator sends to OpenAI for four inputs --
topic only, pasted text, text files and a text PDF -- so any later change
(the Knowledge Base insertion point) can prove a request without books is
byte-for-byte what it is today. No network: the OpenAI client is faked.

    python manage.py test quiz_api.tests_generate_golden

Regenerate the snapshot only when a behaviour change is intended:

    UPDATE_GOLDEN=1 python manage.py test quiz_api.tests_generate_golden
"""
import io
import json
import os
from pathlib import Path
from unittest.mock import patch

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import RequestFactory, SimpleTestCase, override_settings

from .views import generate_ai_questions

GOLDEN_FILE = Path(__file__).with_name("golden") / "generate_ai_questions.json"

MODEL_OUTPUT = {
    "questions": [
        {
            "question": "Which channel is paid?",
            "type": "single_choice",
            "options": ["Organic post", "Sponsored ad", "Blog article", "Newsletter"],
            "correct_answer": "B",
            "explanation": "Sponsored ads are paid. KSBs covered: K1",
            "difficulty": "easy",
        }
    ]
}


class _FakeResponses:
    def __init__(self, calls):
        self.calls = calls

    def create(self, **kwargs):
        self.calls.append(kwargs)
        return type("Response", (), {"output_text": json.dumps(MODEL_OUTPUT)})()


class _FakeOpenAI:
    calls = []

    def __init__(self, *args, **kwargs):
        self.responses = _FakeResponses(_FakeOpenAI.calls)


def _pdf_bytes():
    import fitz

    document = fitz.open()
    for text in ("Organic reach grows through useful content.", "Paid media buys placement and reach."):
        page = document.new_page()
        page.insert_text((72, 72), text)
    data = document.tobytes()
    document.close()
    return data


def _scenarios():
    return {
        "topic_only": {"json": {"topic": "Organic vs Paid Marketing", "questionCount": 3}},
        "pasted_text": {"json": {
            "courseTitle": "Social Media Basics", "programme": "Marketing Executive Level 4",
            "module": "Social Media", "lessonContent": "Organic reach grows through useful content. Paid media buys reach.",
            "customInstructions": "Keep it practical.", "questionCount": 5,
        }},
        "text_files": {"files": [
            ("part1.txt", b"Organic reach grows through useful content.", "text/plain"),
            ("part2.md", b"Paid media buys placement and reach.", "text/markdown"),
        ], "fields": {"topic": "Reach", "questionCount": "4"}},
        "pdf_file": {"files": [("lesson.pdf", _pdf_bytes(), "application/pdf")], "fields": {"questionCount": "2"}},
    }


@override_settings(OPENAI_API_KEY="test-key", OPENAI_MODEL="gpt-test")
class GenerateQuestionsGoldenTests(SimpleTestCase):
    def _run(self, scenario):
        factory = RequestFactory()
        if "json" in scenario:
            request = factory.post("/quiz_api/ai/generate-questions/", data=json.dumps(scenario["json"]),
                                   content_type="application/json")
        else:
            data = dict(scenario["fields"])
            data["files"] = [SimpleUploadedFile(n, b, content_type=t) for n, b, t in scenario["files"]]
            request = factory.post("/quiz_api/ai/generate-questions/", data=data)
        _FakeOpenAI.calls = []
        with patch("openai.OpenAI", _FakeOpenAI):
            response = generate_ai_questions(request)
        self.assertEqual(response.status_code, 200, response.content)
        self.assertEqual(len(_FakeOpenAI.calls), 1)
        return _FakeOpenAI.calls[0], json.loads(response.content)

    def test_requests_match_golden_snapshot(self):
        captured = {}
        for name, scenario in _scenarios().items():
            call, body = self._run(scenario)
            captured[name] = {"request": call, "response": body}

        if os.environ.get("UPDATE_GOLDEN") == "1":
            GOLDEN_FILE.parent.mkdir(exist_ok=True)
            GOLDEN_FILE.write_text(json.dumps(captured, indent=2, ensure_ascii=False, sort_keys=True), encoding="utf-8")
            self.skipTest("Golden snapshot rewritten.")

        expected = json.loads(GOLDEN_FILE.read_text(encoding="utf-8"))
        for name in captured:
            with self.subTest(scenario=name):
                self.assertEqual(json.loads(json.dumps(captured[name], sort_keys=True)), expected[name])
