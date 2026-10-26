"""Object-level authorization for learner quiz endpoints."""

from login.sessions import authenticate_request

from .selectors import learner_has_quiz_entitlement, resolve_quiz_learner


class QuizAccessDenied(Exception):
    def __init__(self, message, status):
        super().__init__(message)
        self.message = message
        self.status = status


def _not_found():
    return QuizAccessDenied("Quiz not found.", 404)


def _positive_id(value):
    try:
        value = int(str(value).strip())
    except (TypeError, ValueError):
        return None
    return value if value > 0 else None


def authorize_quiz_access(
    request,
    quiz_id,
    *,
    learner_id=None,
    kind=None,
    allow_staff_preview=False,
):
    """Authorize quiz visibility/action and return the exact learner context.

    Staff/admin detail preview is an evidenced existing read flow.  Submission
    calls this only after ``learner_self_or_admin`` has authorized the actor to
    act for the target learner, and still requires the target learner's plan to
    contain the quiz.
    """
    account = authenticate_request(request)
    if account is None:
        raise QuizAccessDenied("Authentication required.", 401)

    role = getattr(account, "role", None)
    if allow_staff_preview and role in {"admin", "staff"}:
        return None

    if role == "learner":
        account_learner_id = _positive_id(getattr(account, "subject_id", None))
        requested_learner_id = _positive_id(learner_id) if learner_id is not None else account_learner_id
        if account_learner_id is None or requested_learner_id != account_learner_id:
            raise _not_found()
        target_learner_id = account_learner_id
    elif role in {"admin", "staff"}:
        target_learner_id = _positive_id(learner_id)
        if target_learner_id is None:
            raise QuizAccessDenied("You do not have permission to perform this action.", 403)
    else:
        raise QuizAccessDenied("You do not have permission to perform this action.", 403)

    context = resolve_quiz_learner(target_learner_id)
    if context is None:
        raise _not_found()

    requested_kind = str(kind or "").strip().lower()
    if requested_kind and requested_kind != context.kind:
        raise _not_found()
    if not learner_has_quiz_entitlement(context, quiz_id):
        raise _not_found()
    return context
