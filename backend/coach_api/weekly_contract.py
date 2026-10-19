"""One Weekly Learning contract, assembled directly from calculation facts."""


def learner_attendance(week):
    if week.get('sessionState') == 'upcoming':
        return 'upcoming'
    if week.get('sessionState') in {'cancelled', 'unscheduled'}:
        return 'unmarked'
    return 'present' if week.get('attended') is True else 'absent' if week.get('attended') is False else 'unmarked'


def compact_weekly(*, weeks=(), selected=None, summary=None, live_session=None, activities=()):
    """Serialize each navigation row once; selected detail refers to its ID."""
    modules, navigation = {}, []
    for week in weeks:
        modules.setdefault(week['moduleId'], {'id': week['moduleId'], 'title': week['moduleTitle']})
        navigation.append({key: value for key, value in week.items()
                           if key not in {'moduleTitle', 'attended'}} |
                          {'attendance': learner_attendance(week)})
    return {'modules': list(modules.values()), 'weeks': navigation,
            'selectedWeek': None if selected is None else {
                'weekId': selected['id'], 'summary': summary,
                'liveSession': ({key: value for key, value in live_session.items() if key != 'attended'} |
                                {'attendance': learner_attendance(live_session)}) if live_session else None,
                'activities': activities}}
