"""Existing status labels and legacy plan-value parsing; no I/O.

The canonical roster does not use the legacy JSON parser.
"""
import json


def status_key(value):
    return ' '.join(str(value or 'unknown').strip().lower().replace('_', ' ').replace('-', ' ').split()) or 'unknown'


def plan_membership(value, wanted):
    if isinstance(value, str):
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            value = []
    entries = [entry for entry in value if isinstance(entry, dict)] if isinstance(value, list) else []
    return (any(entry.get('assignmentMode') == 'explicit' for entry in entries),
            {str(entry.get('moduleId')) for entry in entries if str(entry.get('moduleId')) in wanted})
