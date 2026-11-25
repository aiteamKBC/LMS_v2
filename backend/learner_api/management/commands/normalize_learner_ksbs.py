"""Retired destructive normalization entry point: canonical data is already normalized."""
from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Retired: use the reviewed canonical KSB migration reconciliation process.'

    def handle(self, *args, **options):
        raise CommandError('Legacy KSB normalization is retired. No database changes were made. '
                           'Use a reviewed canonical schema reconciliation migration.')
