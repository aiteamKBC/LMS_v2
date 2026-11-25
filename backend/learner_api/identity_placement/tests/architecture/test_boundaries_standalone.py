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
        for path in ("domain/identifiers.py", "domain/placement.py"):
            joined = "\n".join(imports(path))
            self.assertNotIn("django", joined)
            self.assertNotIn("models", joined)
            self.assertNotIn("infrastructure", joined)

    def test_application_depends_only_on_domain(self):
        for path in ("application/resolve_identity.py", "application/read_placement.py"):
            joined = "\n".join(imports(path))
            self.assertNotIn("django", joined)
            self.assertNotIn("learner_api.models", joined)
            self.assertNotIn("infrastructure", joined)

    def test_public_facade_is_lazy_and_explicit(self):
        joined = "\n".join(module_imports("public.py"))
        self.assertNotIn("composition", joined)
        self.assertNotIn("django", joined)
        self.assertNotIn("learner_api.models", joined)

    def test_legacy_modules_do_not_reimplement_read_contracts(self):
        backend = ROOT.parents[1]
        identity = ast.parse((backend / "learner_api/identity.py").read_text(encoding="utf-8"))
        placement = ast.parse((backend / "learner_api/placement_links.py").read_text(encoding="utf-8"))
        free = ast.parse((backend / "learner_api/free_course_selectors.py").read_text(encoding="utf-8"))
        self.assertFalse(any(isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) for node in identity.body))
        placement_names = {node.name for node in placement.body if isinstance(node, ast.FunctionDef)}
        self.assertEqual(placement_names, {"validate_placement", "placement_input"})
        free_names = {node.name for node in free.body if isinstance(node, ast.FunctionDef)}
        self.assertEqual(free_names, {"assigned_course_ids", "assignment_version"})

    def test_production_consumers_use_only_the_public_read_owner(self):
        backend = ROOT.parents[1]
        legacy_reads = {
            "identity": {"learner_profile_for_source"},
            "placement_links": {"placement_profile", "with_placements", "placement_ids", "placement_payload"},
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
