"""Learner-owned identities for Bulk Attendance, retaining its historical keys."""
from collections import defaultdict

from learner_api.models import LearnerProfile


def profiles_by_aptem_ids(learner_ids, *, fields=()):
    """Resolve each register key to one profile; never guess ambiguous matches."""
    numeric = set()
    for value in learner_ids:
        try:
            number = int(str(value))
        except (ValueError, TypeError):
            continue
        if 0 <= number <= 9_223_372_036_854_775_807:
            numeric.add(number)
    if not numeric:
        return {}
    candidates = defaultdict(list)
    for profile in LearnerProfile.objects.filter(aptem_id__in=numeric).only('id', 'aptem_id', *fields):
        candidates[str(profile.aptem_id)].append(profile)
    return {key: rows[0] for key, rows in candidates.items() if len(rows) == 1}


def aptem_ids_by_profile(profile_ids):
    """Map saved profile IDs to unique register keys, including off-page conflicts."""
    profile_ids = set(profile_ids)
    if not profile_ids:
        return {}
    aptem_ids = LearnerProfile.objects.filter(id__in=profile_ids).values_list('aptem_id', flat=True)
    return {profile.id: key for key, profile in profiles_by_aptem_ids(aptem_ids).items()
            if profile.id in profile_ids}
