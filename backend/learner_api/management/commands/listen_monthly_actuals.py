"""Blocking PostgreSQL notifications, not a polling/discovery worker.

Run as a separately supervised, reviewed service. On a connection failure the
process exits; a supervisor may reconnect. No catch-up scan is performed: missed
events leave invalidated rows on the live read path until an explicitly scoped
refresh or the next real source write. No credentials or learner data are logged.
"""
import json
import logging

import psycopg
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from learner_api.monthly_actuals import CHANNEL, refresh, storage_available
from .refresh_monthly_actuals import verify_database

logger = logging.getLogger(__name__)


def notification_ids(payload):
    try:
        value = json.loads(payload)
    except (TypeError, ValueError):
        raise ValueError('Invalid monthly actual notification') from None
    if not isinstance(value, list) or not 1 <= len(value) <= 200 or any(
            type(ident) is not int or not 0 < ident < 2**63 for ident in value):
        raise ValueError('Invalid monthly actual notification')
    return sorted(set(value))


def consume(notification, *, using, refresh_one=refresh):
    ids = notification_ids(notification.payload)
    failed = 0
    for ident in ids:
        try:
            refresh_one(ident, using=using)
        except Exception:
            # No implicit retry/discovery. The database invalidated this owner's
            # snapshots before sending the event, so reads remain correct.
            failed += 1
            logger.error('Monthly actual event refresh failed; canonical fallback remains active.', exc_info=False)
    return len(ids), failed


class Command(BaseCommand):
    help = 'Refresh affected monthly totals from committed PostgreSQL notifications; no polling.'

    def add_arguments(self, parser):
        parser.add_argument('--database', default='enrolment')
        parser.add_argument('--expected-branch', required=True)

    def handle(self, *args, **options):
        using = options['database']
        expected = options['expected_branch']
        identity = verify_database(using, expected)
        if not storage_available(using):
            raise CommandError('Apply the monthly actual event migration before starting the listener.')
        params = connections[using].get_connection_params().copy()
        host = str(params.get('host') or '')
        if host.endswith('.neon.tech'):
            params['host'] = host.replace('-pooler.', '.')
        params['autocommit'] = True
        try:
            with psycopg.connect(**params) as connection:
                actual = connection.execute("SELECT current_database(),current_setting('neon.branch_id',true)").fetchone()
                if actual != identity:
                    raise CommandError('Notification connection does not identify the verified application database.')
                connection.execute(f'LISTEN {CHANNEL}')
                self.stdout.write('Listening for committed monthly-actual events. No startup data scan.')
                # A blocking notification iterator performs no SELECT, timer or
                # startup reconciliation. Each payload identifies bounded work.
                for event in connection.notifies():
                    try:
                        handled, failed = consume(event, using=using)
                    except ValueError:
                        logger.error('Rejected an invalid monthly-actual notification.')
                        continue
                    finally:
                        connections[using].close()
                    self.stdout.write(f'Processed {handled} affected profiles; failed={failed}.')
        except psycopg.Error as exc:
            raise CommandError('Monthly actual listener disconnected; no recovery scan was started.') from exc
