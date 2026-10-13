"""Use the established LMS login, stable enrolment bridge, and current assignments."""
from dataclasses import dataclass
from django.db.models import Q
from learner_api.models import LearnerProfile, StaffUser, EnrolmentUser
from login.models import LoginAccount
from login.identity import accesses_for_staff
from login.sessions import authenticate_request, session_unreadable

class AccessError(Exception):
    def __init__(self, message="This conversation is not available.", status=403):
        self.message, self.status = message, status

@dataclass(frozen=True)
class Principal:
    account_id: int
    subject_id: int
    kind: str
    name: str
    cohort_id: str = ""
    coach_email: str = ""
    email: str = ""

def active_learner(source_id):
    account = LoginAccount.objects.filter(subject_type="learner", subject_id=source_id,
                                          is_active=True, role="learner").first()
    profiles = list(LearnerProfile.objects.filter(enrolment_id=source_id,
                                                  lifecycle_status="active")[:2])
    source = EnrolmentUser.all_learners.filter(pk=source_id).first()
    if not account or not source or len(profiles) != 1:
        raise AccessError()
    profile = profiles[0]
    return Principal(account.pk, source_id, "learner", str(profile.full_name or "Learner")[:200],
                     str(profile.cohort_id or "").strip(), str(profile.coach_email or "").strip().lower())

def principal_for_account(account):
    if not account or not account.is_active:
        raise AccessError("Please sign in.", 401)
    if account.subject_type == "learner" and account.role == "learner":
        principal = active_learner(account.subject_id)
        if principal.account_id != account.pk:
            raise AccessError()
        return principal
    if account.subject_type == "staff":
        staff = StaffUser.objects.filter(pk=account.subject_id).first()
        if staff and "coach" in accesses_for_staff(staff):
            return Principal(account.pk, staff.pk, "coach", str(account.display_name or "Coach")[:200],
                             email=str(staff.email or "").strip().lower())
    raise AccessError()

def authenticate(request):
    account = authenticate_request(request)
    if account is None and session_unreadable(request):
        raise AccessError("Sign-in is temporarily unavailable.", 503)
    return principal_for_account(account)

def coach_for(learner):
    if not learner.coach_email:
        raise AccessError("Your coach assignment needs to be confirmed.", 409)
    # Reject ambiguous directory matches instead of assigning an arbitrary account.
    result = []
    for staff in StaffUser.objects.filter(email__iexact=learner.coach_email):
        if "coach" not in accesses_for_staff(staff):
            continue
        account = LoginAccount.objects.filter(subject_type="staff", subject_id=staff.pk, is_active=True).first()
        if account:
            result.append(principal_for_account(account))
    if len(result) != 1:
        raise AccessError("Your coach account needs to be confirmed.", 409)
    return result[0]

def participants(thread, viewer):
    """Recheck live membership for EVERY read, send and background delivery."""
    if thread.kind == "cohort":
        if viewer.kind != "learner" or not viewer.cohort_id or viewer.cohort_id != thread.cohort_id:
            raise AccessError()
        return [viewer]
    a = active_learner(thread.learner_a)
    if thread.kind == "peer":
        b = active_learner(thread.learner_b)
        if not a.cohort_id or a.cohort_id != b.cohort_id or a.cohort_id != thread.cohort_id:
            raise AccessError()
    elif thread.kind == "coach":
        b = coach_for(a)
        if b.subject_id != thread.coach_id:
            raise AccessError()
    else:
        raise AccessError()
    if viewer.account_id not in {a.account_id, b.account_id}:
        raise AccessError()
    return [a, b]

def peer_directory(viewer):
    profiles = LearnerProfile.objects.filter(lifecycle_status="active").exclude(enrolment_id=None)
    if viewer.kind == "learner":
        if not viewer.cohort_id:
            return []
        profiles = profiles.filter(cohort_id=viewer.cohort_id).exclude(enrolment_id=viewer.subject_id)
    else:
        profiles = profiles.filter(coach_email__iexact=viewer.email)
    entries = []
    for profile in profiles.order_by("full_name", "id")[:500]:
        try:
            person = active_learner(profile.enrolment_id)
        except AccessError:
            continue
        entries.append({"id": str(person.subject_id), "name": person.name})
    return entries
