"""Read-only inventory/dry-run for Keith Customer Journey rosters."""
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import reconcile_femi_commercial_intelligence_dryrun as base  # noqa: E402


base.TARGET_GROUPS = {
    "G1-Keith Customer Journey Optimisation": {
        "group_id": "GROUP-20260928143455519285CEBAAAED556C",
        "module_id": "MOD-20260911124647037289",
        "coach": "Omar Badr",
        "names": [
            "Abigail Hindle", "Adam Anson", "Amber Coakes", "Donna Sharpe",
            "Emma Taylor", "Hasan Syed Mohammed Salam", "Marco Badchkam",
            "Miranda Hartley", "Natalie Parrish", "Paul Brooks", "Sanjit Kaur",
            "Shelley Hart", "Sophie Lee",
        ],
    },
    "G2-Keith Customer Journey Optimisation": {
        "group_id": "GROUP-20260930135400889703823E0C35DCAE",
        "module_id": "MOD-202609301354380952694569FE544702",
        "coach": "Omar Badr",
        "names": [
            "Annie Mannion", "Brooke Elmer", "Christian Beckett",
            "Francesca Sinclair Reid", "Hannah Chantler", "Isabella Francis",
            "Kimberley Gurney", "Kimberley Hatch", "Lucy Beirne",
            "Matthew ODonohoe", "Natalie Rogers", "Rebecca Badby",
            "Steven Howell", "Tom Lowes",
        ],
    },
}


if __name__ == "__main__":
    raise SystemExit(base.main())
