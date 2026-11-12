"""curriculum_component_fk is written only for a verified current component.

DB-free: every connection, cursor and model manager is a stand-in, and the
network is refused. Ids and values are synthetic.
"""
from contextlib import ExitStack, nullcontext
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock, Mock, patch

from django.test import SimpleTestCase

from . import active_users, lms_alias_reconciliation, module_shift


def _connection(found=True, vendor="postgresql"):
    """A connection whose curriculum.components lookup finds the id, or not."""
    cursor = MagicMock()
    cursor.fetchone.return_value = ("ignored",) if found else None
    connection = MagicMock(vendor=vendor)
    connection.cursor.return_value.__enter__.return_value = cursor
    return connection, cursor


def _component_lookups(cursor):
    return [call for call in cursor.execute.call_args_list if "curriculum.components" in call.args[0]]


class CurrentComponentKeyTests(SimpleTestCase):
    def test_a_current_component_is_its_own_key_and_held_until_commit(self):
        connection, cursor = _connection(found=True)

        self.assertEqual(active_users.current_component_fk(connection, " C1 "), "C1")
        sql, params = cursor.execute.call_args.args
        self.assertIn("FOR KEY SHARE", sql)
        self.assertEqual(params, ["C1"])

    def test_an_id_that_resolves_nowhere_stores_null_never_a_substitute(self):
        connection, _cursor = _connection(found=False)

        self.assertIsNone(active_users.current_component_fk(connection, "LEGACY-404"))

    def test_no_component_means_no_lookup(self):
        connection, cursor = _connection()

        for value in (None, "", "   "):
            self.assertIsNone(active_users.current_component_fk(connection, value))
        cursor.execute.assert_not_called()

    def test_sqlite_lookup_has_no_postgres_lock(self):
        connection, cursor = _connection(vendor="sqlite")

        active_users.current_component_fk(connection, "C1")
        self.assertNotIn("FOR KEY SHARE", cursor.execute.call_args.args[0])


class SaveProgressRecordKeyTests(SimpleTestCase):
    def setUp(self):
        self.enterContext(patch("socket.socket", side_effect=AssertionError("Network forbidden")))

    def save(self, record, *, state=("active", ""), found=True):
        learner = SimpleNamespace(pk=7, enrolment_id=19, aptem_id=42, username="Synthetic learner",
                                  training_plan_progress=[], save=Mock())
        create = Mock(return_value=SimpleNamespace(pk=11))
        connection, cursor = _connection(found=found)
        with ExitStack() as stack:
            stack.enter_context(patch.object(active_users, "component_reference_state", return_value=state))
            stack.enter_context(patch.object(active_users, "_component_learning_context", return_value={}))
            stack.enter_context(patch.object(active_users.transaction, "atomic", side_effect=lambda **kwargs: nullcontext()))
            stack.enter_context(patch.object(active_users.transaction, "on_commit"))
            stack.enter_context(patch.object(active_users, "connections", {"enrolment": connection}))
            stack.enter_context(patch.object(active_users.LearnerProfile.objects, "select_for_update",
                                             return_value=SimpleNamespace(get=lambda **kwargs: learner)))
            stack.enter_context(patch.object(active_users.LearnerProgressEntry.objects, "filter",
                                             return_value=SimpleNamespace(aggregate=lambda **kwargs: {"value": 4})))
            stack.enter_context(patch.object(active_users, "_create_progress_entry", create))
            ksb = stack.enter_context(patch.object(active_users, "LearnerProgressKsb"))
            stack.enter_context(patch("learner_api.retake_timing.validate_activity_time"))
            stack.enter_context(patch("learner_api.activity_time_history.attendance_baseline", return_value=0))
            active_users.save_progress_record(learner, record)
        self.ksb = ksb
        return create, cursor

    def test_new_component_progress_writes_the_verified_key_once(self):
        record = {"kind": "component", "componentId": "C1", "componentType": "reading",
                  "grade": 0.75, "claimedSeconds": 900, "ksbs": ["K1"]}

        create, cursor = self.save(record)

        create.assert_called_once()
        fields = create.call_args.kwargs
        self.assertEqual((fields["component_ref"], fields["curriculum_component_fk"]), ("C1", "C1"))
        self.assertEqual(fields["entry_order"], 5)
        self.assertEqual(float(fields["grade"]), 0.75)
        self.assertEqual(fields["claimed_seconds"], 900)
        self.assertEqual(fields["component_link_status"], "resolved_to_current_component")
        # The text lineage column is not invented for a fresh write.
        self.assertNotIn("curriculum_component_ref", fields)
        self.assertEqual(len(_component_lookups(cursor)), 1)
        # KSB links are built exactly as before, once, from the same record.
        self.ksb.objects.bulk_create.assert_called_once()
        self.assertEqual(self.ksb.call_args.kwargs["ksb_code"], "K1")

    def test_a_component_the_writing_database_does_not_hold_is_stored_without_a_key(self):
        create, _cursor = self.save({"kind": "component", "componentId": "C1"}, found=False)

        self.assertIsNone(create.call_args.kwargs["curriculum_component_fk"])
        self.assertEqual(create.call_args.kwargs["component_ref"], "C1")

    def test_a_standalone_quiz_keeps_the_key_null(self):
        create, cursor = self.save({"kind": "quiz", "quizId": "64", "attempt": 2, "grade": 0.5, "passed": False})

        fields = create.call_args.kwargs
        self.assertIsNone(fields["curriculum_component_fk"])
        self.assertIsNone(fields["component_ref"])
        self.assertEqual((fields["quiz_ref"], fields["attempt"], fields["passed"]), ("64", 2, False))
        self.assertEqual(fields["component_link_status"], "valid_legacy_non_component_activity")
        self.assertEqual(_component_lookups(cursor), [])

    def test_unknown_and_deleted_components_are_still_refused_before_any_write(self):
        cases = (
            (("unknown", ""), active_users.OrphanComponentReferenceError),
            (("deleted", "module"), active_users.DeletedComponentReferenceError),
        )
        for state, error in cases:
            with self.subTest(state=state[0]):
                create = Mock()
                with patch.object(active_users, "component_reference_state", return_value=state), \
                        patch.object(active_users, "_create_progress_entry", create):
                    with self.assertRaises(error):
                        active_users.save_progress_record(SimpleNamespace(pk=7), {"kind": "component", "componentId": "C9"})
                create.assert_not_called()


TARGET_CONTEXT = {"moduleId": "MOD-B", "weekId": "W-B1", "componentTitle": "Target", "componentType": "reading",
                  "points": 20, "ksbMappings": []}


def _entry(**kwargs):
    return SimpleNamespace(
        id=kwargs.get("id", 1), kind="component", component_ref=kwargs.get("component_ref", "C-A"),
        legacy_component_ref=kwargs.get("legacy_component_ref", ""),
        curriculum_component_ref=kwargs.get("curriculum_component_ref"),
        curriculum_component_fk=kwargs.get("curriculum_component_fk"),
        programme_ref="P", programme_title="", module_ref="MOD-A", module_title="", week_ref="W-A1",
        week_title="", group_ref="G", group_title="", cohort_ref="C", cohort_title="",
        component_title="Source", component_type="reading", points=10, expected_otjh=2,
        grade=72, attempt=2, passed=True, claimed_seconds=5400, verified_seconds=300,
        submitted_at=datetime(2026, 8, 26, 11, 48, tzinfo=timezone.utc), save=Mock(),
    )


class RepointKeyTests(SimpleTestCase):
    def repoint(self, entries, *, found=True):
        connection, _cursor = _connection(found=found)
        connection.cursor.return_value.__enter__.return_value.fetchall.return_value = []
        with patch.object(module_shift, "_component_learning_context", return_value=TARGET_CONTEXT), \
                patch.object(module_shift, "connections", {"enrolment": connection}), \
                patch.object(module_shift, "_rewrite_ksbs") as ksbs:
            counts = module_shift._repoint_progress(
                SimpleNamespace(pk=62), SimpleNamespace(id=211), [("C-A", "C-B")],
                entries_by_component={"C-A": entries},
            )
        return counts, ksbs

    def test_the_key_and_canonical_ref_follow_the_move_and_lineage_is_kept(self):
        entry = _entry(curriculum_component_ref="C-A", curriculum_component_fk="C-A")

        counts, ksbs = self.repoint([entry])

        self.assertEqual(counts["entries"], 1)
        self.assertEqual((entry.component_ref, entry.curriculum_component_ref, entry.curriculum_component_fk),
                         ("C-B", "C-B", "C-B"))
        self.assertEqual(entry.legacy_component_ref, "C-A")
        changed = set(entry.save.call_args.kwargs["update_fields"])
        self.assertTrue({"curriculum_component_ref", "curriculum_component_fk"} <= changed)
        # What the learner did, and how it was credited, is not rewritten.
        self.assertTrue({"grade", "attempt", "passed", "claimed_seconds", "verified_seconds",
                         "expected_otjh", "submitted_at", "accepted", "actual_seconds"}.isdisjoint(changed))
        self.assertEqual((entry.grade, entry.attempt, entry.claimed_seconds), (72, 2, 5400))
        ksbs.assert_called_once_with(entry, TARGET_CONTEXT)

    def test_an_absent_canonical_ref_stays_absent(self):
        entry = _entry(curriculum_component_ref="")

        self.repoint([entry])

        self.assertEqual(entry.curriculum_component_ref, "")
        self.assertEqual(entry.curriculum_component_fk, "C-B")

    def test_the_key_never_keeps_the_previous_component(self):
        entry = _entry(curriculum_component_ref="C-A", curriculum_component_fk="C-A")

        self.repoint([entry], found=False)

        self.assertIsNone(entry.curriculum_component_fk)
        self.assertEqual(entry.legacy_component_ref, "C-A")

    def test_a_previous_shift_lineage_is_not_overwritten(self):
        entry = _entry(component_ref="C-A", legacy_component_ref="C-ORIGINAL")

        self.repoint([entry])

        self.assertEqual(entry.legacy_component_ref, "C-ORIGINAL")


class LmsReconciliationKeyTests(SimpleTestCase):
    def apply(self, curriculum_ref):
        statements = []

        class Cursor:
            def execute(self, sql, params=()):
                statements.append((sql, list(params)))

            def fetchone(self):
                sql = statements[-1][0]
                if "coalesce(max(entry_order),0)" in sql:
                    return (3,)
                return (100,)

        action = {
            "action": "create_progress", "learner_id": 7, "canonical_activity_key": "lms:7:a1",
            "activity_type": "reading", "candidate_kind": "activity", "source_activity_id": "activity:a1",
            "source_activity_title": "Synthetic", "source_course_title": "Course", "curriculum_module_ref": "MOD-1",
            "activity_status": "Completed", "source_course_ref": "g1", "source_learner_ids": ["s1"],
            "completion_signals": [], "source_catalog_activity_id": 9, "curriculum_component_ref": curriculum_ref,
        }
        existing = {"missing_memberships": [], "activity_actions": [action]}
        with patch.object(lms_alias_reconciliation, "verify_apply_branch", return_value="br-synthetic"), \
                patch.object(lms_alias_reconciliation, "inspect",
                             return_value=({"eligible": {}}, existing, {"identity_conflicts": 0})), \
                patch("learner_api.progress_cache.bump_learners"):
            result = lms_alias_reconciliation.apply(Cursor(), "br-synthetic")
        inserts = [(sql, params) for sql, params in statements
                   if 'INSERT INTO "Learner".learner_progress_entries' in sql]
        return result, inserts

    def test_mapped_and_unmatched_lineage_both_keep_their_text_and_key_only_by_lookup(self):
        for curriculum_ref in ("C-CURRENT", "C-HISTORICAL-GONE", None):
            with self.subTest(curriculum_ref=curriculum_ref):
                result, inserts = self.apply(curriculum_ref)

                self.assertEqual(result["progress_rows_created"], 1)
                self.assertEqual(len(inserts), 1)
                sql, params = inserts[0]
                self.assertIn("curriculum_component_ref,\n                curriculum_component_fk", sql)
                # The key is never the raw lineage: it is whatever the current
                # catalogue returns for it, so an unmatched ref stores NULL.
                self.assertIn("(SELECT id FROM curriculum.components WHERE id=nullif(%s::text,''))", sql)
                self.assertEqual(params[-2:], [curriculum_ref, curriculum_ref])
                self.assertEqual(sql.count("%s"), len(params))
