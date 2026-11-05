"""Learner-owned original activities retained by an approved transfer.

Keep original catalogue identities so existing ownership checks and material /
quiz readers continue to serve the original content. No shared builder writes.
"""


def retained_sources(transfer):
    if transfer.get('status') != 'approved':
        return {}
    completed = set(transfer.get('completedSourceActivities', []))
    matched = {f"{m.get('catalogueKind')}:{m.get('sourceActivityId')}"
               for m in transfer.get('matchedComponents', {}).values()}
    course = transfer['courseRef'][7:]
    return {f'catalogue:{course}:{row["sourceActivityRef"]}': row
            for row in transfer.get('retainedSources', [])
            if row['sourceActivityRef'] in completed - matched}


def retained_card_items(transfer, originals):
    original_by_id = {row['activity_id']: row for row in originals}
    return [dict(original_by_id.get(ident, {}), id=ident, activity_id=ident,
                 title=source['title'], week=source['week'], completed=True,
                 position=index, schedule=original_by_id.get(ident, {}).get('schedule') or {})
            for index, (ident, source) in enumerate(retained_sources(transfer).items())]
