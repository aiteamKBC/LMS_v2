"""Stable generated/manual identities and unambiguous booking reconciliation."""
from __future__ import annotations



def review_calendar_event_key(learner_id, template_id, occurrence_number):
    """An occurrence survives renames, reclassification and target-date edits."""
    return f'review:{learner_id}:{template_id}:{occurrence_number}'


def review_calendar_event_key_manual(learner_id, template_id, addition_id):
    """A learner-specific additional Review's event key -- identity-based and
    date-independent, like the generated form above, but keyed by the
    learner_review_additions row rather than a calendar-derived occurrence
    number (a manual addition has none -- see
    sql/2026-09-15_curriculum_learner_review_additions.sql). Never contains
    target_date, so rescheduling or editing the addition's own record never
    changes the row's identity."""
    return f'review:{learner_id}:{template_id}:manual:{addition_id}'


def reconcile_review_event_keys(events, records):
    """Keep existing booking keys, matching legacy keys only when unambiguous.

    Identity-tuple matching (by_identity) is scoped to events/records that
    carry a real occurrenceNumber -- i.e. GENERATED occurrences only. A
    manual (learner-specific addition) occurrence has no occurrence_number by
    design (occurrence_ref is its identity instead -- see
    curriculum.review_instances.occurrence_ref), so it is deliberately
    excluded from this dict rather than falling back to record.sequence:
    that fallback would collide a manual review with a generated occurrence
    that happens to carry the same sequence value for the same
    learner+template. A manual occurrence is still matched correctly below,
    via its own stable, unique event_key (by_key) -- it never needs the
    identity-tuple path at all.
    """
    by_identity = {}
    by_key = {record.event_key: record for record in records}
    legacy_candidates = {}
    for event in events:
        legacy_key = f"{event['source']}:{event['learnerId']}:{event['sequence']}:{event['targetDate']}"
        legacy_candidates.setdefault(legacy_key, []).append(event)
    for record in records:
        template_id = getattr(record, 'review_template_id', '')
        occurrence_number = getattr(record, 'occurrence_number', None)
        if template_id and occurrence_number is not None:
            identity = (str(record.learner_profile_id), template_id, occurrence_number)
            by_identity[identity] = record
    matched = {}
    for event in events:
        occurrence_number = event.get('occurrenceNumber')
        identity = (str(event['learnerId']), event.get('reviewTemplateId'), occurrence_number) if occurrence_number is not None else None
        record = (by_identity.get(identity) if identity is not None else None) or by_key.get(event['eventKey'])
        if record is None:
            legacy_key = f"{event['source']}:{event['learnerId']}:{event['sequence']}:{event['targetDate']}"
            candidate = by_key.get(legacy_key)
            if candidate and not getattr(candidate, 'review_template_id', '') and len(legacy_candidates[legacy_key]) == 1:
                record = candidate
        if record is not None:
            event['id'] = event['eventKey'] = record.event_key
            matched[record.event_key] = record
    return matched
