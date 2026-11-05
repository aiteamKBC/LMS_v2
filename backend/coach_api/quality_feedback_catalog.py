"""Default UI definitions from the fourteen supplied observation forms."""
from copy import deepcopy
from functools import lru_cache
import json
from pathlib import Path


@lru_cache(maxsize=1)
def defaults():
    return json.loads(Path(__file__).with_name('quality_feedback_defaults.json').read_text(encoding='utf8'))


def default_feedback(kind):
    return next((deepcopy(row) for row in defaults() if row['reviewType'] == kind), None)


def new_definition(kind, title):
    from .quality_review_template import DESCRIPTORS
    return {'id': 'feedback-' + kind.lower(), 'reviewType': kind, 'title': title,
        'version': 1, 'ratings': deepcopy(DESCRIPTORS), 'actionsTitle': 'Action Plan',
        'sections': [{'id': 'observation', 'title': 'Observation judgement and feedback',
            'screenshots': True, 'criteria': [{'id': 'criterion-1', 'text': 'Observation',
                'type': 'rating', 'required': True}]}]}


def feedback_definition(kind):
    row = default_feedback(kind)
    if row is None:
        return None
    return {**new_definition(kind, row['title']), 'sections': row['sections']}


def default_summaries():
    return [{'reviewType': row['reviewType'], 'title': row['title'], 'group': row['group'],
        'published': True, 'revision': 0, 'legacy': False} for row in defaults()]
