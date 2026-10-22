from __future__ import annotations

import time

from django.core.management.base import BaseCommand, CommandError
from django.db import close_old_connections
from django.db.models import Count, Min

from read_models.worker import process_once, worker_identity
from read_models.registry import registered


class Command(BaseCommand):
    help = "Process the durable shared read-model outbox."

    def add_arguments(self, parser):
        parser.add_argument("--forever", action="store_true")
        parser.add_argument('--status', action='store_true', help='Read-only queue counts and oldest event per status; no processing.')
        parser.add_argument('--check-contact-config', action='store_true', help='Read-only contact store/alias/registry preflight; does not start a worker.')
        parser.add_argument("--limit", type=int, default=100)
        parser.add_argument("--poll-seconds", type=float, default=2.0)
        parser.add_argument(
            "--model",
            help="Process only one registered model key (useful for staged canaries).",
        )

    def handle(self, *args, **options):
        if options.get('check_contact_config'):
            from django.conf import settings
            from django.db import connections
            from learner_api.services.contact_sync import _verify_worker_connection, _verify_contact_store
            try:
                _verify_worker_connection(connections['enrolment'])
                for key in ('learner.home', 'record.monitor', 'coach.dashboard'):
                    registered(key)
                for alias in ('default', 'enrolment'):
                    with connections[alias].cursor() as cursor:
                        _verify_contact_store(cursor)
                        cursor.execute("SELECT current_database(),current_setting('neon.branch_id',true)")
                        identity = cursor.fetchone()
                        if alias == 'default':
                            worker_identity_row = identity
                        elif identity != worker_identity_row:
                            raise ValueError('Alias server mismatch')
                enabled = bool(getattr(settings, 'READ_MODEL_OUTBOX_ENABLED', False))
                self.stdout.write(f'contact_store=verified registry=verified outbox_enabled={enabled} worker_running=unverified')
                if not enabled:
                    raise CommandError('Outbox configuration is disabled; deployed consumer remains unverified.')
            except CommandError:
                raise
            except Exception as exc:
                raise CommandError(f'Contact preflight failed: {type(exc).__name__}') from None
            return
        identity = worker_identity()
        model_key = str(options.get("model") or "").strip() or None
        if model_key:
            try:
                registered(model_key)
            except KeyError as exc:
                raise CommandError(str(exc)) from exc
        if options.get('status'):
            from read_models.models import ReadModelEvent
            rows = ReadModelEvent.objects.all()
            if model_key:
                rows = rows.filter(model_key=model_key)
            for row in rows.values('status').annotate(count=Count('id'), oldest=Min('created_at')).order_by('status'):
                self.stdout.write(f"status={row['status']} count={row['count']} oldest={row['oldest'].isoformat()}")
            return
        while True:
            close_old_connections()
            result = process_once(
                limit=options["limit"], worker_id=identity, model_key=model_key,
            )
            self.stdout.write(
                "claimed={claimed} completed={completed} failed={failed} groups={groups}".format(**result)
            )
            if not options["forever"]:
                if result['failed']:
                    raise CommandError('Read-model refresh failures remain in the durable outbox.')
                return
            time.sleep(max(float(options["poll_seconds"]), 0.1))

