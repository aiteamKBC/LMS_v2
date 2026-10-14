from contextlib import nullcontext
from copy import deepcopy
from decimal import Decimal
import io
import json
import sqlite3
from types import SimpleNamespace
from unittest.mock import Mock, patch

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import SimpleTestCase

from . import quiz_grade_corrections as repair


def attempt():
    answers, questions = [], {}
    for i in range(1, 20):
        correct = i <= 14
        answers.append({"id": i, "progress_id": 1, "position": i, "question_ref": i,
                        "is_correct": correct, "earned": Decimal(int(correct)),
                        "chosen_answer_ref": 101 if i == 15 else None,
                        "result_snapshot": None, "question_image_url": None})
        questions[str(i)] = {"id": i, "quiz_id": 7, "points": 1, "question_type": "single_choice"}
    return {"progress": {"id": 1, "learner_id": 999, "kind": "quiz", "quiz_ref": "7", "attempt": 1,
                         "grade": Decimal("0.7400"), "achieved_score": Decimal(14), "total_score": Decimal(19),
                         "passed": True, "feed_detail": "Scored 73.7% · 14/19", "verified_seconds": 123,
                         "submitted_at": "2026-10-01T10:00:00Z", "feedback": "Private synthetic reflection"},
            "answers": answers, "questions": questions, "chosen": {},
            "correct": {"15": [{"quiz_answer_id": 15, "position": 0, "answer_ref": 102}]},
            "options": {"101": {"id": 101, "question_id": 15, "answer_text": "TikTok"},
                        "102": {"id": 102, "question_id": 15, "answer_text": "TikTok"}}}


class QuizGradeCorrectionPlanTests(SimpleTestCase):
    def test_confirmed_duplicate_repairs_original_denominator_and_preserves_history(self):
        state = attempt()
        original = deepcopy(state)
        result, reason = repair.plan_attempt(state, 15)
        self.assertIsNone(reason)
        self.assertEqual(state, original)
        after = result["after"]
        self.assertEqual(after["progress"]["achieved_score"], 15)
        self.assertEqual(after["progress"]["total_score"], 19)
        self.assertEqual(after["progress"]["grade"], Decimal("0.79"))
        self.assertEqual(after["progress"]["feed_detail"], "Scored 78.9% · 15/19")
        for key in state["progress"]:
            if key not in {"achieved_score", "grade", "feed_detail"}:
                self.assertEqual(after["progress"][key], state["progress"][key])
        self.assertTrue(after["answers"][14]["is_correct"])
        self.assertEqual(after["answers"][14]["earned"], 1)
        self.assertEqual(after["answers"][:14], state["answers"][:14])
        self.assertEqual(after["answers"][15:], state["answers"][15:])
        self.assertEqual(after["correct"], state["correct"])

    def test_normalized_label_and_true_false_are_supported(self):
        state = attempt()
        state["options"]["101"]["answer_text"] = "  TIKTOK\n"
        state["questions"]["15"]["question_type"] = "true_false"
        self.assertIsNotNone(repair.plan_attempt(state, 15)[0])

    def test_content_key_difference_is_not_guessed(self):
        state = attempt()
        state["options"]["102"]["answer_text"] = "YouTube"
        self.assertIsNone(repair.plan_attempt(state, 15)[0])

    def test_missing_foreign_or_conflicting_correct_references_are_deferred(self):
        for change in ("missing", "foreign", "extra_key", "extra_selection"):
            with self.subTest(change=change):
                state = attempt()
                if change == "missing":
                    del state["options"]["102"]
                elif change == "foreign":
                    state["options"]["102"]["question_id"] = 99
                elif change == "extra_key":
                    state["options"]["103"] = {"id": 103, "question_id": 15, "answer_text": "YouTube"}
                    state["correct"]["15"].append({"answer_ref": 103})
                else:
                    state["chosen"]["15"] = [{"answer_ref": 101}, {"answer_ref": 103}]
                result, reason = repair.plan_attempt(state, 15)
                self.assertIsNone(result)
                self.assertIsNotNone(reason)

    def test_uncertain_attempts_require_review(self):
        mutations = [
            lambda s: s["progress"].update(total_score=20),
            lambda s: s["progress"].update(grade=Decimal("0.70")),
            lambda s: s["progress"].update(achieved_score=13),
            lambda s: s["progress"].update(passed=False),
            lambda s: s["progress"].update(passed=None),
            lambda s: s["progress"].update(feed_detail="Custom summary"),
            lambda s: s["questions"]["1"].update(points=2),
            lambda s: s["questions"]["1"].update(quiz_id=8),
            lambda s: s["questions"].pop("1"),
            lambda s: s["answers"][0].update(earned=Decimal("0.5")),
            lambda s: s["answers"][0].update(is_correct=None),
            lambda s: s["answers"][0].update(position=2),
            lambda s: s["answers"][0].update(result_snapshot={"possible": 1}),
        ]
        for index, mutate in enumerate(mutations):
            with self.subTest(index=index):
                state = attempt()
                mutate(state)
                result, reason = repair.plan_attempt(state, 15)
                self.assertIsNone(result)
                self.assertIsNotNone(reason)

    def test_changed_evidence_changes_preview_digest(self):
        original = attempt()
        first = repair.build_plan([original], 7, 15)["digest"]
        for mutate in (
            lambda s: s["progress"].update(verified_seconds=124),
            lambda s: s["options"]["101"].update(answer_text="Other"),
            lambda s: s["answers"][14].update(chosen_answer_ref=102),
        ):
            changed = deepcopy(original)
            mutate(changed)
            self.assertNotEqual(first, repair.build_plan([changed], 7, 15)["digest"])

    def test_report_contains_no_private_attempt_data(self):
        report = repair.public_plan(repair.build_plan([attempt()], 7, 15))
        text = json.dumps(report)
        for private in ("999", "learner_id", "feedback", "Private synthetic", "TikTok", "submitted_at"):
            self.assertNotIn(private, text)
        self.assertEqual(report["eligible"], 1)

    def test_stale_preview_does_not_call_apply(self):
        cursor = Mock()
        connection = SimpleNamespace(vendor="postgresql", cursor=lambda: nullcontext(cursor))
        with patch.object(repair, "connections", {"enrolment": connection}), \
                patch.object(repair.transaction, "atomic", return_value=nullcontext()), \
                patch.object(repair, "load_states", return_value=[attempt()]), \
                patch.object(repair, "apply_plan") as apply:
            with self.assertRaisesRegex(ValueError, "Preview is stale"):
                repair.run_correction(7, 15, expected_digest="old")
            apply.assert_not_called()

    def test_command_is_read_only_by_default(self):
        with patch("learner_api.management.commands.correct_duplicate_quiz_grades.run_correction", return_value={}) as run:
            call_command("correct_duplicate_quiz_grades", quiz=7, question=15, stdout=io.StringIO())
            run.assert_called_once_with(7, 15, expected_digest=None)

    def test_apply_requires_preview_and_matching_target(self):
        with patch("learner_api.management.commands.correct_duplicate_quiz_grades.run_correction") as run:
            for kwargs in ({"apply": True}, {"apply": True, "expected_plan": "digest",
                            "expect_host": "unverified", "expect_database": "unverified"}):
                with self.assertRaises(CommandError):
                    call_command("correct_duplicate_quiz_grades", quiz=7, question=15, **kwargs)
            run.assert_not_called()


class SQLiteCursor:
    """Exercise real repair SQL against synthetic in-memory attached schemas."""
    def __init__(self, connection):
        self.cursor = connection.cursor()

    def execute(self, query, params=()):
        converted = [str(v) if isinstance(v, Decimal) else v.isoformat() if hasattr(v, "isoformat") else v for v in params]
        return self.cursor.execute(query.replace("%s", "?"), converted)

    def __getattr__(self, name):
        return getattr(self.cursor, name)


class QuizGradeCorrectionSQLTests(SimpleTestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.executescript('''
            ATTACH DATABASE ':memory:' AS Learner;
            ATTACH DATABASE ':memory:' AS curriculum;
            CREATE TABLE Learner.learner_progress_entries (
                id INTEGER PRIMARY KEY, learner_id INTEGER, kind TEXT, quiz_ref TEXT, attempt INTEGER,
                grade NUMERIC, achieved_score NUMERIC, total_score NUMERIC, passed BOOLEAN,
                feed_detail TEXT, verified_seconds INTEGER, submitted_at TEXT, feedback TEXT);
            CREATE TABLE Learner.learner_quiz_answers (
                id INTEGER PRIMARY KEY, progress_id INTEGER, position INTEGER, question_ref INTEGER,
                is_correct BOOLEAN, earned NUMERIC, chosen_answer_ref INTEGER, result_snapshot TEXT, question_image_url TEXT);
            CREATE TABLE Learner.learner_quiz_correct_answers (quiz_answer_id INTEGER, position INTEGER, answer_ref INTEGER);
            CREATE TABLE Learner.learner_quiz_chosen_answers (quiz_answer_id INTEGER, position INTEGER, answer_ref INTEGER);
            CREATE TABLE curriculum.quiz_questions (id INTEGER PRIMARY KEY, quiz_id INTEGER, points NUMERIC, question_type TEXT);
            CREATE TABLE curriculum.quiz_answers (id INTEGER PRIMARY KEY, question_id INTEGER, answer_text TEXT);
            CREATE TABLE Learner.learner_quiz_grade_corrections (
                progress_id INTEGER, correction_key TEXT, plan_digest TEXT, reason TEXT,
                before_state TEXT, after_state TEXT, created_at TEXT, UNIQUE(progress_id, correction_key));
        ''')
        self.cursor = SQLiteCursor(self.db)
        state = attempt()
        self.insert("Learner.learner_progress_entries", state["progress"])
        for a in state["answers"]:
            self.insert("Learner.learner_quiz_answers", a)
        for q in state["questions"].values():
            self.insert("curriculum.quiz_questions", q)
        for o in state["options"].values():
            self.insert("curriculum.quiz_answers", o)
        for c in state["correct"]["15"]:
            self.insert("Learner.learner_quiz_correct_answers", c)
        self.insert("Learner.learner_progress_entries", {**state["progress"], "id": 2, "learner_id": 998, "quiz_ref": "8"})
        self.db.commit()

    def insert(self, table, row):
        columns = ",".join(row)
        placeholders = ",".join(["%s"] * len(row))
        self.cursor.execute(f"INSERT INTO {table} ({columns}) VALUES ({placeholders})", list(row.values()))

    def plan(self):
        return repair.build_plan(repair.load_states(self.cursor, 7, 15), 7, 15)

    def test_apply_updates_review_and_activity_and_retains_before_after_ledger(self):
        plan = self.plan()
        before = self.db.execute("SELECT * FROM Learner.learner_progress_entries WHERE id=2").fetchone()
        refresh = Mock()
        with self.db:
            repair.apply_plan(self.cursor, plan, 15, refresh=refresh)
        self.assertEqual(self.db.execute("SELECT achieved_score,total_score,grade,attempt,verified_seconds,passed,feed_detail FROM Learner.learner_progress_entries WHERE id=1").fetchone(),
                         (15, 19, 0.79, 1, 123, 1, "Scored 78.9% · 15/19"))
        self.assertEqual(self.db.execute("SELECT is_correct,earned,chosen_answer_ref FROM Learner.learner_quiz_answers WHERE id=15").fetchone(), (1, 1, 101))
        self.assertEqual(self.db.execute("SELECT * FROM Learner.learner_progress_entries WHERE id=2").fetchone(), before)
        old, new = self.db.execute("SELECT before_state,after_state FROM Learner.learner_quiz_grade_corrections").fetchone()
        self.assertEqual(json.loads(old)["progress"]["achieved_score"], 14)
        self.assertEqual(json.loads(new)["progress"]["achieved_score"], "15")
        refresh.assert_called_once_with(999)
        self.assertEqual(self.plan()["patches"], [])
        with self.assertRaises(sqlite3.IntegrityError), self.db:
            repair.apply_plan(self.cursor, plan, 15, refresh=refresh)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM Learner.learner_quiz_grade_corrections").fetchone()[0], 1)

    def test_audit_failure_prevents_any_grade_write(self):
        plan = self.plan()
        self.db.execute("CREATE TRIGGER Learner.reject_audit BEFORE INSERT ON learner_quiz_grade_corrections BEGIN SELECT RAISE(ABORT, 'audit unavailable'); END;")
        with self.assertRaises(sqlite3.IntegrityError), self.db:
            repair.apply_plan(self.cursor, plan, 15, refresh=Mock())
        self.assertEqual(self.db.execute("SELECT achieved_score FROM Learner.learner_progress_entries WHERE id=1").fetchone()[0], 14)
        self.assertEqual(self.db.execute("SELECT is_correct FROM Learner.learner_quiz_answers WHERE id=15").fetchone()[0], 0)

    def test_refresh_failure_rolls_back_scores_and_ledger(self):
        with self.assertRaisesRegex(ValueError, "refresh unavailable"), self.db:
            repair.apply_plan(self.cursor, self.plan(), 15, refresh=Mock(side_effect=ValueError("refresh unavailable")))
        self.assertEqual(self.db.execute("SELECT achieved_score FROM Learner.learner_progress_entries WHERE id=1").fetchone()[0], 14)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM Learner.learner_quiz_grade_corrections").fetchone()[0], 0)

    def test_second_case_failure_rolls_back_the_whole_batch(self):
        plan = self.plan()
        # Repeating the same case simulates a later unique-ledger conflict:
        # the successful first correction must not survive the failed batch.
        plan["patches"].append(deepcopy(plan["patches"][0]))
        with self.assertRaises(sqlite3.IntegrityError), self.db:
            repair.apply_plan(self.cursor, plan, 15, refresh=Mock())
        self.assertEqual(self.db.execute("SELECT achieved_score FROM Learner.learner_progress_entries WHERE id=1").fetchone()[0], 14)
        self.assertEqual(self.db.execute("SELECT is_correct FROM Learner.learner_quiz_answers WHERE id=15").fetchone()[0], 0)
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM Learner.learner_quiz_grade_corrections").fetchone()[0], 0)

    def test_unexpected_trigger_side_effect_aborts_correction(self):
        self.db.execute('''CREATE TRIGGER Learner.change_time AFTER UPDATE ON learner_progress_entries
            BEGIN UPDATE learner_progress_entries SET verified_seconds=0 WHERE id=NEW.id; END;''')
        with self.assertRaisesRegex(ValueError, "verification failed"), self.db:
            repair.apply_plan(self.cursor, self.plan(), 15, refresh=Mock())
        self.assertEqual(self.db.execute("SELECT achieved_score,verified_seconds FROM Learner.learner_progress_entries WHERE id=1").fetchone(), (14, 123))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM Learner.learner_quiz_grade_corrections").fetchone()[0], 0)
