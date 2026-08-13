"""Create (or reset) the demo administrator account.

    python manage.py seed_demo_admin
    python manage.py seed_demo_admin --email me@example.com --password 's3cret'
    python manage.py seed_demo_admin --dry-run

It ensures a row in enrolment."Staff_users" with Position='Admin', a
login."Login_accounts" row linked to it with role='admin', and a known password.

Two things worth knowing
------------------------
**The default password is weak on purpose.** ``123456789`` was specified for the
demo and would be refused by ``validate_password_strength`` (it is in the common
-password list). This command bypasses the policy deliberately and says so
loudly, because a seeding command is an explicit administrative act, not a user
choosing their own password. The policy still applies everywhere a real person
sets one. The command refuses to run with the weak default when DEBUG is off
unless ``--force`` is given, so this account cannot be seeded into production by
accident.

**It is idempotent.** Re-running resets the password and clears any lockout,
which is exactly what you want from a demo credential that people keep locking.
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction
from django.utils import timezone

from learner_api.models import StaffUser
from login.identity import ensure_account
from login.models import LoginAccount
from login.security import hash_password, normalize_email
from login.sessions import revoke_all_for_account

DEFAULT_EMAIL = "engfouda99@gmail.com"
DEFAULT_PASSWORD = "123456789"
DEFAULT_NAME = "Demo Admin"

CONN = "enrolment"


class Command(BaseCommand):
    help = "Create or reset the demo admin login account."

    def add_arguments(self, parser):
        parser.add_argument("--email", default=DEFAULT_EMAIL)
        parser.add_argument("--password", default=DEFAULT_PASSWORD)
        parser.add_argument("--name", default=DEFAULT_NAME)
        parser.add_argument(
            "--force",
            action="store_true",
            help="Allow a policy-failing password when DEBUG is off.",
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Rehearse and roll back.",
        )

    def handle(self, *args, **options):
        from django.conf import settings

        email = normalize_email(options["email"])
        password = options["password"]
        name = options["name"]
        dry_run = options["dry_run"]

        if not email or "@" not in email:
            raise CommandError(f"Not a valid email address: {email!r}")

        # Guard rail described in the module docstring.
        weak = len(password) < 12 or password == DEFAULT_PASSWORD
        if weak and not settings.DEBUG and not options["force"]:
            raise CommandError(
                "Refusing to seed a weak demo password with DJANGO_DEBUG=false. "
                "Pass --password with a strong value, or --force if you really mean it."
            )

        try:
            with transaction.atomic(using=CONN):
                # --- the staff row the account hangs off ----------------------
                staff = (
                    StaffUser.objects.filter(email__iexact=email).first()
                    # Match on the trimmed/lowercased address the way the auth
                    # indexes do, so an existing row with odd casing is reused
                    # rather than duplicated.
                    or StaffUser.objects.extra(
                        where=['lower(btrim("Email")) = %s'], params=[email]
                    ).first()
                )

                if staff is None:
                    staff = StaffUser.objects.create(
                        username=name,
                        email=email,
                        position="Admin",
                        type="Admin",
                        status="FullUser",
                        invite_to_platform=False,
                    )
                    self.stdout.write(f'Created enrolment."Staff_users" row id={staff.id}')
                else:
                    changed = []
                    if (staff.position or "").strip().lower() != "admin":
                        staff.position, _ = "Admin", changed.append("position")
                    if not staff.username:
                        staff.username, _ = name, changed.append("username")
                    if changed:
                        staff.save(update_fields=changed)
                    self.stdout.write(
                        f'Reusing enrolment."Staff_users" row id={staff.id} '
                        f'({"updated " + ", ".join(changed) if changed else "unchanged"})'
                    )

                # --- the login account ---------------------------------------
                account, created = ensure_account("staff", staff.id, subject=staff)
                self.stdout.write(
                    f'{"Created" if created else "Reusing"} login."Login_accounts" '
                    f'row id={account.id} role={account.role}'
                )

                if account.role != "admin":
                    # ensure_account derives the role from Position; if this is
                    # not admin something above did not take effect.
                    raise CommandError(
                        f"Account resolved to role={account.role!r}, expected 'admin'. "
                        f"Check Staff_users.Position for id={staff.id}."
                    )

                account.password_hash = hash_password(password)
                account.password_set_at = timezone.now()
                account.is_active = True
                account.failed_attempts = 0
                account.locked_until = None
                account.save(
                    update_fields=[
                        "password_hash", "password_set_at", "is_active",
                        "failed_attempts", "locked_until", "updated_at",
                    ]
                )

                # A password reset invalidates existing sessions everywhere else
                # in this system; the seeder should not be the exception.
                revoked = revoke_all_for_account(account)

                self.stdout.write("")
                self.stdout.write(self.style.SUCCESS("===== DEMO ADMIN READY ====="))
                self.stdout.write(f"  email:    {email}")
                self.stdout.write(f"  password: {password}")
                self.stdout.write(f"  role:     {account.role}")
                self.stdout.write(f"  staff id: {staff.id}   account id: {account.id}")
                if revoked:
                    self.stdout.write(f"  revoked {revoked} existing session(s)")
                if weak:
                    self.stdout.write(
                        self.style.WARNING(
                            "\n  WARNING: this password does not meet the policy applied to "
                            "real users.\n  Change it before this deployment is reachable "
                            "from the internet."
                        )
                    )

                total = LoginAccount.objects.count()
                self.stdout.write(f"\n  login.\"Login_accounts\" now holds {total} account(s).")

                if dry_run:
                    self.stdout.write(self.style.WARNING("\n--dry-run: rolling back, nothing committed."))
                    transaction.set_rollback(True, using=CONN)
                else:
                    self.stdout.write(self.style.SUCCESS("\nCommitted."))
        except CommandError:
            raise
        except Exception as exc:  # noqa: BLE001 - surface any DB failure clearly
            self.stderr.write(self.style.ERROR(f"Seeding failed (rolled back): {exc}"))
            raise
