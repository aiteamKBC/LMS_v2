from concurrent.futures import ThreadPoolExecutor
import time

from django.core.management.base import BaseCommand
from django.db import connections
from django.db.models import Q
from django.utils import timezone

from coach_api.activity_plan_snapshots import ALIAS, ensure_profiles, refresh_one, store
from learner_api.models import LearnerProfile


class Command(BaseCommand):
    help = 'Prepare/update persisted coach Activities summaries; never changes source progress.'

    def add_arguments(self, parser):
        parser.add_argument('--seed', action='store_true', help='Queue linked learners with an assigned coach.')
        parser.add_argument('--drain', action='store_true', help='Process due work, leaving failed rows for later retry.')
        parser.add_argument('--coach', help='Limit initial preparation to one assigned coach.')

    def handle(self, *args, **options):
        if options['seed']:
            from django.db.models.functions import Lower, Trim
            profiles = LearnerProfile.objects.using(ALIAS).annotate(owner=Lower(Trim('coach_email'))).filter(
                enrolment_id__isnull=False).exclude(owner__isnull=True).exclude(owner='')
            if options.get('coach'):
                profiles = profiles.filter(owner=options['coach'].strip().lower())
            ids = list(profiles.values_list('pk', flat=True))
            ensure_profiles(ids)
            self.stdout.write(f'Queued or already present: {len(ids)}')
        if options['drain']:
            # One pass through currently due rows. Do not repeatedly retry a
            # failing learner while preparing everyone else.
            pending = set(store().filter(expires_at__lte=timezone.now()).values_list('scope_id', flat=True))
            with ThreadPoolExecutor(max_workers=4) as pool:
                count = 0
                while pending:
                    now = timezone.now()
                    due = store().filter(scope_id__in=pending, expires_at__lte=now).filter(
                        Q(source_revision__leaseUntil__isnull=True) | Q(source_revision__leaseUntil__lte=now.isoformat()))
                    ids = list(due.order_by('expires_at', 'pk').values_list('scope_id', flat=True)[:4])
                    results = [future.result() for future in [pool.submit(refresh_one, [pk]) for pk in ids]]
                    count += sum(results)
                    pending = set(store().filter(scope_id__in=pending, expires_at__lte=timezone.now())
                                  .filter(Q(source_revision__error__isnull=True) | Q(source_revision__error=False))
                                  .values_list('scope_id', flat=True))
                    self.stdout.write(f'Processed: {count}; pending: {len(pending)}', ending='\n')
                    self.stdout.flush()
                    if pending and not any(results):
                        time.sleep(1)
        connections.close_all()
