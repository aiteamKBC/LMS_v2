"""Read-only MCM recipient grouping; pagination keeps each learner's reviews together."""


def _text(value):
    return str(value or '').strip()


def current_coach(owner):
    name = _text(owner.get('coach_name'))
    email = _text(owner.get('coach_email')).casefold()
    key = f'email:{email}' if email else 'unlinked' if name else 'unassigned'
    label = (name or email) if email else 'Coach not linked' if name else 'No coach assigned'
    return {'key': key, 'name': label, 'email': email, 'recordedName': name}


def _counts(reviews):
    completed = sum(row.get('responseStatus') == 'completed' for row in reviews)
    return {'reviewCount': len(reviews), 'completedCount': completed,
            'remainingCount': len(reviews) - completed}


def group_mcm_recipients(rows, current_coaches, *, search='', coach_key='', page=1, page_size=25):
    """Use current enrolment ownership, never the reviewer on historical feedback.

    Coach email is the identity key. Name-only assignments are explicitly shown
    as unlinked rather than merging different people who happen to share a name.
    Search selects learners, preserving all of their reviews in this form family.
    """
    learners = {}
    query = search.strip().casefold()
    for row in rows:
        learner_id = str(row['learnerId'])
        learner = learners.setdefault(learner_id, {
            'learnerId': learner_id, 'learnerName': row['learnerName'],
            'email': row.get('email', ''), 'programme': row.get('programme', ''), 'reviews': [],
        })
        learner['reviews'].append(row)

    groups = {}
    for learner_id, learner in learners.items():
        owner = current_coaches.get(learner_id, {})
        identity = current_coach(owner)
        name, email, key, label = (identity[field] for field in ('recordedName', 'email', 'key', 'name'))
        if query and not any(query in _text(value).casefold() for value in (
            learner['learnerName'], learner['email'], learner['programme'], name, email, label,
        )):
            continue
        learner['coachName'] = name or label
        learner['reviews'] = sorted(learner['reviews'],
                                    key=lambda row: (row.get('sourceStartsAt') or '', row['key']), reverse=True)
        learner.update(_counts(learner['reviews']))
        group = groups.setdefault(key, {'key': key, 'name': label, 'email': email, 'learners': []})
        group['learners'].append(learner)

    ordered = sorted(groups.values(), key=lambda group: (
        not bool(group['email']), group['name'].casefold(), group['key'],
    ))
    summaries = []
    for group in ordered:
        group['learners'].sort(key=lambda learner: (learner['learnerName'].casefold(), learner['learnerId']))
        summaries.append({
            'key': group['key'], 'name': group['name'], 'email': group['email'],
            'learnerCount': len(group['learners']),
            **_counts([row for learner in group['learners'] for row in learner['reviews']]),
        })
    selected = groups.get(coach_key, {}).get('learners', [])
    pages = max((len(selected) + page_size - 1) // page_size, 1)
    page = min(page, pages)
    start = (page - 1) * page_size
    return {
        'coaches': summaries, 'coachKey': coach_key, 'learners': selected[start:start + page_size],
        'totalLearners': sum(group['learnerCount'] for group in summaries),
        'totalReviews': sum(group['reviewCount'] for group in summaries),
        'totalCompleted': sum(group['completedCount'] for group in summaries),
        'page': page, 'pageSize': page_size, 'pages': pages,
    }
