from django.core.management.base import BaseCommand, CommandError


class Command(BaseCommand):
    help = 'Retired: coach calendar recordings stay in SharePoint.'

    def handle(self, **options):
        raise CommandError('Coach calendar recordings use SharePoint only; no Azure container is required.')
