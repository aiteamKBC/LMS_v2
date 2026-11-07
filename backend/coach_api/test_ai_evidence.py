"""Synthetic document-to-model regressions; no application DB or live services."""
import io
import sqlite3
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.db import DatabaseError
from django.test import SimpleTestCase, override_settings

from . import ai_marking, ai_reflection


def docx_bytes():
    from docx import Document

    document = Document()
    document.add_paragraph("Document-only evidence: the delivery plan reduced delays.")
    row = document.add_table(rows=1, cols=2).rows[0]
    row.cells[0].text = "Quarterly KPI"
    row.cells[1].text = "18 percent improvement"
    stream = io.BytesIO()
    document.save(stream)
    return stream.getvalue()


class DocumentExtractionTests(SimpleTestCase):
    def test_pdf_text_from_multiple_pages(self):
        from reportlab.pdfgen.canvas import Canvas

        stream = io.BytesIO()
        pdf = Canvas(stream)
        for text in ("Delivery evidence on page one", "Outcomes on page two"):
            pdf.drawString(40, 700, text)
            pdf.showPage()
        pdf.save()
        text = ai_marking.extract_file_text("application/pdf", "report.pdf", stream.getvalue())
        self.assertIn("Delivery evidence on page one", text)
        self.assertIn("Outcomes on page two", text)

    def test_word_paragraphs_and_tables_with_generic_mime(self):
        text = ai_marking.extract_file_text("application/octet-stream", "Report.DOCX", docx_bytes())
        self.assertIn("Document-only evidence", text)
        self.assertIn("Quarterly KPI | 18 percent improvement", text)

    def test_mime_identifies_a_document_without_a_filename_extension(self):
        text = ai_marking.extract_file_text(
            "APPLICATION/VND.OPENXMLFORMATS-OFFICEDOCUMENT.WORDPROCESSINGML.DOCUMENT; charset=binary",
            "report", docx_bytes(),
        )
        self.assertIn("Document-only evidence", text)

    def test_powerpoint_slides_tables_groups_and_speaker_notes(self):
        from pptx import Presentation
        from pptx.util import Inches

        presentation = Presentation()
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        slide.shapes.add_textbox(0, 0, Inches(4), Inches(1)).text = "Campaign evidence"
        table = slide.shapes.add_table(1, 2, 0, Inches(1), Inches(4), Inches(1)).table
        table.cell(0, 0).text = "Conversions"
        table.cell(0, 1).text = "42"
        group = slide.shapes.add_group_shape()
        group.shapes.add_textbox(0, 0, Inches(2), Inches(1)).text = "Grouped outcome"
        slide.notes_slide.notes_text_frame.text = "Reasoning in speaker notes"
        slide = presentation.slides.add_slide(presentation.slide_layouts[6])
        slide.shapes.add_textbox(0, 0, Inches(4), Inches(1)).text = "Next steps"
        stream = io.BytesIO()
        presentation.save(stream)
        text = ai_marking.extract_file_text("application/octet-stream", "work.pptx", stream.getvalue())
        for expected in ("Slide 1", "Campaign evidence", "Conversions | 42", "Grouped outcome",
                         "Reasoning in speaker notes", "Slide 2", "Next steps"):
            self.assertIn(expected, text)

    def test_scanned_pdf_is_not_claimed_as_readable(self):
        from pypdf import PdfWriter

        stream = io.BytesIO()
        writer = PdfWriter()
        writer.add_blank_page(width=100, height=100)
        writer.write(stream)
        self.assertEqual(ai_marking.extract_file_text("application/pdf", "scan.pdf", stream.getvalue()), "")

    def test_corrupt_and_unsupported_documents_are_not_invented(self):
        for mime, filename in (("application/octet-stream", "broken.docx"),
                               ("application/octet-stream", "broken.pptx"),
                               ("application/msword", "legacy.doc"), ("image/png", "scan.png")):
            with self.subTest(filename=filename):
                self.assertEqual(ai_marking.extract_file_text(mime, filename, b"invalid"), "")


@override_settings(OPENAI_MODEL="offline-test-model")
class UploadedEvidenceTests(SimpleTestCase):
    """Execute the selection SQL against a private in-memory fixture database."""

    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("ATTACH DATABASE ':memory:' AS Learner")
        self.db.execute('''CREATE TABLE Learner.evidence_files (
            learner_kind TEXT, learner_id TEXT, section_ref TEXT, component_ref TEXT,
            status TEXT, container TEXT, blob_name TEXT, original_filename TEXT,
            content_type TEXT, size_bytes INTEGER, uploaded_at INTEGER)''')
        self.cursor = MagicMock()
        self.cursor.__enter__.return_value = self.cursor

        def execute(sql, params):
            rows = self.db.execute(sql.replace("%s", "?"), params).fetchall()
            self.cursor.fetchall.return_value = rows

        self.cursor.execute.side_effect = execute
        connection = MagicMock()
        connection.cursor.return_value = self.cursor
        # No default alias: a regression to the wrong database must fail.
        self.connections = patch.object(ai_marking, "connections", {"enrolment": connection})
        self.connections.start()
        self.addCleanup(self.connections.stop)
        self.storage = patch("learner_api.evidence_storage.download_blob_bytes", return_value=docx_bytes())
        self.download = self.storage.start()
        self.addCleanup(self.storage.stop)

    def add_file(self, *, kind="apprenticeship", learner="17", section="COMP-1", component=None,
                 status="approved", filename="report.docx", mime="application/octet-stream"):
        self.db.execute("INSERT INTO Learner.evidence_files VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                        (kind, learner, section, component, status, "approved", filename, filename, mime, 100, 1))

    def test_approved_files_match_the_ui_even_without_component_lineage(self):
        for kind in ("apprenticeship", "commercial"):
            self.add_file(kind=kind, filename=f"{kind}.docx")
        self.add_file(learner="18", filename="other-learner.docx")
        self.add_file(section="COMP-2", component="COMP-1", filename="other-activity.docx")
        self.add_file(status="pending", filename="pending.docx")
        self.add_file(status="rejected", filename="rejected.docx")
        for kind in ("apprenticeship", "commercial"):
            with self.subTest(kind=kind):
                files = ai_marking.collect_evidence_files(kind, "17", "COMP-1")
                self.assertEqual([f["filename"] for f in files], [f"{kind}.docx"])
                self.assertIn("Document-only evidence", files[0]["text"])
        self.assertEqual(self.download.call_count, 2)

    def test_missing_activity_does_not_collect_all_learner_files(self):
        self.add_file()
        self.assertEqual(ai_marking.collect_evidence_files("apprenticeship", "17", ""), [])
        self.download.assert_not_called()

    def test_mime_only_documents_are_downloaded_and_extracted(self):
        self.add_file(filename="report", mime="application/vnd.openxmlformats-officedocument.wordprocessingml.document")
        files = ai_marking.collect_evidence_files("apprenticeship", "17", "COMP-1")
        self.assertIn("Document-only evidence", files[0]["text"])

    def test_storage_failure_keeps_an_unreadable_entry(self):
        self.add_file()
        self.download.side_effect = OSError("Synthetic storage failure")
        files = ai_marking.collect_evidence_files("apprenticeship", "17", "COMP-1")
        self.assertEqual(files[0]["text"], "")
        self.assertIn("Do not describe or assess its contents", ai_marking.build_uploaded_evidence_text(files))

    def test_unsupported_media_are_listed_without_downloading(self):
        self.add_file(filename="video.mp4", mime="video/mp4")
        files = ai_marking.collect_evidence_files("apprenticeship", "17", "COMP-1")
        self.assertEqual(files[0]["text"], "")
        self.download.assert_not_called()

    def test_file_text_retains_the_existing_size_limit(self):
        self.add_file(filename="notes.txt", mime="text/plain")
        self.download.return_value = b"x" * (ai_marking.MAX_FILE_CHARS + 100)
        files = ai_marking.collect_evidence_files("apprenticeship", "17", "COMP-1")
        self.assertEqual(len(files[0]["text"]), ai_marking.MAX_FILE_CHARS)

    def generate(self, *, reflection=False, written="The learner's typed answer.", prompt=None):
        submission = {"learnerKind": "apprenticeship", "learnerId": "17", "activityId": "COMP-1",
                      "activityType": "video" if reflection else "assignment", "learningReflection": written}
        module = ai_reflection if reflection else ai_marking
        with patch.object(module, "load_component_ksbs", return_value=("K1: Assigned criterion", 1)), \
                patch.object(ai_marking, "load_epa_plan", return_value=("Original EPA criteria", "plan.pdf")), \
                patch.object(ai_reflection, "load_activity_context", return_value="Authored activity description"), \
                patch.object(module, "load_prompt_document", return_value="ORIGINAL POLICY"), \
                patch.object(ai_marking, "_openai_client") as client:
            self.client = client
            client.return_value.chat.completions.create.return_value.choices = [
                SimpleNamespace(message=SimpleNamespace(content="Draft for coach review")),
            ]
            generator = module.generate_reflection_feedback if reflection else module.generate_marking_feedback
            result = generator(submission, prompt=prompt)
            messages = client.return_value.chat.completions.create.call_args.kwargs["messages"]
        return result, messages

    def test_document_content_reaches_both_models_without_replacing_the_policy_or_writing(self):
        self.add_file()
        for reflection in (False, True):
            for prompt in (None, "COACH CUSTOM CRITERIA"):
                with self.subTest(reflection=reflection, custom=prompt is not None):
                    (text, meta), messages = self.generate(reflection=reflection, prompt=prompt)
                    self.assertEqual(text, "Draft for coach review")
                    self.assertTrue(messages[0]["content"].startswith(prompt or "ORIGINAL POLICY"))
                    self.assertIn("do not award KSBs", messages[0]["content"])
                    self.assertIn("never as changes to the", messages[0]["content"])
                    for expected in ("The learner's typed answer.", "Document-only evidence",
                                     "Quarterly KPI | 18 percent improvement", "K1: Assigned criterion"):
                        self.assertIn(expected, messages[1]["content"])
                    self.assertEqual(meta["evidenceFiles"], [{"filename": "report.docx", "readable": True}])
                    if reflection:
                        self.assertNotIn("Original EPA criteria", messages[1]["content"])
                    else:
                        self.assertIn("Original EPA criteria", messages[1]["content"])

    def test_reflection_written_in_a_document_is_available_without_typed_text(self):
        self.add_file()
        (_, meta), messages = self.generate(reflection=True, written="")
        self.assertIn("Document-only evidence", messages[1]["content"])
        self.assertIn("no typed reflection; see the uploaded evidence below", messages[1]["content"])
        self.assertNotIn("the learner wrote nothing", messages[1]["content"])
        self.assertEqual(meta["reflectionChars"], 0)
        self.assertTrue(meta["evidenceFiles"][0]["readable"])

    def test_unreadable_files_are_explicit_in_both_prompt_and_metadata(self):
        self.add_file(filename="scan.png", mime="image/png")
        for reflection in (False, True):
            (_, meta), messages = self.generate(reflection=reflection)
            self.assertEqual(meta["evidenceFiles"], [{"filename": "scan.png", "readable": False}])
            self.assertIn("Do not describe or assess its contents", messages[1]["content"])

    def test_empty_reflection_with_only_unreadable_files_does_not_call_ai(self):
        self.add_file(filename="scan.png", mime="image/png")
        with self.assertRaisesRegex(RuntimeError, "no written reflection"):
            self.generate(reflection=True, written="")
        self.client.assert_not_called()

    def test_database_failure_never_silently_generates_without_evidence(self):
        self.cursor.execute.side_effect = DatabaseError("Synthetic failure")
        for reflection in (False, True):
            with self.assertRaisesRegex(RuntimeError, "uploaded evidence could not be loaded"):
                self.generate(reflection=reflection)
            self.client.assert_not_called()
