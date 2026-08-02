"""Fan the wizard draft out into the per-step tables, and read it back.

The draft document (ExtendedIlr.wizard_draft) stays the source of truth for
"reopen exactly what was typed". These tables are the queryable projection of it,
so reporting doesn't have to dig through jsonb — see apply_enrolment_wizard_tables
for the rationale.

Writes are last-write-wins per learner and run inside the caller's transaction:
the projection is rebuilt from the incoming draft, so it can never disagree with
the document it came from. Child collections (KSBs, PLR records, policy acks) are
upserted by their natural key and rows absent from the payload are deleted, so
removing a PLR record in the UI removes it here too.
"""
import logging

from .models import (
    WizardCvJob,
    WizardKsbAssessment,
    WizardPersonalDetails,
    WizardPlr,
    WizardPlrRecord,
    WizardPolicyAck,
    WizardSkillsRadar,
)

logger = logging.getLogger(__name__)

# The 8-point self-assessment scale (see COMPETENCE_LEVELS in the frontend), plus
# the three legacy 5-point values so assessments saved before the scale was
# widened still round-trip instead of being silently dropped.
RAG_LEVELS = {
    "mastery",
    "expert",
    "proficient",
    "consistently",
    "frequently",
    "occasionally",
    "rarely",
    "never",
    # legacy
    "always",
    "often",
    "sometimes",
}

# Numeric score per level, so the DB can be queried/reported on without the
# client having to send it. Legacy values map onto the nearest new score.
LEVEL_SCORES = {
    "mastery": 8, "expert": 7, "proficient": 6, "consistently": 5,
    "frequently": 4, "occasionally": 3, "rarely": 2, "never": 1,
    "always": 8, "often": 5, "sometimes": 3,
}


def _s(value):
    """Trimmed string, or None for blank — keeps '' out of nullable text columns."""
    if value is None:
        return None
    text = str(value).strip()
    return text or None


def _date(value):
    """'YYYY-MM-DD' or None. Anything unparseable becomes None rather than raising:
    a malformed optional date must not fail the learner's whole save."""
    text = _s(value)
    if not text:
        return None
    # Django accepts an ISO string for a DateField; reject anything else early so
    # the error surfaces here rather than as a DB-level cast failure.
    parts = text.split("-")
    if len(parts) == 3 and all(p.isdigit() for p in parts):
        return text
    return None


def _int(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _dict(value):
    return value if isinstance(value, dict) else {}


def _list(value):
    return value if isinstance(value, list) else []


def project_draft(kind, learner_id, draft):
    """Write `draft` into the per-step tables for one learner.

    Absent sections are skipped, not cleared: a client that only sends
    personalDetails must not wipe the learner's PLR records.
    """
    draft = _dict(draft)
    scope = {"learner_kind": kind, "learner_id": learner_id}

    if "personalDetails" in draft:
        pd = _dict(draft["personalDetails"])
        sig = _s(pd.get("signature"))
        WizardPersonalDetails.objects.update_or_create(
            **scope,
            defaults={
                "first_name": _s(pd.get("firstName")),
                "last_name": _s(pd.get("lastName")),
                "email": _s(pd.get("email")),
                "phone": _s(pd.get("phone")),
                "address": _s(pd.get("address")),
                "date_of_birth": _date(pd.get("dob")),
                "age": _int(pd.get("age")),
                "sex": _s(pd.get("sex")),
                "signature": sig,
                # Stamp the signing date when one wasn't supplied but a signature was.
                "signature_date": _date(pd.get("signatureDate")),
            },
        )

    if "skillsRadar" in draft:
        sr = _dict(draft["skillsRadar"])
        WizardSkillsRadar.objects.update_or_create(
            **scope, defaults={"standard_id": _s(sr.get("standardId"))}
        )

        assessments = _dict(sr.get("assessments"))
        seen = []
        for ksb_id, raw in assessments.items():
            a = _dict(raw)
            plan = _dict(a.get("actionPlan"))
            level = _s(a.get("level"))
            if level and level.lower() not in RAG_LEVELS:
                level = None  # ignore an unknown RAG value rather than storing junk
            WizardKsbAssessment.objects.update_or_create(
                **scope,
                ksb_id=str(ksb_id),
                defaults={
                    "level": level.lower() if level else None,
                    "score": LEVEL_SCORES.get(level.lower()) if level else None,
                    "note": _s(a.get("note")),
                    "action_text": _s(plan.get("text")),
                    "action": _s(plan.get("action")),
                    "goal": _s(plan.get("goal")),
                    "due_date": _date(plan.get("dueDate")),
                    "evidence_files": _list(a.get("evidenceFiles")),
                },
            )
            seen.append(str(ksb_id))
        # Drop assessments the learner has since cleared.
        WizardKsbAssessment.objects.filter(**scope).exclude(ksb_id__in=seen).delete()

    if "plr" in draft:
        plr = _dict(draft["plr"])
        WizardPlr.objects.update_or_create(**scope, defaults={"uln": _s(plr.get("uln"))})

        seen = []
        for i, raw in enumerate(_list(plr.get("records"))):
            r = _dict(raw)
            # Fall back to the index so a record with no client id still gets a
            # stable key instead of colliding on ''.
            ref = _s(r.get("id")) or f"idx-{i}"
            WizardPlrRecord.objects.update_or_create(
                **scope,
                record_ref=ref,
                defaults={
                    "place_of_study": _s(r.get("placeOfStudy")),
                    "qualification_type": _s(r.get("qualificationType")),
                    "subject": _s(r.get("subject")),
                    "level": _s(r.get("level")),
                    "award_date": _date(r.get("awardDate")),
                    "credits": _int(r.get("credits")),
                    "grade": _s(r.get("grade")),
                    "record_type": _s(r.get("recordType")),
                },
            )
            seen.append(ref)
        WizardPlrRecord.objects.filter(**scope).exclude(record_ref__in=seen).delete()

    if "cvJob" in draft:
        cv = _dict(draft["cvJob"])
        WizardCvJob.objects.update_or_create(
            **scope,
            defaults={
                "cv_file": _s(cv.get("cvFile")),
                "experience_text": _s(cv.get("experienceText")),
                "pm_qualifications": _s(cv.get("pmQualifications")),
                "functional_skills_enrol": _s(cv.get("functionalSkillsEnrol")),
            },
        )

    if "policies" in draft:
        from django.utils import timezone

        acknowledged = _dict(_dict(draft["policies"]).get("acknowledged"))
        seen = []
        for policy_id, value in acknowledged.items():
            is_ack = bool(value)
            row, _created = WizardPolicyAck.objects.update_or_create(
                **scope, policy_id=str(policy_id), defaults={"acknowledged": is_ack}
            )
            # Only stamp the first time it flips to acknowledged, so re-saving the
            # wizard doesn't keep moving the acknowledgement date.
            if is_ack and row.acknowledged_at is None:
                row.acknowledged_at = timezone.now()
                row.save(update_fields=["acknowledged_at"])
            elif not is_ack and row.acknowledged_at is not None:
                row.acknowledged_at = None
                row.save(update_fields=["acknowledged_at"])
            seen.append(str(policy_id))
        WizardPolicyAck.objects.filter(**scope).exclude(policy_id__in=seen).delete()


def read_projection(kind, learner_id):
    """Rebuild the draft shape from the per-step tables.

    Used as a fallback for rows saved before the projection existed, and as the
    canonical read once these tables are the system of record.
    """
    scope = {"learner_kind": kind, "learner_id": learner_id}
    out = {}

    pd = WizardPersonalDetails.objects.filter(**scope).first()
    if pd:
        out["personalDetails"] = {
            "firstName": pd.first_name or "",
            "lastName": pd.last_name or "",
            "email": pd.email or "",
            "phone": pd.phone or "",
            "address": pd.address or "",
            "dob": str(pd.date_of_birth) if pd.date_of_birth else "",
            "age": pd.age,
            "sex": pd.sex or "",
            "signature": pd.signature or None,
            "signatureDate": str(pd.signature_date) if pd.signature_date else "",
        }

    sr = WizardSkillsRadar.objects.filter(**scope).first()
    ksbs = list(WizardKsbAssessment.objects.filter(**scope))
    if sr or ksbs:
        out["skillsRadar"] = {
            "standardId": (sr.standard_id if sr else "") or "",
            "assessments": {
                k.ksb_id: {
                    "ksbId": k.ksb_id,
                    "level": k.level,
                    "evidenceFiles": k.evidence_files or [],
                    "note": k.note or "",
                    "actionPlan": (
                        {
                            "text": k.action_text or "",
                            "action": k.action or "",
                            "goal": k.goal or "",
                            "dueDate": str(k.due_date) if k.due_date else "",
                        }
                        if (k.action_text or k.action or k.goal or k.due_date)
                        else None
                    ),
                }
                for k in ksbs
            },
        }

    plr = WizardPlr.objects.filter(**scope).first()
    records = list(WizardPlrRecord.objects.filter(**scope).order_by("id"))
    if plr or records:
        out["plr"] = {
            "uln": (plr.uln if plr else "") or "",
            "records": [
                {
                    "id": r.record_ref,
                    "placeOfStudy": r.place_of_study or "",
                    "qualificationType": r.qualification_type or "",
                    "subject": r.subject or "",
                    "level": r.level or "",
                    "awardDate": str(r.award_date) if r.award_date else "",
                    "credits": r.credits or 0,
                    "grade": r.grade or "",
                    "recordType": r.record_type or "",
                }
                for r in records
            ],
        }

    cv = WizardCvJob.objects.filter(**scope).first()
    if cv:
        out["cvJob"] = {
            "cvFile": cv.cv_file or "",
            "experienceText": cv.experience_text or "",
            "pmQualifications": cv.pm_qualifications or "",
            "functionalSkillsEnrol": cv.functional_skills_enrol or "",
        }

    acks = list(WizardPolicyAck.objects.filter(**scope))
    if acks:
        out["policies"] = {"acknowledged": {a.policy_id: a.acknowledged for a in acks}}

    return out
