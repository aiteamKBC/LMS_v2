"""Retrieval, coverage planning and the generator bridge -- no database, no network.

    python manage.py test knowledge_base.tests_retrieval
"""
import json
import math
import tempfile
from unittest.mock import patch

from django.test import RequestFactory, SimpleTestCase, override_settings

from . import integration, jobs, retrieval, storage
from .providers import FakeEmbeddingProvider, PaidCallsDisabled
from .tests_pipeline import _book_pdf
from .tests_worker import CountingProvider, FakeRepository


def _parse(literal):
    return [float(x) for x in literal.strip("[]").split(",")]


class _FailingProvider(FakeEmbeddingProvider):
    def embed(self, texts):
        raise ConnectionError("provider timeout")


class RetrievalRepository(FakeRepository):
    def images_for_chunks(self, chunk_ids, limit=24):
        return []

    def __init__(self):
        super().__init__()
        self.logged = []
        self.vector_searches = 0

    def active_builds(self, book_ids):
        rows = []
        for book_id in book_ids:
            book = self.books.get(str(book_id))
            if not book or not book["current_version_id"]:
                continue
            version = self.versions[book["current_version_id"]]
            space = self.spaces[self.builds[version["active_build_id"]]["space_id"]]
            rows.append({"book_id": book_id, "title": book["title"], "build_id": version["active_build_id"],
                         "embedding_space_id": space["id"], "dims": space["dims"], "space_provider": space["provider"],
                         "space_model": space["model"], "scopes": sorted(self.scopes[book_id])})
        return rows

    def _sections(self, build_id):
        # section ids are "<build>:<ordinal>"; parents follow the same scheme
        return [{"id": f"{build_id}:{s.ordinal}", "build_id": build_id,
                 "parent_id": f"{build_id}:{s.parent}" if s.parent is not None else None,
                 "level": s.level, "ordinal": s.ordinal, "number": s.number, "title": s.title,
                 "pdf_page_start": s.pdf_page_start, "pdf_page_end": s.pdf_page_end} for s in self.sections.get(build_id, [])]

    def sections_for_builds(self, build_ids):
        return [row for b in build_ids for row in self._sections(b)]

    def _chunk_rows(self, build_ids):
        rows = []
        for build_id in build_ids:
            for ordinal, c in sorted(self.chunks.get(build_id, {}).items()):
                rows.append({"id": c["id"], "build_id": build_id, "section_id": f"{build_id}:{c['section']}",
                             "ordinal": ordinal, "kind": c["kind"], "token_count": 100,
                             "pdf_page_start": 1, "pdf_page_end": 1, "content": c["content"]})
        return rows

    def replace_structure(self, job, build_id, sections, chunks, links, decorative_ids):
        super().replace_structure(job, build_id, sections, chunks, links, decorative_ids)
        for c in chunks:
            self.chunks[build_id][c.ordinal]["content"] = c.content

    def chunk_index(self, build_ids):
        return [{k: v for k, v in r.items() if k != "content"} for r in self._chunk_rows(build_ids)]

    def chunk_contents(self, chunk_ids):
        wanted = set(chunk_ids)
        return {r["id"]: r["content"] for r in self._chunk_rows(list(self.chunks)) if r["id"] in wanted}

    def search_chunks_text(self, build_ids, query_text, limit=40):
        words = {w for w in query_text.lower().split() if len(w) > 3}
        rows = []
        for r in self._chunk_rows(build_ids):
            matched = sum(1 for w in words if w in r["content"].lower())
            if matched:
                rows.append({**{k: r[k] for k in r if k != "content"}, "distance": None, "text_match": True,
                             "score": float(matched)})
        return sorted(rows, key=lambda r: -r["score"])[:limit]

    def search_chunks(self, build_ids, space_id, dims, query_vector, query_text, limit=40):
        self.vector_searches += 1
        q = _parse(query_vector)
        words = {w for w in query_text.lower().split() if len(w) > 3}
        rows = []
        for r in self._chunk_rows(build_ids):
            v = _parse(self.chunk_vectors[(r["id"], space_id)])
            distance = 1 - sum(a * b for a, b in zip(q, v))
            text_match = any(w in r["content"].lower() for w in words)
            rows.append({**{k: r[k] for k in r if k != "content"}, "distance": distance, "text_match": text_match,
                         "score": (1.0 if text_match else 0) + (1 - distance) / 10})
        return sorted(rows, key=lambda r: -r["score"])[:limit]

    def log_generation(self, record, sources):
        self.logged.append((record, sources))
        return "gen-1"

    def log_question_sources(self, generation_id, rows):
        self.logged.append(("questions", rows))


class RetrievalTests(SimpleTestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.override = override_settings(KNOWLEDGE_BASE_LOCAL_DIR=self.tmp.name)
        self.override.enable()
        self.repo = RetrievalRepository()
        created = jobs.register_upload(self.repo, storage.get_storage(), _book_pdf(), file_name="book.pdf",
                                       title="The Marketing Book", scopes=["ME", "MM"], user="u")
        self.assertEqual(jobs.run_one(self.repo, provider=CountingProvider()), "ready")
        self.book_id = created["book_id"]

    def tearDown(self):
        self.override.disable()
        self.tmp.cleanup()

    def plan(self, count, topic=""):
        return retrieval.plan(self.repo, FakeEmbeddingProvider(), [self.book_id], count, topic)

    def test_topic_mode_picks_the_relevant_section(self):
        p = self.plan(2, "SWOT strengths weaknesses")
        self.assertEqual(p.mode, "topic")
        self.assertEqual(p.segments[0].section, "1.1 SWOT analysis")
        self.assertIn("Source file: The Marketing Book", p.text())
        self.assertIn("[1.1 SWOT analysis, p.", p.text())

    def test_budget_is_a_ceiling_and_blocks_never_exceed_questions(self):
        for count in (1, 3, 20):
            with self.subTest(count=count):
                p = self.plan(count, "pricing value customer")
                self.assertLessEqual(p.tokens, retrieval.ceiling_for(count))
                self.assertLessEqual(len(p.blocks), count)

    def test_small_quiz_on_whole_book_samples_and_declares_chapters(self):
        p = self.plan(1)
        self.assertEqual(p.mode, "whole_book")
        self.assertGreater(p.chapters_total, 1)
        self.assertEqual(len(p.chapters_used), 1)
        self.assertEqual(len(p.blocks), 1)

    def test_whole_book_with_enough_questions_covers_every_chapter(self):
        p = self.plan(10)
        self.assertEqual(len(p.chapters_used), p.chapters_total)

    def test_topic_is_matched_by_keywords_when_it_cannot_be_embedded_here(self):
        other_model = FakeEmbeddingProvider()
        other_model.model = "another-model"
        for name, provider in (("paid calls off", None), ("another model", other_model), ("call failed", _FailingProvider())):
            with self.subTest(name):
                searches = self.repo.vector_searches
                p = retrieval.plan(self.repo, provider, [self.book_id], 2, "SWOT strengths weaknesses")
                self.assertIn("keyword_search_only", p.warnings)
                self.assertEqual(p.segments[0].section, "1.1 SWOT analysis")
                self.assertEqual(self.repo.vector_searches, searches)          # no vectors compared
        self.assertEqual(other_model.calls, 0)                                   # never asked to embed

    def test_matching_provider_uses_hybrid_search_without_a_warning(self):
        p = self.plan(2, "SWOT strengths weaknesses")
        self.assertNotIn("keyword_search_only", p.warnings)
        self.assertEqual(self.repo.vector_searches, 1)

    def test_no_ready_books_is_a_clear_error(self):
        with self.assertRaises(retrieval.KnowledgeBaseUnavailable):
            retrieval.plan(self.repo, FakeEmbeddingProvider(), ["not-a-book"], 5, "x")

    def test_repeated_sentences_are_sent_once(self):
        seg = lambda text: retrieval.Segment(1, "b", "k", "Book", "Ch", "S", "1", 10, text)
        segments = [seg("Value pricing links price to benefit perceived."),
                    seg("Value pricing links price to benefit perceived. Cost floors still apply to every offer.")]
        retrieval._dedupe(segments)
        joined = " ".join(s.text for s in segments)
        self.assertEqual(joined.count("Value pricing links price"), 1)
        self.assertIn("Cost floors", joined)


class _FakeOpenAI:
    calls = []

    def __init__(self, *args, **kwargs):
        self.responses = self

    def create(self, **kwargs):
        _FakeOpenAI.calls.append(kwargs)
        body = {"questions": [{"question": "What does a SWOT analysis list first?", "type": "single_choice",
                               "options": ["Strengths and weaknesses", "Prices", "Channels", "Budgets"],
                               "correct_answer": "A", "explanation": "SWOT lists strengths and weaknesses.",
                               "difficulty": "easy"}]}
        return type("R", (), {"output_text": json.dumps(body)})()


@override_settings(OPENAI_API_KEY="test-key", OPENAI_MODEL="gpt-test")
class GeneratorBridgeTests(RetrievalTests):
    def call(self, data):
        from quiz_api.views import generate_ai_questions

        request = RequestFactory().post("/quiz_api/ai/generate-questions/", data=json.dumps(data), content_type="application/json")
        _FakeOpenAI.calls = []
        with patch("openai.OpenAI", _FakeOpenAI), patch.object(integration, "Repository", return_value=self.repo):
            return generate_ai_questions(request)

    def test_books_feed_the_existing_prompt_and_sources_come_back(self):
        response = self.call({"topic": "SWOT strengths", "questionCount": 2, "knowledgeBookIds": [self.book_id]})
        self.assertEqual(response.status_code, 200)
        prompt = _FakeOpenAI.calls[0]["input"][1]["content"]
        self.assertIn("Source file: The Marketing Book", prompt)
        self.assertIn("SWOT lists strengths", prompt)
        self.assertNotIn("Figure", prompt)
        kb = json.loads(response.content)["source"]["knowledgeBase"]
        self.assertEqual(kb["mode"], "topic")
        self.assertEqual(kb["books"][0]["title"], "The Marketing Book")
        self.assertEqual(kb["questionSources"][0]["section"], "1.1 SWOT analysis")
        self.assertNotIn("_plan", kb)
        self.assertEqual(self.repo.logged[0][0]["mode"], "topic")

    def test_pasted_text_is_kept_as_its_own_source(self):
        self.call({"topic": "SWOT", "questionCount": 3, "knowledgeBookIds": [self.book_id],
                   "lessonContent": "Our own note about segmentation."})
        prompt = _FakeOpenAI.calls[0]["input"][1]["content"]
        self.assertIn("Source file: Pasted lesson content\nOur own note about segmentation.", prompt)

    def test_generation_still_works_when_paid_embedding_calls_are_off(self):
        with patch.object(integration, "get_embedding_provider", side_effect=PaidCallsDisabled("off")):
            response = self.call({"topic": "SWOT strengths", "questionCount": 2, "knowledgeBookIds": [self.book_id]})
        self.assertEqual(response.status_code, 200)
        kb = json.loads(response.content)["source"]["knowledgeBase"]
        self.assertIn("keyword_search_only", kb["warnings"])
        self.assertIn("SWOT lists strengths", _FakeOpenAI.calls[0]["input"][1]["content"])

    def test_unknown_books_return_400_and_never_call_openai(self):
        response = self.call({"topic": "SWOT", "knowledgeBookIds": ["missing"]})
        self.assertEqual(response.status_code, 400)
        self.assertEqual(_FakeOpenAI.calls, [])

    def test_requests_without_books_do_not_touch_the_knowledge_base(self):
        with patch.object(integration, "merge_into_source") as merge:
            response = self.call({"topic": "SWOT", "questionCount": 2})
        merge.assert_not_called()
        self.assertNotIn("knowledgeBase", json.loads(response.content)["source"])
