"""Idempotent copies of LMS support tickets for the Ticketing system.

The LMS ticket record remains authoritative in ``"Learner".support_tickets``.
The separate Ticketing system database receives both the portal ticket shown in
``public.tickets`` and its conversation log in
``public.assistant_conversations``. The connection is configured by
``ASSISTANT_CONVERSATIONS_DATABASE_URL`` (or ``TICKETING_DATABASE_URL``) and is
never sourced from a request value.
"""

import json

from django.db import connections, transaction


TABLE = 'public.assistant_conversations'
PORTAL_TICKETS = 'public.tickets'
PORTAL_LEARNERS = 'public.learners'
PORTAL_CONVERSATIONS = 'public.conversations'


class AssistantConversationSyncError(RuntimeError):
    """The secondary conversation record could not be written."""


def _message(ticket: dict) -> str:
    """Keep all ticket fields readable without requiring a schema change."""
    return (
        f"Support ticket: {ticket.get('title', '')}\n"
        f"Category: {ticket.get('category', '')}\n"
        f"Priority: {ticket.get('priority', '')}\n\n"
        f"{ticket.get('description', '')}"
    )


def _portal_category(category: str) -> str:
    return {
        'Technical Issue': 'Technical',
        'Learning Support': 'Learning',
        'Data / MIS': 'Data / MIS',
        'Coaching Query': 'Coaching',
        'Safeguarding Concern': 'Safeguarding',
        'Other': 'Other',
    }.get(category, 'Other')


def _portal_priority(priority: str) -> str:
    return {
        'low': 'Low',
        'medium': 'Normal',
        'high': 'High',
        'urgent': 'Urgent',
    }.get(priority, 'Normal')


def _portal_metadata(*, ticket: dict, public_id: str) -> str:
    category = _portal_category(ticket.get('category', ''))
    return json.dumps({
        'source': 'lms',
        'lms_ticket_id': str(ticket['id']),
        'ticket_public_id': public_id,
        'requester_role': 'learner',
        'requester_source': 'lms_learners',
        'assigned_team': ticket.get('portalAssignedTeam') or 'Unassigned',
        'technical_subcategory': 'LMS' if category == 'Technical' else None,
    })


def _find_existing_portal_ticket(cursor, ticket_id: str):
    cursor.execute(
        f"SELECT id, public_id FROM {PORTAL_TICKETS} "
        "WHERE metadata->>'lms_ticket_id'=%s LIMIT 1 FOR UPDATE",
        [ticket_id],
    )
    return cursor.fetchone()


def _ensure_portal_learner(cursor, account, ticket_id: str) -> int:
    email = str(getattr(account, 'email', '') or '').strip().lower()
    if not email:
        raise AssistantConversationSyncError(
            'The learner email is required for the Ticketing system copy.'
        )
    display_name = str(getattr(account, 'display_name', '') or '').strip() or 'Learner'
    # The external Ticketing system contract intentionally keeps the login
    # account's legacy enrolment/subject identifier here. This is not the
    # canonical Learner.learners.id used by Learner.support_tickets.learner_id.
    external_id = str(getattr(account, 'subject_id', '') or '').strip() or ticket_id
    cursor.execute(
        f'''INSERT INTO {PORTAL_LEARNERS}
            (external_learner_id, full_name, email, source)
            VALUES (%s, %s, %s, %s)
            ON CONFLICT (email) DO UPDATE SET updated_at=NOW()
            RETURNING id''',
        [external_id, display_name, email, 'lms_learners'],
    )
    row = cursor.fetchone()
    if not row:
        raise AssistantConversationSyncError(
            'The Ticketing system learner mapping could not be created.'
        )
    return int(row[0])


def _create_portal_ticket(cursor, *, account, ticket: dict, ticket_id: str) -> str:
    existing = _find_existing_portal_ticket(cursor, ticket_id)
    if existing:
        return str(existing[1])

    learner_id = _ensure_portal_learner(cursor, account, ticket_id)
    cursor.execute("SELECT nextval('public.tickets_id_seq')")
    row = cursor.fetchone()
    if not row:
        raise AssistantConversationSyncError(
            'The Ticketing system ticket number could not be allocated.'
        )
    portal_numeric_id = int(row[0])
    public_id = f'KBC-{portal_numeric_id:06d}'
    category = _portal_category(ticket.get('category', ''))
    priority = _portal_priority(ticket.get('priority', ''))
    assigned_team = "'Quality Team'" if ticket.get('portalAssignedTeam') == 'Quality Team' else "'Unassigned'"
    subject = str(ticket.get('title', '') or '').strip()
    inquiry = f"{subject}\n\n{ticket.get('description', '')}".strip()
    metadata = _portal_metadata(ticket=ticket, public_id=public_id)

    cursor.execute(
        f'''INSERT INTO {PORTAL_TICKETS}
            (id, public_id, learner_id, category, inquiry, status,
             assigned_team, priority, metadata, technical_subcategory,
             subject, submitted_for_learner_id, can_show_conversation,
             can_receive_chat)
            VALUES (%s, %s, %s, %s, %s, 'Open', {assigned_team}, %s,
                    %s::jsonb, %s, %s, %s, TRUE, TRUE)''',
        [
            portal_numeric_id, public_id, learner_id, category, inquiry,
            priority, metadata, 'LMS' if category == 'Technical' else None,
            subject, learner_id,
        ],
    )
    cursor.execute(
        f'''INSERT INTO {PORTAL_CONVERSATIONS}
            (channel, customer_id, customer_name, customer_email,
             status, intent, metadata)
            VALUES ('support', %s, %s, %s, 'active', %s, %s::jsonb)
            RETURNING id''',
        [
            public_id,
            str(getattr(account, 'display_name', '') or '').strip() or 'Learner',
            str(getattr(account, 'email', '') or '').strip().lower(),
            category,
            metadata,
        ],
    )
    conversation = cursor.fetchone()
    if not conversation:
        raise AssistantConversationSyncError(
            'The Ticketing system conversation could not be created.'
        )
    cursor.execute(
        f'UPDATE {PORTAL_TICKETS} SET conversation_id=%s, updated_at=NOW() WHERE id=%s',
        [conversation[0], portal_numeric_id],
    )
    return public_id


def _write_assistant_conversation(cursor, *, account, ticket: dict, public_id: str) -> None:
    ticket_id = str(ticket['id'])
    cursor.execute(
        f'''SELECT 1 FROM {TABLE}
            WHERE session_id=%s OR ticket_id IN (%s, %s)
            LIMIT 1''',
        [ticket_id, ticket_id, public_id],
    )
    if cursor.fetchone():
        return
    cursor.execute(
        f'''INSERT INTO {TABLE}
            (session_id, email, mode, route, user_message,
             assistant_reply, escalated, kb_distance, ticket_id)
            VALUES (%s, %s, %s, %s, %s, %s, %s, NULL, %s)''',
        [
            ticket_id,
            str(getattr(account, 'email', '') or '').strip().lower(),
            'learner',
            'support',
            _message(ticket),
            f"Your support ticket has been submitted to {ticket.get('portalAssignedTeam') or 'LMS Support'}.",
            True,
            public_id,
        ],
    )


def record_ticket(*, account, ticket: dict) -> None:
    """Write one ticket copy, safely retryable by its ticket UUID.

    The target table predates LMS tickets and has no unique constraint on
    ``ticket_id``.  A transaction-scoped advisory lock makes the check-and-insert
    idempotent even when the browser retries the same request concurrently.
    """
    if 'assistant_conversations' not in connections.databases:
        raise AssistantConversationSyncError(
            'The Ticketing system connection is not configured.'
        )

    ticket_id = str(ticket['id'])
    try:
        with transaction.atomic(using='assistant_conversations'):
            with connections['assistant_conversations'].cursor() as cursor:
                cursor.execute(
                    'SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))',
                    [ticket_id],
                )
                public_id = _create_portal_ticket(
                    cursor, account=account, ticket=ticket, ticket_id=ticket_id,
                )
                _write_assistant_conversation(
                    cursor, account=account, ticket=ticket, public_id=public_id,
                )
    except Exception as exc:
        raise AssistantConversationSyncError(
            'The ticket was saved in the LMS, but its Ticketing system copy could not be saved. Please retry.'
        ) from exc


def close_open_quality_ticket(*, ticket_id: str) -> str:
    """Close only this existing Quality ticket; never create a missing copy."""
    if 'assistant_conversations' not in connections.databases:
        raise AssistantConversationSyncError('The Ticketing system connection is not configured.')
    try:
        with transaction.atomic(using='assistant_conversations'), connections['assistant_conversations'].cursor() as cursor:
            cursor.execute('SELECT pg_advisory_xact_lock(hashtextextended(%s, 0))', [str(ticket_id)])
            cursor.execute(
                f"SELECT id, status, assigned_team FROM {PORTAL_TICKETS} "
                "WHERE metadata->>'lms_ticket_id'=%s FOR UPDATE", [str(ticket_id)],
            )
            rows = cursor.fetchall()
            if len(rows) != 1 or rows[0][2] != 'Quality Team':
                raise AssistantConversationSyncError('The linked Quality ticket could not be identified.')
            portal_id, status, _ = rows[0]
            if status == 'Open':
                cursor.execute(
                    f"UPDATE {PORTAL_TICKETS} SET status='Closed', closed_at=NOW(), updated_at=NOW() "
                    "WHERE id=%s AND status='Open'", [portal_id],
                )
                return 'Closed'
            return str(status)
    except Exception as exc:
        raise AssistantConversationSyncError('The linked Quality ticket could not be closed in technicalsupport. Please retry.') from exc


def ticket_status(*, ticket_id: str) -> str | None:
    """Read the current status of an LMS ticket from the Ticketing system."""
    if 'assistant_conversations' not in connections.databases:
        raise AssistantConversationSyncError(
            'The Ticketing system connection is not configured.'
        )

    try:
        with transaction.atomic(using='assistant_conversations'):
            with connections['assistant_conversations'].cursor() as cursor:
                cursor.execute(
                    f"SELECT status FROM {PORTAL_TICKETS} "
                    "WHERE metadata->>'lms_ticket_id'=%s LIMIT 1",
                    [str(ticket_id)],
                )
                row = cursor.fetchone()
        return str(row[0]) if row and row[0] is not None else None
    except Exception as exc:
        raise AssistantConversationSyncError(
            'The Ticketing system ticket status could not be read. Please retry.'
        ) from exc
