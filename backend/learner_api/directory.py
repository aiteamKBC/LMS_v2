"""Small, Created_users-owned projection for the Users directory."""
from types import SimpleNamespace

from django.db.models import BooleanField, Case, Q, TextField, Value, When
from django.db.models.expressions import RawSQL

from .models import EnrolmentUser
from .mappers import to_list_row


# Keep this projection aligned with mappers.to_list_row. Plans and wizard JSON
# can be many megabytes; the directory needs only a boolean for its Add/Edit
# action, not the full documents or a lifecycle sweep for every learner.
DIRECTORY_FIELDS = (
    "id", "uuid", "username", "type", "email", "status",
    "programme_status", "programme_id", "cohort_id", "group_id", "organization", "learner_type",
    # The directory's Case owner filter offers the owners actually present in
    # these rows, so the column has to come back with them.
    "case_owner",
)


def _has_plan(field):
    # Match bool() in to_list_row for all JSON types, including SQL NULL and
    # JSON null. Cast/transfer neither plan to Python just to check its presence.
    return (
        Q(**{f"{field}__isnull": False})
        & ~Q(**{field: None})
        & ~Q(**{f"{field}__in": [[], {}, "", False, 0]})
    )


def learner_directory_queryset(learner_type=""):
    queryset = EnrolmentUser.all_learners.only(*DIRECTORY_FIELDS).annotate(
        # Indexed scalar lookups remain in this single SQL statement. Their
        # target keys are verified PKs, so missing relationships yield NULL
        # without excluding or duplicating a Created_users record.
        _directory_programme=RawSQL('''(SELECT p.name FROM curriculum.programmes p
            WHERE p.programme_id = "enrolment"."Created_users".programme_id)''', [], output_field=TextField()),
        _directory_cohort=RawSQL('''(SELECT c.cohort_name FROM curriculum.cohorts c
            WHERE c.cohort_id = "enrolment"."Created_users".cohort_id)''', [], output_field=TextField()),
        _directory_group=RawSQL('''(SELECT g.group_name FROM curriculum.groups g
            WHERE g.group_id = "enrolment"."Created_users".group_id)''', [], output_field=TextField()),
        _directory_has_learning_plan=Case(
            When(_has_plan("learning_plan") | _has_plan("training_plan"), then=Value(True)),
            default=Value(False),
            output_field=BooleanField(),
        ),
    )
    if learner_type == "commercial":
        queryset = queryset.filter(learner_type="commercial")
    elif learner_type == "apprenticeship":
        # Rows predating the merge have a NULL type and are apprenticeship.
        queryset = queryset.exclude(learner_type="commercial")
    return queryset.order_by("id")


def to_directory_row(user):
    """Reuse the API shape without invoking shared Learner placement readers.

    The directory owns its projection only: other callers of to_list_row and
    the Login compatibility properties retain their existing behaviour.
    """
    fields = {name: getattr(user, name) for name in DIRECTORY_FIELDS}
    fields.update(
        programme=user._directory_programme,
        cohort=user._directory_cohort,
        group=user._directory_group,
        _directory_has_learning_plan=user._directory_has_learning_plan,
        # The shared mapper recognises this preloaded sentinel. Directory
        # programme status is exclusively Created_users.Programme_status.
        _aptem_programme_status=None,
    )
    return to_list_row(SimpleNamespace(**fields))
