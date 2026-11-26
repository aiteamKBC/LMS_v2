"""Reviewed and roster-scoped attendance matching; raw evidence is never edited."""
from collections import defaultdict
import json
import re

from .session_results_policy import attendance_display_name, attendance_identity, attendance_name_key, session_roster
from .attendance_identity import teams_identity


def attendance_bot(record):
    """Recognize explicit note-taking assistants, not ordinary unknown guests."""
    name = attendance_display_name(record).casefold()
    domain = str(record.get('email') or '').strip().casefold().partition('@')[2]
    return bool(re.search(r'\bnote[\s-]*taker\b|\b(?:fireflies\.ai|otter\.ai|fathom)\b.*\bbot\b', name)
                or domain in {'fireflies.ai', 'otter.ai', 'fathom.video'})


def identity_key(record):
    email = str(record.get('email') or '').strip().casefold()
    return ('email', email) if email else ('guest_name', attendance_name_key(attendance_display_name(record)))


def record_key(record):
    return 'record', str(record.get('occurrence_id') or '') + ':' + str(record.get('id') or '')


def _source_identity_keys(record):
    """Correlate rejoins using reported account evidence, never a display name."""
    kind, object_id, tenant, _name = teams_identity(record)
    keys = set()
    if object_id:
        keys.add(('account', kind, tenant.casefold(), object_id))
    email = str(record.get('email') or '').strip().casefold()
    if email:
        keys.add(('email', email))
    return keys or {record_key(record)}


def series_identity_emails(series):
    """Explicit meeting staff, not the role assigned to an attendee by Teams."""
    get = series.get if isinstance(series, dict) else lambda key: getattr(series, key, None)
    values = [get('organizer_email')]
    for key in ('presenters', 'co_organizers'):
        people = get(key) or []
        if isinstance(people, str):
            try:
                people = json.loads(people)
            except (TypeError, ValueError):
                people = [people]
        if isinstance(people, list):
            values.extend(people)
    return {str(value).strip().casefold() for value in values if value}


def ambiguous_guest_names(records):
    """Different reported identities with one name must be reviewed separately.

    Repeated rows for the same Teams identity are reconnects. Without an identity
    ID, different source rows cannot be proven to be the same person.
    """
    identities = defaultdict(set)
    for record in records:
        value = attendance_name_key(attendance_display_name(record))
        if value:
            _name, identity_id = attendance_identity(record)
            identities[value].add(identity_id or str(record.get('email') or '').casefold() or 'row:' + str(record.get('id') or ''))
    return {name for name, values in identities.items() if len(values) > 1}


def _name_parts(value):
    return tuple(re.findall(r'[^\W\d_]+', attendance_name_key(value)))


def _one_typo(left, right):
    """One insertion, deletion, substitution or adjacent transposition.

    Short names need exact evidence: Eva must not become Eve by approximation.
    """
    if min(len(left), len(right)) < 4 or abs(len(left) - len(right)) > 1:
        return False
    if len(left) == len(right):
        different = [index for index, pair in enumerate(zip(left, right)) if pair[0] != pair[1]]
        return len(different) == 1 or (
            len(different) == 2 and different[1] == different[0] + 1
            and left[different[0]] == right[different[1]]
            and left[different[1]] == right[different[0]])
    short, long = sorted((left, right), key=len)
    index = next((i for i, pair in enumerate(zip(short, long)) if pair[0] != pair[1]), len(short))
    return short[index:] == long[index + 1:]


def _partial_candidates(record, alternatives):
    """One informative part is enough, but every similar candidate is retained.

    Name and email evidence are combined, not tried in order: an exact part
    must not hide another learner with a one-letter variation. Tenant/domain
    membership is shared by learners and cannot resolve that ambiguity.
    """
    name = _name_parts(attendance_display_name(record))
    local = str(record.get('email') or '').partition('@')[0].split('+', 1)[0]
    local_parts = _name_parts(local)
    queries = {part for part in (*name, *local_parts) if len(part) > 1}
    queries.update(value for value in (''.join(name), ''.join(local_parts)) if len(value) > 1)
    matches = {}
    for email, learner, names, parts in alternatives:
        targets = {part for part in (*names, *parts) if len(part) > 1}
        targets.update(value for value in (''.join(names), ''.join(parts)) if len(value) > 1)
        if any(left == right or _one_typo(left, right) for left in queries for right in targets):
            matches[email] = learner
    return matches


def apply_reviewed_identities(records, aliases=(), legacy_links=(), rules=(), *, learners=None, protected_emails=()):
    """Resolve staff decisions consistently for the register and reporting.

    A revoked rule blocks older links and automatic name matching. A duplicate
    guest name blocks the module rule, but an explicit per-record review wins.
    Optional learners is the full authorized roster, never a search-filtered
    subset. Automatic decisions are derived on read and remain correctable.
    """
    aliases = {str(row['alias_email']).strip().casefold(): row for row in aliases}
    legacy = {(str(row['occurrence_id']), str(row['attendance_row_id'])): row for row in legacy_links}
    rules = {(row['identity_kind'], row['identity_value']): row for row in rules}
    ambiguous = ambiguous_guest_names(records)
    protected = {str(email).strip().casefold() for email in protected_emails}
    candidates = defaultdict(dict)
    alternatives = []
    for email, learner in (learners or {}).items():
        name_key = attendance_name_key(learner.get('name'))
        if name_key and email:
            candidates[name_key][email] = learner
        if email:
            local, separator, _domain = str(email).partition('@')
            alternatives.append((email, learner, _name_parts(name_key),
                                 _name_parts(local.split('+', 1)[0]) if separator else ()))
    result = []
    automatic = []
    claims = defaultdict(set)
    source_targets = defaultdict(set)
    uncertain_sources = set()
    cached_candidates = {}
    for source in records:
        row = dict(source)
        key = identity_key(row)
        source_keys = _source_identity_keys(source)
        specific = rules.get(record_key(row))
        rule = specific or rules.get(key)
        collision = key[0] == 'guest_name' and key[1] in ambiguous
        row['identityReviewRequired'] = False
        row['identityAmbiguous'] = collision
        row['identityRule'] = rule
        if rule is not None:
            if rule.get('active') and (specific or not collision):
                row['email'] = rule['canonical_email']
            else:
                row['identityReviewRequired'] = key[0] != 'email'
        elif collision:
            row['identityReviewRequired'] = True
        else:
            old = (aliases.get(key[1]) if key[0] == 'email' else
                   legacy.get((str(row.get('occurrence_id')), str(row.get('id')))))
            if old:
                row['email'] = old['canonical_email']
                row['identityRule'] = {**old, 'active': True, 'revision': 0,
                                       'identity_kind': key[0], 'identity_value': key[1]}
            elif (str(row.get('email') or '').strip().casefold() not in (learners or {})
                  and str(row.get('email') or '').strip().casefold() not in protected
                  and str(row.get('role') or '').strip().casefold() in {'', 'attendee', 'presenter'}
                  and not attendance_bot(row)):
                cache_key = (attendance_name_key(attendance_display_name(row)), str(row.get('email') or '').casefold())
                if cache_key not in cached_candidates:
                    # Retain authoritative exact full-name guest matches. All
                    # weaker evidence (including different accounts) is checked
                    # together against the complete roster for ambiguity.
                    exact = candidates.get(cache_key[0]) if key[0] == 'guest_name' else None
                    cached_candidates[cache_key] = (exact, False) if exact else (_partial_candidates(row, alternatives), True)
                matches, extended = cached_candidates[cache_key]
                if len(matches) == 1:
                    email, learner = next(iter(matches.items()))
                    row['email'] = email
                    row['identityRule'] = {
                        'active': True, 'revision': 0, 'automatic': True,
                        'identity_kind': key[0], 'identity_value': key[1],
                        'learner_profile_id': learner.get('learnerProfileId'),
                        'canonical_email': email, 'display_name': attendance_display_name(source),
                    }
                    automatic.append((row, source.get('email') or '', source_keys, extended))
                elif len(matches) > 1:
                    row['identityReviewRequired'] = True
                    row['identityAmbiguous'] = True
        if row.get('email') and not row['identityReviewRequired']:
            participant = next((key for key in source_keys if key[0] == 'account'),
                               ('email', str(source['email']).strip().casefold()) if source.get('email') else record_key(source))
            claims[str(row['email']).strip().casefold()].add(participant)
            if str(row['email']).strip().casefold() in (learners or {}):
                for source_key in source_keys:
                    source_targets[source_key].add(str(row['email']).strip().casefold())
        if (row['identityReviewRequired'] or (rule is not None and not rule.get('active'))
                or str(source.get('email') or '').strip().casefold() in protected):
            uncertain_sources.update(source_keys)
        result.append(row)
    # Two distinct reported people must not collapse onto one learner just
    # because one used a first name and the other a surname/local part.
    # Keep explicit reviews and existing full-name/email decisions authoritative.
    for row, original_email, source_keys, extended in automatic:
        conflicting_rejoin = bool(source_keys & uncertain_sources) or any(
            len(source_targets[key]) > 1 for key in source_keys)
        if conflicting_rejoin or (extended and len(claims[str(row['email']).strip().casefold()]) > 1):
            row.update(email=original_email, identityRule=None,
                       identityReviewRequired=True, identityAmbiguous=True)
    return result


def unmatched_roster(records, *, complete):
    """Keep same-name participants separate so a reviewer can choose one."""
    ambiguous = ambiguous_guest_names(records) | {identity_key(row)[1] for row in records if row.get('identityAmbiguous')}
    groups = defaultdict(list)
    ordinary = []
    for row in records:
        if identity_key(row)[1] in ambiguous and not row.get('email'):
            groups[(identity_key(row)[1], attendance_identity(row)[1] or str(row['id']))].append(row)
        else:
            ordinary.append(row)
    result = session_roster(set(), ordinary, complete=complete)
    for rows in groups.values():
        for person in session_roster(set(), rows, complete=complete):
            person['identityAmbiguous'] = True
            person['suggestedLearnerProfileId'] = None
            result.append(person)
    ambiguous_ids = {str(row.get('id') or row.get('graph_record_id') or '') for row in records
                     if row.get('identityAmbiguous')}
    for person in result:
        if ambiguous_ids.intersection(person['sourceRecordIds']):
            person['identityAmbiguous'] = True
            person['suggestedLearnerProfileId'] = None
    return result


def link_specs(selected, all_records):
    """Derive scope from server-owned report rows, never a client-supplied name."""
    keys = {identity_key(row) for row in selected}
    if len(keys) != 1:
        raise ValueError('Choose one Teams identity at a time.')
    kind, value = next(iter(keys))
    if kind == 'guest_name' and (not value or value in ambiguous_guest_names(all_records)):
        # A same-name collision is reviewed one distinct Teams identity at a time.
        identities = {attendance_identity(row)[1] or 'row:' + str(row['id']) for row in selected}
        if len(identities) != 1:
            raise ValueError('Several participants used this name. Review each participant separately.')
        return [record_key(row) for row in selected]
    return [(kind, value)]
