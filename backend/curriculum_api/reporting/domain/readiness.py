"""Readiness follows authored weights; no percentage target is inferred."""


def coverage_readiness(payload):
    # Required KSBs with no weight have nowhere to be taught. Positive weights
    # do not imply a 100% target: the existing business rule defines none.
    issues = []
    for item in payload.get('items', []):
        raw_weight = item.get('raw_total_weight') or 0
        if raw_weight <= 0:
            issues.append({
                'severity': 'warning',
                'code': item.get('code'),
                'raw_weight': raw_weight,
                'rawWeight': raw_weight,
                'message': f'{item.get("code")} is not mapped to any component.',
            })
    return {
        'ready': not issues,
        'canSaveDraft': True,
        'issues': issues,
        'summary': payload.get('summary'),
    }
