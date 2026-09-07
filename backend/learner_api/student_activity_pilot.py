"""Fixed read-only rollout: Created_users 132–141, plus the original pilot.

Verified against enrolment and Last_audit on 2026-09-08. Match by Aptem identity,
never by the learner's display name or an id supplied in a query string.
"""

PILOT_APTEM_IDS = frozenset({
    92,     # Mohamed Elmasry (original pilot)
    4176,   # Anna Rundell
    2030,   # Amy-Marie Field
    4443,   # Amy Wilkinson
    3221,   # Andrew Raslan
    1411,   # Barry McLaughlin
    19694,  # Brooke Elmer
    1039,   # Benjamin Simmonds
    1792,   # Catherine Riley
    2438,   # Christian Moore-Peixe
    14183,  # Christelle Welland
})


def student_activity_available(aptem_id):
    try:
        return int(str(aptem_id).strip()) in PILOT_APTEM_IDS
    except (TypeError, ValueError):
        return False
