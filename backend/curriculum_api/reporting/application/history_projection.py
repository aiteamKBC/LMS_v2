"""Build canonical history events and record projections from supplied readers and registries."""


def entity_type_options(
    workspace, *, ENTITY_LABELS, system_writes_ENTITY_LABELS, system_writes_entity_types_for_workspace,
):
    """Every audited record type in this workspace, as ``{value, label}``.

    Derived from what is registered, so a newly-wired record type is offered on
    the day it starts being recorded rather than on the day somebody remembers
    to edit a list in the browser.
    """
    options = []
    for entity_type in system_writes_entity_types_for_workspace(workspace):
        label = (
            ENTITY_LABELS.get(entity_type)
            or system_writes_ENTITY_LABELS.get(entity_type)
            or (entity_type.replace('_', ' ').capitalize(),)
        )[0]
        options.append({'value': entity_type, 'label': label})
    return sorted(options, key=lambda option: option['label'].lower())


def revision_event(
    row, *, ACTION_LABELS, ACTOR_TYPE_LABELS, ENTITY_LABELS, PROVENANCE_LABELS, audit_pages_WORKSPACES,
    cause_label, context_line, curriculum_views_clean_str, iso, revision_attribution, revision_change,
    source_label, system_writes_ENTITY_LABELS, system_writes_record_href,
    system_writes_workspace_for_entity, versioning_CONTEXT_KEY, versioning_as_dict, versioning_as_list,
    versioning_audit_display_value,
):
    """One revision as the trail's event shape."""
    entity_type = curriculum_views_clean_str(row.get('entity_type'))
    # Curriculum's own types first, then whatever `system_audit` registered for
    # the rest of the LMS. The last fallback keeps `/curriculum` only for a type
    # nothing claims, which by then is a bug rather than a record to link to.
    label, href = ENTITY_LABELS.get(entity_type) or system_writes_ENTITY_LABELS.get(entity_type) or (
        entity_type.replace('_', ' ').title() or 'Record', '/curriculum',
    )
    action = curriculum_views_clean_str(row.get('action')) or 'updated'
    entity_id = curriculum_views_clean_str(row.get('entity_id'))
    # A record with a page of its own opens at that record. Curriculum's rows
    # are refined further by the browser, which knows how to open a component
    # at its week inside Module Builder; the rest are resolved here because the
    # path is a plain function of the id.
    href = system_writes_record_href(entity_type, entity_id, fallback=href)
    snapshot = {key: versioning_audit_display_value(entity_type, key, value)
                for key, value in versioning_as_dict(row.get('snapshot')).items()}
    context = snapshot.get(versioning_CONTEXT_KEY) or {}
    if not isinstance(context, dict):
        context = {}
    handler, actor_kind, source, trigger_email, trigger_name = revision_attribution(row)
    metadata = versioning_as_dict(row.get('metadata'))
    workspace = curriculum_views_clean_str(metadata.get('page_workspace')) or system_writes_workspace_for_entity(entity_type) or ''
    changes = [
        change for change in (revision_change(entity_type, item) for item in versioning_as_list(row.get('changed_fields')))
        if change is not None
    ]
    return {
        'id': f'rev:{row.get("id")}',
        # Where this event comes from. The log saw this save happen.
        'provenance': 'revision',
        'provenanceLabel': PROVENANCE_LABELS['revision'],
        'at': iso(row.get('created_at')),
        'action': action,
        'actionLabel': ACTION_LABELS.get(action, action.title()),
        'entity': entity_type,
        'entityLabel': label,
        'workspace': workspace,
        'workspaceLabel': audit_pages_WORKSPACES.get(workspace, workspace.title() if workspace else ''),
        'entityId': entity_id,
        'revisionNo': int(row.get('revision_no') or 0),
        'title': (curriculum_views_clean_str(snapshot.get('reason_code')) or entity_id
                  if entity_type == 'learner_review_addition' else curriculum_views_clean_str(row.get('title')) or entity_id),
        'context': context_line(entity_type, context),
        'parents': context,
        'moduleCatalogueId': curriculum_views_clean_str(row.get('module_catalogue_id')),
        'parentId': curriculum_views_clean_str(row.get('parent_id')),
        'versionLabel': curriculum_views_clean_str(row.get('version_label')),
        'contentStatus': curriculum_views_clean_str(row.get('content_status')),
        'actorName': curriculum_views_clean_str(row.get('actor_name')),
        'actorEmail': curriculum_views_clean_str(row.get('actor_email')),
        # `system` is a write no person directly made: a cascade, a recalculation,
        # a management command or a scheduled job. Never a guess.
        'actorType': actor_kind,
        'actorTypeLabel': ACTOR_TYPE_LABELS.get(actor_kind, actor_kind.title()),
        # Who caused a system action. Empty for a person's own edit -- they are
        # the actor, not the trigger -- and empty for a scheduled run, where
        # there is no person and naming one would be a fabrication.
        'triggeredByEmail': trigger_email,
        'triggeredByName': trigger_name,
        # Auto-save is a source, not an action: the event is still the edit.
        'source': source,
        'sourceLabel': source_label(source),
        'metadata': metadata,
        'reason': handler,
        # The handler in words, for the sentence a row leads with. Empty when the
        # code has no mapped meaning, so a reader is never shown a guess.
        'causeLabel': cause_label(handler),
        # The page name recorded with the write. `page_path` is still in
        # `metadata` for anyone who wants the URL; this is the one to show.
        'pageLabel': curriculum_views_clean_str(metadata.get('page_label')),
        'changes': changes,
        # A created record's "after" and a deleted record's "before" are the same
        # stored snapshot; which one it is, is the action. Carried inline for
        # those two because for a deleted record there is nowhere else left to
        # read it from.
        'snapshot': (
            {key: value for key, value in snapshot.items() if not key.startswith('_')}
            if action in {'created', 'deleted'} else None
        ),
        'href': href,
    }


def revision_change(
    entity_type, change, *, curriculum_views_clean_str, field_label, versioning_audit_display_value,
):
    """One entry of a revision's ``changed_fields``, as the trail shows it.

    Revisions written by an older version of the log stored the names of the
    fields that moved and nothing else (``["orientation_ksb_mappings"]``). The
    field is still listed, and its values are reported as not recorded --
    ``None``, shown as a dash -- never as empty, which would be a claim about
    what the field held. Anything else unreadable is skipped, not raised.
    """
    if isinstance(change, str):
        field = curriculum_views_clean_str(change)
        if not field:
            return None
        return {'field': field, 'label': field_label(field), 'before': None, 'after': None,
                'truncated': False, 'valuesRecorded': False}
    if not isinstance(change, dict):
        return None
    field = curriculum_views_clean_str(change.get('field'))
    return {
        'field': field,
        'label': field_label(change.get('field')),
        'before': versioning_audit_display_value(entity_type, field, change.get('from')),
        'after': versioning_audit_display_value(entity_type, field, change.get('to')),
        'truncated': bool(change.get('truncated')),
    }


def revision_row(
    row, *, curriculum_views_clean_str, iso, versioning_as_list,
):
    return {
        'id': row.get('id'),
        'entityType': curriculum_views_clean_str(row.get('entity_type')),
        'entityId': curriculum_views_clean_str(row.get('entity_id')),
        'revisionNo': int(row.get('revision_no') or 0),
        'action': curriculum_views_clean_str(row.get('action')),
        'moduleCatalogueId': curriculum_views_clean_str(row.get('module_catalogue_id')),
        'parentId': curriculum_views_clean_str(row.get('parent_id')),
        'title': curriculum_views_clean_str(row.get('title')),
        'versionLabel': curriculum_views_clean_str(row.get('version_label')),
        'contentStatus': curriculum_views_clean_str(row.get('content_status')),
        'changedFields': versioning_as_list(row.get('changed_fields')),
        'actorName': curriculum_views_clean_str(row.get('actor_name')),
        'actorEmail': curriculum_views_clean_str(row.get('actor_email')),
        'reason': curriculum_views_clean_str(row.get('reason')),
        'at': iso(row.get('created_at')),
    }
