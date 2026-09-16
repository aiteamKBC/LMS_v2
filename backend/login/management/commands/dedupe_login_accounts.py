"""Remove the duplicate login accounts that shadow a real one.

An address is meant to have exactly ONE active login account. A second one --
typically a `learner` row minted for somebody who was already staff or an admin
-- breaks sign-in completely: ``identity.account_for_email`` returns None when an
address resolves to more than one active account, and password sign-in, Microsoft
SSO and password reset all go through it. The person is refused with "Incorrect
email or password" and nothing anywhere explains why.

``identity.ensure_account`` no longer creates these (it reuses the account the
address already has). This command clears up the ones written before that fix.

Which row wins
--------------
The account somebody actually SIGNS IN with: the one holding a password. The
duplicates removed are only ever unused shells -- no password, so they could
never authenticate, and nothing is taken away from anyone by deleting them.

This refuses to guess. If two accounts on one address both have passwords, or
neither does, the address is reported and left completely alone -- a person's
only credential is not something to delete on a heuristic.

Nothing is lost by removing the loser: the learner side is found by ADDRESS, not
by a link from the account (see `existing_learner_record` in identity.py), so the
enrolment record stays put and the Learner entry still appears in the workspace
switcher once the surviving account can sign in again.

Usage::

    python manage.py dedupe_login_accounts            # dry run, changes nothing
    python manage.py dedupe_login_accounts --apply
"""
from collections import defaultdict

from django.core.management.base import BaseCommand
from django.db import transaction

from login.models import Invitation, LoginAccount, LoginSession, PasswordReset


class Command(BaseCommand):
    help = "Delete duplicate login accounts that shadow the real one for an address."

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Actually delete. Without this the command only reports.",
        )

    def handle(self, *args, **options):
        apply_changes = options["apply"]

        by_email = defaultdict(list)
        for account in LoginAccount.objects.filter(is_active=True):
            by_email[(account.email or "").strip().lower()].append(account)

        duplicates = {
            email: rows
            for email, rows in by_email.items()
            if email and len(rows) > 1
        }

        if not duplicates:
            self.stdout.write(self.style.SUCCESS(
                "No address has more than one active login account."
            ))
            return

        removed = 0
        skipped = 0

        for email, rows in sorted(duplicates.items()):
            with_password = [a for a in rows if a.has_password]

            # Ambiguous in a way that must not be resolved by guessing: either
            # nobody can sign in with any of them, or more than one person's
            # real credential is involved. Report and move on.
            if len(with_password) != 1:
                skipped += 1
                self.stdout.write(self.style.WARNING(
                    f"SKIP {email}: {len(rows)} active accounts, "
                    f"{len(with_password)} with a password — resolve by hand."
                ))
                for account in sorted(rows, key=lambda a: a.id):
                    self.stdout.write(
                        f"       id={account.id} subject={account.subject_type}/"
                        f"{account.subject_id} role={account.role} "
                        f"password={'yes' if account.has_password else 'no'}"
                    )
                continue

            keeper = with_password[0]
            losers = [a for a in rows if a.id != keeper.id]

            self.stdout.write(
                f"{email}: keeping id={keeper.id} "
                f"({keeper.subject_type}/{keeper.subject_id}, {keeper.role})"
            )

            for account in sorted(losers, key=lambda a: a.id):
                sessions = LoginSession.objects.filter(account_id=account.id).count()
                invitations = Invitation.objects.filter(account_id=account.id).count()
                resets = PasswordReset.objects.filter(account_id=account.id).count()
                self.stdout.write(
                    f"   {'removing' if apply_changes else 'would remove'} "
                    f"id={account.id} ({account.subject_type}/{account.subject_id}, "
                    f"{account.role}) sessions={sessions} "
                    f"invitations={invitations} resets={resets}"
                )

                if not apply_changes:
                    removed += 1
                    continue

                # One transaction per account so a failure on one address cannot
                # leave another half-cleaned.
                with transaction.atomic(using="enrolment"):
                    # These rows are live credentials pointed at a row that is
                    # about to stop existing. An unused set-password link for a
                    # deleted account must not stay redeemable, so they go first.
                    Invitation.objects.filter(account_id=account.id).delete()
                    PasswordReset.objects.filter(account_id=account.id).delete()
                    LoginSession.objects.filter(account_id=account.id).delete()
                    LoginAccount.objects.filter(pk=account.id).delete()
                removed += 1

        self.stdout.write("")
        if apply_changes:
            self.stdout.write(self.style.SUCCESS(
                f"Removed {removed} duplicate account(s). Skipped {skipped} address(es)."
            ))
        else:
            self.stdout.write(self.style.WARNING(
                f"Dry run: would remove {removed} account(s), skip {skipped} address(es). "
                f"Re-run with --apply to make these changes."
            ))
