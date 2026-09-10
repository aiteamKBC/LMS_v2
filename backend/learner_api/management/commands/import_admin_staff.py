"""Create staff records from a list of email addresses, with no role granted.

Reads a plain list of addresses (one per line, a leading label line ignored) and
creates a row in ``enrolment."Staff_users"`` for each. Names come from the local
part of the address: the text before the first dot is the first name, the text
after it the family name.

No role is assigned
-------------------
``Access`` is left NULL deliberately. That is the platform's "no role" state:
``login.permissions.require_access`` refuses every gated area to an account with
no access grant, and the SPA sends them to ``/access-required``. So these people
exist, can be invited, and can sign in -- but reach nothing until somebody grants
them a role from the Access panel.

``Position`` is set to 'Admin' because that is what the console sets on every
staff account it creates, and it no longer decides permissions (see
``learner_api.constants``) -- the ``Access`` grant does. Leaving Position blank
would make these rows look different from natively-created ones for no reason.

No invitation is sent. Creating somebody provisions nothing by itself here; the
invitation is a deliberate step from the user directory or the Accounts page.

Idempotent: matched on the lower-cased address, so an address already present is
left alone rather than duplicated.

    python manage.py import_admin_staff --file admin_users.md
    python manage.py import_admin_staff --file admin_users.md --apply
"""
from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import DatabaseError, transaction


def parse_name(email):
    """``(first_name, family_name)`` from an address's local part.

    "Mahmoud.Fouda@..." -> ("Mahmoud", "Fouda"). An address with no dot --
    a shared mailbox like "office@" or "quality@", or a first-name-only
    address -- yields a first name and an empty family name rather than
    inventing one.

    Only the *first* dot splits, so "mele.marron.smith@" would give
    ("Mele", "Marron.Smith") rather than silently dropping a name part.
    """
    local = str(email or "").split("@")[0].strip()
    if not local:
        return "", ""
    first, _, last = local.partition(".")
    return first.strip().title(), last.strip().title()


def read_emails(path):
    """Addresses from the file, in order, de-duplicated case-insensitively.

    Anything without an "@" is treated as a label or heading and skipped, which
    is what makes the file's own "admin users:" first line harmless.
    """
    text = Path(path).read_text(encoding="utf-8")
    seen, emails = set(), []
    for line in text.splitlines():
        candidate = line.strip().strip(",;")
        if "@" not in candidate or " " in candidate:
            continue
        key = candidate.lower()
        if key in seen:
            continue
        seen.add(key)
        emails.append(candidate)
    return emails


class Command(BaseCommand):
    help = "Create Staff_users rows from a list of emails, with no access granted."

    def add_arguments(self, parser):
        parser.add_argument(
            "--file", required=True,
            help="Path to a file of email addresses, one per line.",
        )
        parser.add_argument(
            "--apply", action="store_true",
            help="Write the changes. Without it, the command only reports what it would do.",
        )

    def handle(self, *args, **options):
        from login.identity import AccountError, ensure_account

        from learner_api.models import StaffUser

        path = Path(options["file"])
        if not path.exists():
            raise CommandError(f"No such file: {path}")

        emails = read_emails(path)
        if not emails:
            raise CommandError(f"No email addresses found in {path}.")

        self.stdout.write(f"Addresses in {path.name}: {len(emails)}")

        try:
            existing = {
                str(value or "").strip().lower()
                for value in StaffUser.objects.values_list("email", flat=True)
            }
        except DatabaseError as exc:
            raise CommandError(f"Could not read the existing staff: {exc}") from exc

        to_create, already = [], []
        for email in emails:
            if email.lower() in existing:
                already.append(email)
                continue
            first, last = parse_name(email)
            to_create.append((email, first, last))

        no_family_name = [e for e, _f, last in to_create if not last]

        self.stdout.write(f"  to create: {len(to_create)}   already present: {len(already)}")
        if no_family_name:
            # Shared mailboxes and first-name-only addresses. Reported rather
            # than guessed at: there is no family name in the address to use.
            self.stdout.write(self.style.WARNING(
                f"  {len(no_family_name)} address(es) have no dot, so no family name:"
            ))
            for email in no_family_name:
                self.stdout.write(f"    {email}")
        for email, first, last in to_create[:5]:
            self.stdout.write(f"    e.g. {email:<46} {first} {last}".rstrip())

        if not options.get("apply"):
            self.stdout.write(self.style.WARNING("\nDry run -- nothing written. Re-run with --apply."))
            return

        created = provisioned = 0
        account_errors = []
        try:
            with transaction.atomic(using="enrolment"):
                for email, first, last in to_create:
                    staff = StaffUser.objects.create(
                        username=f"{first} {last}".strip(),
                        email=email,
                        preferred_name=first,
                        position="Admin",
                        # The point of this import: no role until somebody
                        # grants one.
                        access=None,
                        type="Admin",
                        status="FullUser",
                        invite_to_platform=True,
                    )
                    created += 1

                    # The sign-in identity, so they appear on the Accounts page
                    # — that page lists login.Login_accounts, so without one
                    # these people exist only in the user directory. Emails
                    # nobody: ensure_account writes no invitation row and sends
                    # no mail, leaving each account "Awaiting Sign-In" until an
                    # administrator invites them deliberately.
                    try:
                        ensure_account("staff", staff.id, subject=staff)
                        provisioned += 1
                    except AccountError as exc:
                        # A duplicate address, usually. The staff record stands;
                        # only the account could not be made, and naming which
                        # beats a silent gap on the Accounts page.
                        account_errors.append((email, str(exc)))
        except DatabaseError as exc:
            raise CommandError(f"Import failed and was rolled back: {exc}") from exc

        self.stdout.write(self.style.SUCCESS(f"\nCreated {created} staff record(s), none with a role."))
        self.stdout.write(f"Provisioned {provisioned} sign-in account(s) — no emails were sent.")
        if account_errors:
            self.stdout.write(self.style.WARNING(
                f"{len(account_errors)} account(s) could not be created:"
            ))
            for email, reason in account_errors:
                self.stdout.write(f"    {email}: {reason}")
        self.stdout.write(
            "Grant access from the Accounts page, and send their invitations from "
            "the user directory when you are ready."
        )
