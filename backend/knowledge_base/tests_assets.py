"""Assets and storage -- no database, no network.

    python manage.py test knowledge_base.tests_assets
"""
import io
import tempfile

from django.test import SimpleTestCase, override_settings

from . import assets, storage


def _png(size=(120, 90), color=(200, 30, 30)):
    from PIL import Image

    out = io.BytesIO()
    Image.new("RGB", size, color).save(out, format="PNG")
    return out.getvalue()


def _visual_pdf():
    import fitz

    doc = fitz.open()
    page = doc.new_page()
    # raster image with a caption under it
    page.insert_image(fitz.Rect(72, 60, 252, 195), stream=_png())
    page.insert_text((72, 210), "Figure 3.2: Brand colours", fontsize=9)
    # vector SWOT grid with labels
    labels = ["Strengths", "Weaknesses", "Opportunities", "Threats"]
    for i, label in enumerate(labels):
        x, y = 300 + (i % 2) * 120, 60 + (i // 2) * 80
        page.draw_rect(fitz.Rect(x, y, x + 110, y + 70))
        page.draw_rect(fitz.Rect(x + 5, y + 5, x + 105, y + 65))
        page.insert_text((x + 10, y + 35), label, fontsize=9)
    page.insert_text((300, 235), "Figure 3.3: SWOT matrix", fontsize=9)
    # ruled table
    rows = [["Channel", "Cost"], ["Organic", "Low"], ["Paid", "High"]]
    for r, row in enumerate(rows):
        for c, cell in enumerate(row):
            rect = fitz.Rect(72 + c * 120, 400 + r * 25, 192 + c * 120, 425 + r * 25)
            page.draw_rect(rect)
            page.insert_text((rect.x0 + 5, rect.y0 + 17), cell, fontsize=10)
    # a tiny icon that must be ignored
    page.insert_image(fitz.Rect(500, 700, 510, 710), stream=_png((10, 10)))
    data = doc.tobytes()
    doc.close()
    return fitz.open(stream=data, filetype="pdf")


class AssetExtractionTests(SimpleTestCase):
    def setUp(self):
        self.doc = _visual_pdf()
        self.found = assets.extract_page_assets(self.doc, self.doc.load_page(0), 1)
        self.by_kind = {}
        for asset in self.found:
            self.by_kind.setdefault(asset.kind, []).append(asset)

    def test_raster_image_is_kept_as_clean_webp_with_its_caption(self):
        raster = self.by_kind["raster"]
        self.assertEqual(len(raster), 1)  # the 10x10 icon is ignored
        self.assertEqual(raster[0].media_type, "image/webp")
        self.assertTrue(raster[0].data.startswith(b"RIFF"))
        self.assertEqual(raster[0].caption, "Figure 3.2: Brand colours")

    def test_vector_diagram_is_captured_with_its_labels(self):
        vector = self.by_kind["vector_region"]
        self.assertEqual(len(vector), 1)
        for label in ("Strengths", "Weaknesses", "Opportunities", "Threats"):
            self.assertIn(label, vector[0].label_text)
        self.assertEqual(vector[0].caption, "Figure 3.3: SWOT matrix")

    def test_table_becomes_markdown_plus_snapshot(self):
        table = self.by_kind["table_snapshot"]
        self.assertEqual(len(table), 1)
        for cell in ("Channel", "Organic", "Paid", "High"):
            self.assertIn(cell, table[0].table_markdown)
        self.assertTrue(table[0].data.startswith(b"RIFF"))

    def test_figure_numbers_are_stripped_for_the_generator(self):
        self.assertEqual(assets.strip_figure_number("Figure 3.2: Ansoff matrix"), "Ansoff matrix")
        self.assertEqual(assets.strip_figure_number("Table 4 – Pricing models"), "Pricing models")
        self.assertEqual(assets.strip_figure_number("The Ansoff matrix"), "The Ansoff matrix")

    def test_page_previews_are_small_webp(self):
        thumb, preview = assets.page_previews(self.doc.load_page(0))
        self.assertTrue(thumb.startswith(b"RIFF") and preview.startswith(b"RIFF"))
        self.assertLess(len(thumb), len(preview))
        self.assertLess(len(preview), 400_000)

    def test_repeated_images_are_decorative(self):
        decorative = assets.mark_decorative({"logo": list(range(1, 41)), "figure": [7]}, total_pages=40)
        self.assertEqual(decorative, {"logo"})


class StorageTests(SimpleTestCase):
    def test_content_addressed_local_storage(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(KNOWLEDGE_BASE_LOCAL_DIR=tmp):
            store = storage.get_storage()
            sha = storage.sha256_of(b"image")
            ref = store.put(storage.asset_key(sha, "webp"), b"image")
            self.assertEqual(ref, store.put(storage.asset_key(sha, "webp"), b"image"))  # stored once
            self.assertTrue(ref.startswith("local:assets/"))
            self.assertEqual(store.get(ref), b"image")

    def test_keys_cannot_escape_the_root(self):
        with tempfile.TemporaryDirectory() as tmp, override_settings(KNOWLEDGE_BASE_LOCAL_DIR=tmp):
            with self.assertRaises(storage.StorageError):
                storage.get_storage().put("../outside.txt", b"x")

    @override_settings(KNOWLEDGE_BASE_STORAGE="azure")
    def test_azure_is_not_selectable_yet(self):
        with self.assertRaises(storage.StorageError):
            storage.get_storage()
