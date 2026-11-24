"""Concrete catalogue domain operations; dependencies supplied by outer adapters."""

from curriculum_api.catalogue.domain.values import parse_int as _default_parse_int


def authoring_summary_score(summary, *, parse_int=_default_parse_int):
    return (
        parse_int(summary.get('ksbCount'), 0),
        parse_int(summary.get('qualityScore'), 0),
        parse_int(summary.get('lessonCount'), 0),
        parse_int(summary.get('weeks'), 0),
    )


def best_authoring_summary(candidates, *, authoring_summary_score=authoring_summary_score):
    candidates = [candidate for candidate in candidates if candidate]
    if not candidates:
        return None
    return max(candidates, key=authoring_summary_score)
