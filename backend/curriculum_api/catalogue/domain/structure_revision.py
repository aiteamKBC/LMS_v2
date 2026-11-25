"""Deterministic revision material for the stored authoring structure.

Ignore rewrite timestamps and derived display fields; retain every stored value.
This policy has no storage access and never changes the caller's rows.
"""
import hashlib
import json


def revision_rows(rows, stored, volatile_columns, sort_column, clean_str):
    rows = [
        {key: value for key, value in row.items()
         if key not in volatile_columns and (not stored or key in stored)}
        for row in rows
    ]
    return sorted(rows, key=lambda row: clean_str(row.get(sort_column)))


def revision_digest(material):
    return hashlib.sha256(
        json.dumps(material, sort_keys=True, default=str).encode()
    ).hexdigest()[:32]
