"""Calendar identity aliases read canonical FKs; they are never stored copies."""
from django.db import models
from django.db.models.expressions import Col
from system_audit.writes import AuditedQuerySet


ALIASES = {'owner_email': ('owner', 'email'), 'owner_name': ('owner', 'name'),
           'learner_email': ('learner', 'email'), 'learner_name': ('learner', 'full_name')}


class CalendarIdentityCol(Col):
    def as_sql(self, compiler, connection):
        from learner_api.models import LearnerProfile, PlacementCoach
        kind, attribute = ALIASES[self.target.name]
        source = PlacementCoach if kind == 'owner' else LearnerProfile
        table = connection.ops.quote_name(source._meta.db_table)
        outer = compiler.quote_name_unless_alias(self.alias or self.target.model._meta.db_table)
        key = 'owner_coach_id' if kind == 'owner' else 'learner_id'
        return f'(SELECT calendar_identity."{attribute}" FROM {table} calendar_identity WHERE calendar_identity.id={outer}."{key}")', ()


class CalendarIdentityDescriptor:
    def __init__(self, field):
        self.field = field

    def __get__(self, instance, owner=None):
        if instance is None:
            return self
        name = self.field.name
        selected = '_calendar_' + name
        if selected in instance.__dict__:
            return instance.__dict__[selected] or ''
        if instance._state.adding and '_pending_' + name in instance.__dict__:
            return instance.__dict__['_pending_' + name] or ''
        kind, attribute = ALIASES[name]
        if kind == 'owner':
            if not instance.owner_coach_id:
                return instance.__dict__.get('_pending_' + name, '')
            record = instance.owner_coach
        else:
            from learner_api.models import LearnerProfile
            if not instance.learner_profile_id:
                return ''
            record = LearnerProfile.objects.using(instance._state.db or 'default').only('full_name', 'email').get(pk=instance.learner_profile_id)
        return getattr(record, attribute, '') or ''

    def __set__(self, instance, value):
        # Legacy booking constructors may supply display values. Only the new
        # booking's owner email is an identity input; persisted owners never move.
        if instance._state.adding:
            instance.__dict__['_pending_' + self.field.name] = value


class CalendarIdentityField(models.CharField):
    def __init__(self, *args, **kwargs):
        kwargs.setdefault('max_length', 320)
        kwargs.setdefault('blank', True)
        super().__init__(*args, **kwargs)

    def get_attname_column(self):
        return self.get_attname(), None

    def contribute_to_class(self, cls, name, private_only=False):
        super().contribute_to_class(cls, name, private_only=True)
        setattr(cls, self.attname, CalendarIdentityDescriptor(self))

    def get_col(self, alias, output_field=None):
        return CalendarIdentityCol(alias, self, output_field)


class CalendarQuerySet(AuditedQuerySet):
    def only(self, *fields):
        return super().only(*(tuple(f for f in fields if f not in ALIASES) or ('id',)))

    def defer(self, *fields):
        return super().defer(*(f for f in fields if f not in ALIASES))

    def update(self, **kwargs):
        if set(kwargs) & (set(ALIASES) | {'owner_coach', 'owner_coach_id'}):
            raise ValueError('Calendar identity is read-only after creation.')
        return super().update(**kwargs)

    def bulk_update(self, objs, fields, batch_size=None):
        if set(fields) & (set(ALIASES) | {'owner_coach', 'owner_coach_id'}):
            raise ValueError('Calendar identity is read-only after creation.')
        return super().bulk_update(objs, fields, batch_size=batch_size)

    def bulk_create(self, objs, **kwargs):
        objs = list(objs)
        if set(kwargs.get('update_fields') or ()) & (set(ALIASES) | {'owner_coach', 'owner_coach_id'}):
            raise ValueError('Calendar identity is read-only after creation.')
        for obj in objs:
            obj.prepare_owner(using=self.db)
        return super().bulk_create(objs, **kwargs)


class CalendarManager(models.Manager.from_queryset(CalendarQuerySet)):
    def get_queryset(self):
        return super().get_queryset().annotate(**{
            '_calendar_' + name: models.F(name) for name in ALIASES
        })
