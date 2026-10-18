"""Learner Home round-trip reductions keep the same reads' results (mocks only)."""
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from django.test import SimpleTestCase

from learner_api import calendar, current_learning, home_progress, imported_review_calendar, training_plan_dashboard


def source(aptem_id=6301):
    return SimpleNamespace(pk=121, aptem_id=str(aptem_id), email="learner@example.invalid",
                           learner_type="commercial")


def profile(aptem_id=6301):
    return SimpleNamespace(id=21, enrolment_id=121, aptem_id=aptem_id, email="learner@example.invalid",
                           learner_type="commercial", lifecycle_status="active")


def record(event_type, key, template=""):
    return SimpleNamespace(event_type=event_type, event_key=key, review_template_id=template,
                           learner_email="learner@example.invalid", learner_id=21, idempotency_key="")


class NarrowedReviewEventsTests(SimpleTestCase):
    def read(self, records, only_sources, **options):
        imported = [{"eventKey": "imported-review:1", "source": "progress-review"},
                    {"eventKey": "imported-review:2", "source": "mcr"}]
        with patch.object(calendar.CoachCalendarEvent.objects, "filter") as stored, \
             patch("learner_api.imported_review_calendar.imported_events_for_learner",
                   return_value=imported) as read_imported, \
             patch.object(calendar, "_curriculum_cycle_events", return_value=[]) as cycle, \
             patch.object(calendar, "_serialize_event",
                          side_effect=lambda row: {"eventKey": row.event_key, "source": row.event_type}) as serialize:
            stored.return_value.order_by.return_value = records
            events = calendar.coaching_events_for_learner(source(), profile(), only_sources=only_sources, **options)
        return events, read_imported, cycle, serialize

    def test_progress_review_reader_skips_curriculum_and_section_text(self):
        rows = [record("mcr", "native-mcm"), record("catch-up", "catch-up-1")]
        events, read_imported, cycle, serialize = self.read(rows, {"progress-review"})
        cycle.assert_not_called()
        serialize.assert_not_called()
        self.assertEqual(read_imported.call_args.kwargs, {"include_sections": False, "dates_only": False})
        self.assertEqual([e["eventKey"] for e in events if e["source"] == "progress-review"],
                         ["imported-review:1"])

    def test_a_dates_only_reader_skips_the_review_history(self):
        _, read_imported, _, _ = self.read([], {"progress-review"}, dates_only=True)
        self.assertEqual(read_imported.call_args.kwargs, {"include_sections": False, "dates_only": True})

    def test_templated_native_mcm_rows_do_not_supplement_aptem_reviews(self):
        rows = [record("mcr", "native-mcm", template="T-1")]
        events, _, cycle, serialize = self.read(rows, {"progress-review"})
        cycle.assert_not_called()
        serialize.assert_not_called()
        self.assertNotIn("native-mcm", [item["eventKey"] for item in events])

    def test_mcm_and_progress_readers_keep_only_imported_reviews(self):
        events, _, cycle, _ = self.read([], {"mcr", "progress-review"})
        cycle.assert_not_called()
        self.assertEqual([item["eventKey"] for item in events], ["imported-review:1", "imported-review:2"])

    def test_default_calendar_reads_are_unchanged(self):
        rows = [record("catch-up", "catch-up-1")]
        events, read_imported, cycle, serialize = self.read(rows, None)
        cycle.assert_not_called()
        serialize.assert_called_once()
        self.assertEqual(read_imported.call_args.kwargs, {})
        self.assertEqual(events[-1], {"eventKey": "catch-up-1", "source": "catch-up"})

    def test_matching_sources_are_still_serialised(self):
        rows = [record("student-support", "support-1"), record("catch-up", "catch-up-1")]
        events, _, _, serialize = self.read(rows, {"mcr", "progress-review", "student-support"})
        self.assertEqual(serialize.call_count, 1)
        self.assertEqual(events[-1]["eventKey"], "support-1")

    def test_training_plan_passes_its_wanted_sources(self):
        with patch("learner_api.calendar.coaching_events_for_learner", return_value=[]) as read:
            training_plan_dashboard.plan_reviews(source(), profile(), ("progress-review",))
        self.assertEqual(read.call_args.kwargs, {"only_sources": frozenset({"progress-review"}), "dates_only": False})

    def test_review_identity_fields_are_loaded_with_the_profile(self):
        self.assertTrue({"aptem_id", "enrolment_id", "learner_type"}
                        <= set(training_plan_dashboard.TRAINING_PLAN_PROFILE_FIELDS))
        self.assertIn("learner_type", training_plan_dashboard.TRAINING_PLAN_SOURCE_FIELDS)


class DatesOnlyImportedReviewTests(SimpleTestCase):
    EVENTS = [
        {"eventKey": "imported-review:1", "reviewId": "1", "source": "progress-review", "title": "Progress Review",
         "status": "scheduled", "targetDate": "2026-10-20", "scheduledDate": None, "importedReviewType": "Progress Review"},
        {"eventKey": "imported-review:2", "reviewId": "2", "source": "progress-review", "title": "Progress Review",
         "status": "scheduled", "targetDate": "2026-10-21", "scheduledDate": None, "importedReviewType": "Progress Review"},
    ]

    def read(self, **options):
        cursor = MagicMock()
        cursor.fetchall.return_value = [(1,)]
        connection = MagicMock()
        connection.cursor.return_value.__enter__.return_value = cursor
        events = [dict(event) for event in self.EVENTS]
        links = ({event["eventKey"]: None for event in events}, {event["eventKey"]: None for event in events})
        with patch("coach_api.views.fetch_aptem_review_events", return_value=(events, None)), \
             patch("coach_api.views.overlay_calendar_record", side_effect=lambda event, *_args, **_kw: dict(event)), \
             patch.object(imported_review_calendar, "connection", connection), \
             patch.object(imported_review_calendar, "load_imported_links", return_value=links), \
             patch.object(imported_review_calendar, "_review_rows", return_value=[{"id": 1}]) as full_rows, \
             patch.object(imported_review_calendar, "_serialize_review",
                          return_value={"type": "Progress Review", "reviewerName": "Reviewer"}):
            result = imported_review_calendar.imported_events_for_learner(
                source(), SimpleNamespace(id=21, coach_email="", coach_name="", learner_type="commercial"),
                6301, [], include_sections=False, **options)
        return result, cursor, full_rows

    def test_only_review_ids_are_read_and_the_card_fields_match_the_full_read(self):
        full, _, _ = self.read()
        light, cursor, full_rows = self.read(dates_only=True)
        full_rows.assert_not_called()
        sql, params = cursor.execute.call_args.args
        self.assertEqual(sql, 'SELECT id FROM "Learner".reviews WHERE learner_id = %s AND review_type = ANY(%s)')
        self.assertEqual(params, [21, ["Progress Review"]])
        # The same occurrences (a review without a row is dropped either way), with the same card fields.
        card = ("eventKey", "reviewId", "source", "title", "status", "targetDate", "scheduledDate")
        self.assertEqual([{k: e[k] for k in card} for e in light], [{k: e[k] for k in card} for e in full])
        self.assertEqual([e["reviewId"] for e in light], ["1"])
        self.assertNotIn("importedReview", light[0])
        self.assertIn("importedReview", full[0])


class CanonicalMetricsPayloadTests(SimpleTestCase):
    def test_metrics_read_progress_without_raw_evidence_bodies(self):
        from learner_api import canonical_learning
        owner = {"id": 21, "enrolment_id": 121}
        with patch.object(canonical_learning, "entries_for", return_value=[]) as entries, \
             patch.object(canonical_learning, "targets_for", return_value={}):
            canonical_learning.metrics(121, owner=owner)
        entries.assert_called_once_with(owner, lineage_only=True)

    def test_only_an_object_payload_is_reduced_to_its_lineage_reference(self):
        from learner_api import canonical_learning
        with patch.object(canonical_learning, "query", return_value=[]) as query, \
             patch.object(canonical_learning, "current_records", return_value=[]):
            canonical_learning.entries_for({"id": 21}, lineage_only=True)
            light = query.call_args.args[0]
            canonical_learning.entries_for({"id": 21})
            full = query.call_args.args[0]
        self.assertIn("SELECT to_jsonb(p) AS payload", full)
        self.assertIn("CASE WHEN jsonb_typeof(p.source_payload)='object'", light)
        self.assertIn("jsonb_build_object('original_source_ref',p.source_payload->'original_source_ref')", light)
        self.assertIn("ELSE to_jsonb(p) END AS payload", light)


class AttemptsRelationMemoTests(SimpleTestCase):
    def tearDown(self):
        current_learning.attempts_relation_exists.__dict__.pop("present", None)

    def test_a_found_table_is_not_probed_again(self):
        with patch.object(current_learning, "query", return_value=[{"name": "attempts"}]) as query:
            self.assertTrue(current_learning.attempts_relation_exists())
            self.assertTrue(current_learning.attempts_relation_exists())
        self.assertEqual(query.call_count, 1)

    def test_a_missing_table_is_asked_about_again(self):
        with patch.object(current_learning, "query", return_value=[{"name": None}]) as query:
            self.assertFalse(current_learning.attempts_relation_exists())
            self.assertFalse(current_learning.attempts_relation_exists())
        self.assertEqual(query.call_count, 2)


class HomeAttendanceProfileTests(SimpleTestCase):
    def run_home(self, learner):
        with patch.object(home_progress, "connections") as connections, \
             patch.object(home_progress, "rows", return_value=[]), \
             patch.object(home_progress, "_group_dates", return_value=(None, None, None)), \
             patch.object(home_progress, "lecture_register", return_value=[]) as register, \
             patch.object(home_progress, "apply_canonical_home_metrics",
                          side_effect=lambda home, metrics: home), \
             patch.object(home_progress, "plan_planned_hours", return_value=None):
            home_progress.read_home_progress(learner, "commercial", [], [], [], [], date(2026, 10, 18),
                                             attendance_module_ids=["MOD-1"], canonical_metrics={"otjh": {}})
        return register

    def test_verified_owner_supplies_the_attendance_profile(self):
        learner = SimpleNamespace(pk=121, _canonical_profile={"id": 21})
        register = self.run_home(learner)
        register.assert_called_once_with(learner, module_ids=["MOD-1"], learner_profile_id=21)

    def test_without_an_owner_the_register_resolves_the_profile_itself(self):
        learner = SimpleNamespace(pk=121)
        register = self.run_home(learner)
        register.assert_called_once_with(learner, module_ids=["MOD-1"])
