"""Static dependency boundaries for the Identity & Placement capability."""

import ast
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def imports(relative):
    tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"))
    return [ast.unparse(node) for node in ast.walk(tree) if isinstance(node, (ast.Import, ast.ImportFrom))]


def module_imports(relative):
    tree = ast.parse((ROOT / relative).read_text(encoding="utf-8"))
    return [ast.unparse(node) for node in tree.body if isinstance(node, (ast.Import, ast.ImportFrom))]


class BoundaryTests(unittest.TestCase):
    def test_domain_has_no_framework_or_persistence_dependency(self):
        for path in (
            "domain/identifiers.py",
            "domain/placement.py",
            "domain/placement_validation.py",
            "domain/resolution.py",
            "domain/ownership.py",
        ):
            joined = "\n".join(imports(path))
            self.assertNotIn("django", joined)
            self.assertNotIn("models", joined)
            self.assertNotIn("infrastructure", joined)

    def test_application_depends_only_on_domain(self):
        for path in (
            "application/resolve_identity.py",
            "application/read_placement.py",
            "application/validate_placement.py",
            "application/authorize_ownership.py",
        ):
            joined = "\n".join(imports(path))
            self.assertNotIn("django", joined)
            self.assertNotIn("learner_api.models", joined)
            self.assertNotIn("infrastructure", joined)

    def test_public_facade_is_lazy_and_explicit(self):
        joined = "\n".join(module_imports("public.py"))
        self.assertNotIn("composition", joined)
        self.assertNotIn("django", joined)
        self.assertNotIn("learner_api.models", joined)

    def test_obsolete_modules_are_deleted_and_free_course_keeps_only_its_rules(self):
        backend = ROOT.parents[1]
        self.assertFalse((backend / "learner_api/identity.py").exists())
        self.assertFalse((backend / "learner_api/placement_links.py").exists())
        free = ast.parse((backend / "learner_api/free_course_selectors.py").read_text(encoding="utf-8"))
        free_names = {node.name for node in free.body if isinstance(node, ast.FunctionDef)}
        self.assertEqual(free_names, {"assigned_course_ids", "assignment_version"})

    def test_login_no_longer_owns_learner_authorization_implementations(self):
        backend = ROOT.parents[1]
        tree = ast.parse((backend / "login/permissions.py").read_text(encoding="utf-8"))
        names = {node.name for node in tree.body if isinstance(node, ast.FunctionDef)}
        self.assertTrue({
            "staff_owns_learner",
            "coach_owns_learner",
            "learner_self_only",
            "learner_self_or_staff",
            "learner_self_or_admin",
        }.isdisjoint(names))

    def test_production_consumers_use_only_the_public_read_owner(self):
        backend = ROOT.parents[1]
        legacy_reads = {
            "identity": {"learner_profile_for_source"},
            "placement_links": {
                "placement_profile", "with_placements", "placement_ids",
                "placement_payload", "placement_input", "validate_placement",
            },
            "free_course_selectors": {"canonical_learner", "VALID_LEARNER_KINDS"},
        }
        violations = []
        internal_imports = []
        for path in backend.rglob("*.py"):
            relative = path.relative_to(backend)
            if (
                any(part in {".venv", "__pycache__", "migrations", "tests"} for part in path.parts)
                or path.name == "tests.py"
                or path.name.startswith("test_")
                or path.name.startswith("tests_")
            ):
                continue
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom):
                    continue
                module = node.module or ""
                names = {alias.name for alias in node.names}
                for owner, forbidden in legacy_reads.items():
                    if module.endswith(owner) and names & forbidden:
                        violations.append((str(relative), module, sorted(names & forbidden)))
                if (
                    "identity_placement" in module
                    and not module.endswith("identity_placement.public")
                    and "learner_api/identity_placement" not in relative.as_posix()
                ):
                    internal_imports.append((str(relative), module))
        self.assertEqual(violations, [])
        self.assertEqual(internal_imports, [])

    def test_executable_consumers_do_not_import_the_old_authorization_owner(self):
        backend = ROOT.parents[1]
        migrated = {
            "staff_owns_learner",
            "coach_owns_learner",
            "audit_admin_learner_action",
            "learner_self_only",
            "learner_self_or_staff",
            "learner_self_or_admin",
        }
        violations = []
        for path in backend.rglob("*.py"):
            if "migrations" in path.parts or "identity_placement" in path.parts:
                continue
            tree = ast.parse(path.read_text(encoding="utf-8-sig"))
            for node in ast.walk(tree):
                if isinstance(node, ast.ImportFrom) and node.module == "login.permissions":
                    names = migrated & {alias.name for alias in node.names}
                    if names:
                        violations.append((str(path.relative_to(backend)), sorted(names)))
        self.assertEqual(violations, [])

    def test_capability_dependency_graph_is_acyclic(self):
        modules = {
            path.relative_to(ROOT).with_suffix("").as_posix().replace("/", "."): path
            for path in ROOT.rglob("*.py")
            if "tests" not in path.parts and path.name != "__init__.py"
        }
        edges = {name: set() for name in modules}
        for name, path in modules.items():
            package = name.split(".")[:-1]
            for node in ast.walk(ast.parse(path.read_text(encoding="utf-8"))):
                if not isinstance(node, ast.ImportFrom) or not node.level:
                    continue
                prefix = package[:len(package) - node.level + 1]
                target = ".".join(prefix + ([node.module] if node.module else []))
                if target in modules:
                    edges[name].add(target)
        visiting, visited = set(), set()

        def visit(name):
            self.assertNotIn(name, visiting, f"cycle through {name}")
            if name in visited:
                return
            visiting.add(name)
            for target in edges[name]:
                visit(target)
            visiting.remove(name)
            visited.add(name)

        for name in edges:
            visit(name)


if __name__ == "__main__":
    unittest.main()
