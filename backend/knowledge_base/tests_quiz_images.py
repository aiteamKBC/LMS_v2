"""Book images: model input, validation, saved format and learner display."""
import io
import json
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.test import RequestFactory, SimpleTestCase, override_settings
from PIL import Image, ImageDraw

from . import quiz_images, storage


def _image_bytes(color=(20, 100, 190)):
    out = io.BytesIO()
    img = Image.new("RGB", (120, 100), "white")
    ImageDraw.Draw(img).rectangle((20, 20, 80, 80), fill=color)
    img.save(out, "WEBP")
    return out.getvalue()


def _images():
    return [{"token": f"BOOK_IMAGE_{i}", "id": i, "occurrenceId": i * 10,
             "imageUrl": quiz_images._snapshot(_image_bytes((i * 80, 100, 190))), "book": "Marketing",
             "section": "Channels", "page": i, "caption": "A promotional example"} for i in (1, 2)]


def _question(options=None):
    return {"questionType": "image_matching", "text": "Match each promotion to its outcome.",
            "answers": [{"text": value} for value in (options or ["BOOK_IMAGE_1 -> Awareness", "BOOK_IMAGE_2 -> Sales"])]}


class QuizImageTests(SimpleTestCase):
    def test_reordered_answers_keep_the_exact_requested_image_not_catalogue_order(self):
        images = _images()
        self.assertNotEqual(images[0]["imageUrl"], images[1]["imageUrl"])
        question = _question(["BOOK_IMAGE_2 -> Sales", "BOOK_IMAGE_1 -> Awareness"])
        sources = quiz_images.resolve([question], images)
        saved_pairs = [json.loads(answer["text"]) for answer in question["answers"]]
        self.assertEqual(saved_pairs[0]["imageUrl"], images[1]["imageUrl"])
        self.assertEqual(saved_pairs[0]["match"], "Sales")
        self.assertEqual(saved_pairs[1]["imageUrl"], images[0]["imageUrl"])
        self.assertEqual(saved_pairs[1]["match"], "Awareness")
        self.assertEqual([source["assetId"] for source in sources], [2, 1])

    def test_transparent_images_have_a_white_background_and_blank_images_are_rejected(self):
        import base64

        out = io.BytesIO()
        img = Image.new("RGBA", (120, 100), (0, 0, 0, 0))
        ImageDraw.Draw(img).rectangle((20, 20, 80, 80), fill=(0, 0, 0, 255))
        img.save(out, "PNG")
        snapshot = quiz_images._snapshot(out.getvalue())
        result = Image.open(io.BytesIO(base64.b64decode(snapshot.split(",", 1)[1])))
        self.assertGreater(min(result.getpixel((0, 0))), 240)
        blank = io.BytesIO()
        Image.new("RGB", (120, 100), "black").save(blank, "PNG")
        with self.assertRaises(ValueError):
            quiz_images._snapshot(blank.getvalue())

    def test_selected_images_are_scoped_to_retrieved_chunks_and_build(self):
        data = _image_bytes()
        row = {"id": 1, "occurrence_id": 10, "chunk_id": 7, "build_id": "build-a", "pdf_page": 4,
               "storage_ref": "local:assets/a.webp", "size_bytes": len(data), "sha256": storage.sha256_of(data),
               "book_caption": "Diagram", "label_text": ""}
        repo = Mock()
        repo.images_for_chunks.return_value = [row, {**row, "id": 2, "build_id": "another-build"}]
        plan = SimpleNamespace(segments=[SimpleNamespace(chunk_id=7, build_id="build-a", book_title="Book", section="Section")])
        with patch.object(storage, "read", return_value=data) as read:
            selected, warnings = quiz_images.select(repo, plan)
        repo.images_for_chunks.assert_called_once_with([7], limit=24)
        read.assert_called_once_with(row["storage_ref"])
        self.assertEqual([image["id"] for image in selected], [1])
        self.assertEqual(warnings, [])

    def test_missing_images_are_reported_not_replaced_with_placeholders(self):
        repo = Mock()
        repo.images_for_chunks.return_value = [{"id": 1, "chunk_id": 7, "build_id": "b", "size_bytes": 12, "storage_ref": "local:missing"}]
        plan = SimpleNamespace(segments=[SimpleNamespace(chunk_id=7, build_id="b")])
        with patch.object(storage, "read", side_effect=FileNotFoundError):
            selected, warnings = quiz_images.select(repo, plan)
        self.assertEqual(selected, [])
        self.assertEqual(warnings, ["book_image_unavailable"])

    def test_model_receives_pixels_and_exact_image_identifiers(self):
        content = quiz_images.prompt_content("Question instructions", _images())
        self.assertEqual(content[0], {"type": "input_text", "text": "Question instructions"})
        self.assertIn("BOOK_IMAGE_1", content[1]["text"])
        self.assertTrue(content[2]["image_url"].startswith("data:image/webp;base64,"))
        self.assertEqual(content[2]["type"], "input_image")
        self.assertEqual(quiz_images.prompt_content("text", []), "text")

    def test_saved_pair_round_trips_through_learner_parser_without_expiring_url(self):
        from learner_api.quizzes import _parse_image_matching_answer

        question = _question()
        sources = quiz_images.resolve([question], _images())
        persisted = json.loads(json.dumps(question))
        parsed = _parse_image_matching_answer(persisted["answers"][0]["text"])
        self.assertEqual(parsed["right"], "Awareness")
        self.assertEqual(parsed["left"], "")  # no caption leaking the correct match
        self.assertTrue(parsed["imageUrl"].startswith("data:image/webp;base64,"))
        self.assertEqual(sources[0]["assetId"], 1)

    def test_images_are_displayed_without_the_answer_key_and_grade_by_answer_id(self):
        from learner_api.quizzes import _grade_question, _scrub_answer_key

        question = _question()
        quiz_images.resolve([question], _images())
        answers = [{"id": index + 10, "text": answer["text"], "isCorrect": True} for index, answer in enumerate(question["answers"])]
        saved = {"id": 1, "type": "image_matching", "points": 2, "answers": answers}
        safe = _scrub_answer_key({"questions": [saved]})["questions"][0]
        self.assertEqual(set(safe["rightOptions"]), {"Awareness", "Sales"})
        for answer in safe["answers"]:
            self.assertTrue(answer["imageUrl"].startswith("data:image/webp;base64,"))
            self.assertNotIn("match", answer)
            self.assertNotIn("isCorrect", answer)
        grade = _grade_question(saved, {"10": "Awareness", "11": "Sales"})
        self.assertTrue(grade["correct"])
        self.assertEqual(grade["earned"], 2)
        self.assertEqual(_grade_question(saved, {"10": "Sales", "11": "Awareness"})["earned"], 0)

    def test_source_attribution_uses_image_concepts_not_encoded_pixels(self):
        from . import retrieval

        plan = retrieval.Plan("topic", 1, 100, blocks=[("Book", [retrieval.Segment(1, "build", "book", "Marketing", "Chapter", "Section", "1", 10, "Brand awareness grows through advertising")])])
        question = {"text": "What grows through advertising?", "questionType": "image_matching", "answers": [{"isCorrect": True, "text": json.dumps({"match": "Brand awareness", "imageUrl": "data:image/webp;base64," + "noise" * 10000})}]}
        source = retrieval.attribute_questions([question], plan)[0]
        self.assertEqual(source["section"], "Section")
        self.assertGreater(source["confidence"], 0.5)

    def test_invented_external_duplicate_or_missing_image_is_rejected(self):
        for token in ("BOOK_IMAGE_999", "https://external.invalid/photo.webp", "Image: TV ad", "BOOK_IMAGE_1"):
            with self.subTest(token=token), self.assertRaises(quiz_images.InvalidImageQuestion):
                quiz_images.resolve([_question(["BOOK_IMAGE_1 -> Awareness", f"{token} -> Sales"])], _images())
        with self.assertRaises(quiz_images.InvalidImageQuestion):
            quiz_images.resolve([_question()], [])

    @override_settings(OPENAI_API_KEY="test", OPENAI_MODEL="test")
    def test_generator_attaches_images_and_returns_only_validated_snapshots(self):
        from quiz_api.views import generate_ai_questions

        request = RequestFactory().post("/quiz_api/ai/generate-questions/", content_type="application/json",
                                        data=json.dumps({"knowledgeBookIds": ["book"], "questionCount": 1}))
        model = {"questions": [{"type": "image_matching", "question": "Match the promotions.",
                                "options": ["BOOK_IMAGE_1 -> Awareness", "BOOK_IMAGE_2 -> Sales"], "correct_answer": "ALL"}]}
        client = Mock()
        client.responses.create.return_value.output_text = json.dumps(model)
        meta = {"_images": _images()}
        with patch("openai.OpenAI", return_value=client), patch("knowledge_base.integration.merge_into_source", return_value=("Book content", meta)):
            response = generate_ai_questions(request)
        self.assertEqual(response.status_code, 200, response.content)
        body = json.loads(response.content)
        self.assertNotIn("_images", body["source"]["knowledgeBase"])
        self.assertEqual(len(body["source"]["knowledgeBase"]["questionImages"]), 2)
        pair = json.loads(body["questions"][0]["answers"][0]["text"])
        self.assertTrue(pair["imageUrl"].startswith("data:image/webp;base64,"))
        self.assertEqual(client.responses.create.call_args.kwargs["input"][1]["content"][2]["type"], "input_image")

    def test_text_only_request_excludes_image_type_and_rejects_placeholder_output(self):
        from quiz_api.views import generate_ai_questions

        request = RequestFactory().post("/quiz_api/ai/generate-questions/", content_type="application/json", data=json.dumps({"topic": "Marketing"}))
        client = Mock()
        client.responses.create.return_value.output_text = json.dumps({"questions": [{"type": "image_matching", "question": "Match", "options": ["Image A -> X", "Image B -> Y"]}]})
        with patch("openai.OpenAI", return_value=client):
            response = generate_ai_questions(request)
        self.assertEqual(response.status_code, 502)
        schema = client.responses.create.call_args.kwargs["text"]["format"]["schema"]
        self.assertNotIn("image_matching", schema["properties"]["questions"]["items"]["properties"]["type"]["enum"])
