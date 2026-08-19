"""Monthly journal sign-off for the Manual audit workspace.

Same JSON contract as the automatic workspace's signoff endpoint
(GET/POST ``learners/<learner_id>/signoff/?month=YYYY-MM``), but standalone:
signoffs are stored in ``"Manual_audit".monthly_audit_signoffs`` keyed by the
Aptem learner id, and the learner is validated against
``"Manual_audit".learners`` instead of the heavy learner_match payload chain.
Manual signoffs carry no snapshot hash, so they never go stale automatically.
"""

import json

from django.db import DatabaseError, connections
from django.views.decorators.csrf import csrf_exempt
from django.http import JsonResponse

from .common import CONN, _error, _has_audit_permission, db_is_read_only


PROGRAMME_KEY = "manual"
AUDIT_VERSION = "manual-audit-v1"


def _ensure_signoff_table(cur):
    if db_is_read_only(cur):
        return
    cur.execute(
        '''
        create table if not exists "Manual_audit".monthly_audit_signoffs (
            id bigserial primary key,
            learner_id text not null,
            programme_key text not null,
            report_month text not null,
            signer_role text not null check (signer_role in ('learner', 'coach')),
            signer_name text,
            review_confirmed boolean default false,
            signature_data text,
            signed_at timestamp with time zone,
            snapshot_hash text,
            audit_version text,
            created_at timestamp with time zone default now(),
            updated_at timestamp with time zone default now(),
            unique (learner_id, programme_key, report_month, signer_role)
        )
        '''
    )


def _signoff_row(row):
    if not row:
        return None
    (
        row_id, _learner_id, _programme_key, _report_month, signer_role,
        signer_name, review_confirmed, signature_data, signed_at,
        snapshot_hash, audit_version, created_at, updated_at,
    ) = row
    return {
        "id": row_id,
        "signer_role": signer_role,
        "signer_name": signer_name or "",
        "review_confirmed": bool(review_confirmed),
        "signature_data": signature_data or "",
        "signed_at": signed_at.isoformat() if signed_at else None,
        "snapshot_hash": snapshot_hash,
        "audit_version": audit_version,
        "created_at": created_at.isoformat() if created_at else None,
        "updated_at": updated_at.isoformat() if updated_at else None,
        "is_stale": False,
        "status_message": "",
    }


_SIGNOFF_COLUMNS = (
    "id, learner_id, programme_key, report_month, signer_role, signer_name, "
    "review_confirmed, signature_data, signed_at, snapshot_hash, audit_version, "
    "created_at, updated_at"
)


def _learner_exists(cur, learner_id):
    cur.execute(
        '''select 1 from "Manual_audit".learners where aptem_id::text = %s limit 1''',
        [str(learner_id)],
    )
    return bool(cur.fetchone())


def _text(value):
    return str(value).strip() if value is not None else ""


@csrf_exempt
def learner_signoff(request, learner_id):
    if not _has_audit_permission(request, write=request.method != "GET"):
        return _error("Authentication or audit permission is required.", 403)

    month_key = (request.GET.get("month") or "").strip() or "all"
    try:
        with connections[CONN].cursor() as cur:
            if not _learner_exists(cur, learner_id):
                return _error("Learner audit record was not found.", 404)
            _ensure_signoff_table(cur)

            if request.method == "GET":
                cur.execute(
                    f'''
                    select {_SIGNOFF_COLUMNS} from "Manual_audit".monthly_audit_signoffs
                    where learner_id = %s and programme_key = %s and report_month = %s
                    ''',
                    [str(learner_id), PROGRAMME_KEY, month_key],
                )
                signoffs = {"learner": None, "coach": None}
                for row in cur.fetchall():
                    signoffs[row[4]] = _signoff_row(row)
                return JsonResponse({"learnerId": str(learner_id), "month": month_key, "signoffs": signoffs})

            if request.method != "POST":
                return _error("Method not allowed.", 405)

            try:
                payload = json.loads(request.body.decode("utf-8") or "{}")
            except ValueError:
                return _error("Invalid JSON body.", 400)

            report_month = _text(payload.get("monthKey") or month_key or "all")
            roles = payload.get("roles") if isinstance(payload.get("roles"), dict) else {}
            if not roles:
                roles = {
                    "learner": {
                        "signerName": payload.get("learnerSignerName"),
                        "signature": payload.get("learnerSignature"),
                        "confirmed": payload.get("learnerConfirmed"),
                        "signedAt": payload.get("learnerSignedAt"),
                    },
                    "coach": {
                        "signerName": payload.get("coachSignerName"),
                        "signature": payload.get("coachSignature"),
                        "confirmed": payload.get("coachConfirmed"),
                        "signedAt": payload.get("coachSignedAt"),
                    },
                }

            for role in ("learner", "coach"):
                role_payload = roles.get(role) or {}
                cur.execute(
                    '''
                    insert into "Manual_audit".monthly_audit_signoffs (
                        learner_id, programme_key, report_month, signer_role, signer_name,
                        review_confirmed, signature_data, signed_at, snapshot_hash, audit_version, updated_at
                    )
                    values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, now())
                    on conflict (learner_id, programme_key, report_month, signer_role) do update set
                        signer_name = excluded.signer_name,
                        review_confirmed = excluded.review_confirmed,
                        signature_data = excluded.signature_data,
                        signed_at = excluded.signed_at,
                        snapshot_hash = excluded.snapshot_hash,
                        audit_version = excluded.audit_version,
                        updated_at = now()
                    ''',
                    [
                        str(learner_id),
                        PROGRAMME_KEY,
                        report_month,
                        role,
                        _text(role_payload.get("signerName")),
                        bool(role_payload.get("confirmed")),
                        _text(role_payload.get("signature")),
                        role_payload.get("signedAt") or None,
                        None,
                        AUDIT_VERSION,
                    ],
                )

            cur.execute(
                f'''
                select {_SIGNOFF_COLUMNS} from "Manual_audit".monthly_audit_signoffs
                where learner_id = %s and programme_key = %s and report_month = %s
                ''',
                [str(learner_id), PROGRAMME_KEY, report_month],
            )
            signoffs = {"learner": None, "coach": None}
            for row in cur.fetchall():
                signoffs[row[4]] = _signoff_row(row)
            return JsonResponse({"learnerId": str(learner_id), "month": report_month, "signoffs": signoffs})
    except KeyError:
        return _error("The enrolment database connection is not configured.", 500)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
