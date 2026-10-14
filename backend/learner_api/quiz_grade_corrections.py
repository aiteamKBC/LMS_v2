"""Audited repair of confirmed duplicate-label errors in legacy quiz attempts.

This is deliberately not a general regrader: changed keys, missing history,
weighted questions, snapshots and pass/fail transitions require separate review.
"""
from copy import deepcopy
from decimal import Decimal
import hashlib
import json

from django.core.serializers.json import DjangoJSONEncoder
from django.db import connections, transaction
from django.utils import timezone

from quiz_api.answer_keys import choice_label


RULE = "legacy-duplicate-choice-v1"
REASON = "Selected option has the same normalized text as the saved correct option."


def serialized(value):
    return json.dumps(value, cls=DjangoJSONEncoder, sort_keys=True, separators=(",", ":"))


def _rows(cursor, sql, params=()):
    cursor.execute(sql, params)
    columns = [column[0] for column in cursor.description]
    return [dict(zip(columns, row)) for row in cursor.fetchall()]


def _number(value):
    return Decimal(str(value)) if value is not None else None


def _feed_detail(correct, total):
    percent = round(correct / total * 100, 1)
    return f"Scored {percent:g}% · {correct}/{total}"


def plan_attempt(state, question_id):
    """Return a patch or a review reason; never infer a historical content key."""
    progress, answers = state["progress"], state["answers"]
    target = [a for a in answers if a["question_ref"] == question_id and a["is_correct"] is False]
    if not target:
        return None, None
    if len(target) != 1:
        return None, "Repeated question in historical attempt"
    answer = target[0]
    question = state["questions"].get(str(question_id))
    if not question or question["question_type"] not in {"single_choice", "true_false"}:
        return None, "Missing or unsupported question"
    selected = state["options"].get(str(answer["chosen_answer_ref"]))
    saved_keys = state["correct"].get(str(answer["id"]), [])
    correct = [state["options"].get(str(k["answer_ref"])) for k in saved_keys]
    if not selected or not correct or any(not c for c in correct):
        return None, "Missing historical answer references"
    if any(c["question_id"] != question_id for c in [selected, *correct]):
        return None, "Answer reference belongs to another question"
    label = choice_label(selected["answer_text"])
    if not label or {choice_label(c["answer_text"]) for c in correct} != {label}:
        return None, "Selected text does not match the complete saved key"
    # Singular questions must not conceal a second selection in the list table.
    chosen = state["chosen"].get(str(answer["id"]), [])
    if chosen and [c["answer_ref"] for c in chosen] != [answer["chosen_answer_ref"]]:
        return None, "Conflicting historical selections"
    if any(a.get("result_snapshot") is not None for a in answers):
        return None, "Snapshot-backed attempt requires separate review"
    if progress["kind"] != "quiz" or progress["passed"] is not True:
        return None, "Pass/fail transition requires completion and reward review"
    total = len(answers)
    if not total or _number(progress["total_score"]) != total:
        return None, "Incomplete historical question list"
    if len({a["question_ref"] for a in answers}) != total or len({a["position"] for a in answers}) != total:
        return None, "Duplicate historical questions or positions"
    for item in answers:
        q = state["questions"].get(str(item["question_ref"]))
        if not q or str(q["quiz_id"]) != str(progress["quiz_ref"]) or _number(q["points"]) != 1:
            return None, "Missing, moved or weighted question requires review"
        if item["is_correct"] is not True and item["is_correct"] is not False:
            return None, "Historical marking is incomplete"
        if _number(item["earned"]) != int(item["is_correct"]):
            return None, "Historical question scores are inconsistent"
    before_correct = sum(a["is_correct"] for a in answers)
    if (_number(progress["achieved_score"]) != before_correct
            or _number(progress["grade"]) != Decimal(str(round(before_correct / total, 2)))):
        return None, "Historical totals do not match the saved marking"
    before_feed = progress.get("feed_detail") or ""
    if before_feed and before_feed != _feed_detail(before_correct, total):
        return None, "Nonstandard activity summary requires review"
    after = deepcopy(state)
    after["progress"].update(
        achieved_score=Decimal(before_correct + 1),
        grade=Decimal(str(round((before_correct + 1) / total, 2))),
    )
    if before_feed:
        after["progress"]["feed_detail"] = _feed_detail(before_correct + 1, total)
    for item in after["answers"]:
        if item["id"] == answer["id"]:
            item.update(is_correct=True, earned=Decimal(1))
    return {"before": state, "after": after, "answer_id": answer["id"]}, None


def load_states(cursor, quiz_id, question_id, *, lock=False):
    suffix = " FOR UPDATE" if lock else ""
    progress = _rows(cursor, '''
        SELECT p.* FROM "Learner".learner_progress_entries p
        WHERE p.kind = 'quiz' AND p.quiz_ref = %s AND EXISTS (
            SELECT 1 FROM "Learner".learner_quiz_answers a
            WHERE a.progress_id = p.id AND a.question_ref = %s AND a.is_correct = false
        ) ORDER BY p.id
    ''' + suffix, [str(quiz_id), question_id])
    states = []
    for entry in progress:
        answers = _rows(cursor, '''SELECT * FROM "Learner".learner_quiz_answers
            WHERE progress_id = %s ORDER BY position, id''' + suffix, [entry["id"]])
        # Django's raw PostgreSQL cursor returns jsonb as text; the SQLite
        # regression fixture uses the same representation.
        for a in answers:
            a["is_correct"] = None if a["is_correct"] is None else bool(a["is_correct"])
            if isinstance(a.get("result_snapshot"), str):
                a["result_snapshot"] = json.loads(a["result_snapshot"])
        entry["passed"] = None if entry["passed"] is None else bool(entry["passed"])
        correct, chosen = {}, {}
        ids = [a["id"] for a in answers]
        placeholders = ",".join(["%s"] * len(ids))
        for table, mapping in (("learner_quiz_correct_answers", correct), ("learner_quiz_chosen_answers", chosen)):
            links = _rows(cursor, f'''SELECT * FROM "Learner".{table}
                WHERE quiz_answer_id IN ({placeholders}) ORDER BY quiz_answer_id, position''' + suffix, ids)
            for link in links:
                mapping.setdefault(str(link["quiz_answer_id"]), []).append(link)
        refs = sorted({a["question_ref"] for a in answers})
        placeholders = ",".join(["%s"] * len(refs))
        source_lock = " FOR SHARE" if lock else ""
        questions = {str(q["id"]): q for q in _rows(cursor, f'''
            SELECT id, quiz_id, question_type, points FROM curriculum.quiz_questions
            WHERE id IN ({placeholders}) ORDER BY id''' + source_lock, refs)}
        refs = {a["chosen_answer_ref"] for a in answers}
        refs.update(r["answer_ref"] for links in correct.values() for r in links)
        refs = sorted(r for r in refs if r is not None)
        placeholders = ",".join(["%s"] * len(refs))
        options = {str(o["id"]): o for o in _rows(cursor, f'''
            SELECT id, question_id, answer_text FROM curriculum.quiz_answers
            WHERE id IN ({placeholders}) ORDER BY id''' + source_lock, refs)} if refs else {}
        states.append({"progress": entry, "answers": answers, "correct": correct,
                       "chosen": chosen, "questions": questions, "options": options})
    return states


def build_plan(states, quiz_id, question_id):
    patches, deferred = [], []
    for index, state in enumerate(states, 1):
        patch, reason = plan_attempt(state, question_id)
        if patch:
            patches.append(patch)
        elif reason:
            deferred.append({"case": index, "reason": reason})
    digest = hashlib.sha256(serialized({"rule": RULE, "quiz": quiz_id,
        "question": question_id, "states": states}).encode()).hexdigest()
    return {"digest": digest, "patches": patches, "deferred": deferred}


def public_plan(plan):
    """No learner IDs, names, free-text reflections or answer evidence in stdout."""
    cases = []
    for index, patch in enumerate(plan["patches"], 1):
        before, after = patch["before"]["progress"], patch["after"]["progress"]
        cases.append({"case": index, "before": str(before["achieved_score"]),
                      "after": str(after["achieved_score"]), "total": str(before["total_score"]),
                      "grade_before": str(before["grade"]), "grade_after": str(after["grade"]),
                      "passed_unchanged": True})
    return {"digest": plan["digest"], "eligible": len(cases), "cases": cases, "deferred": plan["deferred"]}


def apply_plan(cursor, plan, question_id, *, refresh):
    """Caller must hold the transaction and locks used to build this plan."""
    for patch in plan["patches"]:
        before, after = patch["before"]["progress"], patch["after"]["progress"]
        # Unique key and audit insertion precede all edits; any error rolls
        # back both the ledger and the entire batch of grade corrections.
        cursor.execute('''INSERT INTO "Learner".learner_quiz_grade_corrections
            (progress_id, correction_key, plan_digest, reason, before_state, after_state, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)''',
            [before["id"], f"{RULE}:{question_id}", plan["digest"], REASON,
             serialized(patch["before"]), serialized(patch["after"]), timezone.now()])
        cursor.execute('''UPDATE "Learner".learner_quiz_answers SET is_correct = true, earned = 1
            WHERE id = %s AND progress_id = %s AND is_correct = false AND earned = 0''',
            [patch["answer_id"], before["id"]])
        if cursor.rowcount != 1:
            raise ValueError("Historical answer changed; preview again.")
        cursor.execute('''UPDATE "Learner".learner_progress_entries
            SET grade = %s, achieved_score = %s, feed_detail = %s WHERE id = %s''',
            [after["grade"], after["achieved_score"], after["feed_detail"], before["id"]])
        if cursor.rowcount != 1:
            raise ValueError("Historical attempt changed; preview again.")
        saved = _rows(cursor, '''SELECT * FROM "Learner".learner_progress_entries
            WHERE id = %s''', [before["id"]])[0]
        for field, value in after.items():
            actual = saved[field]
            if field in {"grade", "achieved_score", "total_score"}:
                actual, value = _number(actual), _number(value)
            if actual != value:
                raise ValueError("Attempt verification failed; correction rolled back.")
        refresh(before["learner_id"])


def run_correction(quiz_id, question_id, *, using="enrolment", expected_digest=None):
    connection = connections[using]
    if connection.vendor != "postgresql":
        raise ValueError("The repair command requires the verified PostgreSQL application database.")
    applying = expected_digest is not None
    with transaction.atomic(using=using), connection.cursor() as cursor:
        cursor.execute("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ" + ("" if applying else " READ ONLY"))
        cursor.execute("SET LOCAL lock_timeout = '10s'")
        cursor.execute("SET LOCAL statement_timeout = '60s'")
        states = load_states(cursor, quiz_id, question_id, lock=applying)
        plan = build_plan(states, quiz_id, question_id)
        if applying:
            if expected_digest != plan["digest"]:
                raise ValueError("Preview is stale. Run the read-only preview again.")

            def refresh(profile_id):
                from django.conf import settings
                from .read_model import enqueue_learner_home_refresh
                if not getattr(settings, "READ_MODEL_OUTBOX_ENABLED", False):
                    return
                from .models import LearnerProfile
                profile = LearnerProfile.objects.using(using).only("enrolment_id", "learner_type").get(pk=profile_id)
                kind = "commercial" if str(profile.learner_type).casefold() == "commercial" else "apprenticeship"
                if not enqueue_learner_home_refresh(kind, profile.enrolment_id, reason=RULE, using=using):
                    raise ValueError("Could not queue learner summary refresh; correction rolled back.")

            apply_plan(cursor, plan, question_id, refresh=refresh)
        return public_plan(plan)
