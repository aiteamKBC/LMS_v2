"""Real Django startup + CLI, with synthetic fixtures and process-wide I/O traps."""
import json
from pathlib import Path
import subprocess
import sys

from django.test import SimpleTestCase


class ReconciliationCommandProcessTests(SimpleTestCase):
    def test_startup_and_command_are_read_only_with_old_new_and_applied_schema(self):
        probe = Path(__file__).with_name("tests_support") / "reconciliation_command_probe.py"
        for mode in ("old", "new", "mapped", "default", "detectors"):
            with self.subTest(mode=mode):
                result = subprocess.run([sys.executable, "-B", str(probe), mode],
                                        capture_output=True, text=True, timeout=45)
                self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
                payload = json.loads(next(line.removeprefix("PROBE_RESULT=") for line in result.stdout.splitlines()
                                          if line.startswith("PROBE_RESULT=")))
                self.assertEqual(payload["mode"], mode)
                if mode == "old":
                    self.assertIn("RECONCILIATION_SCHEMA_NOT_DEPLOYED", result.stderr)
                elif mode == "new" or mode == "default":
                    self.assertIn('"status": "PREVIEW"', result.stdout)
                elif mode == "mapped":
                    self.assertIn('"status": "APPLIED"', result.stdout)
