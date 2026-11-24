"""Field differences, lifecycle actions and file-event classification; no persistence."""


def diff_snapshots(
    previous, current, *, change_entry, diff_settings,
):
    """Field-level changes between two snapshots, newest value last.

    ``settings_json`` is compared one level in, so an edit reads as
    ``settings.contentHtml`` rather than as the whole settings blob changing.
    """
    changes = []
    previous = previous or {}
    current = current or {}
    for key in sorted(set(previous) | set(current)):
        # Underscore keys are context, not content. See CONTEXT_KEY.
        if key.startswith('_'):
            continue
        before = previous.get(key)
        after = current.get(key)
        if before == after:
            continue
        if key == 'settings_json' and (isinstance(before, dict) or isinstance(after, dict)):
            changes.extend(diff_settings(
                before if isinstance(before, dict) else {},
                after if isinstance(after, dict) else {},
            ))
            continue
        changes.append(change_entry(key, before, after))
    return changes


def people_in(
    value, *, clean, parse_json_column,
):
    if isinstance(value, str):
        value = parse_json_column(value) if value.strip().startswith('[') else value.split(',')
    if not isinstance(value, list):
        return set()
    return {clean(item).lower() for item in value if clean(item)}


def is_text_field(
    field, before, after, *, DIFF_VALUE_LIMIT, TEXT_COLUMNS, TEXT_SETTING_PATTERN,
):
    name = field.split('.', 1)[1] if field.startswith('settings.') else field
    if field.startswith('settings.'):
        if TEXT_SETTING_PATTERN.search(name):
            return isinstance(before, (str, type(None))) and isinstance(after, (str, type(None)))
    elif name in TEXT_COLUMNS:
        return True
    # Anything too long to show whole is prose, not a setting.
    return any(isinstance(value, str) and len(value) > DIFF_VALUE_LIMIT for value in (before, after))


def change_entry(
    field, before, after, *, PEOPLE_LIST_FIELDS, TEXT_CHANGED, is_text_field, people_in, short,
):
    """One changed field as the log keeps it."""
    if field in PEOPLE_LIST_FIELDS:
        was, now = people_in(before), people_in(after)
        added, removed = len(now - was), len(was - now)
        return {
            'field': field, 'from': f'{len(was)} invited',
            'to': f'{len(now)} invited (+{added}, -{removed})', 'truncated': False,
        }
    if is_text_field(field, before, after):
        return {'field': field, 'from': '', 'to': TEXT_CHANGED, 'truncated': False, 'text': True}
    from_text, from_cut = short(before)
    to_text, to_cut = short(after)
    return {'field': field, 'from': from_text, 'to': to_text, 'truncated': from_cut or to_cut}


def merge_changes(
    earlier, later, *, clean,
):
    """Two diffs of one record as one: each field from its first value to its last.

    A field put back where it started drops out; text keeps its "changed" line,
    since the log never held the words to compare.
    """
    merged = {}
    for change in list(earlier or ()) + list(later or ()):
        field = clean(change.get('field'))
        if not field:
            continue
        if field in merged:
            first = merged[field]
            combined = dict(change)
            combined['from'] = first.get('from')
            combined['truncated'] = bool(first.get('truncated') or change.get('truncated'))
            combined['text'] = bool(first.get('text') or change.get('text'))
            if not combined['text']:
                combined.pop('text')
            merged[field] = combined
        else:
            merged[field] = dict(change)
    return [change for change in merged.values() if change.get('text') or change.get('from') != change.get('to')]


def diff_settings(
    previous, current, *, IGNORED_SETTING_KEYS, change_entry,
):
    changes = []
    for key in sorted(set(previous) | set(current)):
        if key in IGNORED_SETTING_KEYS:
            continue
        before = previous.get(key)
        after = current.get(key)
        if before == after:
            continue
        changes.append(change_entry(f'settings.{key}', before, after))
    return changes


def resolve_file_action(
    changes, *, UPLOAD_NAME_FIELD, clean,
):
    """Which file event this diff is, if it is one at all."""
    for change in changes or ():
        if change.get('field') != UPLOAD_NAME_FIELD:
            continue
        before, after = clean(change.get('from')), clean(change.get('to'))
        if before and not after:
            return 'file_removed'
        if after and not before:
            return 'file_uploaded'
        if after and before:
            return 'file_replaced'
    return ''


def file_metadata(
    action, snapshot, previous_snapshot, *, UPLOAD_NAME_KEY, UPLOAD_SIZE_KEY, UPLOAD_TYPE_KEY, as_dict,
    safe_metadata,
):
    """What the trail records about a file event, read from the rows themselves.

    Only ever the name, the type and the size -- enough for a reader to know
    which file this was, and nothing that is the file or that could let someone
    fetch it.
    """
    if action not in {'file_uploaded', 'file_replaced', 'file_removed'}:
        return {}
    settings = as_dict(snapshot.get('settings_json'))
    previous = as_dict((previous_snapshot or {}).get('settings_json'))
    if action == 'file_removed':
        return safe_metadata({'previous_file_name': previous.get(UPLOAD_NAME_KEY)})
    metadata = {
        'file_name': settings.get(UPLOAD_NAME_KEY),
        'file_type': settings.get(UPLOAD_TYPE_KEY),
        'file_size': settings.get(UPLOAD_SIZE_KEY),
    }
    if action == 'file_replaced':
        metadata['previous_file_name'] = previous.get(UPLOAD_NAME_KEY)
    return safe_metadata({key: value for key, value in metadata.items() if value not in (None, '')})


def snapshot_archived(
    snapshot, entity_type='', *, STATUS_LIFECYCLE_TYPES,
):
    """Is this snapshot of an archived row?

    The normalised schema records it in ``status`` ('inactive'); snapshots taken
    on the old schema carry ``deleted_at``, and history mixes both.
    """
    if snapshot.get('deleted_at'):
        return True
    if entity_type not in STATUS_LIFECYCLE_TYPES:
        return False
    return str(snapshot.get('status') or '').strip().lower() in ('inactive', 'archived')


def resolve_action(
    entity_type, snapshot, previous_row, changes, *, ORDER_COLUMNS, PARENT_COLUMNS, resolve_file_action,
    snapshot_archived,
):
    """The action this revision records, from the row and its own diff.

    Archive and restore win over everything, because withdrawing a record is the
    most consequential thing that can happen to it. Below those, a diff that
    touches only the parent column is a move and a diff that touches only the
    order column is a reorder -- said outright rather than left for a reader to
    infer from a `week_id` that went from one opaque id to another.
    """
    archived = snapshot_archived(snapshot, entity_type)
    if previous_row is None:
        return 'archived' if archived else 'created'
    was_archived = snapshot_archived(previous_row.get('snapshot') or {}, entity_type)
    if archived and not was_archived:
        return 'archived'
    if was_archived and not archived:
        return 'restored'
    # Attaching, swapping or detaching a file, read off the component's own
    # diff rather than declared by a caller.
    #
    # Derived on purpose. The obvious place to declare it is the upload endpoint,
    # but that endpoint does not write the component (it hands the file's details
    # back and the browser saves them with the next component save), so a
    # declaration there would label a write that never happens while the real one
    # went on reading as a settings edit. The name the component ends up carrying
    # is the fact; whichever save carried it is beside the point.
    file_action = resolve_file_action(changes)
    if file_action:
        return file_action
    fields = {change.get('field') for change in changes or ()}
    if fields:
        parents = set(PARENT_COLUMNS.get(entity_type) or ())
        # A move has to actually touch a parent column. Landing in a new position
        # within the same week is a reorder, and reading it as a move because
        # `week_id` happens to be a parent column would mislabel every drag.
        if fields & parents and fields <= (parents | ORDER_COLUMNS):
            return 'moved'
        if fields <= ORDER_COLUMNS:
            return 'reordered'
    return 'updated'


def looks_newly_created(
    item, *, clean, datetime,
):
    """Whether this row came into existence now, or merely reached history now.

    Both stamps have to be readable for this to answer yes. An unreadable or
    missing stamp is treated as "cannot tell", and the honest answer to "cannot
    tell whether this was just created" is no -- claiming a create that did not
    happen is the worse of the two mistakes, because it puts a false origin
    story against a record nobody can correct afterwards.
    """
    created, updated = item.get('created_at'), item.get('updated_at')
    if created is None or updated is None:
        return False
    if isinstance(created, datetime) and isinstance(updated, datetime):
        # The two are written microseconds apart by the same statement, never
        # exactly equal, so this asks whether the row's whole life fits inside
        # this save rather than whether the stamps match to the microsecond.
        return abs((updated - created).total_seconds()) < 1
    return clean(created) == clean(updated)


def strip_context(
    snapshot,
):
    """A snapshot without its ancestry, for the did-anything-change comparison.

    Renaming a programme must not make every component under it look edited.
    """
    return {key: value for key, value in (snapshot or {}).items() if not key.startswith('_')}
