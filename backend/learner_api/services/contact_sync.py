"""Synchronous source-owned contacts and durable cache refresh publication.

Only use inside an existing source-first transaction on the owning connection.
No signals, identity healing, activation, source replay or cross-alias writes.
"""
from uuid import uuid4

from .identity_reconciliation import IdentityReconciliationError, ReconciliationResult, _reconcile_locked


def verified_activation_profile(source):
    """Gate existing activation; never heal links using email or matching PKs.

    NOWAIT refuses an inverse-lock caller instead of waiting on another source
    writer while it may already hold profile/plan locks. Activation's caller
    retains its existing transaction and failure contract.
    """
    from django.db import DatabaseError, connections
    from learner_api.models import LearnerProfile
    connection = connections['enrolment']
    uid = getattr(source, 'uuid', None)
    if not connection.in_atomic_block or uid is None:
        raise DatabaseError('Activation requires a persisted stable identity.')
    _verify_worker_connection(connection)
    with connection.cursor() as cursor:
        cursor.execute('SELECT id,uuid,"Email","Username","Phone_number" FROM enrolment."Created_users" '
                       'WHERE id=%s OR uuid=%s ORDER BY id FOR UPDATE NOWAIT', [source.id, uid])
        rows = cursor.fetchall()
        if len(rows) != 1 or rows[0][0] != source.id or str(rows[0][1]) != str(uid):
            raise DatabaseError('Activation source identity is ambiguous or changed.')
        contacts = {
            'full_name': str(rows[0][3] or '').strip() or str(rows[0][2] or '').strip(),
            'phone_number': str(rows[0][4] or '').strip(),
        }
        cursor.execute('SELECT id FROM "Learner".learners WHERE enrolment_id=%s OR uuid=%s '
                       'ORDER BY id FOR UPDATE NOWAIT', [source.id, uid])
        profiles = cursor.fetchall()
        if len(profiles) > 1:
            raise DatabaseError('Activation profile identity is ambiguous.')
        if profiles:
            try:
                _reconcile_locked(cursor, source.id, profiles[0][0], uid, apply=False)
            except IdentityReconciliationError as exc:
                raise DatabaseError(f'Activation identity refused: {exc.code}') from None
            return LearnerProfile.objects.using('enrolment').get(pk=profiles[0][0]), contacts
        # Email and coincident PKs are exclusion checks, never proof of a link.
        cursor.execute('SELECT 1 FROM "Learner".learners WHERE lower(trim(email))=lower(trim(%s)) '
                       'OR (id=%s AND enrolment_id IS NULL) LIMIT 1', [rows[0][2], source.id])
        if cursor.fetchone():
            raise DatabaseError('Activation requires review of an unverified existing profile.')
    # Preserve the existing activation-only creation path for a new identity.
    return None, contacts


def save_verified_contact_fields(user, fields, *, profile_fields=None):
    """Save explicit PATCH fields and verified projections on one connection."""
    from django.db import DatabaseError, connections, transaction
    names = set(fields)
    if not names.intersection({'username', 'phone_number'}) or names.intersection({'id', 'pk', 'uuid'}):
        raise DatabaseError('Explicit contact fields and an unchanged identity are required.')
    if getattr(getattr(user, '_state', None), 'db', None) not in (None, 'enrolment'):
        raise DatabaseError('Contact source database is not verified.')
    with transaction.atomic(using='enrolment'):
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('SELECT uuid FROM enrolment."Created_users" WHERE id=%s FOR UPDATE', [user.pk])
            row = cursor.fetchone()
            if row is None or str(row[0]) != str(getattr(user, 'uuid', None)):
                raise DatabaseError('Contact source identity changed.')
        user.save(using='enrolment', update_fields=list(fields))
        result = sync_contacts_in_transaction(user.pk, using='enrolment')
        if profile_fields:
            from learner_api.models import LearnerProfile
            # No legacy email/PK fallback: sync has validated the explicit link.
            profile = LearnerProfile.objects.using('enrolment').filter(enrolment_id=user.pk).first()
            if profile is not None:
                for field, value in profile_fields.items():
                    setattr(profile, field, value)
                profile.save(using='enrolment', update_fields=[*profile_fields, 'updated_at'])
                if set(profile_fields).intersection({'coach_name', 'coach_email'}):
                    # Invalidate both old and new coach scopes inside this commit.
                    sync_contacts_in_transaction(user.pk, using='enrolment')
        return result


def save_profile_contact_fields(profile, fields):
    """Profile editor write-through; caller must retain the owning transaction.

    Unlinked profiles remain profile-only. Never resolve a source by email or
    profile PK, and never propagate other delivery-profile fields to the source.
    """
    from django.db import DatabaseError, connections
    from learner_api.models import EnrolmentUser, LearnerProfile
    connection = connections['enrolment']
    if not connection.in_atomic_block or not set(fields) <= {'full_name', 'phone_number'}:
        raise DatabaseError('An owning contact transaction is required.')
    _verify_worker_connection(connection)
    sid = profile.enrolment_id
    if sid is not None:
        source = EnrolmentUser.all_learners.using('enrolment').select_for_update().filter(pk=sid).first()
        if source is None:
            raise DatabaseError('Contact source identity is missing.')
    locked = LearnerProfile.objects.using('enrolment').select_for_update().get(pk=profile.pk)
    if locked.uuid != profile.uuid or locked.enrolment_id != sid:
        raise DatabaseError('Contact profile identity changed.')
    if sid is None:
        for field, value in fields.items():
            setattr(locked, field, value)
        locked.save(using='enrolment', update_fields=[*fields, 'updated_at'])
        from django.db import transaction
        scopes = [('record.monitor', 'record-monitor', 'global')]
        if locked.coach_email:
            scopes.append(('coach.dashboard', 'coach', locked.coach_email.strip().lower()))
        with connection.cursor() as cursor:
            try:
                _publish_contact_scopes(cursor, scopes)
            except IdentityReconciliationError as exc:
                raise DatabaseError(f'Contact synchronization refused: {exc.code}') from None
        transaction.on_commit(lambda: invalidate_contact_caches(scopes), using='enrolment', robust=True)
    else:
        try:
            with connection.cursor() as cursor:
                _reconcile_locked(cursor, sid, locked.pk, locked.uuid, apply=False)
        except IdentityReconciliationError as exc:
            raise DatabaseError(f'Contact synchronization refused: {exc.code}') from None
        source_fields = {'username' if key == 'full_name' else key: value for key, value in fields.items()}
        for field, value in source_fields.items():
            setattr(source, field, value)
        save_verified_contact_fields(source, source_fields)
        locked.refresh_from_db(using='enrolment', fields=['full_name', 'phone_number', 'updated_at'])
    for field in ('full_name', 'phone_number', 'updated_at'):
        setattr(profile, field, getattr(locked, field))


def publish_contact_refresh(cursor, source_id):
    """Strictly persist existing refresh events alongside the contact mutation.

    Fail closed if unqualified worker tables resolve elsewhere. The worker must
    be deployed against this same store; that remains an operational GO gate.
    """
    _verify_contact_store(cursor)
    scopes = contact_refresh_scopes(cursor, source_id)
    return _publish_contact_scopes(cursor, scopes, store_verified=True)


def _verify_contact_store(cursor):
    cursor.execute("SELECT to_regclass('platform_read_model_outbox')=to_regclass('public.platform_read_model_outbox'),"
                   "to_regclass('platform_read_models')=to_regclass('public.platform_read_models')")
    if cursor.fetchone() != (True, True):
        raise IdentityReconciliationError(code="cache_store_not_verified")


def _publish_contact_scopes(cursor, scopes, *, store_verified=False):
    if not store_verified:
        _verify_contact_store(cursor)
    from read_models.repository import invalidate_contact_projection
    for model, scope_type, scope_id in scopes:
        invalidate_contact_projection(cursor, model, scope_type, scope_id)
        cursor.execute('''INSERT INTO public.platform_read_model_outbox
            (id,event_type,model_key,scope_type,scope_id,payload,status,attempts,available_at,
             locked_at,locked_by,last_error,created_at,processed_at)
            VALUES (%s,%s,%s,%s,%s,'{"reason":"verified-contact-change"}'::jsonb,
                    'pending',0,now(),NULL,'','',now(),NULL)''',
                       [uuid4(), model + ".refresh_requested", model, scope_type, scope_id])
    return scopes


def contact_refresh_scopes(cursor, source_id):
    """Existing Home, Record Monitor and assigned-coach invalidation domains."""
    cursor.execute('''SELECT u."Learner_type",l.coach_email FROM enrolment."Created_users" u
        LEFT JOIN "Learner".learners l ON l.enrolment_id=u.id WHERE u.id=%s''', [source_id])
    rows = cursor.fetchall()
    if len(rows) != 1:
        raise IdentityReconciliationError(code="cache_identity_conflict")
    kind, coach = rows[0]
    # First-login treats a legacy blank kind as apprenticeship. Preserve that
    # source-only population; linked-profile validation remains stricter.
    kind = str(kind or "").strip().lower() or "apprenticeship"
    if kind not in {"commercial", "apprenticeship"}:
        raise IdentityReconciliationError(code="cache_identity_conflict")
    scopes = [("learner.home", "learner", f"{kind}:{source_id}"),
              ("record.monitor", "record-monitor", "global")]
    coach = str(coach or "").strip().lower()
    if coach:
        scopes.append(("coach.dashboard", "coach", coach))
    return scopes


def invalidate_contact_caches(scopes):
    """Post-commit best effort; durable refresh events are the recovery record."""
    from read_models.repository import invalidate_read_model_cache
    for model, scope_type, scope_id in scopes:
        if model == "coach.dashboard":
            from coach_api.dashboard_cache import invalidate_coach_dashboard_cache
            from coach_api.services.dashboard.service import CoachDashboardService
            version = CoachDashboardService.SCHEMA_VERSION
            invalidate_coach_dashboard_cache(scope_id)
        else:
            version = 1
        invalidate_read_model_cache(model, scope_type, scope_id, schema_version=version)


def sync_contacts_in_transaction(source_id, *, using):
    """Sync a fresh persisted source in the caller's transaction, or raise.

    A missing profile is a preserved pre-activation population, not a request to
    create/link one. Conflicts abort the source transaction. Pending cache events
    contain scope keys only, never names, phones or a stale contact snapshot.
    """
    from django.db import DatabaseError, connections, transaction
    connection = connections[using]
    if connection.vendor != "postgresql" or not connection.in_atomic_block:
        raise DatabaseError("Contact synchronization requires an owning PostgreSQL transaction.")
    _verify_worker_connection(connection)
    try:
        with connection.cursor() as cursor:
            cursor.execute('SELECT id,uuid FROM enrolment."Created_users" WHERE id=%s FOR UPDATE', [source_id])
            source = cursor.fetchone()
            if source is None:
                raise IdentityReconciliationError(code="missing_source")
            cursor.execute('SELECT id FROM "Learner".learners WHERE enrolment_id=%s ORDER BY id FOR UPDATE', [source_id])
            profiles = cursor.fetchall()
            if len(profiles) > 1:
                raise IdentityReconciliationError(code="ambiguous_profile")
            result = (_reconcile_locked(cursor, source_id, profiles[0][0], source[1], apply=True)
                      if profiles else ReconciliationResult("unlinked_preserved", ()))
            # Source may change while the already-correct profile is unchanged.
            scopes = publish_contact_refresh(cursor, source_id)
        transaction.on_commit(lambda: invalidate_contact_caches(scopes), using=using, robust=True)
        return result
    except IdentityReconciliationError as exc:
        raise DatabaseError(f"Contact synchronization refused: {exc.code}") from None


def _verify_worker_connection(connection):
    from django.db import DatabaseError, connections
    from read_models.apps import _database_identity
    worker = connections['default']
    if (_database_identity(connection.settings_dict) != _database_identity(worker.settings_dict)
            or connection.settings_dict.get('OPTIONS') != worker.settings_dict.get('OPTIONS')):
        raise DatabaseError('Contact synchronization worker database is not verified.')
