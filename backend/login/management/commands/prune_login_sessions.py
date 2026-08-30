"""Delete session rows that have been dead long enough to be of no use.

Nothing has ever removed a row from ``Login_sessions``. Every sign-in mints one
and nothing retires it, so the table only grows -- and it grows in the dead
direction, because a session's whole working life ends at ``Expires_at`` or
``Revoked_at`` while the row stays behind for ever.

Why not simply delete on expiry
-------------------------------
Because "why was I signed out on Tuesday?" is a question somebody eventually
asks, and a row that says when a session was issued, from which IP, on what user
agent, and when it was revoked, is the only thing that answers it. The audit
table (``LoginAudit``) records the sign-in and the sign-out, not the shape of
the session in between. So dead rows are kept for a retention window and removed
after it, rather than at the moment they die.

What counts as safe to delete
-----------------------------
Both measures of death have to be older than the cutoff: the session expired
before it, *and* -- if it was ever revoked -- the revocation was before it too.
A session revoked ten minutes ago is therefore kept even if its ``Expires_at``
passed weeks earlier, which is the case a naive "expired long ago" filter gets
wrong. Live sessions cannot match at all: the cutoff is in the past, so an
unexpired row fails the first condition.

Usage
-----
    python manage.py prune_login_sessions --dry-run
    python manage.py prune_login_sessions            # 30-day retention
    python manage.py prune_login_sessions --days 90

Safe to run repeatedly and safe to run while the site is serving: it deletes in
batches, so it never holds a long transaction over a table every authenticated
request reads.
"""
from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Q
from django.utils import timezone

from login.models import LoginSession

#: How long a dead session is kept before it is deleted. Long enough to explain
#: a sign-out somebody is still puzzled about, short enough that the table does
#: not accumulate indefinitely.
DEFAULT_RETENTION_DAYS = 30

#: Rows per DELETE. Small enough that the statement never locks the table for
#: long, large enough that a big backlog does not take thousands of round trips
#: to Neon -- which is the actual cost here, not the deleting.
BATCH_SIZE = 1_000


def dead_before(cutoff):
    """Sessions that were already dead at ``cutoff``, by both measures.

    See the module docstring for why revocation is checked separately rather
    than trusting ``Expires_at`` alone.
    """
    return LoginSession.objects.filter(
        Q(expires_at__lt=cutoff)
        & (Q(revoked_at__isnull=True) | Q(revoked_at__lt=cutoff))
    )


class Command(BaseCommand):
    help = "Delete Login_sessions rows that have been dead beyond the retention window."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=DEFAULT_RETENTION_DAYS,
            help=(
                "Retention window in days (default: "
                f"{DEFAULT_RETENTION_DAYS}). 0 deletes everything already dead."
            ),
        )
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be deleted and change nothing.",
        )

    def handle(self, *args, **options):
        days = options["days"]
        if days < 0:
            raise CommandError("--days cannot be negative.")

        cutoff = timezone.now() - timedelta(days=days)
        doomed = dead_before(cutoff).count()
        live = LoginSession.objects.filter(
            revoked_at__isnull=True, expires_at__gt=timezone.now()
        ).count()

        self.stdout.write(
            f"Retention: {days} day(s) - deleting sessions dead before "
            f"{cutoff.isoformat(timespec='seconds')}"
        )
        self.stdout.write(f"  live sessions (never touched): {live}")
        self.stdout.write(f"  dead beyond retention:         {doomed}")

        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry run - nothing deleted."))
            return

        if not doomed:
            self.stdout.write(self.style.SUCCESS("Nothing to delete."))
            return

        deleted = 0
        while True:
            # Re-query each time rather than paging through a slice: the rows
            # underneath are shifting as they are deleted, and an offset into a
            # changing result set skips rows.
            batch = list(
                dead_before(cutoff).values_list("pk", flat=True)[:BATCH_SIZE]
            )
            if not batch:
                break
            removed, _ = LoginSession.objects.filter(pk__in=batch).delete()
            deleted += removed

        self.stdout.write(self.style.SUCCESS(f"Deleted {deleted} session row(s)."))
