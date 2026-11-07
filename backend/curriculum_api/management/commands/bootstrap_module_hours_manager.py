"""Explicitly appoint the first hours-access manager after reviewed migration."""
from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction

from curriculum_api.module_hours import read_access, write_access
from login.models import LoginAccount


class Command(BaseCommand):
    help = 'Appoint the initial Match Module Hours access managers by account ID.'

    def add_arguments(self, parser):
        parser.add_argument('--account-id', required=True, type=int, action='append',
                            help='An initial manager account ID; repeat for co-managers.')
        parser.add_argument('--grant-match', action='store_true',
                            help='Also explicitly permit these initial managers to edit targets.')
        parser.add_argument('--expected-database', required=True,
                            help='The verified curriculum database name; no connection string.')
        parser.add_argument('--expected-host', required=True,
                            help='The verified curriculum database hostname.')

    def handle(self, *args, **options):
        if str(connection.settings_dict['NAME']) != options['expected_database']:
            raise CommandError('Database name does not match the verified target.')
        if str(connection.settings_dict.get('HOST', '')) != options['expected_host']:
            raise CommandError('Database host does not match the verified target.')
        identifiers = set(options['account_id'])
        accounts = list(LoginAccount.objects.filter(pk__in=identifiers, subject_type='staff',
                                                   role='admin', is_active=True))
        if not accounts or {account.id for account in accounts} != identifiers:
            raise CommandError('Every initial manager must be an active staff administrator account.')
        with transaction.atomic():
            from curriculum_api.module_hours_schema import table_name
            # Only bootstrap an empty delegation set. Later grants use the UI.
            if connection.vendor == 'postgresql':
                with connection.cursor() as cursor:
                    cursor.execute(f'LOCK TABLE {table_name(connection, "module_hours_access")} IN EXCLUSIVE MODE')
            with connection.cursor() as cursor:
                cursor.execute(f'SELECT account_id FROM {table_name(connection, "module_hours_access")} WHERE can_manage = %s', [True])
                if cursor.fetchone():
                    raise CommandError('An hours access manager already exists; use the account console.')
            for account in accounts:
                current = read_access(account.id)
                write_access(account.id, current['canMatch'] or options['grant_match'], True,
                             current['revision'], 0, audit_source='bootstrap')
        self.stdout.write(self.style.SUCCESS(f'Appointed {len(accounts)} module hours access manager(s).'))
