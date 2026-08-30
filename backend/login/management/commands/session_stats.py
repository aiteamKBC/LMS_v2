"""What the session table is actually doing, in one screen.

The structured events on ``login.sessions`` answer "what happened to this
session"; this answers "what is happening to sessions in general" -- the shape
you want before deciding whether the lifetime numbers in ``security.py`` are the
right ones, and the shape a log stream is bad at showing.

The question it exists to settle
--------------------------------
Two clocks end a session, and only one of them is a good experience:

* **idle** -- nobody was using it. Working as designed.
* **ceiling** -- it hit ``Created_at + absolute maximum``. This one signs
  somebody out *while they are working*, and no amount of activity prevents it.

If the ceiling column is a rounding error, the current 7-day and 90-day maximums
are comfortable. If it is a meaningful share of expiries, they are too tight for
how people actually use the console, and that is an argument from evidence
rather than from whoever complained most recently.

Usage
-----
    python manage.py session_stats
    python manage.py session_stats --days 30

Read-only. Safe to run against production at any time.
"""
from __future__ import annotations

from datetime import timedelta

from django.core.management.base import BaseCommand, CommandError
from django.db.models import Count
from django.db.models.functions import TruncDate
from django.utils import timezone

from login.models import EVENT_LOGIN, EVENT_LOGOUT, LoginAudit, LoginSession
from login.security import session_policy
from login.sessions import expiry_reason

#: Window for the "recently ended" and sign-in-rate sections.
DEFAULT_WINDOW_DAYS = 7

#: Live sessions are bucketed by age against these, in hours.
AGE_BUCKETS = (1, 12, 24, 24 * 7, 24 * 30)


def _bucket_label(hours):
    if hours < 24:
        return f"under {hours}h"
    return f"under {hours // 24}d"


class Command(BaseCommand):
    help = "Report on live and recently ended login sessions."

    def add_arguments(self, parser):
        parser.add_argument(
            "--days",
            type=int,
            default=DEFAULT_WINDOW_DAYS,
            help=f"Window for ended sessions and sign-in rate (default: {DEFAULT_WINDOW_DAYS}).",
        )

    def handle(self, *args, **options):
        days = options["days"]
        if days < 1:
            raise CommandError("--days must be at least 1.")

        now = timezone.now()
        since = now - timedelta(days=days)

        self._live(now)
        self._ended(since, now, days)
        self._rate(since, days)

    # -- live ---------------------------------------------------------------

    def _live(self, now):
        live = list(
            LoginSession.objects.filter(
                revoked_at__isnull=True, expires_at__gt=now
            ).only("created_at", "expires_at", "remember")
        )

        self.stdout.write(self.style.MIGRATE_HEADING("Live sessions"))
        if not live:
            self.stdout.write("  none")
            return

        remembered = sum(1 for s in live if s.remember)
        # Pinned means the rolling window has run out of room: every further
        # renewal is a no-op, so these are the sessions that will end at the
        # ceiling rather than through idleness.
        pinned = 0
        for session in live:
            rolling, absolute = session_policy(session.remember)
            if now + rolling >= session.created_at + absolute:
                pinned += 1

        self.stdout.write(f"  total:                {len(live)}")
        self.stdout.write(f"    remember me:        {remembered}")
        self.stdout.write(f"    ordinary:           {len(live) - remembered}")
        self.stdout.write(
            f"  pinned at ceiling:    {pinned}"
            + ("   <- these will be signed out mid-task" if pinned else "")
        )

        # Age says how much of the ceiling has been used up. A population
        # clustered in the oldest buckets is one heading for ceiling expiries.
        counts = [0] * (len(AGE_BUCKETS) + 1)
        for session in live:
            age_hours = (now - session.created_at).total_seconds() / 3600.0
            for index, edge in enumerate(AGE_BUCKETS):
                if age_hours < edge:
                    counts[index] += 1
                    break
            else:
                counts[-1] += 1

        self.stdout.write("  age since sign-in:")
        for index, edge in enumerate(AGE_BUCKETS):
            self.stdout.write(f"    {_bucket_label(edge):<12} {counts[index]}")
        self.stdout.write(f"    {'older':<12} {counts[-1]}")

    # -- ended --------------------------------------------------------------

    def _ended(self, since, now, days):
        self.stdout.write("")
        self.stdout.write(
            self.style.MIGRATE_HEADING(f"Sessions that ended in the last {days} day(s)")
        )

        revoked = LoginSession.objects.filter(
            revoked_at__isnull=False, revoked_at__gte=since
        ).count()

        expired = list(
            LoginSession.objects.filter(
                revoked_at__isnull=True, expires_at__lte=now, expires_at__gte=since
            ).only("created_at", "expires_at", "remember")
        )
        reasons = {"expired_idle": 0, "expired_ceiling": 0}
        for session in expired:
            reasons[expiry_reason(session)] += 1

        total = revoked + len(expired)
        self.stdout.write(f"  revoked (signed out, password changed):  {revoked}")
        self.stdout.write(f"  expired while idle:                      {reasons['expired_idle']}")
        self.stdout.write(f"  expired at the absolute ceiling:         {reasons['expired_ceiling']}")

        if total:
            share = 100.0 * reasons["expired_ceiling"] / total
            self.stdout.write(f"  ceiling share of all endings:            {share:.1f}%")
            if share >= 5.0:
                self.stdout.write(
                    self.style.WARNING(
                        "  ^ people are being signed out mid-task often enough to "
                        "reconsider SESSION_MAX_LIFETIME."
                    )
                )

    # -- rate ---------------------------------------------------------------

    def _rate(self, since, days):
        self.stdout.write("")
        self.stdout.write(self.style.MIGRATE_HEADING(f"Sign-ins per day (last {days})"))

        rows = (
            LoginAudit.objects.filter(
                event=EVENT_LOGIN, succeeded=True, created_at__gte=since
            )
            .annotate(day=TruncDate("created_at"))
            .values("day")
            .annotate(count=Count("id"))
            .order_by("day")
        )
        if not rows:
            self.stdout.write("  none recorded")
        else:
            for row in rows:
                self.stdout.write(f"  {row['day']}   {row['count']}")

        signouts = LoginAudit.objects.filter(
            event=EVENT_LOGOUT, created_at__gte=since
        ).count()
        self.stdout.write(f"  explicit sign-outs in the window: {signouts}")
