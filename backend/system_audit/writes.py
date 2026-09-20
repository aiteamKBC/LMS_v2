"""Recording what changed, in every workspace.

Curriculum Studio has recorded its saves for a while: ``curriculum_api``'s write
helpers hand the rows they wrote to ``versioning.record_rows``, which buffers
them, waits for the commit and writes one revision per record that genuinely
moved. That machinery is sound and hard-won -- it is rollback-safe, it collapses
a save cycle that touches a row five times into one revision, and it diffs
against the stored history rather than against a re-read of the table.

None of it is curriculum-specific. What was curriculum-specific was the list of
tables it knew about. This module widens that list, and adds the two things the
rest of the LMS needs that curriculum did not:

* **A workspace per entity.** The Changes feed can then say which workspace a
  save belongs to, and the Audit Trail can stop hard-coding ``['curriculum']``
  as the answer to "what can you speak for?".

* **Redaction.** Curriculum's authoring tables hold no personal detail, so an
  allowlist of columns was enough. ``enrolment."Created_users"`` holds dates of
  birth, addresses and national insurance numbers. Those must remain auditable
  -- somebody changing a learner's date of birth is exactly the kind of thing an
  audit exists to show -- without the audit log becoming a second copy of the
  data. So a redacted column records a digest: the change is visible, the value
  is not.

Three capture mechanisms, because no one of them sees everything:

* **Signals** (``post_save``/``post_delete``/``m2m_changed``) for ORM writes,
  which is how ``learner_api`` and ``enrolment_api`` mostly write.
* **:class:`AuditedQuerySet`** for ``update()``, ``bulk_create()`` and
  ``bulk_update()``, which emit no signals at all.
* **Explicit calls** to :func:`record_table_rows` for raw SQL, which is how
  ``curriculum_api`` and ``coach_api`` mostly write.

Nothing here can fail a save. Every entry point swallows its own errors, and the
revision write happens inside its own SAVEPOINT after the caller's transaction
has committed.
"""

from __future__ import annotations

import logging

from django.db import DEFAULT_DB_ALIAS, models
from django.db.models.signals import m2m_changed, post_delete, post_save

from curriculum_api import versioning

logger = logging.getLogger(__name__)

#: entity_type -> workspace key, as ``system_audit.pages`` names workspaces.
WORKSPACE_BY_ENTITY: dict[str, str] = {}

#: entity_type -> (label, href). What a reader should see instead of the raw
#: type, and where that kind of record lives. Curriculum keeps its own copy in
#: ``curriculum_api.quality.ENTITY_LABELS``; this is for everything else.
ENTITY_LABELS: dict[str, tuple[str, str]] = {}

#: Curriculum registered its own tables before this module existed, and its
#: entity types all belong to one workspace.
for _config in versioning.VERSIONED_TABLES.values():
    WORKSPACE_BY_ENTITY.setdefault(_config['entity_type'], 'curriculum')


def register(
    table,
    *,
    workspace,
    entity_type,
    key,
    title='',
    columns=(),
    redact=(),
    using=DEFAULT_DB_ALIAS,
    label='',
    href='',
):
    """Declare a table as audited.

    ``columns`` is an allowlist and the only thing that reaches history: a
    column not named here cannot arrive by accident, however the write path
    changes later. ``redact`` narrows it further -- those columns record that
    they changed without recording what to.
    """
    # Checked before anything is registered. A registration that fails halfway
    # is worse than one that is refused: the entity type would already be
    # filterable and already be collecting columns, while belonging to no
    # workspace -- so its changes would appear in every workspace's feed.
    missing = set(redact) - set(columns)
    if missing:
        # A redaction naming a column that is not collected is not a redaction
        # -- it is a line of configuration that looks like one. Loud, because
        # the failure it hides is a value reaching history.
        raise ValueError(
            f'{entity_type}: redacted columns are not in the snapshot: {sorted(missing)}'
        )
    if not workspace:
        raise ValueError(f'{entity_type}: an audited record must belong to a workspace')

    versioning.VERSIONED_TABLES[table] = {
        'entity_type': entity_type,
        'key': key,
        'title': title,
        'using': using,
    }
    versioning.SNAPSHOT_COLUMNS[entity_type] = tuple(columns)
    versioning.ENTITY_TYPES.add(entity_type)
    if redact:
        versioning.REDACTED_COLUMNS[entity_type] = frozenset(redact)
    WORKSPACE_BY_ENTITY[entity_type] = workspace
    if label or href:
        ENTITY_LABELS[entity_type] = (
            label or entity_type.replace('_', ' ').capitalize(),
            href,
        )


def workspace_for_entity(entity_type):
    """Which workspace a recorded change belongs to, or '' when unregistered."""
    return WORKSPACE_BY_ENTITY.get(entity_type, '')


def entity_types_for_workspace(workspace):
    """Every record type that belongs to one workspace, or all of them for ''."""
    if not workspace:
        return sorted(WORKSPACE_BY_ENTITY)
    return sorted(
        entity for entity, owner in WORKSPACE_BY_ENTITY.items() if owner == workspace
    )


def change_workspaces():
    """The workspaces whose saves the Changes feed can actually speak for.

    Derived from what is registered rather than listed by hand, so the Audit
    Trail starts telling the truth about a newly-wired workspace on the day it
    is wired, not on the day somebody remembers to edit a list.
    """
    return sorted({workspace for workspace in WORKSPACE_BY_ENTITY.values() if workspace})


# --------------------------------------------------------------------- rows

def record_table_rows(table, rows, *, reason='', deleted=False, using=None):
    """Record rows a raw-SQL write left behind. Never raises.

    The alias defaults to the one the table was registered against, because a
    raw-SQL caller usually has no opinion about which connection it used and
    getting that wrong is what decides whether a rolled-back write can leave a
    revision claiming it succeeded.
    """
    config = versioning.VERSIONED_TABLES.get(table)
    alias = using or (config or {}).get('using') or DEFAULT_DB_ALIAS
    versioning.record_rows(table, rows, reason=reason, deleted=deleted, using=alias)


# ------------------------------------------------------------------- models

def row_from_instance(instance, columns):
    """The allowlisted columns of a model instance, as a plain row."""
    row = {}
    for column in columns:
        try:
            value = getattr(instance, column)
        except Exception:
            # A deferred field, or a relation whose target has gone. Recorded as
            # absent rather than skipped, so the snapshot keeps its shape and an
            # unreadable column does not read as a field that was removed.
            value = None
        if isinstance(value, models.Model):
            value = getattr(value, 'pk', None)
        row[column] = value
    return row


def register_model(
    model,
    *,
    workspace,
    entity_type,
    key='pk',
    title='',
    columns=(),
    redact=(),
    table=None,
    using=None,
    label='',
    href='',
):
    """Audit every ORM save and delete of this model.

    ``columns`` names model attributes, not database columns -- the instance is
    what is read, so the attribute names are what the snapshot is built from.

    Connected with ``dispatch_uid`` so registering twice (a module imported
    under two names, a test reloading the app) connects one handler rather than
    recording every save twice.
    """
    table = table or model._meta.db_table
    alias = using or DEFAULT_DB_ALIAS
    fields = tuple(columns)
    if key not in fields:
        fields = (key,) + fields

    register(
        table,
        workspace=workspace,
        entity_type=entity_type,
        key=key,
        title=title,
        columns=fields,
        redact=redact,
        using=alias,
        label=label,
        href=href,
    )

    uid = f'system_audit:{entity_type}'

    def on_save(sender, instance, created=False, raw=False, using=None, **kwargs):
        # `raw` is a fixture load: the rows are being installed, not changed by
        # anybody, and there is no actor to attribute them to.
        if raw:
            return
        try:
            record_table_rows(table, [row_from_instance(instance, fields)], using=using or alias)
        except Exception:
            logger.warning('Could not record a %s save.', entity_type, exc_info=True)

    def on_delete(sender, instance, using=None, **kwargs):
        try:
            record_table_rows(
                table,
                [row_from_instance(instance, fields)],
                reason='deleted',
                deleted=True,
                using=using or alias,
            )
        except Exception:
            logger.warning('Could not record a %s delete.', entity_type, exc_info=True)

    def on_m2m(sender, instance, action, reverse=False, using=None, **kwargs):
        # Only the settled actions. `pre_*` fires before the link table has
        # moved, so recording then would describe a change that may not happen.
        if action not in {'post_add', 'post_remove', 'post_clear'}:
            return
        if reverse or not isinstance(instance, model):
            return
        try:
            record_table_rows(table, [row_from_instance(instance, fields)], using=using or alias)
        except Exception:
            logger.warning('Could not record a %s link change.', entity_type, exc_info=True)

    post_save.connect(on_save, sender=model, weak=False, dispatch_uid=uid)
    post_delete.connect(on_delete, sender=model, weak=False, dispatch_uid=uid)
    for field in model._meta.many_to_many:
        m2m_changed.connect(
            on_m2m,
            sender=getattr(model, field.name).through,
            weak=False,
            dispatch_uid=f'{uid}:{field.name}',
        )


# --------------------------------------------------------------- bulk writes

class AuditedQuerySet(models.QuerySet):
    """A QuerySet whose bulk writes are recorded.

    ``update()``, ``bulk_create()``, ``bulk_update()`` and the fast path inside
    ``delete()`` emit no ``post_save`` or ``post_delete`` at all -- Django goes
    straight to SQL. A model audited only through signals therefore has a hole
    in its history exactly where the largest changes go through, which is the
    worst possible place for one.

    The rows are read back rather than assumed, because an ``update()`` can
    match rows the caller never enumerated and a database default or trigger can
    leave a row holding something the caller did not send.
    """

    def update(self, **fields):
        affected = list(self.values_list('pk', flat=True))
        updated = super().update(**fields)
        self._record_pks(affected)
        return updated

    update.alters_data = True

    def bulk_create(self, objs, *args, **kwargs):
        created = super().bulk_create(objs, *args, **kwargs)
        self._record_instances(created)
        return created

    bulk_create.alters_data = True

    def bulk_update(self, objs, fields, *args, **kwargs):
        result = super().bulk_update(objs, fields, *args, **kwargs)
        self._record_instances(objs)
        return result

    bulk_update.alters_data = True

    def delete(self):
        # Read before the delete: afterwards there is nothing left to read, and
        # a snapshot of what went is the whole point of recording a deletion.
        doomed = list(self)
        result = super().delete()
        self._record_instances(doomed, deleted=True)
        return result

    delete.alters_data = True

    # -- internals

    def _config(self):
        return versioning.VERSIONED_TABLES.get(self.model._meta.db_table)

    def _record_instances(self, instances, deleted=False):
        config = self._config()
        if not config or not instances:
            return
        columns = versioning.SNAPSHOT_COLUMNS.get(config['entity_type'], ())
        try:
            record_table_rows(
                self.model._meta.db_table,
                [row_from_instance(instance, columns) for instance in instances],
                reason='bulk-delete' if deleted else '',
                deleted=deleted,
                using=self.db,
            )
        except Exception:
            logger.warning('Could not record a bulk write of %s.', self.model.__name__, exc_info=True)

    def _record_pks(self, pks):
        if not pks:
            return
        try:
            # A fresh queryset: `self` has already been consumed by the update
            # and its filters may no longer match the rows that were changed.
            self._record_instances(list(self.model._base_manager.using(self.db).filter(pk__in=pks)))
        except Exception:
            logger.warning('Could not read back a bulk update of %s.', self.model.__name__, exc_info=True)
