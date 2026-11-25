"""Snapshot normalization and privacy rules over explicit values; no I/O."""


def safe_metadata(
    metadata, *, METADATA_JSON_LIMIT, METADATA_KEYS, METADATA_VALUE_LIMIT, clean, json, jsonable,
):
    """The declared metadata, reduced to what is safe and small enough to keep.

    An allowlist rather than a filter of known-bad names: a deny-list has to
    guess every future spelling of "token", and the first one it has not heard
    of ends up in an append-only log nobody can edit. Anything not named here is
    dropped silently -- the caller is passing descriptive context, not content,
    and a dropped key costs a note in the trail rather than a leak.
    """
    if not isinstance(metadata, dict):
        return {}
    safe = {}
    for key, value in metadata.items():
        name = clean(key)
        if name not in METADATA_KEYS:
            continue
        if value is None or isinstance(value, bool) or isinstance(value, int):
            safe[name] = value
            continue
        text = clean(value if isinstance(value, str) else json.dumps(jsonable(value), ensure_ascii=False))
        # A URL can carry a SAS token, a signature or a session in its query
        # string, so only the part before the '?' is ever kept.
        if '://' in text or text.startswith('/'):
            text = text.split('?', 1)[0].split('#', 1)[0]
        safe[name] = text[:METADATA_VALUE_LIMIT]
    if len(json.dumps(safe, ensure_ascii=False)) > METADATA_JSON_LIMIT:
        # Bounded rather than truncated mid-value: half a JSON document in an
        # append-only column is worse than an honest note that it was too big.
        return {'note': 'metadata omitted: too large'}
    return safe


def clean(
    value,
):
    return str(value or '').strip()


def as_list(
    value, *, clean, json,
):
    """A json column as a list, whether the driver parsed it or handed back text."""
    if isinstance(value, list):
        return value
    text = clean(value)
    if not text:
        return []
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError):
        return []
    return parsed if isinstance(parsed, list) else []


def as_dict(
    value, *, clean, json,
):
    """A jsonb column as a dict, whatever the driver handed back."""
    if isinstance(value, dict):
        return value
    text = clean(value)
    if not text:
        return {}
    try:
        parsed = json.loads(text)
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def jsonable(
    value, *, Decimal, date, datetime, jsonable,
):
    """A column value in a form ``json.dumps`` accepts, without losing meaning.

    Decimal becomes float on purpose. The driver returns ``Decimal('2.00')`` for
    an OTJH column while the tree save passes ``2.0``; as text those differ, and
    every alternate save would report a change to a field nobody touched.
    """
    if value is None or isinstance(value, (bool, int, float, str)):
        return value
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, dict):
        return {str(key): jsonable(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(item) for item in value]
    # UUID and anything else the driver invents: text is lossless enough for a
    # snapshot and always comparable.
    return str(value)


def parse_json_column(
    value, *, clean, json,
):
    """A JSON column as its parsed value, whether it arrived parsed or as text."""
    if isinstance(value, (dict, list)):
        return value
    text = clean(value)
    if not text:
        return None
    try:
        return json.loads(text)
    except (TypeError, ValueError):
        return None


def strip_credentials(
    value, *, strip_credentials,
):
    """The same value with any URL query string removed, however deep it sits.

    A stored upload URL can carry a SAS token, a signature or a one-time key in
    its query string. The allowlist above keeps such things out of *metadata*,
    but a component's own ``settings_json`` holds the URL as ordinary content,
    so without this the snapshot and the diff would quietly archive a working
    credential in an append-only table that nobody can edit afterwards.

    Only the query and fragment go. The path stays, because which file this is
    remains the useful part, and two different signatures for the same file were
    never a change worth reporting anyway.
    """
    if isinstance(value, str):
        if ('://' in value or value.startswith('/')) and ('?' in value or '#' in value):
            return value.split('?', 1)[0].split('#', 1)[0]
        return value
    if isinstance(value, dict):
        return {key: strip_credentials(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [strip_credentials(item) for item in value]
    return value


def redacted(
    value, *, REDACTED_PREFIX, hashlib, json, jsonable,
):
    """A stand-in that changes when the value changes and reveals nothing."""
    if value is None or value == '':
        return None
    text = value if isinstance(value, str) else json.dumps(jsonable(value), sort_keys=True, ensure_ascii=False)
    return REDACTED_PREFIX + hashlib.sha256(text.encode('utf-8')).hexdigest()[:16]


def audit_display_value(
    entity_type, field, value, *, REDACTED_COLUMNS, REDACTED_PREFIX, strip_credentials,
):
    """Apply today's privacy policy to old plaintext history on read as well."""
    if field.split('.', 1)[0] in REDACTED_COLUMNS.get(entity_type, ()):
        return None if value is None or value == '' else REDACTED_PREFIX + 'hidden'
    return strip_credentials(value)


def build_snapshot(
    entity_type, row, *, JSON_SNAPSHOT_COLUMNS, REDACTED_COLUMNS, SNAPSHOT_COLUMNS, SYSTEM_COLUMNS,
    jsonable, logged_settings, parse_json_column, redacted, strip_credentials,
):
    """The saved record as history will hold it, in a shape both write paths share.

    Always carries exactly the columns ``SNAPSHOT_COLUMNS`` declares for the
    entity — see the note there for why the source's own key set is not used.
    Columns named in ``REDACTED_COLUMNS`` carry a digest instead of the value.
    """
    row = row or {}
    hidden = REDACTED_COLUMNS.get(entity_type) or frozenset()
    skipped = SYSTEM_COLUMNS.get(entity_type) or frozenset()
    snapshot = {}
    for column in SNAPSHOT_COLUMNS.get(entity_type, ()):
        if column in skipped:
            continue
        value = row.get(column)
        if column in hidden:
            snapshot[column] = redacted(value)
            continue
        if column in JSON_SNAPSHOT_COLUMNS:
            parsed = parse_json_column(value)
            if column == 'settings_json':
                parsed = logged_settings(parsed)
            snapshot[column] = strip_credentials(jsonable(parsed)) if parsed is not None else None
            continue
        snapshot[column] = strip_credentials(jsonable(value))
    return snapshot


def logged_settings(
    settings, *, TEAMS_LINKED, TEAMS_LINK_KEYS, TEAMS_LINK_MARKER, TEAMS_SYSTEM_SETTING_KEYS,
):
    """Settings as the log keeps them: the Teams ids and links become one flag."""
    if not isinstance(settings, dict):
        return settings
    kept = {key: value for key, value in settings.items() if key not in TEAMS_SYSTEM_SETTING_KEYS}
    if any(settings.get(key) for key in TEAMS_LINK_KEYS):
        kept[TEAMS_LINK_MARKER] = TEAMS_LINKED
    return kept


def logged_view(
    entity_type, snapshot, *, SYSTEM_COLUMNS, logged_settings,
):
    """An older stored snapshot put in today's shape before it is compared.

    Rows written before these rules still carry the Teams ids and Microsoft's
    calendar ids. Comparing them as they are would report every one of those
    keys as removed on the next save.
    """
    if not snapshot:
        return snapshot
    skipped = SYSTEM_COLUMNS.get(entity_type) or frozenset()
    view = {key: value for key, value in snapshot.items() if key not in skipped}
    if isinstance(view.get('settings_json'), dict):
        view['settings_json'] = logged_settings(view['settings_json'])
    return view


def short(
    value, *, DIFF_VALUE_LIMIT, json,
):
    """A diff-sized rendering of a value, and whether it had to be cut."""
    if value is None:
        return '', False
    if isinstance(value, (dict, list)):
        text = json.dumps(value, sort_keys=True, ensure_ascii=False)
    else:
        text = str(value)
    if len(text) <= DIFF_VALUE_LIMIT:
        return text, False
    return f'{text[:DIFF_VALUE_LIMIT]}…', True
