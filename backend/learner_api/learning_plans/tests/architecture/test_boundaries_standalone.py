"""Static dependency checks for the domain-first learning-plan boundary."""

import ast
import unittest
from collections import Counter
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[4]
PACKAGE = BACKEND / "learner_api" / "learning_plans"


def imports(path):
    tree = ast.parse(path.read_text(encoding="utf-8-sig"))
    values = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            values.extend(alias.name for alias in node.names)
        elif isinstance(node, ast.ImportFrom):
            values.append(node.module or "")
    return values


def production_python(root):
    return [
        path for path in root.rglob("*.py")
        if "tests" not in path.parts and not path.name.startswith("test")
    ]


class DependencyBoundaryTests(unittest.TestCase):
    def test_domain_has_no_framework_or_project_dependencies(self):
        forbidden = ("django", "learner_api", "curriculum_api", "coach_api")
        for path in (PACKAGE / "domain").glob("*.py"):
            with self.subTest(path=path.name):
                self.assertFalse([
                    value for value in imports(path)
                    if value.startswith(forbidden)
                ])

    def test_application_does_not_depend_on_outer_layers(self):
        forbidden = (
            "django",
            "learner_api.learning_plans.api",
            "learner_api.learning_plans.composition",
            "learner_api.learning_plans.infrastructure",
            "learner_api.learning_plans.public",
        )
        for path in (PACKAGE / "application").glob("*.py"):
            with self.subTest(path=path.name):
                invalid = [
                    value for value in imports(path)
                    if value.startswith(forbidden)
                    or value == "learner_api.learning_plan"
                ]
                self.assertFalse(invalid)

    def test_learner_consumers_use_public_or_composition_boundary(self):
        violations = []
        learner_root = BACKEND / "learner_api"
        for path in production_python(learner_root):
            if PACKAGE in path.parents:
                continue
            if path == learner_root / "training_plan_writes.py":
                continue
            for value in imports(path):
                if value.startswith((
                    "learner_api.learning_plans.application",
                    "learner_api.learning_plans.domain",
                    "learner_api.learning_plans.infrastructure",
                    "learning_plans.application",
                    "learning_plans.domain",
                    "learning_plans.infrastructure",
                )):
                    violations.append((path.relative_to(BACKEND).as_posix(), value))
        self.assertEqual(violations, [])

    def test_root_writer_is_the_only_approved_infrastructure_compatibility_alias(self):
        path = BACKEND / "learner_api" / "training_plan_writes.py"
        tree = ast.parse(path.read_text(encoding="utf-8-sig"))
        definitions = [
            node.name
            for node in tree.body
            if isinstance(node, (ast.FunctionDef, ast.ClassDef))
        ]
        self.assertEqual(definitions, [])
        self.assertIn(
            "learning_plans.infrastructure",
            imports(path),
        )

    def test_exactly_one_normalized_writer_implementation_exists(self):
        definitions = []
        for path in production_python(BACKEND / "learner_api"):
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
            if any(
                isinstance(node, ast.FunctionDef)
                and node.name == "reconcile_training_plan"
                for node in tree.body
            ):
                definitions.append(path.relative_to(BACKEND).as_posix())
        self.assertEqual(definitions, [
            "learner_api/learning_plans/infrastructure/training_plan_writes.py"
        ])

    def test_existing_cross_domain_private_imports_are_frozen(self):
        expected = set()
        found = set()
        for owner in ("curriculum_api", "coach_api"):
            for path in production_python(BACKEND / owner):
                for value in imports(path):
                    if value.startswith((
                        "learner_api.learning_plans.application",
                        "learner_api.learning_plans.domain",
                        "learner_api.learning_plans.infrastructure",
                    )):
                        found.add((path.relative_to(BACKEND).as_posix(), value))
        self.assertEqual(found, expected)

    def test_existing_external_legacy_imports_are_frozen(self):
        expected = Counter({
            ("curriculum_api/qr_attendance.py", "learner_api.learning_plan", "_parse_day", None): 1,
            ("enrolment_api/wizard_bootstrap.py", "learner_api.learning_plan", "promote_learner_if_ready", None): 1,
        })
        found = Counter()
        for owner in ("curriculum_api", "coach_api", "engagement_api", "enrolment_api"):
            for path in production_python(BACKEND / owner):
                tree = ast.parse(path.read_text(encoding="utf-8-sig"))
                for node in ast.walk(tree):
                    if not isinstance(node, ast.ImportFrom):
                        continue
                    for alias in node.names:
                        if node.module == "learner_api.learning_plan" or (
                            node.module == "learner_api" and alias.name == "learning_plan"
                        ):
                            found[(
                                path.relative_to(BACKEND).as_posix(),
                                node.module,
                                alias.name,
                                alias.asname,
                            )] += 1
        self.assertEqual(found, expected)

    def test_remaining_learning_plan_consumers_use_public_boundary(self):
        expected = Counter({
            ("engagement_api/module_feedback.py", "effective_module_ids", None): 1,
            ("scripts/benchmark_week_switch.py", "effective_module_ids", None): 1,
        })
        found = Counter()
        for path in (
            BACKEND / "engagement_api" / "module_feedback.py",
            BACKEND / "scripts" / "benchmark_week_switch.py",
        ):
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom):
                    continue
                if node.module != "learner_api.learning_plans.public":
                    continue
                for alias in node.names:
                    found[(
                        path.relative_to(BACKEND).as_posix(),
                        alias.name,
                        alias.asname,
                    )] += 1
        self.assertEqual(found, expected)

    def test_coach_learning_plan_consumers_use_public_boundary(self):
        expected = Counter({
            ("coach_api/case_file.py", "effective_plan_projection", None): 1,
            ("coach_api/learning_plan_projection.py", "effective_module_ids", None): 2,
            ("coach_api/monthly_focus.py", "effective_module_ids", None): 1,
            ("coach_api/views.py", "effective_module_ids", None): 1,
            ("coach_api/weekly_learning.py", "effective_module_ids", None): 1,
        })
        found = Counter()
        for path in production_python(BACKEND / "coach_api"):
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom):
                    continue
                if node.module != "learner_api.learning_plans.public":
                    continue
                for alias in node.names:
                    found[(
                        path.relative_to(BACKEND).as_posix(),
                        alias.name,
                        alias.asname,
                    )] += 1
        self.assertEqual(found, expected)


if __name__ == "__main__":
    unittest.main()
