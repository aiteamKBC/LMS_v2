"""Explicit, scoped repair of Active enrolments missing their learning owner."""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from learner_api.active_users import ensure_active_learner_profile
from learner_api.models import EnrolmentUser, LearnerProfile


class Command(BaseCommand):
    help = "Provision missing Active learner profiles for explicit enrolment IDs; dry-run by default."

    def add_arguments(self, parser):
        parser.add_argument("--learner", type=int, action="append", required=True,
                            help="Created_users ID; repeat to select more than one enrolment.")
        parser.add_argument("--apply", action="store_true")

    def handle(self, *args, **options):
        ids = sorted(set(options["learner"]))
        if any(pk <= 0 for pk in ids):
            raise CommandError("Learner IDs must be positive integers.")
        repaired = 0
        messages = []
        with transaction.atomic(using="enrolment"):
            sources = EnrolmentUser.all_learners.filter(pk__in=ids).order_by("pk")
            if options["apply"]:
                sources = sources.select_for_update()
            sources = list(sources)
            if len(sources) != len(ids):
                raise CommandError("A selected enrolment was not found; no changes applied.")
            for source in sources:
                if LearnerProfile.objects.filter(enrolment_id=source.pk).exists():
                    messages.append(f"Learner {source.pk}: already linked; unchanged.")
                    continue
                if str(source.programme_status or "").strip().casefold() != "active":
                    raise CommandError(f"Learner {source.pk} is not Active; no changes applied.")
                if options["apply"]:
                    ensure_active_learner_profile(source)
                    repaired += 1
                messages.append(f"Learner {source.pk}: {'repaired' if options['apply'] else 'missing profile'}.")
        for message in messages:
            self.stdout.write(message)
        self.stdout.write(f"Repaired {repaired} learner(s)." if options["apply"] else "Dry run; nothing written.")
