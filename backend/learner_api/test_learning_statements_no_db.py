"""Learning-statement validation without app startup, a database or network calls."""
import ast
import json
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock


class LearningStatementAnswerTests(unittest.TestCase):
    def setUp(self):
        source = Path(__file__).with_name("reflection_ai.py")
        tree = ast.parse(source.read_text(encoding="utf-8"))
        handlers = ast.Module(body=[
            node for node in tree.body
            if isinstance(node, ast.FunctionDef)
            and node.name in {"_generate_learning_statements", "_error"}
        ], type_ignores=[])
        self.statements = {
            "whatYouLearned": "Supported knowledge statement.",
            "understood": "Supported understanding statement.",
            "gainedSkills": "Supported skills statement.",
        }
        self.client = Mock()
        self.client.responses.create.return_value.output_text = json.dumps(self.statements)
        self.openai_client = Mock(return_value=self.client)
        self.moderation = Mock(return_value=False)
        scope = {
            "json": json,
            "logger": Mock(),
            "settings": SimpleNamespace(OPENAI_API_KEY="synthetic", OPENAI_REFLECTION_MODEL="mock"),
            "JsonResponse": lambda data, status=200: SimpleNamespace(data=data, status_code=status),
            "_openai_client": self.openai_client,
            "_moderation_flagged": self.moderation,
        }
        exec(compile(handlers, str(source), "exec"), scope)
        self.generate = scope["_generate_learning_statements"]

    def request(self, answer):
        return self.generate(SimpleNamespace(body=json.dumps({"text": answer}).encode("utf-8")))

    def test_fewer_than_120_words_are_rejected_even_when_text_is_long(self):
        for answer in ("", "word " * 119, ("x" * 200 + " ") * 119):
            with self.subTest(words=len(answer.split())):
                response = self.request(answer)
                self.assertEqual(response.status_code, 400)
                self.assertEqual(response.data, {
                    "error": "Write at least 120 words before generating learning statements.",
                    "code": "invalid_answer",
                })
        self.openai_client.assert_not_called()
        self.moderation.assert_not_called()

    def test_exactly_120_words_are_accepted_with_mixed_whitespace(self):
        answer = " \n" + "word\tword\nword " * 40
        response = self.request(answer)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data, self.statements)
        sent = self.client.responses.create.call_args.kwargs["input"][1]["content"]
        self.assertEqual(sent, answer.strip())

    def test_long_answers_reach_generation_in_full(self):
        for answer in ("word " * 4000 + "x", "learning " * 12000):
            with self.subTest(characters=len(answer)):
                response = self.request(answer)
                self.assertEqual(response.status_code, 200)
                self.assertEqual(response.data, self.statements)
                sent = self.client.responses.create.call_args.kwargs["input"][1]["content"]
                self.assertEqual(sent, answer.strip())
                self.moderation.assert_any_call(self.client, answer.strip())

    def test_long_answers_still_require_moderation(self):
        self.moderation.return_value = True
        response = self.request("learning " * 12000)
        self.assertEqual(response.status_code, 422)
        self.assertEqual(response.data["code"], "inappropriate_content")
        self.client.responses.create.assert_not_called()


if __name__ == "__main__":
    unittest.main()
