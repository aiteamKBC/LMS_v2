"""Create (or reset) the 3 inspection-demo learner accounts.

    python manage.py seed_inspection_demo_learners
    python manage.py seed_inspection_demo_learners --password 's3cret' --commit
    python manage.py seed_inspection_demo_learners --commit

Replaces the earlier 9 cohort-style demo accounts
(learner-me-l4-jul25@learner.local and friends — see
frontend/src/lib/learnerFlowAccess.ts) with exactly 3 dedicated accounts, one
per programme:

    learner-me@learner.local   -> Marketing Executive
    learner-mm@learner.local   -> Marketing Manager
    learner-pcp@learner.local  -> Project Controls Professional

Each account is a normal enrolment."Created_users" (apprenticeship) row, made
Active immediately (skipping the compliance-document pipeline a real
apprentice goes through — these accounts exist to demo the finished
experience, not to exercise enrolment). Its training plan carries only the
authored module ids chosen for that programme's materials — see
frontend/src/lib/demoProgrammeMaterials.ts, which must be kept in sync with
the MODULE_IDS_BY_EMAIL below. The learner-detail pipeline
(learner_api/learner_detail.py:_resolve_from_master) rebuilds each module's
weeks/components live from the master curriculum tables on every load, so no
curriculum content is copied or duplicated here — only module ids are stored.

Idempotent, like seed_demo_admin: re-running finds the existing row by email,
refreshes its training plan/programme fields, and resets the password.

Dry-run by default; pass --commit to write.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from learner_api.active_users import sync_active_user
from learner_api.models import EnrolmentUser
from login.identity import ensure_account
from login.security import hash_password, normalize_email
from login.sessions import revoke_all_for_account

DEFAULT_PASSWORD = "Inspection123!"

# Kept in sync by hand with frontend/src/lib/demoProgrammeMaterials.ts.
# Each module id is the authored curriculum module (curriculum.modules /
# ModuleAuthoringModule.module_catalogue_id) chosen for that material — see
# the ranking used to pick them (most authored weeks/components) in the PR
# that introduced this command.
DEMO_LEARNERS = [
    {
        "email": "learner-me@learner.local",
        "username": "ME Inspection Demo",
        "programme": "Marketing Executive",
        "module_ids": [
            ("MOD-202608228DDFCB53074A", "Crispin- Marketing Impact and Planning Integrated Campaigns"),   # Impact Planning
            ("MOD-2026082243BD5ED0A8EA", "DR.Samar- Social Media"),                                         # Social Media
            ("MOD-2026082273BF1B44335F", "Femi-Marketing Technology (MarTech)"),                            # Marketing Technology
        ],
    },
    {
        "email": "learner-mm@learner.local",
        "username": "MM Inspection Demo",
        "programme": "Marketing Manager",
        "module_ids": [
            ("MOD-202608223E23693425BC", "G1-Keith-Strategy&Planning"),                                     # Strategy Planning
            ("MOD-20260822222D7B9190AA", "G1-Femi-Customer Journey"),                                        # Customer Journey
            ("MOD-20260822BFA56444DE10", "Commercial Intelligence - Marketing Manager"),                    # Commercial Intelligence
            ("MOD-AI-IN-MARKETING-MM", "AI in Marketing"),                                                    # AI in Marketing
        ],
    },
    {
        "email": "learner-pcp@learner.local",
        "username": "PCP Inspection Demo",
        "programme": "Project Controls Professional",
        "module_ids": [
            ("MOD-2026082245779A87FE0C", "Dr.Amgad – Project Management Professional (Apprenticeship) – Oct2025"),  # Project Management Professional
            ("MOD-20260822B2177D2C4599", "Andrew - PMI - SP (Scheduling Professional)"),                    # MSP / Scheduling Professional (1/2)
            ("MOD-202608223894BBCBCF5F", "Ray - MSP - Managing Successful Programmes"),                     # MSP / Scheduling Professional (2/2)
            ("MOD-202608227739EC14E0CC", "Andrew-Risk management"),                                         # Risk Management
            ("MOD-202608226F0A69EDAD30", "Steve-Earned Value Management(EVM)2026"),                         # EVM / Portfolio Management (1/2)
            ("MOD-20260822007072C8A616", "Stephen-Portfolio Management 2026"),                              # EVM / Portfolio Management (2/2)
            ("MOD-2026082281333774FD28", "Ray -Project Management Office (PMO)"),                           # PPC / PMO (1/2)
            ("MOD-20260822C8C4CF8F9D6F", "Andrew-Project Planning & Control(PPC)"),                         # PPC / PMO (2/2)
        ],
    },
]

CONN = "enrolment"


class Command(BaseCommand):
    help = "Create or reset the 3 inspection-demo learner accounts (ME/MM/PCP)."

    def add_arguments(self, parser):
        parser.add_argument("--password", default=DEFAULT_PASSWORD)
        parser.add_argument("--commit", action="store_true", help="Write changes. Default is dry-run.")

    def handle(self, *args, **options):
        password = options["password"]
        dry_run = not options["commit"]

        try:
            with transaction.atomic(using=CONN):
                for spec in DEMO_LEARNERS:
                    self._seed_one(spec, password)

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run (pass --commit to write): rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except CommandError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any DB failure clearly
            self.stderr.write(self.style.ERROR(f"Seeding failed (rolled back): {exc}"))
            raise

    def _seed_one(self, spec, password):
        email = normalize_email(spec["email"])
        learning_plan = [
            {"moduleId": module_id, "moduleTitle": title, "weeks": []}
            for module_id, title in spec["module_ids"]
        ]

        learner = EnrolmentUser.all_learners.filter(email__iexact=email).first()
        if learner is None:
            learner = EnrolmentUser(email=email)
            self.stdout.write(f"Creating learner {email!r}")
        else:
            self.stdout.write(f"Reusing learner {email!r} (id={learner.id})")

        learner.username = spec["username"]
        learner.learner_type = "apprenticeship"
        learner.status = "FullUser"
        learner.type = "User"
        learner.programme = spec["programme"]
        learner.programme_status = "Active"
        learner.learning_plan = learning_plan
        learner.save()

        # Creates/refreshes the "Active" learner profile the workspace reads
        # progress from (KSBs, quiz attempts, video/component completions) —
        # the same call the real enrolment pipeline makes when a learner
        # reaches Active. Also hydrates the module-id-only plan above into
        # full weeks/components from the master curriculum tables.
        sync_active_user(learner)

        account, created = ensure_account("learner", learner.id, subject=learner)
        self.stdout.write(
            f'  {"created" if created else "reusing"} login account id={account.id} role={account.role}'
        )
        if account.role != "learner":
            raise CommandError(f"Account for {email} resolved to role={account.role!r}, expected 'learner'.")

        account.password_hash = hash_password(password)
        account.password_set_at = timezone.now()
        account.is_active = True
        account.failed_attempts = 0
        account.locked_until = None
        account.save(update_fields=[
            "password_hash", "password_set_at", "is_active",
            "failed_attempts", "locked_until", "updated_at",
        ])
        revoked = revoke_all_for_account(account)
        if revoked:
            self.stdout.write(f"  revoked {revoked} existing session(s)")
        self.stdout.write(f"  password: {password}")
