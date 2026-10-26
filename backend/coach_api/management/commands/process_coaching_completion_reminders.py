"""Explicit scheduled processing, never invoked by an HTTP page load."""
import json
from datetime import datetime,time
from zoneinfo import ZoneInfo
from django.conf import settings
from django.core.management.base import BaseCommand,CommandError
from coach_api.completion_reminders import run


class Command(BaseCommand):
    help='Preview Aptem MCM/PR completion reminders. --reconcile writes inbox items; --send dispatches daily emails.'

    def add_arguments(self,parser):
        parser.add_argument('--since',required=True,help='Explicit rollout date YYYY-MM-DD; never backfill older meetings automatically.')
        parser.add_argument('--reconcile',action='store_true')
        parser.add_argument('--send',action='store_true')
        parser.add_argument('--site-url',default='')

    def handle(self,*args,**options):
        try:
            since=datetime.combine(datetime.strptime(options['since'],'%Y-%m-%d').date(),time.min,ZoneInfo(settings.TIME_ZONE))
            if options['send'] and (not options['reconcile'] or not options['site_url']):
                raise ValueError('--send requires --reconcile and --site-url.')
            result=run(since,write=options['reconcile'],send=options['send'],site_url=options['site_url'])
        except Exception as failure:
            # No exception strings: a connection/provider exception can contain
            # private addresses, SQL or credentials.
            raise CommandError(f'Completion reminders stopped ({type(failure).__name__}); no success is implied.') from None
        self.stdout.write(json.dumps(result))
