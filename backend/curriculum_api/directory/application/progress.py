"""Read progress for a verified profile and exact current/imported module identities."""


def learner_progress(
    source, profile_id, module_ids, today, *, require_profile, load_context, assemble_cards,
    activity_summary, ServiceError,
):
    owner = require_profile(source.pk)
    if str(owner['id']) != str(profile_id):
        raise ServiceError('The learner identity needs review.', 'identity_review_required', 409)
    _, _, records, native, courses, definitions, done, started, hours, metadata, credits = load_context(source, owner)
    cards, _ = assemble_cards(native, metadata['current_subjects'], courses, definitions,
                             done, started, hours, metadata, records, metadata['modules'], credits,
                             include_activity_items=True)
    # Imported/replacement subjects are linked by verified identities, never titles.
    links = {**metadata['imported_courses'], **metadata['replacement_courses']}
    allowed = {f'current:{mid}' for mid in module_ids}
    allowed.update(old for current, old in links.items() if current in allowed)
    items = [item for card in cards
             if card['id'] in allowed or card.get('moduleId') in module_ids
             for item in card['_activityItems']]
    return activity_summary(items, today)


class MissingProgressScope(Exception):
    """The requested curriculum record no longer exists."""


class ChangedProgressScope(Exception):
    """At least one requested profile is no longer a member of this scope."""


def read_progress(scope, identifier, ids, *, target_rows, read_module_ids, read_sources,
                  current_date, learner_progress, DatabaseError, ServiceError):
    rows = target_rows(scope, identifier)
    if rows is None:
        raise MissingProgressScope()
    by_id = {row['id']: row for row in rows}
    if any(value not in by_id for value in ids):
        raise ChangedProgressScope()
    module_ids = read_module_ids(scope, identifier)
    sources = read_sources([by_id[value]['enrolmentId'] for value in ids if by_id[value].get('enrolmentId')])
    today = current_date()
    result = {}
    for value in ids:
        source = sources.get(str(by_id[value].get('enrolmentId')))
        try:
            if source is None:
                raise LookupError()
            result[value] = learner_progress(source, value, module_ids, today)
        except (DatabaseError, ServiceError, LookupError):
            result[value] = {'error': 'Progress is unavailable. Please retry or review the learner identity.'}
    return result
