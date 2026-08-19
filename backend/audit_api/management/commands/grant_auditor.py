"""Grant the Actual Hours auditor permissions to a Django account.

    python manage.py grant_auditor alice --propose --approve
    python manage.py grant_auditor bob --approve --list

Writes to the **default** database (where Django's auth tables live) and to
nothing else: it never touches an audit branch, a learner row or an
``actual_hours`` value.

The two permissions come from ``audit_api.models.ActualHoursReview`` and exist
after ``manage.py migrate`` has been applied to the default database.
"""

from django.contrib.auth import get_user_model
from django.contrib.auth.models import Group, Permission
from django.core.management.base import BaseCommand, CommandError


GROUP_NAME = "Auditor"
CODENAMES = {"propose": "propose_actual_hours", "approve": "approve_actual_hours"}


class Command(BaseCommand):
    help = "Grant propose/approve actual-hours permissions to a user (default database only)."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--propose", action="store_true", help="Grant propose_actual_hours.")
        parser.add_argument("--approve", action="store_true", help="Grant approve_actual_hours.")
        parser.add_argument("--list", action="store_true", help="Only report what the user holds.")

    def handle(self, *args, **options):
        User = get_user_model()
        try:
            user = User.objects.get(**{User.USERNAME_FIELD: options["username"]})
        except User.DoesNotExist as error:
            raise CommandError(f"No user named {options['username']!r}.") from error

        if options["list"]:
            self._report(user)
            return

        wanted = [CODENAMES[key] for key in ("propose", "approve") if options[key]]
        if not wanted:
            raise CommandError("Pass --propose and/or --approve (or --list).")

        permissions = list(Permission.objects.filter(codename__in=wanted,
                                                     content_type__app_label="audit_api"))
        missing = set(wanted) - {permission.codename for permission in permissions}
        if missing:
            raise CommandError(
                f"Permission(s) {sorted(missing)} do not exist yet. Apply the audit_api "
                f"migration to the default database first (manage.py migrate audit_api)."
            )

        group, _ = Group.objects.get_or_create(name=GROUP_NAME)
        group.permissions.add(*permissions)
        user.groups.add(group)
        self.stdout.write(self.style.SUCCESS(
            f"{user} added to {GROUP_NAME} with: {', '.join(sorted(permission.codename for permission in permissions))}"))
        self._report(user)

    def _report(self, user):
        User = type(user)
        fresh = User.objects.get(pk=user.pk)      # drop the cached permission set
        held = [name for name in (f"audit_api.{code}" for code in CODENAMES.values())
                if fresh.has_perm(name)]
        self.stdout.write(f"{fresh}: {held or 'no actual-hours permissions'}")
