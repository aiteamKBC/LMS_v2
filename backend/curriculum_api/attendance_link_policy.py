"""Reviewed and exact-name attendance matching; raw evidence is never edited."""
from collections import defaultdict
import re

from .session_results_policy import attendance_display_name, attendance_identity, attendance_name_key, session_roster


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


def apply_reviewed_identities(records, aliases=(), legacy_links=(), rules=(), *, learners=None):
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
    candidates = defaultdict(dict)
    for email, learner in (learners or {}).items():
        name_key = attendance_name_key(learner.get('name'))
        if name_key and email:
            candidates[name_key][email] = learner
    result = []
    for source in records:
        row = dict(source)
        key = identity_key(row)
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
            elif key[0] == 'guest_name' and str(row.get('role') or '').strip().casefold() in {'', 'attendee'}:
                matches = candidates.get(key[1], {})
                if len(matches) == 1:
                    email, learner = next(iter(matches.items()))
                    row['email'] = email
                    row['identityRule'] = {
                        'active': True, 'revision': 0, 'automatic': True,
                        'identity_kind': 'guest_name', 'identity_value': key[1],
                        'learner_profile_id': learner.get('learnerProfileId'),
                        'canonical_email': email, 'display_name': attendance_display_name(source),
                    }
                elif len(matches) > 1:
                    row['identityReviewRequired'] = True
                    row['identityAmbiguous'] = True
        result.append(row)
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
