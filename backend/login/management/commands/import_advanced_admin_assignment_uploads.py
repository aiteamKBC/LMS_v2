"""Import supplied assignment files into one learner's private admin record."""
import hashlib
import json
import logging
import mimetypes
from pathlib import Path

from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management.base import BaseCommand, CommandError
from django.db import connections

from learner_api.models import LearnerProfile
from login.advanced_admin import _profile_in_scope
from login.advanced_admin_assignment_uploads import file_digest, save_record, validate_record, _existing


def selected_profile(name):
    matches = list(LearnerProfile.objects.using('enrolment').filter(full_name__iexact=name))
    if not matches:
        candidates = LearnerProfile.objects.using('enrolment').all()
        for token in name.split():
            candidates = candidates.filter(full_name__icontains=token)
        matches = list(candidates[:2])
    if len(matches) != 1:
        raise CommandError('Learner name must resolve to one profile only.')
    profile = _profile_in_scope(matches[0].pk)
    if profile is None:
        raise CommandError('Learner is outside the Advanced Admin scope.')
    return profile


class Command(BaseCommand):
    help = 'Import month, confirmed hours, and a file into Advanced Admin only; dry-run by default.'

    def add_arguments(self, parser):
        parser.add_argument('--learner-name', required=True)
        parser.add_argument('--entry', action='append', required=True,
                            help='MONTH|HOURS|ABSOLUTE_FILE_PATH; repeat for each assignment')
        parser.add_argument('--apply', action='store_true')
        parser.add_argument('--expected-fingerprint')

    def handle(self, *args, **options):
        logging.getLogger('azure.core.pipeline.policies.http_logging_policy').setLevel(logging.WARNING)
        profile = selected_profile(options['learner_name'])
        target = connections['enrolment'].settings_dict
        records = []
        for raw in options['entry']:
            parts = raw.split('|', 2)
            if len(parts) != 3:
                raise CommandError('Each entry must contain MONTH|HOURS|ABSOLUTE_FILE_PATH.')
            month, hours, raw_path = parts
            path = Path(raw_path)
            if not path.is_absolute() or not path.is_file():
                raise CommandError('Every assignment path must be an existing absolute file.')
            content_type = mimetypes.guess_type(path.name)[0] or 'application/octet-stream'
            file = SimpleUploadedFile(path.name, path.read_bytes(), content_type=content_type)
            amount = validate_record(month, hours, file)
            checksum = file_digest(file)
            previous = _existing(profile, month, checksum)
            if previous and previous[1] != amount:
                raise CommandError('An existing file has a different number of hours.')
            records.append((month, amount, file, checksum, bool(previous)))
        if len({(month, checksum) for month, _, _, checksum, _ in records}) != len(records):
            raise CommandError('The supplied entries contain a duplicate file and month.')
        fingerprint = hashlib.sha256(json.dumps({
            'host': target['HOST'], 'database': target['NAME'],
            'profile_id': profile.pk, 'aptem_id': str(profile.aptem_id),
            'records': [(month, str(amount), checksum, previous)
                        for month, amount, _, checksum, previous in records],
        }, sort_keys=True).encode()).hexdigest()
        self.stdout.write(f"Target: {target['NAME']} (enrolment alias); files: {len(records)}; fingerprint: {fingerprint}")
        for month, amount, _, _, previous in records:
            self.stdout.write(f"{month}: {amount}h; {'already recorded' if previous else 'to add'}")
        if not options['apply']:
            self.stdout.write('Dry run; no changes made.')
            return
        if options['expected_fingerprint'] != fingerprint:
            raise CommandError('Import inputs or existing records changed since dry-run; review again.')
        created = 0
        for month, amount, file, _, _ in records:
            _, inserted = save_record(profile, month, amount, file, 'Advanced Admin import')
            created += int(inserted)
        self.stdout.write(f'Imported {created} assignment records; {len(records) - created} already existed.')
