"""Quiz-taking API: fetch a quiz to take, and submit a graded attempt.

Data source: curriculum.quizzes -> curriculum.quiz_questions -> curriculum.quiz_answers
(the `curriculum` schema, same Neon DB as enrolment — read-only raw SQL, same
pattern as learner_api.curriculum).

    GET  /learner_api/quizzes/<int:quiz_id>/             -> quiz + questions + answers
                                                             (answers scrubbed of is_correct
                                                             for gradeable types, so the
                                                             correct answer isn't shipped
                                                             to the browser before grading)
    POST /learner_api/quizzes/<int:quiz_id>/submit/?learnerId=<id>&kind=<commercial|apprenticeship>
                                                          -> grades the attempt server-side
                                                             and appends it to
                                                             "Learner"."Active_users"."Weekly_Quizzes"

`matching`/`image_matching`/`ordering`/`keywords` answer rows are all authored
with is_correct=True (they ARE the answer key, not distractors), so those types
are graded structurally instead of by is_correct: matching/image_matching parse
each answer_text's "left -> right" pairing; ordering uses sort_order as the
correct sequence; keywords accepts any N of the listed answer_texts.
"""
import json
import random
import re

from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.utils import timezone
from django.views.decorators.csrf import csrf_exempt

from .models import ActiveUser, CommercialUser, EnrolmentUser

SOURCE_MODELS = {
    "commercial": CommercialUser,
    "apprenticeship": EnrolmentUser,
}


def _conn():
    return connections["enrolment"]


def _error(message, status):
    return JsonResponse({"error": message}, status=status)


def _format_clock(seconds):
    """Seconds -> "MM:SS" (e.g. 26 -> "00:26", 90 -> "01:30")."""
    try:
        total = int(seconds)
    except (TypeError, ValueError):
        return None
    m, s = divmod(max(total, 0), 60)
    return f"{m:02d}:{s:02d}"


def _fetch_quiz(quiz_id):
    with _conn().cursor() as cur:
        cur.execute(
            "SELECT id, title, module, programme, week_id, duration, time_unit, "
            "passing_grade, randomize_questions, randomize_answers, default_question_type "
            "FROM curriculum.quizzes WHERE id = %s",
            [quiz_id],
        )
        row = cur.fetchone()
        if row is None:
            return None
        quiz = {
            "id": row[0], "title": row[1], "module": row[2], "programme": row[3],
            "weekId": row[4], "duration": row[5], "timeUnit": row[6],
            "passingGrade": row[7], "randomizeQuestions": row[8], "randomizeAnswers": row[9],
        }

        cur.execute(
            "SELECT id, question_text, question_type, points, sort_order, explanation "
            "FROM curriculum.quiz_questions WHERE quiz_id = %s AND is_archived = false "
            "ORDER BY sort_order",
            [quiz_id],
        )
        questions = [
            {
                "id": qid, "text": text, "type": qtype, "points": points,
                "sortOrder": sort_order, "explanation": explanation,
            }
            for qid, text, qtype, points, sort_order, explanation in cur.fetchall()
        ]
        if not questions:
            quiz["questions"] = []
            return quiz

        q_ids = [q["id"] for q in questions]
        cur.execute(
            "SELECT id, question_id, answer_text, is_correct, sort_order "
            "FROM curriculum.quiz_answers WHERE question_id = ANY(%s) ORDER BY question_id, sort_order",
            [q_ids],
        )
        answers_by_question = {}
        for aid, qid, text, is_correct, sort_order in cur.fetchall():
            answers_by_question.setdefault(qid, []).append({
                "id": aid, "text": text, "isCorrect": is_correct, "sortOrder": sort_order,
            })

        for q in questions:
            q["answers"] = answers_by_question.get(q["id"], [])
        quiz["questions"] = questions
        return quiz


def _scrub_answer_key(quiz):
    """Build a client-safe copy of the quiz: every field that would reveal the
    correct choice before grading is stripped, and answers are shuffled so
    array position can't leak it either (matching/ordering's "correct" shape
    IS the authored row order, so shipping rows as-is would hand the answer
    to anyone who reads the array top-to-bottom)."""
    safe_questions = []
    for q in quiz["questions"]:
        qtype = q["type"]
        answers = q["answers"]
        safe_q = {k: v for k, v in q.items() if k != "answers"}

        if qtype in ("single_choice", "multiple_choice", "true_false"):
            shuffled = list(answers)
            random.shuffle(shuffled)
            safe_q["answers"] = [{"id": a["id"], "text": a["text"]} for a in shuffled]

        elif qtype == "fill_gap":
            safe_q["answers"] = []  # free-text entry; nothing to display

        elif qtype in ("matching", "image_matching"):
            lefts, rights = [], []
            for a in answers:
                left, _, right = a["text"].partition("->")
                lefts.append({"id": a["id"], "left": left.strip()})
                rights.append(right.strip())
            random.shuffle(lefts)
            random.shuffle(rights)
            safe_q["answers"] = lefts
            safe_q["rightOptions"] = rights

        elif qtype == "ordering":
            shuffled = list(answers)
            random.shuffle(shuffled)
            safe_q["answers"] = [{"id": a["id"], "text": a["text"]} for a in shuffled]

        elif qtype == "keywords":
            safe_q["answers"] = []  # free-text entry; nothing to display
            safe_q["answerCount"] = len(answers)

        else:
            safe_q["answers"] = [{"id": a["id"], "text": a["text"]} for a in answers]

        safe_questions.append(safe_q)

    return {**{k: v for k, v in quiz.items() if k != "questions"}, "questions": safe_questions}


@csrf_exempt
def quiz_detail(request, quiz_id):
    if request.method != "GET":
        return _error("Method not allowed.", 405)
    try:
        quiz = _fetch_quiz(quiz_id)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if quiz is None:
        return _error("Quiz not found.", 404)
    return JsonResponse(_scrub_answer_key(quiz))


def _norm(text):
    return re.sub(r"\s+", " ", (text or "").strip().lower())


def _answer_text_by_id(answers):
    return {a["id"]: a["text"] for a in answers}


def _grade_question(question, submitted):
    """Return a dict describing how one question was graded: points earned/
    possible, whether it was fully correct, and human-readable text for what
    the learner chose vs. what the correct answer actually was (so a stored
    attempt can show "you answered X, the correct answer was Y" without a
    second lookup against curriculum.quiz_answers)."""
    points = question["points"] or 1
    qtype = question["type"]
    answers = question["answers"]
    by_id = _answer_text_by_id(answers)

    if qtype in ("single_choice", "true_false"):
        correct_ids = {a["id"] for a in answers if a["isCorrect"]}
        chosen_id = _coerce_id(submitted) if isinstance(submitted, (int, str)) else None
        ok = chosen_id in correct_ids
        return {
            "earned": points if ok else 0, "possible": points, "correct": ok,
            "chosenAnswer": by_id.get(chosen_id) if chosen_id is not None else None,
            "correctAnswer": ", ".join(by_id[i] for i in correct_ids),
        }

    if qtype == "multiple_choice":
        correct_ids = {a["id"] for a in answers if a["isCorrect"]}
        submitted_ids = {_coerce_id(v) for v in submitted} if isinstance(submitted, list) else set()
        ok = submitted_ids == correct_ids and len(correct_ids) > 0
        return {
            "earned": points if ok else 0, "possible": points, "correct": ok,
            "chosenAnswer": ", ".join(by_id[i] for i in submitted_ids if i in by_id) or None,
            "correctAnswer": ", ".join(by_id[i] for i in correct_ids),
        }

    if qtype == "fill_gap":
        accepted = {_norm(a["text"]) for a in answers}
        ok = isinstance(submitted, str) and _norm(submitted) in accepted
        return {
            "earned": points if ok else 0, "possible": points, "correct": ok,
            "chosenAnswer": submitted if isinstance(submitted, str) and submitted else None,
            "correctAnswer": " / ".join(a["text"] for a in answers),
        }

    if qtype in ("matching", "image_matching"):
        # pairs: raw left text (as shipped to the client and used as its
        # submitted_map key) -> right text, plus a normalized-key lookup for
        # tolerant comparison against the learner's submission.
        pairs = {}
        for a in answers:
            left, _, right = a["text"].partition("->")
            pairs[left.strip()] = right.strip()
        submitted_map = submitted if isinstance(submitted, dict) else {}
        total = len(pairs) or 1
        matched = sum(1 for left, right in pairs.items() if _norm(submitted_map.get(left, "")) == _norm(right))
        ok = matched == total
        earned = round(points * matched / total, 2)
        chosen_pairs = "; ".join(f"{left} -> {submitted_map.get(left) or '(no answer)'}" for left in pairs)
        correct_pairs = "; ".join(f"{left} -> {right}" for left, right in pairs.items())
        return {
            "earned": earned, "possible": points, "correct": ok,
            "chosenAnswer": chosen_pairs or None, "correctAnswer": correct_pairs,
        }

    if qtype == "ordering":
        correct_order = [a["id"] for a in sorted(answers, key=lambda a: a["sortOrder"])]
        submitted_order = [_coerce_id(v) for v in submitted] if isinstance(submitted, list) else []
        ok = submitted_order == correct_order
        return {
            "earned": points if ok else 0, "possible": points, "correct": ok,
            "chosenAnswer": " -> ".join(by_id[i] for i in submitted_order if i in by_id) or None,
            "correctAnswer": " -> ".join(by_id[i] for i in correct_order),
        }

    if qtype == "keywords":
        accepted = {_norm(a["text"]) for a in answers}
        submitted_words = [str(v) for v in submitted] if isinstance(submitted, list) else []
        submitted_norm = {_norm(v) for v in submitted_words}
        total = len(accepted) or 1
        matched = len(accepted & submitted_norm)
        ok = matched == total
        earned = round(points * matched / total, 2)
        return {
            "earned": earned, "possible": points, "correct": ok,
            "chosenAnswer": ", ".join(w for w in submitted_words if w.strip()) or None,
            "correctAnswer": ", ".join(a["text"] for a in answers),
        }

    return {"earned": 0, "possible": points, "correct": False, "chosenAnswer": None, "correctAnswer": None}


def _coerce_id(value):
    try:
        return int(value)
    except (TypeError, ValueError):
        return value


@csrf_exempt
def submit_quiz_attempt(request, quiz_id):
    if request.method != "POST":
        return _error("Method not allowed.", 405)

    kind = (request.GET.get("kind") or "").strip()
    learner_id = (request.GET.get("learnerId") or "").strip()
    model = SOURCE_MODELS.get(kind)
    if model is None or not learner_id:
        return _error("kind and learnerId query params are required.", 400)

    try:
        payload = json.loads(request.body.decode("utf-8")) if request.body else {}
    except (ValueError, UnicodeDecodeError) as exc:
        return _error(f"Invalid JSON body: {exc}", 400)

    submitted_answers = payload.get("answers") or {}
    time_taken_seconds = payload.get("timeTakenSeconds")
    started_at = payload.get("startedAt")
    week_title = payload.get("week")
    module_title = payload.get("module")
    # Post-quiz reflection window: KSBs the learner marks this quiz as fulfilling,
    # a general feedback note, and their self-reported time-to-complete.
    ksbs = payload.get("ksbs") if isinstance(payload.get("ksbs"), list) else []
    feedback = payload.get("feedback") or ""
    reported_time = payload.get("reportedTime") or ""

    try:
        quiz = _fetch_quiz(quiz_id)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)
    if quiz is None:
        return _error("Quiz not found.", 404)

    earned = 0.0
    possible = 0.0
    correct_count = 0
    breakdown = []
    for q in quiz["questions"]:
        submitted = submitted_answers.get(str(q["id"]))
        result = _grade_question(q, submitted)
        earned += result["earned"]
        possible += result["possible"]
        if result["correct"]:
            correct_count += 1
        breakdown.append({
            "questionId": q["id"],
            "questionText": q["text"],
            "type": q["type"],
            "points": q["points"],
            "earned": result["earned"],
            "possible": result["possible"],
            "correct": result["correct"],
            "chosenAnswer": result["chosenAnswer"],
            "correctAnswer": result["correctAnswer"],
        })

    question_count = len(quiz["questions"])
    grade_pct = round((earned / possible) * 100, 1) if possible else 0.0
    passed = grade_pct >= (quiz["passingGrade"] or 0)

    try:
        source = model.objects.get(pk=learner_id)
    except model.DoesNotExist:
        return _error("Learner not found.", 404)
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    try:
        active = ActiveUser.objects.filter(id=learner_id).first()
    except DatabaseError as exc:
        return _error(f"Database error: {exc}", 502)

    history = (active.weekly_quizzes if active and isinstance(active.weekly_quizzes, list) else [])
    # 1-based attempt number for THIS quiz (counts prior attempts of the same quiz).
    attempt_number = sum(1 for a in history if a.get("quizId") == quiz["id"]) + 1

    # Format grade so a whole number renders as "30%" (not "30.0%").
    grade_str = f"{int(grade_pct) if grade_pct == int(grade_pct) else grade_pct}%"

    attempt = {
        "week": week_title,
        "attempt": attempt_number,
        "grade": grade_str,                              # e.g. "30%"
        "Score": f"{correct_count}/{question_count}",    # questions correct / total, e.g. "6/20"
        "module": module_title or quiz["module"],
        "passed": passed,
        "quizId": quiz["id"],
        "quizName": quiz["title"],
        "ksbs": ksbs,                                    # KSB codes the learner selected
        "feedback": feedback,                            # general feedback about the quiz
        "reportedTime": reported_time,                   # learner's self-reported time-to-complete
        "questions": breakdown,
        "startedAt": started_at,
        "submittedAt": timezone.now().isoformat(),
        "timeTaken": _format_clock(time_taken_seconds),  # "M:SS", e.g. "0:26"
    }

    if active is not None:
        history.append(attempt)
        active.weekly_quizzes = history
        try:
            active.save(update_fields=["weekly_quizzes"])
        except DatabaseError as exc:
            return _error(f"Database error saving attempt: {exc}", 502)

    return JsonResponse({"attempt": attempt, "breakdown": breakdown, "earned": earned, "possible": possible})
