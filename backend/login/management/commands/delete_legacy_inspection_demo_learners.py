"""Delete the 9 retired cohort-style inspection/demo learner accounts.

    python manage.py delete_legacy_inspection_demo_learners
    python manage.py delete_legacy_inspection_demo_learners --commit

These 9 accounts were replaced by the 3 dedicated accounts created by
seed_inspection_demo_learners (learner-me@, learner-mm@, learner-pcp@ —
see frontend/src/lib/learnerFlowAccess.ts). They are synthetic
@learner.local test accounts created only for this demo/inspection work —
verified before writing this command: each one has exactly one training-plan
module snapshot, at most a handful of progress/KSB rows, and no evidence,
reflections, attendance, coaching or calendar data. Nothing here touches
curriculum data (curriculum.* is never queried or written by this command).

Removes, per account:
  - login."Login_sessions"                (no DB cascade from Login_accounts
                                            — deleted explicitly)
  - login."Login_accounts"
  - "Learner"."learner_ksb_assignments"    (deleted explicitly)
  - "Learner"."learner_progress_entries"   (deleting these cascades their own
                                            quiz_answers/chosen+correct
                                            answers and ksb links)
  - "Learner"."learner_training_plan_modules" (cascades its weeks/components)
  - "Learner"."learners"                   (deleted by raw SQL, not
                                            LearnerProfile.delete() — see note
                                            below)
  - enrolment."Created_users"

Note on "Learner"."learners": Django's ORM also declares a *legacy*
`assigned_ksbs` relation (LearnerKsb -> "Learner"."learner_ksbs") that this
environment's database does not have (superseded by
learner_ksb_assignments above, confirmed missing before writing this
command). Calling LearnerProfile.delete() makes Django's cascade collector
touch that relation regardless of whether it holds any rows, which fails
here. So every real child table is deleted explicitly above (via the ORM,
each still cascading its own further children), and the "Learner"."learners"
row itself is removed with a plain raw-SQL DELETE — never through
LearnerProfile.delete()/the ORM collector.

Deliberately leaves login."Login_audit" alone: it is an append-only,
denormalised authentication ledger with no FK to the account by design (see
login/models.py:LoginAudit) specifically so history survives account
deletion — removing those rows would go against that.

Dry-run by default; pass --commit to write.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction

from learner_api.models import (
    EnrolmentUser,
    LearnerKsbAssignment,
    LearnerProfile,
    LearnerProgressEntry,
    LearnerTrainingPlanModule,
)
from login.models import LoginAccount, LoginSession
from login.security import normalize_email

LEGACY_EMAILS = [
    "learner-me-l4-jul25@learner.local",
    "learner-me-l4-may25@learner.local",
    "learner-me-l4-feb26@learner.local",
    "learner-mm-l6-oct25@learner.local",
    "learner-mm-l6-feb26@learner.local",
    "learner-pcp-l6-may25@learner.local",
    "learner-pcp-l6-jul25@learner.local",
    "learner-pcp-l6-oct25@learner.local",
    "learner-pcp-l6-feb26@learner.local",
]

CONN = "enrolment"


class Command(BaseCommand):
    help = "Delete the 9 retired cohort-style inspection/demo learner accounts."

    def add_arguments(self, parser):
        parser.add_argument("--commit", action="store_true", help="Write changes. Default is dry-run.")

    def handle(self, *args, **options):
        dry_run = not options["commit"]
        try:
            with transaction.atomic(using=CONN):
                for email in LEGACY_EMAILS:
                    self._delete_one(email)

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run (pass --commit to write): rolling back, nothing deleted."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except CommandError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any DB failure clearly
            self.stderr.write(self.style.ERROR(f"Deletion failed (rolled back): {exc}"))
            raise

    def _delete_one(self, raw_email):
        email = normalize_email(raw_email)
        self.stdout.write(f"===== {email}")

        learner = EnrolmentUser.all_learners.filter(email__iexact=email).first()
        if learner is None:
            self.stdout.write("  no enrolment.Created_users row — nothing to do")
            return

        account = LoginAccount.objects.filter(subject_type="learner", subject_id=learner.id).first()
        if account is not None:
            account_id = account.id
            sessions_deleted, _ = LoginSession.objects.filter(account_id=account_id).delete()
            self.stdout.write(f"  deleted {sessions_deleted} Login_sessions row(s) for account id={account_id}")
            account.delete()
            self.stdout.write(f"  deleted Login_accounts id={account_id}")
        else:
            self.stdout.write("  no Login_accounts row")

        profile = LearnerProfile.objects.filter(enrolment_id=learner.id).first()
        if profile is None:
            profile = LearnerProfile.objects.filter(email__iexact=email).first()
        if profile is not None:
            profile_id = profile.id
            # Each deleted explicitly (see module docstring) instead of
            # profile.delete(), which would also touch the missing legacy
            # "Learner"."learner_ksbs" table via the assigned_ksbs relation.
            ksb_deleted, _ = LearnerKsbAssignment.objects.filter(learner_id=profile_id).delete()
            progress_deleted, _ = LearnerProgressEntry.objects.filter(learner_id=profile_id).delete()
            plan_deleted, _ = LearnerTrainingPlanModule.objects.filter(learner_id=profile_id).delete()
            self.stdout.write(
                f"  deleted {ksb_deleted} ksb-assignment, {progress_deleted} progress-entry-tree, "
                f"{plan_deleted} plan-module-tree row(s) for profile id={profile_id}"
            )
            with connections[CONN].cursor() as cur:
                cur.execute('delete from "Learner"."learners" where id = %s', [profile_id])
            self.stdout.write(f"  deleted Learner.learners id={profile_id}")
        else:
            self.stdout.write("  no Learner.learners profile")

        learner_id = learner.id
        learner.delete()
        self.stdout.write(f"  deleted Created_users id={learner_id}")
