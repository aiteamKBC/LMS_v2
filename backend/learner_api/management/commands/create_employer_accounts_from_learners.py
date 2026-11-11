"""Create employer profiles and login accounts from the learners' employer email.

Each distinct ``enrolment."Created_users"."Employer_email"`` becomes one
``enrolment."Employers"`` row (or reuses the one already holding that address),
gets a login account, and every learner carrying that address is linked to it
through ``"Employer_id"``. When the learners name an organisation in
``"Orgnization"`` it is reused or created in ``enrolment."Organisations"`` and
set as the employer's group.

No invitation is written and no email is sent: the account is provisioned the
same way the employer form provisions it (``ensure_account``), and an
administrator sends the invitation from the Accounts page when they choose.

Never changes a learner's existing ``"Employer_id"`` or their ``Employer`` /
``Orgnization`` text. Anything ambiguous is skipped and counted under review.

    python manage.py create_employer_accounts_from_learners           # dry run
    python manage.py create_employer_accounts_from_learners --apply
"""

import json
from collections import defaultdict

from django.core.exceptions import ValidationError
from django.core.management.base import BaseCommand, CommandError
from django.core.validators import validate_email
from django.db import DatabaseError, connections, transaction

from curriculum_api.versioning import audit_context
from learner_api.models import Employer, EnrolmentUser, Organisation
from login.identity import AccountError, ensure_account
from login.models import LoginAccount

ALIAS = "enrolment"


def _text(value):
    return " ".join(str(value or "").split())


def _email(value):
    return _text(value).lower()


def split_name(full_name):
    """'Mary Ann Smith' -> ('Mary Ann', 'Smith'); one word stays a first name."""
    parts = _text(full_name).split(" ")
    if len(parts) < 2:
        return (parts[0] if parts and parts[0] else ""), ""
    return " ".join(parts[:-1]), parts[-1]


def _single(values):
    """The one distinct non-blank value (case-insensitive), '' if none, None if several."""
    seen = {}
    for value in values:
        text = _text(value)
        if text:
            seen.setdefault(text.lower(), text)
    if len(seen) > 1:
        return None
    return next(iter(seen.values()), "")


def plan_employers(learners, employers_by_email, accounts_by_email, orgs_by_name):
    """Pure planning step. Returns (plans, review Counter-like dict).

    learners: iterables of dicts with id, employer_email, employer, employer_phone,
        organization, employer_id.
    employers_by_email: {email: [employer ids]}
    accounts_by_email: {email: [(subject_type, subject_id, is_active)]}
    orgs_by_name: {lower name: [organisation ids]}
    """
    review = defaultdict(int)
    groups = defaultdict(list)
    for row in learners:
        email = _email(row["employer_email"])
        if not email:
            continue
        try:
            validate_email(email)
        except ValidationError:
            review["invalid_employer_email"] += 1
            continue
        groups[email].append(row)

    plans = []
    for email in sorted(groups):
        rows = groups[email]
        to_link = sorted(r["id"] for r in rows if r["employer_id"] is None)
        name = _single(r["employer"] for r in rows)
        phone = _single(r["employer_phone"] for r in rows)
        org = _single(r["organization"] for r in rows)
        existing = employers_by_email.get(email, [])
        if len(existing) > 1:
            review["several_employers_share_email"] += 1
            continue
        others = [a for a in accounts_by_email.get(email, [])
                  if not (a[0] == "employer" and existing and a[1] == existing[0])]
        if any(a[0] != "employer" and a[2] for a in others) or any(a[0] == "employer" for a in others):
            # ensure_account would hand back that person's account instead of
            # creating an employer login; a human has to decide.
            review["email_used_by_another_account"] += 1
            continue
        if not existing and name is None:
            review["learners_disagree_on_employer_name"] += 1
            continue
        if not existing and not name:
            review["employer_name_missing"] += 1
            continue
        if org is None:
            review["learners_disagree_on_organisation"] += 1
            org = ""
        org_ids = orgs_by_name.get(org.lower(), []) if org else []
        if len(org_ids) > 1:
            review["several_organisations_share_name"] += 1
            org, org_ids = "", []
        if phone is None:
            phone = ""
        plans.append({
            "email": email,
            "employer_id": existing[0] if existing else None,
            "name": name or "",
            "phone": phone,
            "organisation": org,
            "organisation_id": org_ids[0] if org_ids else None,
            "link_learner_ids": to_link,
        })
    return plans, dict(review)


class Command(BaseCommand):
    help = ("Create employer profiles + login accounts (no invitation) from learners' Employer_email "
            "and link those learners through Employer_id. Dry run unless --apply.")

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true")

    def _load(self, lock):
        # Employer_email / employer_phone are not mapped on EnrolmentUser.
        with connections[ALIAS].cursor() as cursor:
            cursor.execute(
                'SELECT id, "Employer_email", "Employer", employer_phone, "Orgnization", "Employer_id" '
                'FROM enrolment."Created_users" ORDER BY id' + (" FOR UPDATE" if lock else "")
            )
            learners = [dict(zip(("id", "employer_email", "employer", "employer_phone", "organization",
                                  "employer_id"), row)) for row in cursor.fetchall()]
        employers_by_email = defaultdict(list)
        for pk, email in Employer.objects.using(ALIAS).values_list("pk", "email"):
            if _email(email):
                employers_by_email[_email(email)].append(pk)
        accounts_by_email = defaultdict(list)
        for row in LoginAccount.objects.using(ALIAS).values_list("subject_type", "subject_id", "email", "is_active"):
            if _email(row[2]):
                accounts_by_email[_email(row[2])].append((row[0], row[1], row[3]))
        orgs_by_name = defaultdict(list)
        for pk, name in Organisation.objects.using(ALIAS).values_list("pk", "name"):
            if _text(name):
                orgs_by_name[_text(name).lower()].append(pk)
        return learners, employers_by_email, accounts_by_email, orgs_by_name

    def _apply(self, plans, counts):
        created_orgs = {}
        for plan in plans:
            org_id, org_name = plan["organisation_id"], plan["organisation"]
            if org_name and org_id is None:
                key = org_name.lower()
                if key not in created_orgs:
                    created_orgs[key] = Organisation.objects.using(ALIAS).create(
                        name=org_name, group_type="Employer").pk
                    counts["organisations_created"] += 1
                org_id = created_orgs[key]
            if plan["employer_id"] is None:
                first, surname = split_name(plan["name"])
                employer = Employer.objects.using(ALIAS).create(
                    first_name=first, surname=surname, email=plan["email"], mobile=plan["phone"] or None,
                    employer_group_ids=[org_id] if org_id else [],
                    employer_group_names=[org_name] if org_id else [],
                )
                counts["employers_created"] += 1
            else:
                employer = Employer.objects.using(ALIAS).get(pk=plan["employer_id"])
                counts["employers_reused"] += 1
            try:
                _account, created = ensure_account("employer", employer.pk, subject=employer)
            except AccountError:
                raise CommandError("An employer account could not be created; nothing was changed.") from None
            counts["accounts_created" if created else "accounts_existing"] += 1
            if plan["link_learner_ids"]:
                # employer_id__isnull guards against a link made since the read.
                counts["learners_linked"] += EnrolmentUser.all_learners.using(ALIAS).filter(
                    pk__in=plan["link_learner_ids"], employer_id__isnull=True,
                ).update(employer_id=employer.pk)

    def handle(self, *args, **options):
        apply = options["apply"]
        counts = defaultdict(int)
        try:
            with transaction.atomic(using=ALIAS):
                with audit_context(actor_type="job", source="import", action="update",
                                   reason="employer_accounts_from_learners"):
                    learners, employers, accounts, orgs = self._load(apply)
                    plans, review = plan_employers(learners, employers, accounts, orgs)
                    counts["employer_emails"] = len(plans)
                    counts["new_employers"] = sum(p["employer_id"] is None for p in plans)
                    counts["existing_employers"] = sum(p["employer_id"] is not None for p in plans)
                    counts["learners_to_link"] = sum(len(p["link_learner_ids"]) for p in plans)
                    counts["with_organisation"] = sum(bool(p["organisation"]) for p in plans)
                    counts["new_organisations"] = len({p["organisation"].lower() for p in plans
                                                       if p["organisation"] and p["organisation_id"] is None})
                    if apply:
                        self._apply(plans, counts)
        except DatabaseError:
            # Driver messages can contain hosts or personal data.
            raise CommandError("Employer account creation failed; changes rolled back.") from None
        self.stdout.write(json.dumps({"mode": "apply" if apply else "dry_run",
                                      "counts": dict(counts), "review": review}, sort_keys=True))
