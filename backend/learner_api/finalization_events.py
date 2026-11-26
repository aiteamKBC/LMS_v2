"""Administrative event write serialization; not Monthly Log signature status.

Deploy with the coordinated canonical lock SQL. Call before reading a snapshot
and within the event transaction. Aptem identity is never a lock key.
"""
from old_otjh.service import ServiceError


def lock_writer(cursor, learner_id, month, *, expected_aptem_id=None):
    from .finalization_locks import lock_scopes
    lock_scopes(cursor, [(learner_id, month)])
    cursor.execute('SELECT aptem_id FROM "Learner".learners WHERE id=%s', [learner_id])
    owner = cursor.fetchone()
    if owner is None:
        raise ServiceError('Learner not found.', 'not_found', 404)
    if expected_aptem_id is not None and owner[0] != expected_aptem_id:
        raise ServiceError('The learner identity changed. Reload before finalizing.', 'record_changed', 409)
