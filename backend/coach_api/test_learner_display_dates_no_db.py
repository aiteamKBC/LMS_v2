"""Synthetic display-contract regressions; no Django setup, database or network."""
import ast
from pathlib import Path
from types import SimpleNamespace
import unittest


ROOT = Path(__file__).resolve().parents[1]


def function(path, name, namespace):
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    node = next(node for node in tree.body if isinstance(node, ast.FunctionDef) and node.name == name)
    exec(compile(ast.Module(body=[node], type_ignores=[]), str(path), "exec"), namespace)
    return namespace[name]


class LearnerDisplayDatesTests(unittest.TestCase):
    def test_shell_preserves_calculation_window_and_adds_recorded_dates(self):
        serialize = function(ROOT / "coach_api/serializers/learner_profile.py",
                             "serialize_learner_profile_shell", {})
        for kind in ("commercial", "apprenticeship"):
            for end in ("2027-02-15", None, ""):
                with self.subTest(kind=kind, end=end):
                    source = SimpleNamespace(learner_type=kind, learner_start_date="2025-10-16",
                                             learner_end_date=end, end_date="2027-02-14")
                    profile = SimpleNamespace(id=1, enrolment_id=2, end_date="2027-02-14")
                    payload = serialize(profile, source, canonical_start_date="2025-10-16",
                                        clean_text=lambda value: str(value or "").strip(),
                                        format_date=lambda value: value,
                                        student_activity_available=lambda value: False,
                                        format_coach_rag_value=lambda value: value)
                    self.assertEqual(payload["profile"]["learnerEndDate"], end or None)
                    self.assertEqual(payload["profile"]["plannedEndDate"], "2027-02-14")
                    self.assertEqual(payload["profile"]["startDate"], "2025-10-16")
                    self.assertEqual(source.end_date, "2027-02-14")

    def test_live_review_information_uses_recorded_dates_only(self):
        information = function(ROOT / "learner_api/review_form.py", "_learner_information",
                               {"_s": lambda value: str(value or "")})
        for end in ("2027-02-15", None, ""):
            learner = SimpleNamespace(learner_start_date="2025-10-16", learner_end_date=end,
                                      start_date="2025-10-01", end_date="2027-02-14")
            payload = information(learner)
            self.assertEqual(payload["programmeStartDate"], "2025-10-16")
            self.assertEqual(payload["plannedEndDate"], end or "--")
            self.assertEqual(learner.end_date, "2027-02-14")


if __name__ == "__main__":
    unittest.main()
