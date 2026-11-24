"""Canonical profile identity, active buckets and ordered directory result construction."""


def roster(scope, identifier, status, *, scope_placement_lineage, assigned_learners_for_scope, status_key):
    lineage = scope_placement_lineage(scope, identifier)
    if not lineage.get('found'):
        return None
    rows = assigned_learners_for_scope(
        scope, identifier, '', lineage=lineage, strict=True,
    )
    # Canonical learner identity, not a sum of module memberships.
    unique = {str(row['id']): {
        'id': str(row['id']), 'name': row.get('name') or '',
        'email': row.get('email') or '',
        'status': str(row.get('lifecycleStatus') or '').strip() or str(row.get('programmeStatus') or '').strip(),
        'programme': row.get('programme') or '',
        'enrolmentId': row.get('enrolmentId'),
    } for row in rows}
    if status == 'active':
        # Match the count buckets, including legacy programme-status fallback.
        unique = {key: row for key, row in unique.items() if status_key(row['status']) == 'active'}
    return sorted(unique.values(), key=lambda row: (row['name'].casefold(), row['id']))
