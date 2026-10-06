"""Extraction, structure, chunking and fake embeddings -- no database, no network.

    python manage.py test knowledge_base.tests_pipeline
"""
from django.test import SimpleTestCase, override_settings

from . import chunking, config, extract, providers, structure

HEADER = "Marketing Strategy & Planning"
PRICING_PARAGRAPHS = [
    f"Pricing paragraph {i}: value based pricing links the price to the benefit the customer "
    f"perceives, and it must be tested against competitor offers and cost floors. " * 3
    for i in range(12)
]


def _book_pdf(with_toc=True):
    import fitz

    doc = fitz.open()

    def page_with(lines, header=True, number=None):
        page = doc.new_page()
        y = 60
        if header:
            page.insert_text((72, 40), HEADER, fontsize=9)
        for text, size in lines:
            page.insert_text((72, y), text, fontsize=size)
            y += size + 10
        if number is not None:
            page.insert_text((72, 800), f"Page {number}", fontsize=9)
        return page

    page_with([("The Marketing Book", 24), ("Second edition", 12)], header=False)            # 1 cover
    page_with([("1 Marketing Strategy", 20), ("Strategy sets direction for the business.", 11),
               ("It links objectives to the market.", 11)], number=1)                       # 2
    page_with([("1.1 SWOT analysis", 16), ("SWOT lists strengths and weaknesses.", 11),
               ("Opportunities and threats come from outside.", 11)], number=2)             # 3
    doc.new_page()                                                                          # 4 blank
    visual = doc.new_page()                                                                 # 5 drawing only
    visual.draw_rect(fitz.Rect(100, 100, 300, 250))
    page_with([("2 Pricing", 20)], number=3)                                                # 6
    for i, paragraph in enumerate(PRICING_PARAGRAPHS):                                      # 7..
        page = doc.new_page()
        page.insert_text((72, 40), HEADER, fontsize=9)
        page.insert_textbox(fitz.Rect(72, 60, 520, 780), paragraph, fontsize=11)
        page.insert_text((72, 800), f"Page {4 + i}", fontsize=9)
    if with_toc:
        doc.set_toc([[1, "1 Marketing Strategy", 2], [2, "1.1 SWOT analysis", 3], [1, "2 Pricing", 6]])
    data = doc.tobytes()
    doc.close()
    return data


def _run(data=None):
    document = extract.open_pdf(data or _book_pdf())
    pages = extract.strip_running_lines(extract.extract_pages(document))
    sections = structure.build_structure(document.get_toc(), pages)
    chunks = chunking.chunk_book(sections, "The Marketing Book")
    return document, pages, sections, chunks


class ValidationTests(SimpleTestCase):
    def test_non_pdf_is_rejected(self):
        with self.assertRaisesMessage(extract.PdfRejected, "not a PDF"):
            extract.open_pdf(b"hello, this is text")

    def test_corrupt_pdf_is_rejected(self):
        with self.assertRaises(extract.PdfRejected):
            extract.open_pdf(b"%PDF-1.7\n" + b"\x00garbage" * 50)

    def test_password_protected_pdf_is_rejected(self):
        import fitz

        doc = fitz.open()
        doc.new_page().insert_text((72, 72), "secret")
        data = doc.tobytes(encryption=fitz.PDF_ENCRYPT_AES_256, user_pw="u", owner_pw="o")
        with self.assertRaisesMessage(extract.PdfRejected, "password"):
            extract.open_pdf(data)


class ExtractionTests(SimpleTestCase):
    def test_every_page_has_a_known_status(self):
        _, pages, _, _ = _run()
        self.assertEqual([p.pdf_page for p in pages], list(range(1, len(pages) + 1)))
        by_page = {p.pdf_page: p.status for p in pages}
        self.assertEqual(by_page[4], "blank")
        self.assertEqual(by_page[5], "image_only")
        self.assertTrue(all(status in {"text", "blank", "image_only"} for status in by_page.values()))

    def test_running_headers_and_page_numbers_are_removed(self):
        _, pages, _, _ = _run()
        body = "\n".join(p.text for p in pages)
        self.assertNotIn(HEADER, body)
        self.assertNotIn("Page 3", body)
        self.assertIn("SWOT lists strengths and weaknesses.", body)


class StructureTests(SimpleTestCase):
    def test_outline_gives_chapters_sections_and_front_matter(self):
        _, _, sections, _ = _run()
        titles = [(s.level, s.title) for s in sections]
        self.assertEqual(titles[0], (1, "Front matter"))
        self.assertIn((2, "1.1 SWOT analysis"), titles)
        swot = next(s for s in sections if s.title == "1.1 SWOT analysis")
        self.assertEqual(swot.number, "1.1")
        parent = next(s for s in sections if s.ordinal == swot.parent)
        self.assertEqual(parent.title, "1 Marketing Strategy")

    def test_each_line_belongs_to_the_right_section_and_headings_are_not_body(self):
        _, _, sections, _ = _run()
        text_of = {s.title: " ".join(t for _, t in s.paragraphs) for s in sections}
        self.assertIn("Strategy sets direction", text_of["1 Marketing Strategy"])
        self.assertIn("SWOT lists strengths", text_of["1.1 SWOT analysis"])
        self.assertNotIn("SWOT lists", text_of["1 Marketing Strategy"])
        self.assertNotIn("1.1 SWOT analysis", text_of["1.1 SWOT analysis"])
        self.assertIn("The Marketing Book", text_of["Front matter"])

    def test_books_without_an_outline_fall_back_to_heading_sizes(self):
        _, _, sections, _ = _run(_book_pdf(with_toc=False))
        titles = [s.title for s in sections]
        self.assertIn("1 Marketing Strategy", titles)
        self.assertIn("2 Pricing", titles)


class ChunkingTests(SimpleTestCase):
    def test_all_body_text_is_covered(self):
        _, _, sections, chunks = _run()
        self.assertEqual(chunking.text_coverage(sections, chunks), 1.0)

    def test_chunks_stay_inside_one_section_and_within_the_size_limit(self):
        _, _, sections, chunks = _run()
        pricing = next(s for s in sections if s.title == "2 Pricing")
        pricing_chunks = [c for c in chunks if c.section_ordinal == pricing.ordinal]
        self.assertGreater(len(pricing_chunks), 1)
        self.assertTrue(all(c.token_count <= chunking.MAX_TOKENS for c in chunks))
        self.assertTrue(all("Pricing paragraph" not in c.content for c in chunks if c.section_ordinal != pricing.ordinal))

    def test_embed_text_carries_book_section_and_pages_but_content_does_not(self):
        _, _, _, chunks = _run()
        swot = next(c for c in chunks if "SWOT lists" in c.content)
        self.assertIn("The Marketing Book › 1 Marketing Strategy › 1.1 SWOT analysis (pp. 3–3)", swot.embed_text)
        self.assertNotIn("The Marketing Book", swot.content)

    def test_hashes_are_stable_so_unchanged_content_is_never_embedded_twice(self):
        first = [c.content_sha256 for c in _run()[3]]
        second = [c.content_sha256 for c in _run()[3]]
        self.assertEqual(first, second)
        self.assertEqual(chunking.content_hash("A  b\nc"), chunking.content_hash("A b c"))


class ProviderTests(SimpleTestCase):
    def test_fake_embeddings_are_deterministic_unit_vectors(self):
        provider = providers.FakeEmbeddingProvider()
        a, b = provider.embed(["swot", "swot"]).vectors
        self.assertEqual(a, b)
        self.assertEqual(len(a), 1536)
        self.assertAlmostEqual(sum(v * v for v in a), 1.0, places=6)
        self.assertNotEqual(a, provider.embed(["pestle"]).vectors[0])

    def test_batches_are_bounded(self):
        with self.assertRaises(ValueError):
            providers.FakeEmbeddingProvider().embed(["x"] * (providers.MAX_BATCH_INPUTS + 1))

    def test_defaults_are_fake_and_paid_calls_are_refused(self):
        self.assertEqual(config.providers(), "fake")
        self.assertIsInstance(providers.get_embedding_provider(), providers.FakeEmbeddingProvider)
        with self.assertRaises(providers.PaidCallsDisabled):
            providers.OpenAIEmbeddingProvider()

    @override_settings(KNOWLEDGE_BASE_PROVIDERS="openai", KNOWLEDGE_BASE_ALLOW_PAID=False)
    def test_one_flag_alone_never_enables_paid_calls(self):
        with self.assertRaises(providers.PaidCallsDisabled):
            providers.get_embedding_provider()
