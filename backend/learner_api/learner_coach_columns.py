"""How a "Learner".learners row names its coach, per database.

Older databases copy the coach onto the learner row (``coach_name``,
``coach_email``). The canonical schema drops those copies and keeps only
``coach_id``, a foreign key to curriculum.coaches. Readers -- raw SQL through
``learner_coach_sql`` and the ORM through ``LearnerCoachTextField`` /
``LearnerCoachEmailField`` -- produce the same values on either schema:

* legacy schema (or a non-PostgreSQL test database): the copied column, as before;
* canonical schema: the linked coach's name/email, NULL when ``coach_id`` is
  NULL or names no coach. NULL (not '') keeps caseload filters fail-closed: an
  unassigned learner never equals any owner email, not even an empty one.

Writes are not translated: on the canonical schema a write naming
coach_name/coach_email still fails on the missing column, explicitly.
"""
import time

from django.db import DatabaseError, connections, models
from django.db.models.expressions import Col

# A canonical answer is kept; a legacy answer is re-checked after this many
# seconds so a schema migration takes effect without a restart.
_LEGACY_RECHECK_SECONDS = 60
_keyed_cache = {}
ATTRIBUTES = ('name', 'email')


def learner_coach_keyed(using='default'):
    """True when "Learner".learners has coach_id and no copied coach_name."""
    cached = _keyed_cache.get(using)
    if cached is not None:
        keyed, checked_at = cached
        if keyed or time.monotonic() - checked_at < _LEGACY_RECHECK_SECONDS:
            return keyed
    connection = connections[using]
    if connection.vendor != 'postgresql':
        keyed = False
    else:
        try:
            with connection.cursor() as cursor:
                cursor.execute('''SELECT coalesce(bool_or(column_name='coach_id'), false)
                        AND NOT coalesce(bool_or(column_name='coach_name'), false)
                    FROM information_schema.columns
                    WHERE table_schema='Learner' AND table_name='learners'
                      AND column_name IN ('coach_id','coach_name')''')
                keyed = bool(cursor.fetchone()[0])
        except DatabaseError:
            return False  # not cached: a failed probe must not pin the answer
    _keyed_cache[using] = (keyed, time.monotonic())
    return keyed


def learner_coach_sql(alias='l', attribute='email', using='default'):
    """SQL expression: the coach ``attribute`` ('name'/'email') of learner row ``alias``."""
    if attribute not in ATTRIBUTES:
        raise ValueError(f'Unknown coach attribute: {attribute}')
    if not learner_coach_keyed(using):
        return f'{alias}.coach_{attribute}'
    return (f"(SELECT learner_coach.{attribute} FROM curriculum.coaches learner_coach "
            f"WHERE learner_coach.id={alias}.coach_id)")


def owner_coach_sql(alias='l', using='default'):
    """Select-list items ``coach_name, coach_email`` for learner row ``alias``."""
    if not learner_coach_keyed(using):
        return f'{alias}.coach_name,{alias}.coach_email'
    return (f'{learner_coach_sql(alias, "name", using)} AS coach_name,'
            f'{learner_coach_sql(alias, "email", using)} AS coach_email')


class LearnerCoachCol(Col):
    """A coach field's column, or its value through coach_id on the canonical schema."""

    def as_sql(self, compiler, connection):
        if not learner_coach_keyed(connection.alias):
            return super().as_sql(compiler, connection)
        table = compiler.quote_name_unless_alias(self.alias or self.target.model._meta.db_table)
        return learner_coach_sql(table, self.target.coach_attribute, connection.alias), ()


class _LearnerCoachFieldMixin:
    coach_attribute = None

    def get_col(self, alias, output_field=None):
        return LearnerCoachCol(alias, self, output_field)

    def deconstruct(self):
        # Same migration state as the plain field: only the read SQL differs.
        name, _, args, kwargs = super().deconstruct()
        return name, f'django.db.models.{self.__class__.__mro__[2].__name__}', args, kwargs


class LearnerCoachTextField(_LearnerCoachFieldMixin, models.TextField):
    coach_attribute = 'name'


class LearnerCoachEmailField(_LearnerCoachFieldMixin, models.EmailField):
    coach_attribute = 'email'
