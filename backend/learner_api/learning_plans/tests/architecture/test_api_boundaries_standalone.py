"""Architecture and compatibility guards for the extracted HTTP adapters."""

import ast
import unittest
from pathlib import Path

CAPABILITY = Path(__file__).resolve().parents[2]
LEARNER_API = CAPABILITY.parent


def tree(relative):
    return ast.parse((CAPABILITY / relative).read_text(encoding="utf-8-sig"))


def function(path, name):
    module = ast.parse(path.read_text(encoding="utf-8-sig"))
    return next(node for node in module.body if isinstance(node, ast.FunctionDef) and node.name == name)


class ApiBoundaryTests(unittest.TestCase):
    def test_api_imports_http_and_application_but_not_models_or_infrastructure(self):
        for relative in ("api/learning_plan.py", "api/module_membership.py"):
            imports = {
                node.module or ""
                for node in ast.walk(tree(relative))
                if isinstance(node, ast.ImportFrom)
            }
            self.assertFalse(any(".models" in name for name in imports), relative)
            self.assertFalse(any(".infrastructure" in name for name in imports), relative)
            self.assertTrue(any(".application" in name for name in imports), relative)

    def test_application_has_no_django_http_orm_sql_or_legacy_dependencies(self):
        for relative in (
            "application/read_plan.py",
            "application/update_plan.py",
            "application/module_assignment.py",
            "application/effective_plan.py",
            "application/hydration.py",
        ):
            source = (CAPABILITY / relative).read_text(encoding="utf-8-sig")
            imports = {
                node.module or ""
                for node in ast.walk(ast.parse(source))
                if isinstance(node, ast.ImportFrom)
            }
            self.assertFalse(any(name.startswith("django") for name in imports), relative)
            self.assertNotIn("learner_api.learning_plan", imports, relative)
            self.assertNotIn(".objects", source, relative)
            self.assertNotIn("cursor(", source, relative)

    def test_normalized_hydration_is_owned_by_the_capability(self):
        root = ast.parse((LEARNER_API / "learning_plan.py").read_text(encoding="utf-8-sig"))
        root_definitions = {
            node.name for node in root.body if isinstance(node, ast.FunctionDef)
        }
        self.assertNotIn("install_canonical_training_plan", root_definitions)
        self.assertNotIn("install_canonical_training_plan_modules", root_definitions)

        application = (CAPABILITY / "application" / "hydration.py").read_text(encoding="utf-8-sig")
        infrastructure = (CAPABILITY / "infrastructure" / "plan_hydration.py").read_text(encoding="utf-8-sig")
        self.assertNotIn("django", application)
        self.assertNotIn("cursor(", application)
        self.assertIn("LearnerProfile.objects", infrastructure)
        self.assertIn("connections[using].cursor()", infrastructure)

    def test_legacy_serializer_delegates_membership_selection(self):
        node = function(LEARNER_API / "learning_plan.py", "_legacy_serialize")
        source = ast.unparse(node)
        self.assertIn("legacy_plan_membership", source)
        duplicated = [
            call for call in ast.walk(node)
            if isinstance(call, ast.Call)
            and isinstance(call.func, ast.Name)
            and call.func.id == "any"
            and "assignmentMode" in ast.unparse(call)
        ]
        self.assertEqual(duplicated, [])

    def test_root_handlers_are_thin_decorated_compatibility_entry_points(self):
        path = LEARNER_API / "learning_plan.py"
        expected = {
            "learning_plan": ["ensure_csrf_cookie", "csrf_exempt", "learner_self_or_staff"],
            "module_learners": ["csrf_exempt", "staff_only"],
        }
        for name, decorators in expected.items():
            node = function(path, name)
            rendered = [ast.unparse(value).split("(", 1)[0] for value in node.decorator_list]
            self.assertEqual(rendered, decorators)
            executable = [statement for statement in node.body if not (
                isinstance(statement, ast.Expr)
                and isinstance(statement.value, ast.Constant)
                and isinstance(statement.value.value, str)
            )]
            self.assertEqual(len(executable), 1, name)
            self.assertIsInstance(executable[0], ast.Return, name)

    def test_canonical_endpoint_remains_unregistered(self):
        source = (LEARNER_API / "urls.py").read_text(encoding="utf-8-sig")
        self.assertNotIn("canonical_learning_plan", source)

    def test_composition_wires_from_the_live_compatibility_namespace(self):
        node = function(CAPABILITY / "composition.py", "legacy_http_dependencies")
        source = ast.unparse(node)
        for name in (
            "compatibility.EnrolmentUser",
            "compatibility._all_modules",
            "compatibility._plan_entries",
            "compatibility._picker_learners",
            "compatibility._effective_plan_ids",
            "compatibility.sync_learning_plan_mirror",
            "compatibility.advance_learner",
        ):
            self.assertIn(name, source)

    def test_root_effective_projection_is_a_live_compatibility_wrapper(self):
        node = function(LEARNER_API / "learning_plan.py", "effective_training_plan")
        executable = [statement for statement in node.body if not (
            isinstance(statement, ast.Expr)
            and isinstance(statement.value, ast.Constant)
            and isinstance(statement.value.value, str)
        )]
        self.assertEqual(len(executable), 1)
        self.assertIsInstance(executable[0], ast.Return)
        rendered = ast.unparse(executable[0])
        self.assertIn("legacy_effective_plan_projection", rendered)
        self.assertIn("sys.modules[__name__]", rendered)


if __name__ == "__main__":
    unittest.main()
