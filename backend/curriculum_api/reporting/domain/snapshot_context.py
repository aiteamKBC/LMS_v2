"""Historical entity identity and ancestry projection from supplied values."""


def snapshot_title(
    snapshot, columns, join=' ', *, clean,
):
    """The record's own name, from one snapshot column or several joined.

    Several, because outside the curriculum a record's name is rarely in one
    column: a coaching meeting is identified by whose it is *and* what kind it
    is, and an employer contact by a first name *and* a surname. A column that
    is empty is skipped rather than joined as a gap, so a contact with no
    surname reads as their first name and not as a name with a dangling
    separator.
    """
    if not columns:
        return ''
    if isinstance(columns, str):
        columns = (columns,)
    parts = [clean(snapshot.get(column)) for column in columns]
    return join.join(part for part in parts if part)


def entity_facts(
    entity_type, snapshot, *, ENTITY_FACT_FIELDS, as_dict, clean, snapshot_title,
):
    """The columns the history table denormalises out of a snapshot."""
    fields = ENTITY_FACT_FIELDS.get(entity_type) or {}
    settings = as_dict(snapshot.get('settings_json'))
    version_label = clean(settings.get('version')) if entity_type == 'component' else ''
    content_status = clean(settings.get('contentStatus')) if entity_type == 'component' else ''
    if not content_status and fields.get('status'):
        content_status = clean(snapshot.get(fields['status']))
    title_column = fields.get('title')
    title = snapshot_title(snapshot, title_column, fields.get('title_join') or ' ')
    # A record whose usual name is blank still has to be findable in a list.
    # `title_fallback` names the column to use instead -- an email where a
    # username was never set -- rather than leaving the row to be listed under
    # its own primary key, which tells a reader nothing.
    if not title and fields.get('title_fallback'):
        title = snapshot_title(snapshot, fields['title_fallback'])
    # A row with no title of its own is still worth naming in a list, and the
    # only honest name it has is the record it belongs to.
    if not title and entity_type in {'module_details', 'module_completion'}:
        title = clean(snapshot.get('module_catalogue_id'))
    parent_column = fields.get('parent')
    return {
        'module_catalogue_id': clean(snapshot.get('module_catalogue_id')),
        'parent_id': clean(snapshot.get(parent_column)) if parent_column else '',
        'title': title[:500],
        'version_label': version_label,
        'content_status': content_status[:64],
    }


def context_for(
    entity_type, snapshot, ancestry, *, ENTITY_CONTEXT_FIELDS, clean,
):
    """The ancestry to store beside a snapshot, from an already-resolved map."""
    registered = ENTITY_CONTEXT_FIELDS.get(entity_type)
    if registered:
        # Read off the row itself, and stored with it, for the same reason the
        # curriculum's is: this is where the record sat WHEN the change
        # happened. A learner moved to another cohort next month must not
        # silently rewrite the line against today's edit.
        return {
            column: clean(snapshot.get(column))
            for column in registered
            if clean(snapshot.get(column))
        }
    module_id = clean(snapshot.get('module_catalogue_id'))
    context = {}
    if entity_type == 'programme':
        context = {'programme_id': clean(snapshot.get('programme_id')), 'programme_name': clean(snapshot.get('name'))}
    elif entity_type in {'cohort', 'group', 'module', 'week_template'}:
        context = {
            'programme_id': clean(snapshot.get('programme_id')),
            'programme_name': clean(snapshot.get('programme_name')),
        }
        if entity_type in {'group', 'module'}:
            context['cohort_id'] = clean(snapshot.get('cohort_id'))
            context['cohort_name'] = clean(snapshot.get('cohort_name'))
        if entity_type == 'module':
            context['group_id'] = clean(snapshot.get('group_id'))
            context['group_name'] = clean(snapshot.get('group_name'))
    elif module_id:
        context = dict(ancestry.get(module_id) or {})
    if entity_type == 'component':
        context['week_id'] = clean(snapshot.get('week_id'))
        context['module_catalogue_id'] = module_id
    elif entity_type == 'week':
        context['module_catalogue_id'] = module_id
    elif entity_type == 'ksb_mapping':
        context['week_id'] = clean(snapshot.get('week_id'))
        context['component_id'] = clean(snapshot.get('component_id'))
        context['module_catalogue_id'] = module_id
    return {key: value for key, value in context.items() if value}
