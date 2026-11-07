"""Author settings that decide how an assignment is presented to learners.

``learnerTitle`` is the name the programme team uses with learners; the
curriculum title often still carries the imported legacy LMS name.

``isMonthlyAssignment`` is retained in legacy payloads for compatibility.
Every assignment now appears in Monthly submission and uses its eight-step
submission, regardless of this flag.
"""
import json


def _settings(value):
    if isinstance(value, str):
        try:
            value = json.loads(value) if value.strip() else {}
        except (TypeError, ValueError):
            return {}
    return value if isinstance(value, dict) else {}


def learner_title(settings):
    """The title shown to learners, or '' when the curriculum title applies."""
    return " ".join(str(_settings(settings).get("learnerTitle") or "").split())


def flagged_monthly(settings):
    # Preserve the legacy payload flag: JSON true (or the string "true"), nothing else.
    value = _settings(settings).get("isMonthlyAssignment")
    return value is True or value == "true"
