"""Link the approved workbook learners who predate their LMS enrolment row."""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from learner_api.management.commands.import_audit_learners import target_programme
from learner_api.models import EnrolmentUser, LearnerProfile
from login.models import AdvancedAdminLearnerScope


class Command(BaseCommand):
    help = 'Create the three missing LMS records from their existing learner profiles.'

    def add_arguments(self, parser):
        parser.add_argument('--apply', action='store_true')

    def handle(self, *args, **options):
        selected = list(AdvancedAdminLearnerScope.objects.using('enrolment').values_list('aptem_id', flat=True))
        if len(selected) != 211:
            raise CommandError('The approved Advanced Admin scope must contain exactly 211 learners.')
        profiles = list(LearnerProfile.objects.using('enrolment').filter(
            aptem_id__in=[int(value) for value in selected], enrolment_id__isnull=True,
        ).only('id', 'uuid', 'aptem_id', 'email', 'full_name', 'programme',
               'programme_status', 'cohort', 'group_name', 'learning_plan'))
        if not profiles:
            linked = LearnerProfile.objects.using('enrolment').filter(
                aptem_id__in=[int(value) for value in selected],
                enrolment_id__isnull=False,
            ).count()
            if linked != 211:
                raise CommandError('The approved learner links do not verify.')
            self.stdout.write('All 211 approved learners already have LMS links.')
            return
        if len(profiles) != 3:
            raise CommandError(f'Expected exactly three unlinked scoped learners; found {len(profiles)}.')
        existing_programmes = set()
        from django.db import connections
        with connections['enrolment'].cursor() as cursor:
            cursor.execute('select name from curriculum.programmes where coalesce(is_archived,false)=false')
            existing_programmes = {row[0] for row in cursor.fetchall()}
        programmes = {}
        for profile in profiles:
            programme = target_programme(profile.programme)
            if programme not in existing_programmes or profile.programme_status.strip().casefold() != 'active':
                raise CommandError('An unlinked learner has no Active, authored PCP/ME programme.')
            if not profile.email or not profile.aptem_id or not profile.uuid:
                raise CommandError('An unlinked learner is missing a stable email, Aptem ID or UUID.')
            if (EnrolmentUser.all_learners.using('enrolment').filter(email__iexact=profile.email).exists()
                    or EnrolmentUser.all_learners.using('enrolment').filter(aptem_id=str(profile.aptem_id)).exists()
                    or EnrolmentUser.all_learners.using('enrolment').filter(uuid=profile.uuid).exists()):
                raise CommandError('An unlinked learner conflicts with an existing LMS identity.')
            programmes[profile.pk] = programme
        self.stdout.write('Verified exactly three scoped, Active, unique learner identities.')
        if not options['apply']:
            self.stdout.write('Dry run; no changes made.')
            return
        with transaction.atomic(using='enrolment'):
            for profile in profiles:
                created = EnrolmentUser.all_learners.using('enrolment').create(
                    uuid=profile.uuid,
                    username=profile.full_name,
                    email=profile.email,
                    programme=programmes[profile.pk],
                    cohort=profile.cohort,
                    group=profile.group_name,
                    aptem_id=str(profile.aptem_id),
                    status='FullUser',
                    type='User',
                    learner_type='commercial',
                    programme_status='Active',
                    invite_to_platform=True,
                    training_plan=profile.learning_plan,
                )
                LearnerProfile.objects.using('enrolment').filter(pk=profile.pk, enrolment_id__isnull=True).update(
                    enrolment_id=created.pk, learner_type='commercial',
                )
                from learner_api.canonical_learning import require_profile
                require_profile(created.pk)
        self.stdout.write(self.style.SUCCESS('Created and verified exactly three LMS links. No invitations sent.'))
