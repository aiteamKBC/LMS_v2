"""Static dependency checks for the domain-first learning-plan boundary."""

import ast
from collections import Counter
from pathlib import Path
import unittest

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
            for value in imports(path):
                if value.startswith((
                    "learner_api.learning_plans.application",
                    "learner_api.learning_plans.domain",
                    "learner_api.learning_plans.infrastructure",
                )) or value.startswith((
                    "learning_plans.application",
                    "learning_plans.domain",
                    "learning_plans.infrastructure",
                )):
                    violations.append((path.relative_to(BACKEND).as_posix(), value))
        self.assertEqual(violations, [])

    def test_existing_cross_domain_private_imports_are_frozen(self):
        expected = {
            ("curriculum_api/directory/infrastructure/membership_runtime.py", "learner_api.learning_plans.infrastructure.membership_facts"),
            ("curriculum_api/directory/infrastructure/membership_runtime.py", "learner_api.learning_plans.domain.membership_policy"),
            ("curriculum_api/directory/infrastructure/membership_runtime.py", "learner_api.learning_plans.application.module_membership"),
            ("curriculum_api/learner_assignment_counts_sql.py", "learner_api.learning_plans.infrastructure"),
            ("curriculum_api/module_plan_rows.py", "learner_api.learning_plans.infrastructure.plan_reads"),
        }
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

    def test_existing_legacy_view_imports_are_frozen(self):
        expected = Counter({
            ("coach_api/case_file.py", "learner_api.learning_plan", "effective_training_plan", None): 1,
            ("coach_api/learning_plan_projection.py", "learner_api.learning_plan", "_effective_plan_ids", None): 2,
            ("coach_api/monthly_focus.py", "learner_api.learning_plan", "_effective_plan_ids", None): 1,
            ("coach_api/views.py", "learner_api.learning_plan", "_effective_plan_ids", None): 1,
            ("coach_api/weekly_learning.py", "learner_api.learning_plan", "_effective_plan_ids", None): 1,
            ("curriculum_api/learner_assignments.py", "learner_api", "learning_plan", "plans"): 1,
            ("curriculum_api/module_plan_rows.py", "learner_api", "learning_plan", "plans"): 1,
            ("curriculum_api/qr_attendance.py", "learner_api.learning_plan", "_parse_day", None): 1,
        })
        found = Counter()
        for owner in ("curriculum_api", "coach_api"):
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


if __name__ == "__main__":
    unittest.main()
