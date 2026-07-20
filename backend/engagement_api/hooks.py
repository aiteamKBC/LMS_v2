   """Real-time engagement-points hooks.

This module is the single entry point another app calls the instant a
grant-worthy learner event is recorded, so engagement points are awarded
synchronously (no cron/worker/listener). All point logic — which rule earns,
how the idempotency key is built, the "first attempt only" gate — lives HERE, so
the calling app only ever passes raw data and stays fully decoupled from points.

Currently called from `learner_api` the moment a Training_plan_progress record is
written (see learner_api/quizzes.py + learner_api/videos.py). As new
point-earning sources come online they call this same function.

Contract with callers: this function is BEST-EFFORT and must NEVER raise — a
points failure must not break (or roll back) the learner action that triggered
it. Callers still wrap the call defensively too, but the guarantee lives here.
"""
import logging

logger = logging.getLogger(__name__)


def record_progress_points(learner_id, learner_name, record):
    """Grant engagement points for one Training_plan_progress record, if it qualifies.

    `record` is a single progress entry as learner_api stores it — a dict with a
    "kind" ("quiz" or "video"), an "attempt" (1-based), and kind-specific fields.

    Points are awarded ONCE PER LEARNER PER QUIZ/VIDEO, on the FIRST ATTEMPT ONLY:
      - quiz  -> rule "quiz_passed", only if attempt == 1 AND the attempt passed.
                 A failed first attempt earns nothing, even if a later retake passes.
      - video -> rule "recorded_session_attended", only on the first watch (attempt 1).

    Never raises: a missing/inactive rule, a DB error, anything — all swallowed and
    logged, so the caller's own save is never affected.
    """
    try:
        # Lazy import: keeps this module cheap to import and avoids any import-time
        # coupling for callers that touch learner_api at module load.
        from .services import grant_points

        if not isinstance(record, dict) or record.get("attempt") != 1:
            return  # first attempt only — nothing else ever grants

        lid = str(learner_id)
        name = learner_name or ""
        kind = record.get("kind")

        if kind == "quiz" and record.get("passed"):
            # event_reference MUST carry the learner id: grant_points de-dupes on
            # (rule, event_reference) with NO learner filter (see services.py), so a
            # reference of just "quiz:64" would collide across learners. This form is
            # unique per (learner, quiz) and idempotent against a double-submit.
            ref = f"quiz:{record.get('quizId')}:learner:{lid}"
            grant_points("quiz_passed", lid, name, event_reference=ref)
        elif kind == "video":
            ref = f"video:{record.get('componentId')}:learner:{lid}"
            grant_points("recorded_session_attended", lid, name, event_reference=ref)
    except Exception:  # noqa: BLE001 — engagement points must never break the learner's save
        logger.warning("record_progress_points failed for learner %s", learner_id, exc_info=True)
