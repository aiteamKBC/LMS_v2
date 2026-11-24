"""Read-only canonical Free Course verification after historical cleanup.

Original cleanup snapshots remain in private recovery exports. This command no
longer plans cleanup or queries retired identity tables; use the manifest and
baseline options of verify_free_course_identity.py for historical row parity.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from scripts.verify_free_course_identity import verify as verify_canonical
from scripts.verify_inclusion_canonical_targets import connect_development


def verify(connection, phase='after'):
    return verify_canonical(connection)


if __name__ == '__main__':
    with connect_development() as connection:
        print(json.dumps(verify(connection), sort_keys=True))
