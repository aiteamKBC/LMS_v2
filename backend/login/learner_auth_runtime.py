"""Opt-in request bridge; source models remain the authoritative writers.

Hydrated accounts have no deferred fields: reading an attribute cannot issue a
hidden source SELECT. Saves retain the enrolment alias and explicit update_fields.
Locked token redemption and account provisioning remain source transactions.
"""
from types import SimpleNamespace

from django.conf import settings

from . import selectors
from .learner_auth_reader import _actor, _read_query


def enabled():
    return bool(getattr(settings, 'LEARNER_AUTH_READS_ENABLED', False))


def _account_columns():
    from .models import LoginAccount
    fields = list(LoginAccount._meta.concrete_fields)
    return fields, ', '.join('"' + field.column + '"' for field in fields)


def _account(account_id, query, record=None):
    from .models import LoginAccount
    fields, columns = _account_columns()
    if record is None:
        rows = query('SELECT ' + columns + ' FROM "Learner"."Login_accounts" WHERE id=%s', [account_id])
        if len(rows) != 1:
            raise selectors.IdentityReviewRequired('Account identity needs review')
        record = rows[0]
    account = LoginAccount.from_db('enrolment', [f.attname for f in fields],
                                  [record[f.column] for f in fields])
    actor = _actor(dict(account_id=account.id, subject_type=account.subject_type,
                        subject_id=account.subject_id), query)
    if actor is None:
        return None
    row, source, staff = actor
    account.role = row['role']
    account._learner_auth = True
    account._learner_auth_grants = row['grants']
    account._learner_auth_subject = staff or SimpleNamespace(
        learner_type=source['learner_type'], programme=source['programme'],
        aptem_id=source['aptem_id'], employer_group_ids=source['organisation_ids'])
    if staff is not None:
        staff.id = staff.pk = account.subject_id
        staff.email = source['email']
        staff.username = source['source_display_name']
        account._staff_access = (staff.access or '').strip().lower()
    return account


def account_for_email(email):
    with _read_query() as query:
        _, columns = _account_columns()
        # Identity ambiguity and credentials are observed in the same SELECT.
        rows = query('SELECT ' + columns + ' FROM "Learner"."Login_accounts" '
                     'WHERE "Email"=%s AND "Is_active"=TRUE LIMIT 2',
                     [str(email or '').strip().lower()])
        return _account(rows[0]['id'], query, rows[0]) if len(rows) == 1 else None


def resolve_session(token):
    from django.utils import timezone
    from .security import hash_token
    if not token:
        return None
    with _read_query() as query:
        row = selectors.session_with_account(hash_token(token), now=timezone.now(), query=query)
        if row is None:
            return None
        account = _account(row['account_id'], query)
        if account is None or not account.is_active:
            return None
        return SimpleNamespace(id=row['session_id'], pk=row['session_id'],
            account_id=account.id, account=account, **{key: row[key] for key in
            ('expires_at', 'revoked_at', 'created_at', 'last_seen_at', 'remember')})


def payload(account):
    from .identity import account_payload
    with _read_query() as query:
        current = _account(account.id, query)
        if current is None:
            raise selectors.IdentityReviewRequired('Subject identity needs review')
        def learner_record(_email):
            try:
                link = selectors.learner_link_for_actor(account.id, query=query)
            except selectors.IdentityReviewRequired:
                return None
            return SimpleNamespace(pk=link['legacy_enrolment_id'], learner_type=link['learner_type']) if link else None
        return account_payload(current, subject=current._learner_auth_subject,
                               learner_record_resolver=learner_record)


def owns(account, learner_id, relationship):
    with _read_query() as query:
        current = _account(account.id, query)
        if current is None or not current.is_active:
            return False
        expected = {'staff_self': ('staff', 'staff'), 'coach': ('staff', 'staff'),
                    'employer': ('employer', 'employer')}
        if (current.subject_type, current.role) != expected.get(relationship):
            return False
        if relationship == 'coach' and 'coach' not in current._learner_auth_grants:
            return False
        try:
            return selectors.relationship_for_target(account.id, learner_id, relationship, query=query) is not None
        except selectors.IdentityReviewRequired:
            return False


def peek_token(model, token):
    from django.utils import timezone
    from .models import Invitation
    from .security import hash_token
    from .invitations import TokenError
    with _read_query() as query:
        row = selectors.pending_token('invitation' if model is Invitation else 'reset',
            hash_token(token), now=timezone.now(), query=query)
        if row is None:
            raise TokenError('This link is invalid or has expired. Please request a new one.')
        # Peeks historically expose the stored role, not a refreshed grant.
        account = SimpleNamespace(email=row['email'], display_name=row['display_name'], role=row['stored_role'])
        return SimpleNamespace(account=account, expires_at=row['expires_at'])


def provisioning_candidate(email):
    """Preflight only; provisioning still rechecks the authoritative writer."""
    with _read_query() as query:
        if query('SELECT id FROM "Learner"."Login_accounts" WHERE "Email"=%s LIMIT 1', [email]):
            return None
        rows = query('''SELECT subject_id FROM "Learner".auth_subjects
            WHERE subject_type='learner' AND upper(email)=upper(%s) LIMIT 2''', [email])
        return rows[0]['subject_id'] if len(rows) == 1 else None


def programme_source(enrolment_id):
    """Only the existing programme gate's inputs; never a canonical ID substitute."""
    with _read_query() as query:
        facts = selectors.learner_access_facts(enrolment_id, query=query)
        if facts is None:
            return None
        rows = query('SELECT cohort_id FROM "Learner".learners WHERE enrolment_id=%s LIMIT 5', [enrolment_id])
        values = {row['cohort_id'].strip() for row in rows if isinstance(row['cohort_id'], str) and row['cohort_id'].strip()}
        return SimpleNamespace(programme=facts['programme'], cohort=facts['cohort'],
            start_date=facts['start_date'], cohort_id=values.pop() if len(values) == 1 else '')


def coach_candidates(email):
    with _read_query() as query:
        rows = query('''SELECT g.staff_id, g.staff_email, g.primary_access, g.access_extra,
            s.display_name FROM "Learner".actor_grants g JOIN "Learner".auth_subjects s
            ON s.subject_type='staff' AND s.subject_id=g.staff_id
            WHERE lower(btrim(g.staff_email))=%s''', [email])
        return [SimpleNamespace(id=row['staff_id'], pk=row['staff_id'], email=row['staff_email'],
            access=row['primary_access'], access_extra=row['access_extra'], username=row['display_name'])
            for row in rows]
