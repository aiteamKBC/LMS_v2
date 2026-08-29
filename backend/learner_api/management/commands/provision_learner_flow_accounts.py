"""Provision post-enrolment learner accounts for the nine legacy cohorts.

The legacy snapshots in ``programme_audit`` are content sources, not learner
records.  Their seven distinct courses have already been imported into the
normalised curriculum as modules.  This command puts those modules under the
three real programmes they belong to, creates one cohort/group for each of the
nine delivery variants, and creates an Active learner with an empty progress
ledger for each variant.

No completion, elapsed time, OTJH, quiz attempt, evidence, or activity event is
seeded.  Those records must be produced through the learner UI so the resulting
trail exercises the same path an ordinary learner uses.

The command is idempotent and dry-run by default::

    python manage.py provision_learner_flow_accounts
    python manage.py provision_learner_flow_accounts --apply

An apply creates/resets one shared strong password and prints it once.  To
provide a controlled password without exposing it in the process list, put it
in an environment variable and pass ``--password-env VARIABLE_NAME``.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from dataclasses import dataclass
from datetime import date

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction
from django.utils import timezone

from learner_api.active_users import sync_active_user
from learner_api.models import EnrolmentUser, LearnerProfile
from curriculum_api.management.commands.import_mba_curriculum import (
    ALL_FILE_KINDS,
    attachment_of_kinds,
    component_type_for,
    legacy_rows,
    upload_settings,
)
from login.identity import ensure_account
from login.security import (
    PasswordPolicyError,
    hash_password,
    normalize_email,
    validate_password_strength,
)
from login.sessions import revoke_all_for_account


CONN = "enrolment"
DEFAULT_EMAIL_DOMAIN = "learner.local"
SOURCE_PROGRAMME_ID = "PROG-20260824104138483006"
FLOW_MARKER = "learner-flow-verification"
LEGACY_COURSE_IDS = (59611, 101477, 103722, 60702, 122798, 102420, 65983)
AZURE_ATTACHMENT_RE = re.compile(r"/_legacy_files/([^/]+)/")
PRIMARY_ATTACHMENT_KINDS = {
    "video": {"video"},
    "podcast": {"audio"},
    "powerpoint": {"slides"},
    "assignment": set(ALL_FILE_KINDS),
    "reading": {"pdf", "word", "excel", "file", "slides"},
}
RESOURCE_SETTING_KEYS = {
    "video": "videoUrl",
    "podcast": "podcastUrl",
    "powerpoint": "presentationUrl",
    "assignment": "assignmentFileUrl",
    "reading": "resourceUrl",
}


@dataclass(frozen=True)
class ProgrammeSpec:
    programme_id: str
    name: str
    level: str
    colour: str


@dataclass(frozen=True)
class LearnerSpec:
    username: str
    programme_id: str
    cohort_id: str
    cohort_name: str
    group_id: str
    group_name: str
    module_id: str
    module_title: str
    start_date: date
    end_date: date


PROGRAMMES = {
    "PROG-ME-L4": ProgrammeSpec(
        "PROG-ME-L4", "Marketing Executive Level 4", "Level 4", "#2563eb"
    ),
    "PROG-MM-L6": ProgrammeSpec(
        "PROG-MM-L6", "Marketing Manager Level 6", "Level 6", "#7c3aed"
    ),
    "PROG-PCP-L6": ProgrammeSpec(
        "PROG-PCP-L6", "Project Controls Professional Level 6", "Level 6", "#0f766e"
    ),
}


LEARNERS = (
    LearnerSpec(
        "learner-me-l4-jul25", "PROG-ME-L4", "COHORT-ME-L4-JUL25",
        "July 2025", "GROUP-ME-L4-JUL25", "Marketing Executive L4 - July 2025",
        "MOD-202608226D7F30544E6E",
        "Marketing Impact and Planning (Marketing Executive Apprenticeship) - May 2025",
        date(2025, 7, 1), date(2026, 12, 31),
    ),
    LearnerSpec(
        "learner-me-l4-may25", "PROG-ME-L4", "COHORT-ME-L4-MAY25",
        "May 2025", "GROUP-ME-L4-MAY25", "Marketing Executive L4 - May 2025",
        "MOD-20260822845BE588961A", "Marketing Executive L4 : KSBs",
        date(2025, 5, 1), date(2026, 10, 31),
    ),
    LearnerSpec(
        "learner-pcp-l6-oct25", "PROG-PCP-L6", "COHORT-PCP-L6-OCT25",
        "October 2025", "GROUP-PCP-L6-OCT25", "Project Controls L6 - October 2025",
        "MOD-2026082229B41B80266C", "Project Controls  Professional  L6 : KSBs",
        date(2025, 10, 1), date(2027, 9, 30),
    ),
    LearnerSpec(
        "learner-pcp-l6-may25", "PROG-PCP-L6", "COHORT-PCP-L6-MAY25",
        "May 2025", "GROUP-PCP-L6-MAY25", "Project Controls L6 - May 2025",
        "MOD-20260822F5205A5A253A",
        "Ray  - Project Management Professional (Apprenticeship) - PCP",
        date(2025, 5, 1), date(2027, 4, 30),
    ),
    LearnerSpec(
        "learner-me-l4-feb26", "PROG-ME-L4", "COHORT-ME-L4-FEB26",
        "February 2026", "GROUP-ME-L4-FEB26", "Marketing Executive L4 - February 2026",
        "MOD-20260822E551CE7C7FCE", "Marketing Executive Level 4 MCT Prep.",
        date(2026, 2, 1), date(2027, 7, 31),
    ),
    LearnerSpec(
        "learner-mm-l6-feb26", "PROG-MM-L6", "COHORT-MM-L6-FEB26",
        "February 2026", "GROUP-MM-L6-FEB26", "Marketing Manager L6 - February 2026",
        "MOD-20260822DE3E29E1444E", "Marketing Manager Level 6-KSBs",
        date(2026, 2, 1), date(2028, 1, 31),
    ),
    LearnerSpec(
        "learner-mm-l6-oct25", "PROG-MM-L6", "COHORT-MM-L6-OCT25",
        "October 2025", "GROUP-MM-L6-OCT25", "Marketing Manager L6 - October 2025",
        "MOD-20260822DE3E29E1444E", "Marketing Manager Level 6-KSBs",
        date(2025, 10, 1), date(2027, 9, 30),
    ),
    LearnerSpec(
        "learner-pcp-l6-jul25", "PROG-PCP-L6", "COHORT-PCP-L6-JUL25",
        "July 2025", "GROUP-PCP-L6-JUL25", "Project Controls L6 - July 2025",
        "MOD-20260822403EEDFCFC64",
        "Ray - Project Management Professional (Apprenticeship) - PCP-July",
        date(2025, 7, 1), date(2027, 6, 30),
    ),
    LearnerSpec(
        "learner-pcp-l6-feb26", "PROG-PCP-L6", "COHORT-PCP-L6-FEB26",
        "February 2026", "GROUP-PCP-L6-FEB26", "Project Controls L6 - February 2026",
        "MOD-2026082229B41B80266C", "Project Controls  Professional  L6 : KSBs",
        date(2026, 2, 1), date(2028, 1, 31),
    ),
)


class Command(BaseCommand):
    help = "Provision the nine post-enrolment learner-flow accounts (dry-run by default)."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply", action="store_true", help="Commit the curriculum and account changes."
        )
        parser.add_argument(
            "--email-domain",
            default=DEFAULT_EMAIL_DOMAIN,
            help=f"Domain for learner sign-in addresses (default: {DEFAULT_EMAIL_DOMAIN}).",
        )
        parser.add_argument(
            "--password-env",
            default="",
            help="Read the shared password from this environment variable.",
        )

    def handle(self, *args, **options):
        apply = bool(options["apply"])
        domain = str(options["email_domain"] or "").strip().lower().lstrip("@")
        if not domain or "." not in domain or any(char.isspace() for char in domain):
            raise CommandError(f"Invalid email domain: {domain!r}")

        self._preflight(domain)

        if not apply:
            results = self._dry_run_results(domain)
            self._write_summary(results, domain=domain, password="", apply=False)
            return

        password = self._password(options.get("password_env") or "")
        # Django's password hasher is intentionally expensive.  All nine
        # temporary accounts share this controlled credential, so calculate its
        # salted hash once rather than repeating the same expensive operation.
        password_hash = hash_password(password)

        try:
            with transaction.atomic(using=CONN):
                with connections[CONN].cursor() as cursor:
                    self._upsert_curriculum(cursor)

                results = []
                for spec in LEARNERS:
                    results.append(self._upsert_learner(spec, domain, password_hash))
        except CommandError:
            raise
        except Exception as exc:  # noqa: BLE001 - management command boundary
            raise CommandError(f"Provisioning failed and was rolled back: {exc}") from exc

        self._write_summary(results, domain=domain, password=password, apply=True)

    def _write_summary(self, results, *, domain, password, apply):
        mode = "COMMITTED" if apply else "DRY RUN - no changes written"
        self.stdout.write(self.style.SUCCESS(f"{mode}: 3 programmes, 9 cohorts/groups, 9 learners"))
        self.stdout.write(
            f"  Azure curriculum links: {getattr(self, 'azure_component_mapped', 0)} mapped, "
            f"{getattr(self, 'azure_component_changes', 0)} "
            f"{'updated' if apply else 'would change'}"
        )
        for result in results:
            self.stdout.write(
                f"  {result['username']:<28} {result['email']:<48} "
                f"learner={result['learner_id']} progress={result['progress_count']}"
            )

        if apply:
            self.stdout.write("")
            self.stdout.write(self.style.SUCCESS("===== LEARNER FLOW SIGN-IN ====="))
            self.stdout.write(f"  email domain: {domain}")
            self.stdout.write(f"  password:     {password}")
            self.stdout.write("  progress:     0% (no learning events seeded)")
            self.stdout.write(
                self.style.WARNING(
                    "  Keep this credential controlled and rotate or disable it after the review."
                )
            )

    def _dry_run_results(self, domain):
        results = []
        for spec in LEARNERS:
            email = normalize_email(f"{spec.username}@{domain}")
            source = (
                EnrolmentUser.all_learners.using(CONN)
                .extra(where=['lower(btrim("Email")) = %s'], params=[email])
                .first()
            )
            profile = None
            if source is not None:
                profile = (
                    LearnerProfile.objects.using(CONN)
                    .filter(enrolment_id=source.id)
                    .first()
                )
            results.append({
                "username": spec.username,
                "email": email,
                "learner_id": profile.id if profile else "new",
                "progress_count": profile.progress_entries.count() if profile else 0,
            })
        return results

    def _password(self, variable_name):
        if variable_name:
            password = os.environ.get(variable_name, "")
            if not password:
                raise CommandError(
                    f"Environment variable {variable_name!r} is empty or is not set."
                )
        else:
            # The fixed prefix guarantees a mix of character classes while the
            # token supplies enough entropy for a temporary shared credential.
            password = f"Flow-7!{secrets.token_urlsafe(18)}"
        try:
            validate_password_strength(password)
        except PasswordPolicyError as exc:
            raise CommandError(f"The supplied password does not meet policy: {exc}") from exc
        return password

    def _preflight(self, domain):
        """Refuse ambiguous ownership before making the first write."""
        wanted_modules = {spec.module_id: spec for spec in LEARNERS}
        with connections[CONN].cursor() as cursor:
            cursor.execute(
                """
                SELECT module_catalogue_id, title, COALESCE(programme_id, '')
                FROM curriculum.modules
                WHERE module_catalogue_id = ANY(%s)
                """,
                [list(wanted_modules)],
            )
            rows = {row[0]: row for row in cursor.fetchall()}
            missing = sorted(set(wanted_modules) - set(rows))
            if missing:
                raise CommandError(f"Missing curriculum modules: {', '.join(missing)}")
            for module_id, (_, title, programme_id) in rows.items():
                spec = wanted_modules[module_id]
                if str(title or "").strip() != spec.module_title:
                    raise CommandError(
                        f"Module {module_id} title changed: {title!r}; expected {spec.module_title!r}."
                    )
                allowed_programmes = {SOURCE_PROGRAMME_ID, spec.programme_id}
                if programme_id not in allowed_programmes:
                    raise CommandError(
                        f"Module {module_id} belongs to {programme_id!r}, not a managed programme."
                    )

            cursor.execute(
                """
                SELECT qcl.quiz_id
                FROM curriculum.quiz_course_links qcl
                WHERE qcl.quiz_id IN (
                    SELECT quiz_id FROM curriculum.quiz_course_links
                    WHERE module_catalogue_id = ANY(%s)
                )
                GROUP BY qcl.quiz_id
                HAVING count(DISTINCT qcl.module_catalogue_id) > 1
                LIMIT 1
                """,
                [list(wanted_modules)],
            )
            shared_quiz = cursor.fetchone()
            if shared_quiz:
                raise CommandError(
                    f"Quiz {shared_quiz[0]} is shared across modules; refusing to reclassify it."
                )

        emails = [normalize_email(f"{spec.username}@{domain}") for spec in LEARNERS]
        for spec, email in zip(LEARNERS, emails):
            existing = (
                EnrolmentUser.all_learners.using(CONN)
                .extra(where=['lower(btrim("Email")) = %s'], params=[email])
                .first()
            )
            if existing and str(existing.reference_number or "").strip() != FLOW_MARKER:
                raise CommandError(
                    f"Email {email} belongs to learner id={existing.id} outside this provisioning set."
                )
            name_clash = (
                EnrolmentUser.all_learners.using(CONN)
                .filter(username=spec.username)
                .exclude(email__iexact=email)
                .first()
            )
            if name_clash:
                raise CommandError(
                    f"Username {spec.username} belongs to learner id={name_clash.id} with another email."
                )

        self._prepare_azure_component_repoints()

    def _prepare_azure_component_repoints(self):
        """Map legacy attachment ids to the stable same-origin Azure routes.

        The programme-audit rows and normalised learner components were created
        by different imports, so their component ids intentionally do not
        match.  The WordPress attachment id is the stable common key.
        """
        with connections[CONN].cursor() as cursor:
            cursor.execute(
                """
                SELECT source_url
                FROM programme_audit.assets
                WHERE programme_source_id = ANY(%s)
                  AND source_url LIKE '/curriculum_api/curriculum/uploads/_legacy_files/%%'
                """,
                [[str(value) for value in LEGACY_COURSE_IDS]],
            )
            azure_by_attachment = {}
            for (url,) in cursor.fetchall():
                match = AZURE_ATTACHMENT_RE.search(str(url or ""))
                if match:
                    azure_by_attachment[match.group(1)] = str(url)

        materials = []
        for row in legacy_rows(LEGACY_COURSE_IDS):
            for section in row.get("curriculum", {}).get("sections") or []:
                materials.extend(section.get("materials") or [])

        component_ids = [
            str(material.get("component_id") or "").strip()
            for material in materials
            if str(material.get("component_id") or "").strip()
        ]
        with connections[CONN].cursor() as cursor:
            cursor.execute(
                "SELECT id, settings_json FROM curriculum.components WHERE id = ANY(%s)",
                [component_ids],
            )
            current_settings = {row[0]: row[1] for row in cursor.fetchall()}

        repoints = []
        mapped = 0
        for material in materials:
            component_id = str(material.get("component_id") or "").strip()
            component_type = component_type_for(material)
            setting_key = RESOURCE_SETTING_KEYS.get(component_type)
            kinds = PRIMARY_ATTACHMENT_KINDS.get(component_type)
            if not component_id or not setting_key or not kinds:
                continue
            attachment = attachment_of_kinds(material, kinds)
            attachment_id = str((attachment or {}).get("attachment_id") or "").strip()
            azure_url = azure_by_attachment.get(attachment_id)
            if not attachment or not azure_url:
                continue
            mapped += 1
            settings = current_settings.get(component_id) or {}
            if isinstance(settings, str):
                try:
                    settings = json.loads(settings)
                except ValueError:
                    settings = {}
            settings = dict(settings) if isinstance(settings, dict) else {}
            next_settings = {
                **settings,
                setting_key: azure_url,
                **upload_settings(attachment, azure_url),
            }
            if next_settings != settings:
                repoints.append((component_id, next_settings))

        self.azure_component_mapped = mapped
        self.azure_component_changes = len(repoints)
        self._azure_component_repoints = repoints

    def _upsert_curriculum(self, cursor):
        now = timezone.now()
        programme_module_ids = {programme_id: [] for programme_id in PROGRAMMES}
        for spec in LEARNERS:
            if spec.module_id not in programme_module_ids[spec.programme_id]:
                programme_module_ids[spec.programme_id].append(spec.module_id)

        for programme in PROGRAMMES.values():
            cursor.execute(
                """
                INSERT INTO curriculum.programmes
                    (programme_id, name, color, created_at, updated_at, is_archived,
                     level, description, standard, owner, created_by, is_active,
                     structure_type, status)
                VALUES (%s, %s, %s, %s, %s, false, %s, %s, %s, %s, %s, true,
                        'scheduled', 'active')
                ON CONFLICT (programme_id) DO UPDATE SET
                    name = EXCLUDED.name,
                    color = EXCLUDED.color,
                    updated_at = EXCLUDED.updated_at,
                    is_archived = false,
                    level = EXCLUDED.level,
                    description = EXCLUDED.description,
                    standard = EXCLUDED.standard,
                    owner = EXCLUDED.owner,
                    created_by = EXCLUDED.created_by,
                    is_active = true,
                    deleted_at = NULL,
                    deleted_by = NULL,
                    deleted_via_parent = NULL,
                    structure_type = 'scheduled',
                    status = 'active'
                """,
                [
                    programme.programme_id,
                    programme.name,
                    programme.colour,
                    now,
                    now,
                    programme.level,
                    "Post-enrolment learner flow verification.",
                    programme.name,
                    "Curriculum Team",
                    "Curriculum Team",
                ],
            )

        # Re-point only the normalised components whose legacy attachment id has
        # an already-verified Azure path in programme_audit.  External YouTube,
        # Google Drive and Spotify URLs are left as authored.
        cursor.executemany(
            """
            UPDATE curriculum.components
            SET settings_json = %s::jsonb, updated_at = %s
            WHERE id = %s
            """,
            [
                [json.dumps(settings), now, component_id]
                for component_id, settings in getattr(self, "_azure_component_repoints", [])
            ],
        )

        # Keep stable module/component/quiz ids.  Moving rather than cloning is
        # what preserves all 392 existing quiz links and their question banks.
        for programme_id, module_ids in programme_module_ids.items():
            programme = PROGRAMMES[programme_id]
            cursor.execute(
                """
                UPDATE curriculum.modules
                SET programme_id = %s, programme_name = %s,
                    is_programme_deleted = false, deleted_at = NULL,
                    deleted_by = NULL, deleted_via_parent = NULL, updated_at = %s
                WHERE module_catalogue_id = ANY(%s)
                """,
                [programme_id, programme.name, now, module_ids],
            )
            cursor.execute(
                """
                UPDATE curriculum.quizzes q
                SET programme_id = %s, programme = %s, updated_at = %s
                WHERE q.id IN (
                    SELECT quiz_id FROM curriculum.quiz_course_links
                    WHERE module_catalogue_id = ANY(%s)
                )
                """,
                [programme_id, programme.name, now, module_ids],
            )

        for spec in LEARNERS:
            programme = PROGRAMMES[spec.programme_id]
            module_ids = json.dumps([spec.module_id])
            module_names = json.dumps([spec.module_title])
            group_ids = json.dumps([spec.group_id])
            cursor.execute(
                """
                INSERT INTO curriculum.cohorts
                    (cohort_id, cohort_name, programme_id, programme_name,
                     start_date, end_date, duration_months, color, status,
                     training_plan_ids, group_ids, module_names, holiday_ids,
                     source_type, source_id, created_at, updated_at,
                     is_programme_deleted, epa_months, apprenticeship_end_date)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, 'active',
                        %s::jsonb, %s::jsonb, %s::jsonb, '[]'::jsonb,
                        %s, %s, %s, %s, false, 6, (%s::date + interval '6 months')::date)
                ON CONFLICT (cohort_id) DO UPDATE SET
                    cohort_name = EXCLUDED.cohort_name,
                    programme_id = EXCLUDED.programme_id,
                    programme_name = EXCLUDED.programme_name,
                    start_date = EXCLUDED.start_date,
                    end_date = EXCLUDED.end_date,
                    duration_months = EXCLUDED.duration_months,
                    color = EXCLUDED.color,
                    status = 'active',
                    training_plan_ids = EXCLUDED.training_plan_ids,
                    group_ids = EXCLUDED.group_ids,
                    module_names = EXCLUDED.module_names,
                    holiday_ids = EXCLUDED.holiday_ids,
                    source_type = EXCLUDED.source_type,
                    source_id = EXCLUDED.source_id,
                    updated_at = EXCLUDED.updated_at,
                    is_programme_deleted = false,
                    deleted_at = NULL,
                    deleted_by = NULL,
                    deleted_via_parent = NULL,
                    epa_months = EXCLUDED.epa_months,
                    apprenticeship_end_date = EXCLUDED.apprenticeship_end_date
                """,
                [
                    spec.cohort_id,
                    spec.cohort_name,
                    spec.programme_id,
                    programme.name,
                    spec.start_date,
                    spec.end_date,
                    self._months_between(spec.start_date, spec.end_date),
                    programme.colour,
                    module_ids,
                    group_ids,
                    module_names,
                    FLOW_MARKER,
                    spec.cohort_id,
                    now,
                    now,
                    spec.end_date,
                ],
            )
            cursor.execute(
                """
                INSERT INTO curriculum.groups
                    (group_id, group_name, cohort_id, cohort_name, programme_id,
                     programme_name, module_ids, module_names, notes, created_at,
                     updated_at, color, is_programme_deleted)
                VALUES (%s, %s, %s, %s, %s, %s, %s::jsonb, %s::jsonb, %s,
                        %s, %s, %s, false)
                ON CONFLICT (group_id) DO UPDATE SET
                    group_name = EXCLUDED.group_name,
                    cohort_id = EXCLUDED.cohort_id,
                    cohort_name = EXCLUDED.cohort_name,
                    programme_id = EXCLUDED.programme_id,
                    programme_name = EXCLUDED.programme_name,
                    module_ids = EXCLUDED.module_ids,
                    module_names = EXCLUDED.module_names,
                    notes = EXCLUDED.notes,
                    updated_at = EXCLUDED.updated_at,
                    color = EXCLUDED.color,
                    is_programme_deleted = false,
                    deleted_at = NULL,
                    deleted_by = NULL,
                    deleted_via_parent = NULL
                """,
                [
                    spec.group_id,
                    spec.group_name,
                    spec.cohort_id,
                    spec.cohort_name,
                    spec.programme_id,
                    programme.name,
                    module_ids,
                    module_names,
                    FLOW_MARKER,
                    now,
                    now,
                    programme.colour,
                ],
            )

    def _upsert_learner(self, spec, domain, password_hash):
        programme = PROGRAMMES[spec.programme_id]
        email = normalize_email(f"{spec.username}@{domain}")
        plan = [{"moduleId": spec.module_id, "moduleTitle": spec.module_title}]
        learner = (
            EnrolmentUser.all_learners.using(CONN)
            .extra(where=['lower(btrim("Email")) = %s'], params=[email])
            .first()
        )
        values = {
            "username": spec.username,
            "email": email,
            "status": "FullUser",
            "type": "User",
            "learner_type": "apprenticeship",
            "programme_status": "Active",
            "programme": programme.name,
            "cohort": spec.cohort_name,
            "group": spec.group_name,
            "start_date": spec.start_date.isoformat(),
            "end_date": spec.end_date.isoformat(),
            "practical_period_end_date": spec.end_date.isoformat(),
            "onboarding_status": "Completed",
            "onboarding_completed": "Yes",
            "learning_plan": plan,
            "invite_to_platform": False,
            "reference_number": FLOW_MARKER,
        }
        if learner is None:
            learner = EnrolmentUser.all_learners.using(CONN).create(**values)
            if not learner.enrolled_time_and_user:
                learner.enrolled_time_and_user = (
                    f"{timezone.now().strftime('%d/%m/%Y %H:%M:%S')} by learner flow provisioning"
                )
                learner.save(update_fields=["enrolled_time_and_user"])
        else:
            for field, value in values.items():
                setattr(learner, field, value)
            learner.save(update_fields=list(values))

        profile = sync_active_user(learner)
        if profile is None:
            raise CommandError(f"Could not activate learner {spec.username}.")

        account, _created = ensure_account("learner", learner.id, subject=learner)
        account.password_hash = password_hash
        account.password_set_at = timezone.now()
        account.is_active = True
        account.failed_attempts = 0
        account.locked_until = None
        account.save(
            update_fields=[
                "password_hash",
                "password_set_at",
                "is_active",
                "failed_attempts",
                "locked_until",
                "updated_at",
            ]
        )
        revoke_all_for_account(account)

        profile = LearnerProfile.objects.using(CONN).get(pk=profile.pk)
        if profile.programme_id != spec.programme_id:
            raise CommandError(
                f"Learner {spec.username} resolved to programme_id={profile.programme_id!r}, "
                f"expected {spec.programme_id!r}."
            )
        progress_count = profile.progress_entries.count()
        return {
            "username": spec.username,
            "email": email,
            "learner_id": profile.id,
            "progress_count": progress_count,
        }

    @staticmethod
    def _months_between(start, end):
        return max(1, (end.year - start.year) * 12 + end.month - start.month + 1)
