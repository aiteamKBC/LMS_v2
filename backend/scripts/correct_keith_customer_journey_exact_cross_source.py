"""Soft-correct exact Aptem/Journal overlaps for Keith Customer Journey.

Only exact Evidence lineage with equal duration is eligible.  Ambiguous and
duration-conflict rows are reported and left untouched.
"""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import correct_sharon_exact_cross_source as base  # noqa: E402


base.RUN_KIND = "keith-customer-journey-exact-cross-source-correction-v1"
base.ROSTER = {
    15791, 10624, 14880, 15751, 15951, 16749, 15433, 15073,
    15489, 16549, 15588, 17753, 16474,
    17705, 19694, 18616, 6409, 18716, 17825, 16476, 17930,
    17952, 16482, 17417, 18705, 16477, 17254,
}
base.GROUPS = {
    "G1-Keith Customer Journey Optimisation": {
        15791, 10624, 14880, 15751, 15951, 16749, 15433, 15073,
        15489, 16549, 15588, 17753, 16474,
    },
    "G2-Keith Customer Journey Optimisation": {
        17705, 19694, 18616, 6409, 18716, 17825, 16476, 17930,
        17952, 16482, 17417, 18705, 16477, 17254,
    },
}


if __name__ == "__main__":
    base.main()
