"""Audit attribution, windows and display values over explicit inputs."""


def window_limit(
    workspace, *, MAX_WINDOW_DAYS, UNLIMITED_WINDOW_DAYS, UNLIMITED_WORKSPACES,
):
    """The longest window a workspace's page activity (People) may read, in days."""
    return UNLIMITED_WINDOW_DAYS if workspace in UNLIMITED_WORKSPACES else MAX_WINDOW_DAYS


def change_window_limit(
    workspace, *, MAX_CHANGE_WINDOW_DAYS, UNLIMITED_WINDOW_DAYS, UNLIMITED_WORKSPACES,
):
    """The longest window a workspace's Changes feed may read, in days."""
    return UNLIMITED_WINDOW_DAYS if workspace in UNLIMITED_WORKSPACES else MAX_CHANGE_WINDOW_DAYS


def source_label(
    value, *, SOURCE_LABELS, curriculum_views_clean_str,
):
    text = curriculum_views_clean_str(value)
    return SOURCE_LABELS.get(text, text.replace('-', ' ').capitalize() if text else '')


def cause_label(
    reason, *, REASON_LABELS, curriculum_views_clean_str,
):
    """The handler code as the cause phrase a reader can use, or ''.

    Empty for an unmapped code: "as part of ksb-mapping-patch" explains nothing,
    and the raw handler is still on the event as ``reason`` for anyone auditing
    it. Saying nothing is better than dressing a code up as an explanation.
    """
    return REASON_LABELS.get(curriculum_views_clean_str(reason), '')


def field_label(
    field, *, FIELD_LABELS, curriculum_views_clean_str,
):
    name = curriculum_views_clean_str(field)
    if name in FIELD_LABELS:
        return FIELD_LABELS[name]
    if name.startswith('settings.'):
        tail = name.split('.', 1)[1]
        # camelCase settings keys read as words: contentHtml -> Content html.
        spaced = ''.join(f' {ch.lower()}' if ch.isupper() else ch for ch in tail).strip()
        return spaced[:1].upper() + spaced[1:]
    spaced = name.replace('_', ' ').strip()
    return spaced[:1].upper() + spaced[1:]


def split_reason(
    reason, *, curriculum_views_clean_str,
):
    """The handler code, save source, actor kind and trigger out of one column.

    Until the Phase 2 columns existed, ``reason`` was the only free column this
    table had, so it was written as
    ``component-delete; source=auto-save; actor=system; by=someone@example.com``
    -- the handler code it always carried, with tags appended. Every one of the
    1.15M rows written that way is still here and still has to be readable, so
    this stays as the fallback for a row whose structured columns are empty. It
    is no longer how new rows are written.
    """
    text = curriculum_views_clean_str(reason)
    handler, source, actor_kind, triggered_by = '', '', '', ''
    for part in text.split(';'):
        part = part.strip()
        if not part:
            continue
        if part.startswith('source='):
            source = part[len('source='):].strip()
        elif part.startswith('actor='):
            actor_kind = part[len('actor='):].strip()
        elif part.startswith('by='):
            triggered_by = part[len('by='):].strip()
        elif not handler:
            handler = part
    return handler, source, actor_kind, triggered_by


def revision_attribution(
    row, *, curriculum_views_clean_str, split_reason, versioning_ACTOR_TYPES, versioning_ACTOR_USER,
):
    """Actor kind, source and trigger for one revision, newest shape winning.

    The order is the whole backwards-compatibility story: a structured column
    when the row has one, the parsed legacy tag when it does not, and an honest
    default when neither says anything. Nothing is rewritten to make this
    simpler -- a row written in September must still read correctly in a year,
    and the only way to guarantee that is to keep being able to read both.
    """
    handler, tag_source, tag_kind, tag_trigger = split_reason(row.get('reason'))
    kind = curriculum_views_clean_str(row.get('actor_type')) or tag_kind
    if kind not in versioning_ACTOR_TYPES:
        # Rows older than any of this carry nothing. They were written by the
        # signed-in account the middleware supplied, so `user` is the reading
        # the data supports -- and where even the actor is empty the UI shows
        # no name rather than inventing one.
        kind = versioning_ACTOR_USER
    source = curriculum_views_clean_str(row.get('source')) or tag_source
    trigger_email = curriculum_views_clean_str(row.get('triggered_by_email')) or tag_trigger
    trigger_name = curriculum_views_clean_str(row.get('triggered_by_name')) or trigger_email
    return handler, kind, source, trigger_email, trigger_name


def parse_bounded_int(
    value, default, minimum, maximum,
):
    try:
        parsed = int(str(value).strip())
    except (TypeError, ValueError):
        return default
    return max(minimum, min(maximum, parsed))


def iso(
    value, *, curriculum_views_clean_str, datetime,
):
    """A timestamp as a sortable ISO string, or '' when there is none."""
    if isinstance(value, datetime):
        return value.isoformat()
    text = curriculum_views_clean_str(value)
    if not text:
        return ''
    return text.replace(' ', 'T', 1)


def merge_actors(
    logged, recovered, *, curriculum_views_clean_str,
):
    """One author list over both readings, so its counts match the feed.

    A recovered event names an author only where the row recorded an email.
    The log's spelling of a name wins; the counts add, because the two readings
    never hold the same event.
    """
    merged = {}
    for row in logged:
        email = curriculum_views_clean_str(row.get('email')).lower()
        if email:
            merged[email] = {'email': email, 'name': row.get('name') or '', 'changes': int(row.get('changes') or 0)}
    for row in recovered:
        email = curriculum_views_clean_str(row.get('email')).lower()
        if not email:
            continue
        entry = merged.setdefault(email, {'email': email, 'name': '', 'changes': 0})
        entry['name'] = entry['name'] or curriculum_views_clean_str(row.get('name'))
        entry['changes'] += int(row.get('changes') or 0)
    return sorted(merged.values(), key=lambda entry: (-entry['changes'], entry['email']))[:100]


def context_line(
    entity_type, context, *, curriculum_views_clean_str, versioning_ENTITY_CONTEXT_FIELDS,
):
    """The entity's ancestry as one readable line, from the names it was saved with.

    The curriculum's ancestry is a programme tree and reads in that order. The
    rest of the LMS does not have one -- a coaching meeting is placed by whose
    it is and when, a learner by their programme, cohort and group -- so those
    record types declare their own order at registration and it is read back
    here. Without this every non-curriculum row fell through to an empty line,
    which the page then filled with the words "Curriculum record".
    """
    registered = versioning_ENTITY_CONTEXT_FIELDS.get(entity_type)
    order = registered or ('programme_name', 'cohort_name', 'group_name', 'module_name')
    parts = [curriculum_views_clean_str(context.get(key)) for key in order]
    return ' â€º '.join(part for part in parts if part)


def coverage_keys(
    workspaces, *, revision, derived,
):
    """Return canonical revision coverage; derived timestamp history is retired."""
    covered = sorted(set(revision) | set(derived))
    return {
        'changeWorkspaces': covered,
        'revisionWorkspaces': sorted(revision),
        'derivedWorkspaces': sorted(derived),
        'uncoveredWorkspaces': [entry['value'] for entry in workspaces if entry['value'] not in covered],
    }
