"""Delete MCP OAuth and preview rows that have been dead long enough to be of no use.

Not scheduled yet. Retention per table:

- ``Mcp_oauth_codes``: expired more than 1 day ago. A code lives 5 minutes; the
  extra day only keeps "why did my connect fail?" answerable.
- ``Mcp_oauth_tokens``: dead by both measures for more than 90 days -- the last
  usable moment (refresh expiry, or access expiry when there is no refresh) is
  before the cutoff, *and* any revocation is too. Same reasoning as
  ``login.management.commands.prune_login_sessions``: a token revoked yesterday is
  kept even if it expired long ago.
- ``Mcp_pending_changes``: created more than 30 days ago, applied or not. The
  applied write itself is recorded in the curriculum revisions; this row is only
  the preview that led to it.

Clients are never deleted here.

Usage
-----
    python manage.py mcp_cleanup --dry-run
    python manage.py mcp_cleanup
"""
from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from mcp_api.models import McpOAuthCode, McpOAuthToken, McpPendingChange

CODE_RETENTION = timedelta(days=1)
TOKEN_RETENTION = timedelta(days=90)
PENDING_CHANGE_RETENTION = timedelta(days=30)


def stale_codes(now):
    return McpOAuthCode.objects.filter(expires_at__lt=now - CODE_RETENTION)


def stale_tokens(now):
    cutoff = now - TOKEN_RETENTION
    unusable = Q(refresh_expires_at__lt=cutoff) | Q(
        refresh_expires_at__isnull=True, expires_at__lt=cutoff
    )
    return McpOAuthToken.objects.filter(
        unusable & (Q(revoked_at__isnull=True) | Q(revoked_at__lt=cutoff))
    )


def stale_pending_changes(now):
    return McpPendingChange.objects.filter(created_at__lt=now - PENDING_CHANGE_RETENTION)


STALE = (
    ("Mcp_oauth_codes", stale_codes),
    ("Mcp_oauth_tokens", stale_tokens),
    ("Mcp_pending_changes", stale_pending_changes),
)


class Command(BaseCommand):
    help = "Delete expired MCP codes, long-dead tokens and old pending changes."

    def add_arguments(self, parser):
        parser.add_argument(
            "--dry-run",
            action="store_true",
            help="Report what would be deleted and change nothing.",
        )

    def handle(self, *args, **options):
        now = timezone.now()
        for table, stale in STALE:
            if options["dry_run"]:
                self.stdout.write(f"  {table}: {stale(now).count()} would be deleted")
                continue
            deleted, _ = stale(now).delete()
            self.stdout.write(f"  {table}: {deleted} deleted")
        if options["dry_run"]:
            self.stdout.write(self.style.WARNING("Dry run - nothing deleted."))
