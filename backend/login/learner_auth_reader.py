"""Opt-in read adapter, used by the disabled-by-default request bridge.

No model objects or save methods escape this adapter. Source writers and their
transactions remain on enrolment. Never use this separate connection to make
decisions inside uncommitted source-writer transactions. Each operation opens
a short READ COMMITTED, READ ONLY transaction and reads fresh grants. No cache,
legacy-query fallback, Django-admin fallback, token redemption or session touch.
Public permission methods are preparation for existing endpoint policy owners,
not replacements for route decorators. All callers must handle DatabaseError as
unavailability, not as an anonymous/expired session or successful authorization.
"""
from contextlib import contextmanager
from types import MappingProxyType, SimpleNamespace

from django.conf import settings
from django.core.exceptions import ImproperlyConfigured
from django.db import connections, transaction
from django.utils import timezone

from config.learner_auth import ALIAS
from . import identity, selectors
from .security import hash_token


_RELATIONS = ('Login_accounts', 'Login_sessions', 'Invitations', 'Password_resets',
              'Login_audit', 'auth_subjects', 'actor_grants', 'learner_identity_evidence',
              'cohort_access_facts', 'account_learner_links', 'learners', 'progress_transfer_requests')


class LearnerAuthDisabled(ImproperlyConfigured):
    pass


@contextmanager
def _read_query():
    if not getattr(settings, 'LEARNER_AUTH_READS_ENABLED', False):
        raise LearnerAuthDisabled('Learner-auth reads are disabled')
    if ALIAS not in settings.DATABASES:
        raise ImproperlyConfigured('Learner-auth reader connection is not configured')
    connection = connections[ALIAS]
    if connection.vendor != 'postgresql' or connection.in_atomic_block:
        raise ImproperlyConfigured('Learner-auth requires an independent PostgreSQL read transaction')
    with transaction.atomic(using=ALIAS):
        with connection.cursor() as cursor:
            cursor.execute('SET TRANSACTION ISOLATION LEVEL READ COMMITTED, READ ONLY')
            cursor.execute("SET LOCAL statement_timeout = '5s'")
            cursor.execute('SET LOCAL search_path = pg_catalog')
            cursor.execute('''SELECT rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication
                OR has_schema_privilege(current_user,'Learner','CREATE')
                FROM pg_catalog.pg_roles WHERE rolname=current_user''')
            if cursor.fetchone() != (False,):
                raise ImproperlyConfigured('Learner-auth requires a nonprivileged reader role')
            cursor.execute('''SELECT count(*), bool_and(has_table_privilege(current_user,c.oid,'SELECT')),
                bool_or(pg_has_role(current_user,c.relowner,'MEMBER') OR
                    has_table_privilege(current_user,c.oid,'INSERT,UPDATE,DELETE,TRUNCATE,TRIGGER,REFERENCES'))
                FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid=c.relnamespace
                WHERE n.nspname='Learner' AND c.relname=ANY(%s)''', [list(_RELATIONS)])
            if cursor.fetchone() != (len(_RELATIONS), True, False):
                raise ImproperlyConfigured('Learner-auth relation privileges require review')

            def query(sql, params):
                cursor.execute(sql, params)
                names = [column[0] for column in cursor.description]
                return [dict(zip(names, row)) for row in cursor.fetchall()]
            yield query


def _actor(row, query):
    if row is None:
        return None
    subject = selectors.subject_for_account(row['account_id'], query=query)
    if subject is None:
        return None
    if (subject['subject_type'], subject['subject_id']) != (row['subject_type'], row['subject_id']):
        raise selectors.IdentityReviewRequired('Subject identity needs review')
    grants = frozenset()
    staff = None
    if row['subject_type'] == 'staff':
        raw = selectors.staff_grants_for_actor(row['account_id'], query=query)
        if raw is None:
            return None
        staff = SimpleNamespace(position=raw['position'], access=raw['primary_access'],
                                access_extra=raw['access_extra'])
        grants = identity.accesses_for_staff(staff)
        role = identity.role_for_staff(staff.position, grants)
    elif row['subject_type'] in ('learner', 'employer'):
        role = row['subject_type']
    else:
        raise selectors.IdentityReviewRequired('Unknown subject identity')
    return MappingProxyType({**row, 'role': role, 'grants': grants}), subject, staff


class LearnerAuthReader:
    """Explicit preview API; constructing it does not connect or enable reads."""

    def account_for_login(self, email):
        """Credential record for a future verifier; never return this as JSON."""
        with _read_query() as query:
            actor = _actor(selectors.password_account_for_email(email, query=query), query)
            return actor[0] if actor else None

    def session_actor(self, token):
        with _read_query() as query:
            actor = self._session(token, query)
            return actor[0] if actor else None

    @staticmethod
    def _session(token, query):
        row = selectors.session_with_account(hash_token(token) if token else '', now=timezone.now(), query=query)
        return _actor(row, query)

    def me(self, token):
        """Existing {user: AuthUser} payload, or None for invalid identity."""
        with _read_query() as query:
            actor = self._session(token, query)
            if actor is None:
                return None
            row, source, staff = actor
            account = SimpleNamespace(id=row['account_id'], email=row['email'],
                display_name=row['display_name'], role=row['role'], subject_type=row['subject_type'],
                subject_id=row['subject_id'], has_password=row['has_password'], last_login_at=row['last_login_at'])
            subject = staff or SimpleNamespace(learner_type=source['learner_type'],
                programme=source['programme'], aptem_id=source['aptem_id'],
                employer_group_ids=source['organisation_ids'])

            def learner_record(_email):
                try:
                    link = selectors.learner_link_for_actor(row['account_id'], query=query)
                except selectors.IdentityReviewRequired:
                    # Preserve staff workspace; no arbitrary learner workspace.
                    return None
                return SimpleNamespace(pk=link['legacy_enrolment_id'], learner_type=link['learner_type']) if link else None

            return {'user': identity.account_payload(account, subject=subject, learner_record_resolver=learner_record)}

    def has_staff_access(self, token, access):
        with _read_query() as query:
            actor = self._session(token, query)
            if actor is None or actor[0]['subject_type'] != 'staff':
                return False
            grants = actor[0]['grants']
            return access in identity.ACCESS_CHOICES and ('super-admin' in grants or access in grants)

    def owns_learner(self, token, enrolment_id, relationship):
        """Narrow existing self/staff-study/coach/employer ownership checks.

        Admin preview/action policy is deliberately left to existing endpoints;
        super-admin is not implicitly a coach or a staff-own-study actor.
        """
        if relationship not in ('self', 'staff_self', 'coach', 'employer'):
            raise ValueError('Unknown relationship')
        with _read_query() as query:
            actor = self._session(token, query)
            if actor is None or type(enrolment_id) is not int or enrolment_id <= 0:
                return False
            row = actor[0]
            expected = {'self': ('learner', 'learner'), 'staff_self': ('staff', 'staff'),
                        'coach': ('staff', 'staff'), 'employer': ('employer', 'employer')}
            if (row['subject_type'], row['role']) != expected[relationship]:
                return False
            if relationship == 'coach' and 'coach' not in row['grants']:
                return False
            try:
                return selectors.relationship_for_target(row['account_id'], enrolment_id, relationship, query=query) is not None
            except selectors.IdentityReviewRequired:
                return False

    def profile_for_enrolment(self, enrolment_id, *, error_type):
        """Caller must already own/authorize target, as with the existing selector."""
        with _read_query() as query:
            return selectors.profile_for_enrolment(enrolment_id, query=query, error_type=error_type)

    def learner_access_facts(self, enrolment_id):
        """Pre-authorized target only; lifecycle rules remain with their owner."""
        with _read_query() as query:
            return selectors.learner_access_facts(enrolment_id, query=query)

    def cohort_access_facts(self, cohort_id):
        """Exact-key facts, not a replacement for legacy cohort resolution."""
        with _read_query() as query:
            return selectors.cohort_access_facts(cohort_id, query=query)

    def pending_token(self, kind, digest):
        # Inspection only: consumption must use the source writer's locked read.
        with _read_query() as query:
            return selectors.pending_token(kind, digest, now=timezone.now(), query=query)

    def recent_auth_event_count(self, **filters):
        with _read_query() as query:
            return selectors.recent_auth_event_count(query=query, **filters)
