"""Immutable Imported resource identities captured before a booking is moved.

Only server-verified, saved resources enter this manifest. It stores references,
not content or attendee identities. Callers must first authorize the calendar and
qualify archive rows by its learner, owner and provider event.
"""
from .migrated_session_scope import (
    booking_fingerprint, has_verified_meeting_evidence, meeting_artifacts, scope_snapshot,
)


class EvidenceConflict(ValueError):
    pass


def validated_manifest(previous, attempt):
    manifest = getattr(attempt, 'evidence_manifest', {})
    if manifest in ({}, None):
        return None  # Native and archives written before this feature.
    if (not isinstance(manifest, dict) or manifest.get('schemaVersion') != 1
            or manifest.get('source') != 'aptem'
            or manifest.get('bookingFingerprint') != attempt.booking_fingerprint
            or attempt.booking_fingerprint != booking_fingerprint(previous)):
        raise EvidenceConflict('Invalid archived evidence scope.')
    for key, fields in [('reports', ('id', 'meetingId')), ('artifacts', ('id', 'meetingId', 'type'))]:
        rows = manifest.get(key)
        if not isinstance(rows, list) or any(
                not isinstance(row, dict) or any(not isinstance(row.get(field), str) or not row[field]
                                                for field in fields) for row in rows):
            raise EvidenceConflict('Invalid archived resource identity.')
    if any(row['type'] not in {'recording', 'transcript'} or not isinstance(row.get('callId'), str)
           for row in manifest['artifacts']):
        raise EvidenceConflict('Invalid archived media identity.')
    return manifest


def without_archived(snapshot, manifests):
    """IDs remain historical even when a later Graph refresh changes timestamps."""
    if not manifests:
        return snapshot
    report_ids = {row['id'] for manifest in manifests for row in manifest['reports']}
    media_ids = {(row['type'], row['id']) for manifest in manifests for row in manifest['artifacts']}
    calls = {(row['meetingId'], row['callId']) for manifest in manifests for row in manifest['artifacts']
             if row['callId']}

    def is_previous(row):
        metadata = row.get('metadata') or {}
        return ((row.get('artifact_type'), row.get('graph_artifact_id')) in media_ids
                or (metadata.get('_lms_verified_online_meeting_id'),
                    row.get('call_id') or metadata.get('callId')) in calls)

    return {**snapshot,
        'attendanceReports': [row for row in snapshot.get('attendanceReports', []) if row.get('id') not in report_ids],
        'artifacts': [row for row in snapshot.get('artifacts', []) if not is_previous(row)]}


def capture(record, snapshot, manifests):
    if snapshot.get('partial') or not (snapshot.get('storage') or {}).get('stored'):
        raise EvidenceConflict('Saved meeting resources are unavailable.')
    if not has_verified_meeting_evidence(snapshot):
        return {}  # Keep the existing booked-window / explicit-call reader.
    # Everything verified and already saved before the slot change is historical
    # afterwards, including off-slot calls. Previously archived IDs stay with their
    # first archive. Do not infer ownership from when a report was refreshed.
    scoped = scope_snapshot(record, without_archived(snapshot, manifests),
                            meeting_scoped=True, historical=True)
    if scoped.get('selectionError'):
        raise EvidenceConflict('Saved meeting resources have conflicting identity.')
    return {'schemaVersion': 1, 'source': 'aptem', 'bookingFingerprint': booking_fingerprint(record),
        'reports': [{'id': row['id'], 'meetingId': row['_lms_verified_online_meeting_id']}
                    for row in scoped['attendanceReports']],
        'artifacts': [{'type': row['artifact_type'], 'id': row['graph_artifact_id'],
                       'meetingId': row['metadata']['_lms_verified_online_meeting_id'],
                       'callId': row.get('call_id') or row['metadata'].get('callId') or ''}
                      for row in scoped['artifacts']]}


def archived_artifacts(record, snapshot, manifest):
    """Exact verified IDs, plus later segments of those same verified calls."""
    result = []
    for meeting_id in {row['meetingId'] for row in manifest['artifacts']}:
        identities = {(row['type'], row['id']): row for row in manifest['artifacts']
                      if row['meetingId'] == meeting_id}
        calls = {row['callId'] for row in identities.values() if row['callId']}
        candidates = []
        conflicted = set()
        for row in snapshot.get('artifacts', []):
            metadata = row.get('metadata') or {}
            call = row.get('call_id') or metadata.get('callId') or ''
            saved = identities.get((row.get('artifact_type'), row.get('graph_artifact_id')))
            if saved:
                if saved['callId'] and saved['callId'] != call:
                    conflicted.add((row.get('artifact_type'), row.get('graph_artifact_id')))
                    continue
            elif call not in calls:
                continue
            candidates.append(row)
        verified, error = meeting_artifacts(record, {'artifacts': candidates}, meeting_id)
        if not error:
            result.extend(row for row in verified
                          if (row['artifact_type'], row['graph_artifact_id']) not in conflicted)
    return result
