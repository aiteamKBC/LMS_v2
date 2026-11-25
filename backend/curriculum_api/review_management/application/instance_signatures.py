"""Native sign-off and completion within the existing transaction."""
from __future__ import annotations

from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCES_TABLE
from curriculum_api.review_management.infrastructure.instance_relations import REVIEW_INSTANCE_SIGNATURES_TABLE
from curriculum_api.review_management.domain.instance_rules import SIGNATURE_ROLES
from curriculum_api.review_management.domain.instance_rules import STATUS_AWAITING_SIGNATURE
from curriculum_api.review_management.domain.instance_rules import STATUS_COMPLETED
from curriculum_api.review_management.infrastructure.instance_calendar import _mirror_linked_calendar_after_signature
from curriculum_api.catalogue.domain.values import as_json_value
from datetime import datetime
from curriculum_api.review_management.infrastructure.instance_rows import find_review_instance_signature_rows
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance
from curriculum_api.review_management.infrastructure.instance_rows import get_review_instance_signatures
from curriculum_api.catalogue.infrastructure.authoring_storage import insert_row
from coach_api.reconciliation_links import native_write
from curriculum_api.review_management.domain.instance_rules import required_signature_roles
from curriculum_api.review_management.application.instance_definitions import review_instance_form_definition
from django.db import transaction
from curriculum_api.catalogue.infrastructure.record_identity import unique_prefixed_id
from curriculum_api.catalogue.infrastructure.authoring_storage import update_rows


def _all_required_signatures_present(instance_id, snapshot):
    required_roles = required_signature_roles(snapshot.get('signatures', {}))
    if not required_roles:
        return True
    signatures_by_role = get_review_instance_signatures(instance_id)
    return all(signatures_by_role.get(role, {}).get('signed_at') for role in required_roles)


@native_write
def record_review_instance_signature(instance_row, role, *, signed_by, signed_name, signature, actor='system'):
    """Record one party's sign-off and mirror its lifecycle status atomically."""
    if role not in SIGNATURE_ROLES:
        raise ValueError(f'Unknown signature role "{role}".')
    snapshot = as_json_value(instance_row.get('definition_snapshot'), {})
    if role not in required_signature_roles(snapshot.get('signatures', {})):
        raise ValueError(f'This review does not require a "{role}" signature.')
    if instance_row.get('status') not in (STATUS_AWAITING_SIGNATURE, STATUS_COMPLETED):
        raise ValueError('This review must be finished before it can be signed.')

    with transaction.atomic():
        existing_rows = find_review_instance_signature_rows(instance_row.get('id'), role)
        signed_at = datetime.utcnow() if signature else None
        payload = {
            'signed_by': signed_by or '', 'signed_name': signed_name or '',
            'signature': signature or '', 'signed_at': signed_at,
            'updated_at': datetime.utcnow(),
        }
        if existing_rows:
            update_rows(
                REVIEW_INSTANCE_SIGNATURES_TABLE, 'id = %s', [existing_rows[0]['id']], payload,
                allow_null_columns=['signed_at'],
            )
        else:
            insert_row(REVIEW_INSTANCE_SIGNATURES_TABLE, {
                'id': unique_prefixed_id('REVIS'),
                'review_instance_id': instance_row.get('id'),
                'role': role,
                'created_at': datetime.utcnow(),
                **payload,
            })

        current_status = instance_row.get('status')
        if _all_required_signatures_present(instance_row.get('id'), snapshot):
            completed_at = datetime.utcnow()
            if current_status == STATUS_AWAITING_SIGNATURE:
                updated = update_rows(
                    REVIEW_INSTANCES_TABLE,
                    'id = %s and status = %s',
                    [instance_row.get('id'), STATUS_AWAITING_SIGNATURE],
                    {
                        'status': STATUS_COMPLETED, 'completed_at': completed_at,
                        'updated_by': actor, 'updated_at': completed_at,
                    },
                )
                if not updated:
                    raise ValueError(
                        'This review status changed while the signature was being recorded. '
                        'Reload it and try again.'
                    )
                completed_at = updated[0].get('completed_at') or completed_at
            elif current_status != STATUS_COMPLETED:
                raise ValueError('This review must be awaiting signature before it can be completed.')
            _mirror_linked_calendar_after_signature(
                instance_row, status=STATUS_COMPLETED, completed_at=completed_at,
            )
        else:
            # A completed instance is terminal even if a legacy/concurrent
            # signature row is being backfilled. Keep its Calendar projection
            # completed instead of trying to regress it to awaiting-signature.
            if current_status == STATUS_COMPLETED:
                _mirror_linked_calendar_after_signature(
                    instance_row,
                    status=STATUS_COMPLETED,
                    completed_at=instance_row.get('completed_at'),
                )
            else:
                _mirror_linked_calendar_after_signature(
                    instance_row, status=STATUS_AWAITING_SIGNATURE,
                )

    return review_instance_form_definition(get_review_instance(instance_row.get('id')))
