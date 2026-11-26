"""Assignment provenance links using the same records as monthly hour totals."""
from collections import defaultdict
import json

from . import canonical_learning as canonical
from .current_learning import source_reference


def submission_links(submissions, records, owner, selected):
    """Resolve one unambiguous canonical month without allocating hours again.

    Current submissions can be represented by a progress entry, imported
    reflection lineage, or a synthetic reflection row. Follow that same
    deduplication priority; never guess a date for missing historical evidence.
    """
    targets = {item['report_month']: item['id'] for item in selected}
    by_id, by_source, by_component = {}, defaultdict(list), defaultdict(list)
    for record in records:
        by_id[str(record['id'])] = [record]
        reference = source_reference(record)
        if reference:
            by_source[reference].append(record)
        if record.get('component_ref'):
            by_component[str(record['component_ref'])].append(record)
    links = []
    for submission in submissions:
        target_id = None
        if (submission['activity_type'] == 'assignment' and submission['status'] != 'draft'
                and submission['learner_kind'] == owner['learner_type']):
            reference = f"reflection:{submission['id']}"
            matches = (by_source.get(reference)
                       or by_id.get(str(submission['progress_entry_id']))
                       or by_component.get(str(submission['component_ref']))
                       or by_id.get(reference) or [])
            months = {part.get('reporting_month') for record in matches
                      for part in canonical.allocations(record)}
            if len(months) == 1:
                target_id = targets.get(next(iter(months)))
        links.append({'id': str(submission['id']), 'target_id': target_id})
    return links


def link_assignment_targets(cursor, owner, selected, records):
    """Update only this owner's links, inside the atomic summary replacement.

    FK-only changes are outside the existing submission event field list, so
    they neither invalidate the new snapshot nor produce recursive events.
    """
    cursor.execute('''SELECT EXISTS(SELECT 1 FROM pg_attribute
        WHERE attrelid=to_regclass('"Learner".learning_reflection_submissions')
          AND attname='monthly_target_id' AND NOT attisdropped)''')
    if not cursor.fetchone()[0]:
        return  # Rolling deployment before the additive submission migration.
    cursor.execute('''SELECT id,learner_kind,activity_type,status,progress_entry_id,component_ref
        FROM "Learner".learning_reflection_submissions
        WHERE learner_id=%s AND (activity_type='assignment' OR monthly_target_id IS NOT NULL)''', [owner['id']])
    columns = ('id', 'learner_kind', 'activity_type', 'status', 'progress_entry_id', 'component_ref')
    links = submission_links([dict(zip(columns, row)) for row in cursor.fetchall()], records, owner, selected)
    if not links:
        return
    cursor.execute('''UPDATE "Learner".learning_reflection_submissions s SET monthly_target_id=x.target_id
        FROM jsonb_to_recordset(%s::jsonb) x(id uuid,target_id bigint)
        WHERE s.id=x.id AND s.learner_id=%s AND s.monthly_target_id IS DISTINCT FROM x.target_id''',
        [json.dumps(links), owner['id']])
