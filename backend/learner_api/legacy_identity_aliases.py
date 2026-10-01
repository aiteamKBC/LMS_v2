"""Plan copies of established legacy account links; never infer new owners."""
from collections import defaultdict


def email_key(value):
    return str(value or '').strip().casefold()


def identity_email(identity):
    payload = identity['source_payload']
    return email_key(payload.get('source_email') or payload.get('learner_email'))


def plan_aliases(state):
    learners, emails, sources, source_owners, alias_emails = (
        defaultdict(list), defaultdict(set), defaultdict(list),
        defaultdict(set), defaultdict(set),
    )
    for learner in state['learners']:
        learners[learner['aptem_id']].append(learner)
        if email_key(learner['email']):
            emails[email_key(learner['email'])].add(learner['id'])
    for identity in state['identities']:
        if identity['source_system'] == 'old_lms':
            sources[str(identity['source_learner_id'])].append(identity)
            if identity['deleted_at'] is None:
                address = identity_email(identity)
                if address:
                    emails[address].add(identity['learner_id'])
    for alias in state['aliases']:
        source_owners[str(alias['lms_learner_id'])].add(alias['aptem_id'])
        alias_emails[email_key(alias['lms_email'])].add(alias['aptem_id'])
    result = []
    for alias in state['aliases']:
        source_id = str(alias['lms_learner_id'])
        email = email_key(alias['lms_email'])
        item = {'source_learner_id': source_id, 'aptem_id': alias['aptem_id'],
                'resolution': 'review_required'}
        owners = learners[alias['aptem_id']]
        reason = None
        if not owners:
            reason = 'no_canonical_learner'
        elif len(owners) != 1:
            reason = 'ambiguous_canonical_learner'
        elif not source_id.isdigit() or int(source_id) <= 0 or not email or '@' not in email:
            reason = 'invalid_source_identity'
        else:
            owner = owners[0]
            item.update(learner_id=owner['id'], enrolment_id=owner['enrolment_id'])
            primary = [i for i in sources[str(alias['canonical_lms_id'])]
                       if i['deleted_at'] is None and i['learner_id'] == owner['id']]
            existing = sources[source_id]
            if email_key(alias['aptem_email']) != email_key(owner['email']):
                reason = 'canonical_email_mismatch'
            elif len(primary) != 1:
                reason = 'primary_identity_missing_or_ambiguous'
            elif source_owners[source_id] != {alias['aptem_id']}:
                reason = 'legacy_source_owner_conflict'
            elif alias_emails[email] != {alias['aptem_id']} or emails[email] - {owner['id']}:
                reason = 'email_owner_conflict'
            elif owner['enrolment_id'] is not None and (
                owner.get('account_id') != owner['enrolment_id']
                or email_key(owner.get('account_email')) != email_key(owner['email'])
                or (owner.get('account_aptem_id') is not None
                    and str(owner['account_aptem_id']) != str(owner['aptem_id']))
            ):
                reason = 'enrolment_owner_mismatch'
            elif existing:
                if (len(existing) == 1 and existing[0]['deleted_at'] is None
                        and existing[0]['learner_id'] == owner['id']):
                    if identity_email(existing[0]) == email:
                        item['resolution'] = 'already_present'
                    elif (alias['is_primary'] and not existing[0]['source_payload'].get('source_email')
                          and identity_email(existing[0]) == email_key(owner['email'])):
                        # The original import stored the canonical email here.
                        # Keep that original value and add the source account's
                        # actual address, verified by the same owned source ID.
                        item.update(resolution='add_source_email', identity_id=existing[0]['id'],
                                    source_payload={**existing[0]['source_payload'],
                                                    'source_email': email, 'legacy_alias': dict(alias)})
                    else:
                        reason = 'existing_source_email_conflict'
                else:
                    reason = 'existing_source_conflict_or_deleted'
            else:
                item.update(resolution='insert', source_payload={
                    'learner_email': email, 'source_email': email, 'aptem_id': alias['aptem_id'],
                    'legacy_alias': dict(alias),
                    'identity_import': {'source_table': 'Last_audit.learner_lms_aliases',
                                        'version': 1},
                })
        if reason:
            item['reason'] = reason
        result.append(item)
    return result
