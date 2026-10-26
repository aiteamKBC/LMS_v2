"""Quality form selection only; never changes a Microsoft meeting or booking."""
import re
from .quality_review_template import InvalidReview

REVIEW_TYPES = ('MCM', 'PR')
PR_TITLE = r'\bprogress[\s_-]+review\b|\b(?:pr|br)\b'
MCM_TITLE = r'\bmonthly[\s_-]+coaching[\s_-]+(?:meeting|review)\b|\b(?:mcm|mcr)\b'


def review_type(value, *, allow_empty=True):
    if value == '' and allow_empty:
        return ''
    if not isinstance(value, str) or value not in REVIEW_TYPES:
        raise InvalidReview('Choose MCM or PR (Progress Review).')
    return value


def suggest_type(title):
    text = str(title or '')
    # Progress review is specific even when a title also mentions monthly coaching.
    if re.search(PR_TITLE, text, re.I):
        return 'PR'
    if re.search(MCM_TITLE, text, re.I):
        return 'MCM'
    return ''


def saved_type(saved):
    return saved.get('reviewType') or suggest_type(saved.get('meeting', {}).get('title'))


def type_sql(alias=''):
    """Same title suggestion for legacy rows; parameters never become SQL text."""
    payload = f'{alias}.payload' if alias else 'payload'
    pr_pattern = PR_TITLE.replace(r'\b', r'\y')
    mcm_pattern = MCM_TITLE.replace(r'\b', r'\y')
    return f"""COALESCE(NULLIF({payload}->>'reviewType',''), CASE
      WHEN {payload}->'meeting'->>'title' ~* '{pr_pattern}' THEN 'PR'
      WHEN {payload}->'meeting'->>'title' ~* '{mcm_pattern}' THEN 'MCM'
      ELSE '' END)"""
