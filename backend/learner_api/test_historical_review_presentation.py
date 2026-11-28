"""Synthetic captures: no database access, PDFs, current metrics or external IO."""
from copy import deepcopy
from datetime import date
from types import SimpleNamespace
from unittest import TestCase
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api.historical_review_presentation import enrich_historical_review
from learner_api.review_history import _serialize_review


def field(name, title=None, **extra):
    return {"name": name, "title": title or name, "type": 13, **extra}


def capture_fixture(review_type="Progress Review"):
    """15732's 12-section/65-field shape with synthetic identity and answers."""
    counts = [("Learner information", 9), ("Learning progress", 2), ("Progress Checks", 5),
              ("Learner Reflections & Ratings", 16), ("Manager Reflections & Ratings", 7),
              ("Tutor Reflections & Ratings", 7), ("Safeguarding & Key Themes", 6),
              ("Progress Targets & Actions", 2), ("RAG", 2), ("Meeting Details", 7),
              ("Meeting Summary", 2), ("Previous Meeting Summary", 0)]
    sections, captured = [], []
    for index, (name, count) in enumerate(counts):
        definitions = [field(f"question{j}", f"Question {j}", order=j) for j in range(count)]
        values = {f"question{j}": f"Answer {j}" for j in range(count)}
        normalized = [{"label": f["title"], "value": values[f["name"]]} for f in definitions]
        sections.append({"id": index + 100, "name": name, "order": index,
                         "fields": normalized, "tables": [], "rawText": ""})
        captured.append({"section_name": name, "source_payload": {"fields": definitions, **values}})
    sections[0]["fields"][0] = {"label": "Programme", "value": "Historic Programme - June cohort"}
    captured[0]["source_payload"] = {}
    sections[1]["fields"] = [{"label": "hasPrevProgress", "value": "No"}, {"label": "progress", "value": [
        {"progressType": 2, "completedCount": 37, "totalCount": 143, "current": 19, "targetCount": 24},
        {"progressType": 4, "current": 20.71, "max": 100, "target": 31.14},
        {"progressType": 6, "completedTime": 7586, "plannedHours": 850},
        {"progressType": 7, "startDate": "2026-05-15", "currentDate": "2026-09-29", "expectedEndDate": "2029-02-14"},
    ]}]
    captured[1]["source_payload"] = {}
    for i, role in [(3, "Learner"), (4, "Manager"), (5, "Tutor")]:
        payload = captured[i]["source_payload"]
        for definition in payload["fields"]:
            definition["order"] += 1
        payload["fields"].insert(0, field(role.lower(), role + ":", type=11, order=0,
                                        description="On a scale of 1 and 10, how would you rate progress?"))
    for index, condition, answer, title in [
        (6, True, "Safeguarding team: support@example.invalid", "How would you report a Safeguarding concern (and who to)?"),
        (7, False, "First review", "What action is required to achieve outstanding targets including any assistance needed to achieve"),
    ]:
        payload = captured[index]["source_payload"]
        payload["question0"] = condition
        sections[index]["fields"][0]["value"] = "Yes" if condition else "No"
        payload["fields"][0].update(type=6, **{
            "ifTrue" if condition else "ifFalse": [field("detail", title)],
            "ifFalse" if condition else "ifTrue": [field("inactive", "Inactive question")],
        })
        payload["detail"], payload["inactive"] = answer, "Must stay hidden"
    captured[6]["source_payload"]["fields"].append(field("themeComments", "Theme comments", order=6))
    captured[6]["source_payload"]["themeComments"] = None
    sections[8]["fields"] = [{"label": "RAG Level", "value": 3}, {"label": "currentRagLevel", "value": 3}]
    captured[8]["source_payload"] = {}
    # Real MCM/Radar system sections can have no custom-field definitions.
    for i in (9, 10, 11):
        captured[i]["source_payload"] = {}
    sections[10]["fields"] = [{"label": "Summary", "value": "<p>Historical meeting summary.</p>"},
                               {"label": "Transcripts", "value": []}]
    row = dict(id=901, learner_id=21, aptem_review_id="historical-reference", review_type=review_type,
               review_name="Review 1", reviewer_name="Example Coach", learner_name="Alex Example",
               planned_scheduled_date=date(2026, 9, 29), completed_date=date(2026, 9, 29),
               status="Completed", review_data={"sections": captured, "aptem_learner_id": "6301",
               "live_odata": {"ProgramName": "Older fallback programme", "RagLevel": "Green"}},
               extraction_status="success", last_error=None)
    return row, {901: sections}


class HistoricalEnrichmentTests(TestCase):
    def test_15732_shape_restores_six_fields_without_changing_source_values(self):
        row, sections = capture_fixture()
        before = deepcopy((row, sections))
        result = _serialize_review(row, sections, historical_presentation=True)
        self.assertEqual((row, sections), before)
        self.assertEqual(len(result["sections"]), 12)
        self.assertEqual(sum(len(s["fields"]) for s in result["sections"]), 71)
        for old, new in zip(sections[901], result["sections"]):
            retained = [f for f in new["fields"] if not f.get("sourceFieldKey")]
            self.assertEqual([(f["label"], f["value"]) for f in retained],
                             [(f["label"], f["value"]) for f in old["fields"]])
        self.assertEqual(result["sections"][6]["fields"][1]["value"], "Safeguarding team: support@example.invalid")
        self.assertEqual(result["sections"][7]["fields"][1]["value"], "First review")
        for i in (3, 4, 5):
            self.assertEqual(result["sections"][i]["fields"][0]["fieldType"], "title_description")
        self.assertIsNone(result["sections"][6]["fields"][-1]["value"])
        self.assertTrue(result["sections"][6]["fields"][-1]["preserveEmpty"])
        self.assertEqual(result["historicalProgramme"], "Historic Programme - June cohort")
        self.assertEqual(result["sections"][8]["fields"][0]["displayValue"], "Green")
        self.assertEqual(result["sections"][8]["fields"][0]["value"], 3)
        self.assertEqual(enrich_historical_review(result, row["review_data"]), result)

    def test_missing_malformed_payload_or_definitions_keeps_normalized_values(self):
        for malformed in (None, "broken", [], {}, {"fields": None}, {"fields": [None, "bad"]}):
            row, sections = capture_fixture()
            for section in row["review_data"]["sections"]:
                section["source_payload"] = malformed
            result = _serialize_review(row, sections, historical_presentation=True)
            self.assertEqual(sum(len(s["fields"]) for s in result["sections"]), 65)
        row["review_data"] = {"sections": None}
        self.assertEqual(len(_serialize_review(row, sections, historical_presentation=True)["sections"]), 12)

    def test_strong_identity_dedupes_changed_label_and_keeps_explicit_null(self):
        review = {"status": "completed", "sections": [{"name": "Section", "fields": [
            {"id": "field-a", "label": "Old label", "value": None},
            {"name": "answer", "label": "Answer", "value": "Normalized wins"},
        ]}]}
        payload = {"sections": [{"name": "Section", "source_payload": {"fields": [
            field("a", "New label", id="field-a"), field("answer", "Renamed answer"),
        ], "a": "Stale source", "answer": "Raw source"}}]}
        fields = enrich_historical_review(review, payload)["sections"][0]["fields"]
        self.assertEqual(len(fields), 2)
        self.assertEqual(fields[0]["label"], "Old label")
        self.assertIsNone(fields[0]["value"])
        self.assertEqual(fields[1]["value"], "Normalized wins")

    def test_different_strong_ids_with_same_label_are_distinct_and_stable(self):
        review = {"status": "completed", "sections": [{"name": "Section", "fields": [
            {"id": "one", "label": "Notes", "value": "Original"}]}]}
        raw = {"sections": [{"name": "Section", "source_payload": {"fields": [
            field("one", "Notes", id="one"), field("two", "Notes", id="two"),
        ], "one": "Other", "two": "Second"}}]}
        enriched = enrich_historical_review(review, raw)
        self.assertEqual([f["value"] for f in enriched["sections"][0]["fields"]], ["Original", "Second"])
        self.assertEqual(enrich_historical_review(enriched, raw), enriched)

    def test_conditions_use_captured_boolean_not_normalized_or_current_state(self):
        for condition, expected in [(True, "trueAnswer"), (False, "falseAnswer"), (None, None), ("Yes", "trueAnswer")]:
            review = {"status": "completed", "sections": [{"name": "Section", "fields": [
                {"label": "Condition", "value": "Opposite/stale display"}]}]}
            raw = {"sections": [{"name": "Section", "source_payload": {"fields": [
                field("condition", "Condition", type=6, ifTrue=[field("trueAnswer")], ifFalse=[field("falseAnswer")]),
            ], "condition": condition, "trueAnswer": None, "falseAnswer": "Historical false branch"}}]}
            fields = enrich_historical_review(review, raw)["sections"][0]["fields"]
            self.assertEqual([f["label"] for f in fields], ["Condition"] + ([expected] if expected else []))
            if expected == "trueAnswer":
                self.assertIsNone(fields[1]["value"])

    def test_no_human_labels_means_no_invented_programme_or_rag_mapping(self):
        row, sections = capture_fixture()
        row["review_data"].pop("live_odata")
        sections[901][0]["fields"][0]["value"] = None
        result = _serialize_review(row, sections, historical_presentation=True)
        self.assertNotIn("historicalProgramme", result)
        self.assertNotIn("displayValue", result["sections"][8]["fields"][0])

    def test_rag_null_and_existing_human_answer_remain_authoritative(self):
        for value in (None, "Amber"):
            row, sections = capture_fixture()
            sections[901][8]["fields"][0]["value"] = value
            result = _serialize_review(row, sections, historical_presentation=True)
            self.assertNotIn("displayValue", result["sections"][8]["fields"][0])

    def test_identical_normalized_fields_keep_distinct_positional_form_ids(self):
        row, sections = capture_fixture()
        sections[901][3]["fields"][1] = deepcopy(sections[901][3]["fields"][0])
        result = _serialize_review(row, sections, historical_presentation=True)
        fields = [f for f in result["sections"][3]["fields"] if not f.get("historicalSupplement")]
        self.assertEqual([f["historicalIndex"] for f in fields], list(range(16)))

    def test_payload_metadata_and_unknown_structured_controls_are_not_exposed(self):
        review = {"status": "completed", "sections": [{"name": "Section", "fields": []}]}
        raw = {"sections": [{"name": "Section", "source_payload": {"fields": [
            field("ownerId"), field("webMeetingLink"), field("route"), field("unknown", type=99), field("object"),
        ], "ownerId": 10, "webMeetingLink": "https://example.invalid/private", "route": "internal",
            "unknown": "Do not expose", "object": {"permissions": "private"}, "unlisted": "private"}}]}
        self.assertEqual(enrich_historical_review(review, raw)["sections"][0]["fields"], [])

    def test_ambiguous_section_mapping_is_not_guessed(self):
        row, sections = capture_fixture()
        raw = row["review_data"]
        raw["sections"].append(deepcopy(raw["sections"][6]))
        result = _serialize_review(row, sections, historical_presentation=True)
        self.assertEqual(len(result["sections"][6]["fields"]), 6)

    def test_text_only_normalized_export_is_not_discarded_when_fields_are_restored(self):
        review = {"status": "completed", "sections": [{"name": "Section", "fields": [], "rawText": "Original narrative"}]}
        raw = {"sections": [{"name": "Section", "source_payload": {"fields": [field("answer", "Question")], "answer": "Captured answer"}}]}
        enriched = enrich_historical_review(review, raw)
        self.assertEqual(enriched["sections"][0]["rawText"], "Original narrative")
        self.assertTrue(enriched["sections"][0]["preserveRawText"])
        self.assertEqual(enrich_historical_review(enriched, raw), enriched)

    def test_uncompleted_sources_and_default_serialization_are_unchanged(self):
        row, sections = capture_fixture()
        baseline = _serialize_review(row, sections)
        self.assertEqual(sum(len(s["fields"]) for s in baseline["sections"]), 65)
        row.update(status="In Progress", completed_date=None)
        self.assertEqual(_serialize_review(row, sections, historical_presentation=True), _serialize_review(row, sections))


class HistoricalFormContractTests(SimpleTestCase):
    def definition(self, row, sections, *, pdf_only=False):
        from coach_api import views
        person = SimpleNamespace(id=21, full_name="Alex Example", programme="Current programme", programme_id="P1",
                                 coach_email="coach@example.invalid")
        cursor = MagicMock()
        cursor.description = [(key,) for key in row]
        cursor.fetchall.return_value = [tuple(row.values())]
        with patch.object(views, "fetch_caseload_dashboard_profiles", return_value=[person]), \
             patch.object(views, "resolve_effective_aptem_ids", return_value=({21: 6301}, set())), \
             patch.object(views, "get_learner_db_alias", return_value="default"), \
             patch.object(views, "connections") as connections, \
             patch.object(views, "_sections_by_review", return_value=sections), \
             patch.object(views.ImportedReviewInstance.objects, "filter") as overlays, \
             patch.object(views, "resolve_migrated_template", side_effect=AssertionError("template lookup")), \
             patch.object(views.curriculum_review_instances, "review_instance_form_definition", side_effect=AssertionError("Native lookup")), \
             patch.object(views, "build_progress_snapshot", side_effect=AssertionError("live metrics")):
            connections["default"].cursor.return_value.__enter__.return_value = cursor
            overlays.return_value.first.return_value = None
            return views._imported_review_definition("coach@example.invalid", "imported-review:historical-reference", pdf_only=pdf_only)

    def test_all_historical_families_keep_order_identity_readonly_and_original_pdf_path(self):
        for review_type in ("Monthly Coaching Meeting", "Progress Review", "Progress Review (+ Skills Radar)"):
            with self.subTest(review_type=review_type):
                row, sections = capture_fixture(review_type)
                definition = self.definition(row, sections)
                self.assertEqual(len(definition["sections"]), 12)
                self.assertEqual([s["title"] for s in definition["sections"]], [s["name"] for s in sections[901]])
                self.assertEqual(definition["instance"]["id"], "imported-review:historical-reference")
                self.assertTrue(definition["readOnly"])
                self.assertFalse(definition["migratedForm"])
                self.assertFalse(definition["canInitialize"])
                self.assertEqual(definition["programme"], "Historic Programme - June cohort")
                self.assertEqual(definition["sections"][8]["fields"][0]["answer"], "Green")
                restored = definition["sections"][7]["fields"][1]
                self.assertEqual(restored["answer"], "First review")
                self.assertIn("source:key:", restored["id"])
                self.assertEqual(definition["sections"][3]["fields"][1]["id"], "aptem-field:103:0")
                self.assertIsNone(definition["progressSnapshot"])
                pdf_definition = self.definition(row, sections, pdf_only=True)
                self.assertEqual(pdf_definition["historicalReview"], _serialize_review(row, sections))
                self.assertFalse(pdf_definition["migratedForm"])

    def test_missing_historical_programme_keeps_existing_header_fallback(self):
        row, sections = capture_fixture()
        row["review_data"].pop("live_odata")
        sections[901][0]["fields"][0]["value"] = None
        self.assertEqual(self.definition(row, sections)["programme"], "Current programme")
