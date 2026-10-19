"""Use the established LMS login, stable enrolment bridge, and current assignments."""
from dataclasses import dataclass
from django.db.models.functions import Lower, Trim
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
    cohort_name: str = ""

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
                     str(profile.cohort_id or "").strip(), str(profile.coach_email or "").strip().lower(),
                     cohort_name=str(profile.cohort or "").strip()[:200])

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
        if staff and "coach" in accesses_for_staff(staff) and str(staff.email or "").strip():
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
    for staff in StaffUser.objects.annotate(email_key=Lower(Trim("email"))).filter(email_key=learner.coach_email):
        if "coach" not in accesses_for_staff(staff):
            continue
        account = LoginAccount.objects.filter(subject_type="staff", subject_id=staff.pk, is_active=True).first()
        if account:
            result.append(principal_for_account(account))
    if len(result) != 1:
        raise AccessError("Your coach account needs to be confirmed.", 409)
    return result[0]

def eligible_learners(profiles):
    """Resolve the same live, unique enrolment bridge for every chat directory."""
    seen = set()
    for profile in profiles.order_by("full_name", "id"):
        if profile.enrolment_id in seen:
            continue
        seen.add(profile.enrolment_id)
        try:
            yield active_learner(profile.enrolment_id)
        except AccessError:
            continue

def active_profiles():
    return LearnerProfile.objects.filter(lifecycle_status="active").exclude(enrolment_id=None)

def _coach_once(learner, resolved):
    # This cache lives only while one roster is built. A later request or the
    # send-transaction recheck starts fresh, including previously denied grants.
    key = learner.coach_email.strip().lower()
    if key not in resolved:
        try:
            resolved[key] = coach_for(learner)
        except AccessError:
            resolved[key] = None
    return resolved[key]

def assigned_learners(viewer):
    if viewer.kind != "coach" or not viewer.email:
        return []
    profiles = active_profiles().annotate(coach_key=Lower(Trim("coach_email"))).filter(coach_key=viewer.email)
    result, coaches = [], {}
    for learner in eligible_learners(profiles):
        coach = _coach_once(learner, coaches)
        if coach is not None and coach.account_id == viewer.account_id:
            result.append(learner)
    return result

def cohort_members(cohort_id):
    """Current class learners and coaches, using exact cohort IDs throughout.

    One assigned eligible learner grants a coach access to the whole class.
    This same roster controls reads, sends, notifications and later delivery.
    """
    if not isinstance(cohort_id, str) or not cohort_id or len(cohort_id) > 64 or cohort_id != cohort_id.strip():
        raise AccessError()
    profiles = active_profiles().annotate(cohort_key=Trim("cohort_id")).filter(cohort_key=cohort_id)
    members, coaches = {}, {}
    for learner in eligible_learners(profiles):
        # Resolve again after the candidate query; a concurrent move is not a grant.
        if learner.cohort_id != cohort_id:
            continue
        members[learner.account_id] = learner
        coach = _coach_once(learner, coaches)
        if coach is not None:
            members[coach.account_id] = coach
    return list(members.values())

def cohort_directory(viewer):
    if viewer.kind == "coach":
        learners = assigned_learners(viewer)
    elif viewer.kind == "learner":
        learner = active_learner(viewer.subject_id)
        learners = [learner] if learner.account_id == viewer.account_id else []
    else:
        return []
    groups = {}
    for learner in learners:
        if learner.cohort_id:
            groups.setdefault(learner.cohort_id, {"id":learner.cohort_id,
                "name":learner.cohort_name or "Class chat"})
    return sorted(groups.values(), key=lambda group: (group["name"].casefold(), group["id"]))

def cohort_name(members):
    return next((person.cohort_name for person in members if person.kind == "learner" and person.cohort_name), "Class chat")

def participants(thread, viewer):
    """Recheck live membership for EVERY read, send and background delivery."""
    if thread.kind == "cohort":
        members = cohort_members(thread.cohort_id)
        if viewer.account_id not in {person.account_id for person in members}:
            raise AccessError()
        return members
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
    profiles = active_profiles()
    if viewer.kind == "learner":
        if not viewer.cohort_id:
            return []
        profiles = profiles.annotate(cohort_key=Trim("cohort_id")).filter(cohort_key=viewer.cohort_id).exclude(enrolment_id=viewer.subject_id)
        people = [person for person in eligible_learners(profiles) if person.cohort_id == viewer.cohort_id]
    else:
        people = assigned_learners(viewer)
    # Neon transaction pooling cannot retain a named server cursor between
    # fetches. A cohort/caseload is bounded by the current assignment query.
    return [{"id":str(person.subject_id), "name":person.name} for person in people]
