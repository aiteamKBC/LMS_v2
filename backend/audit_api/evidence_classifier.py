"""Content-based evidence classification.

Learners upload evidence into the WRONG Aptem component often enough that the
component name cannot be trusted — so the verdict here comes from the FILE'S
OWN CONTENT: the PDF/DOCX text (or the page image / photo, via the vision
model) and the note body. The component name is passed to the model only as a
hint, and a ``mismatch`` flag records when the content contradicts the slot it
was uploaded into — the "misfiled evidence" report.

Results land in our own table (``structured_manual_activities.
evidence_content_classification``) — the fetch service's tables are never
written to. Run via::

    python manage.py classify_evidence --limit 20
    python manage.py classify_evidence --aptem-id 14548
"""

import base64
import io
import json
import re
import time
import urllib.request

from django.conf import settings

from learner_api import evidence_storage

from .last_audit_ledger_views import _connection, _dict_rows

EVIDENCE_ITEMS = '"fetching_evidence"."evidence_items"'
CLASSIFICATIONS = '"structured_manual_activities"."evidence_content_classification"'
EVIDENCE_CONTAINER = "fetch-aptem-evidences"

CATEGORIES = (
    "assignment",
    "attendance_reflection",
    "lms_activity",
    "review",
    "work_product",
    "administrative",
    "other",
)

# --- Hint rules (provisional tier): the Aptem slot name, then the file's own
# name. Measured coverage ~90% — used until the content verdict exists, and as
# the fallback for archives/media that carry no classifiable content.
_COMPONENT_RULES = (
    ("assignment", re.compile(r"assig[nm]", re.I)),  # catches the "Assigmen" typos too
    ("attendance_reflection", re.compile(r"attendance", re.I)),
    ("lms_activity", re.compile(r"lms.activit|lms-activity|recordings?\b|m&q", re.I)),
    ("review", re.compile(r"review", re.I)),
    ("work_product", re.compile(r"additional job|job activit", re.I)),
    ("administrative", re.compile(
        r"welcome|support plan|induction|onboard|declaration|rpl|health & safety", re.I)),
)
_NAME_RULES = (
    ("assignment", re.compile(r"\bassig[nm]", re.I)),
    ("review", re.compile(r"^review\b|\breview -", re.I)),
    # A reflection about a RECORDING belongs to the LMS (recordings live
    # there); only LIVE-session reflections are attendance.
    ("lms_activity", re.compile(r"record", re.I)),
    ("attendance_reflection", re.compile(r"\battend|reflection", re.I)),
    ("lms_activity", re.compile(r"\blms\b|lecture|quiz", re.I)),
)


def classify_by_hints(component_name, evidence_name, hours_type, evidence_kind):
    """(category, source, needs_review) from metadata only — pure function."""
    component = str(component_name or "")
    for category, pattern in _COMPONENT_RULES:
        if pattern.search(component):
            return category, "component", False
    name = str(evidence_name or "")
    for category, pattern in _NAME_RULES:
        if pattern.search(name):
            return category, "file-name", False
    if str(evidence_kind or "").lower() == "note" and str(hours_type or "").lower() != "offthejobtraining":
        return "administrative", "kind", False
    return "other", "unresolved", True

_PROMPT = """You classify one apprenticeship evidence document from Kent Business College.
Decide what the document ITSELF is — learners often upload files into the wrong slot,
so the slot name is only a hint and must be overridden when the content disagrees.

Categories (pick exactly one):
- assignment: a written assignment/assessment submission (briefs, reports, essays, submitted work for marking).
- attendance_reflection: a reflection about attending a LIVE session ONLY — in person or live online (Teams/Zoom/webinar). Signals: "attended", a live lecture on a specific date, register-style records.
- lms_activity: evidence of consuming LMS course content — completed videos/quizzes/lessons, LMS certificates, quiz results, AND watching RECORDED sessions/lectures. IMPORTANT: a reflection about a RECORDING the learner watched (recorded session, catch-up video) is lms_activity, NOT attendance_reflection — recordings live on the LMS, so the LMS slot is the correct place for them.
- review: a progress review / eligibility review / tripartite review record.
- work_product: real workplace output (work documents, job tasks, additional job activities).
- administrative: forms, declarations, support plans, onboarding/welcome paperwork, general comments with no learning content. INCLUDES completed induction/onboarding questionnaires (e.g. "Welcome to Your Apprenticeship" handbook Q&A, policy acknowledgements) — answered questions do NOT make induction paperwork an assignment. An assignment is a substantive assessed piece of work for the programme's modules.
- other: genuinely none of the above.

KBC's "LMS Submission Template" (header: "LMS Submission Template … For quizzes, lecture
reflections, readings, slides, videos and audio tasks") is the standard form for LMS work:
a generic "what I learnt" reflection written on this template with NO explicit live-session
markers is lms_activity. Classify as attendance_reflection ONLY when the text explicitly
shows LIVE attendance (e.g. "attended", a live lecture/webinar on Teams/Zoom, in-person) —
learners sometimes use the wrong template, so explicit live markers override the template.

Respond with ONLY a JSON object:
{"category": "<one of the categories>", "confidence": <0.0-1.0>, "matches_slot": <true|false>, "reason": "<one short sentence>"}
"matches_slot" says whether your category agrees with the slot the file was uploaded into."""


_DDL = f"""
CREATE TABLE IF NOT EXISTS {CLASSIFICATIONS} (
    evidence_id     bigint PRIMARY KEY,
    aptem_id        bigint NOT NULL,
    category        text   NOT NULL,
    confidence      double precision,
    mismatch        boolean NOT NULL DEFAULT false,
    method          text   NOT NULL,
    model_name      text,
    extracted_chars integer,
    reason          text,
    classified_at   timestamptz NOT NULL DEFAULT now()
)
"""


def ensure_classification_table(cursor):
    cursor.execute(_DDL)
    # Auditor review verdicts on top of the model's classification.
    cursor.execute(f"ALTER TABLE {CLASSIFICATIONS} ADD COLUMN IF NOT EXISTS review_status text")
    cursor.execute(f"ALTER TABLE {CLASSIFICATIONS} ADD COLUMN IF NOT EXISTS reviewed_at timestamptz")


def _download(blob, max_bytes=30_000_000, deadline_s=60):
    """Chunked read with a WALL-CLOCK deadline: the socket timeout alone
    cannot stop a blob that trickles a few bytes per second forever (a real
    item did exactly that and froze its whole shard for 10+ minutes)."""
    url = evidence_storage.get_read_sas(EVIDENCE_CONTAINER, blob)
    with urllib.request.urlopen(url, timeout=30) as response:
        length = response.headers.get("Content-Length")
        if length and int(length) > max_bytes:
            raise RuntimeError(f"Blob too large to classify ({length} bytes).")
        chunks, total = [], 0
        deadline = time.monotonic() + deadline_s
        while True:
            chunk = response.read(65536)
            if not chunk:
                break
            chunks.append(chunk)
            total += len(chunk)
            if total > max_bytes:
                raise RuntimeError(f"Blob exceeded {max_bytes} bytes mid-download.")
            if time.monotonic() > deadline:
                raise RuntimeError(f"Download exceeded {deadline_s}s ({total} bytes so far).")
        return b"".join(chunks)


def _pdf_text_or_image(data):
    """Text layer if the PDF has one; else the first page rendered as PNG."""
    import fitz

    with fitz.open(stream=data, filetype="pdf") as pdf:
        text = "\n".join(page.get_text() for page in pdf[:6]).strip()
        if len(text) >= 120:
            return text, None
        pixmap = pdf[0].get_pixmap(dpi=110)
        return None, pixmap.tobytes("png")


def _docx_text(data):
    import docx

    document = docx.Document(io.BytesIO(data))
    return "\n".join(paragraph.text for paragraph in document.paragraphs).strip()


def extract_content(name, data):
    """(text, image_png_bytes, method) for one downloaded evidence file."""
    lowered = (name or "").lower()
    if re.search(r"\.pdf($|\?)", lowered) or data[:4] == b"%PDF":
        text, image = _pdf_text_or_image(data)
        return text, image, "pdf-text" if text else "pdf-vision"
    if re.search(r"\.docx?($|\?)", lowered):
        try:
            return _docx_text(data), None, "docx-text"
        except Exception:
            return None, None, "unreadable"
    if re.search(r"\.(png|jpe?g|gif|bmp|webp|heic)($|\?)", lowered) or data[:8].startswith(b"\x89PNG") or data[:3] == b"\xff\xd8\xff":
        return None, data, "image-vision"
    try:
        text = data.decode("utf-8").strip()
        return (text or None), None, "plain-text"
    except (UnicodeDecodeError, AttributeError):
        return None, None, "unreadable"


def _llm_classify(client, model, slot_name, file_name, text=None, image_png=None):
    user_content = [{
        "type": "text",
        "text": (
            f"Uploaded into slot: {slot_name or 'unknown'}\n"
            f"File name: {file_name or 'unknown'}\n"
            + (f"Document text (may be truncated):\n{text[:6000]}" if text else "The document is the attached image.")
        ),
    }]
    if image_png is not None:
        encoded = base64.b64encode(image_png).decode("ascii")
        user_content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/png;base64,{encoded}", "detail": "low"},
        })
    # Newer OpenAI models reject max_tokens (and some pin temperature=1) —
    # max_completion_tokens is the accepted form across current models.
    kwargs = {}
    if model.startswith("gpt-5"):
        # This is a simple 7-way classification: low reasoning keeps the
        # quality and cuts both latency and reasoning-token cost sharply.
        kwargs["reasoning_effort"] = "low"
    response = client.chat.completions.create(
        model=model,
        messages=[
            {"role": "system", "content": _PROMPT},
            {"role": "user", "content": user_content},
        ],
        max_completion_tokens=1500,
        response_format={"type": "json_object"},
        **kwargs,
    )
    content = response.choices[0].message.content
    if not content:
        raise RuntimeError("The model returned an empty response.")
    payload = json.loads(content)
    category = str(payload.get("category") or "other").strip().lower()
    if category not in CATEGORIES:
        category = "other"
    try:
        confidence = max(0.0, min(1.0, float(payload.get("confidence"))))
    except (TypeError, ValueError):
        confidence = 0.5
    return category, confidence, bool(payload.get("matches_slot", True)), str(payload.get("reason") or "")[:300]


def _prepare_item(client, model, item):
    """Network-only stage (safe to run in a thread): download, extract,
    classify. Returns the values to store — no database access here."""
    evidence_id = int(item["evidence_id"])
    name = item.get("evidence_name") or f"Evidence {evidence_id}"
    slot = item.get("component_name") or ""
    text = image = None
    note = (item.get("note_content") or "").strip()
    if str(item.get("evidence_kind") or "").lower() == "note" or (not item.get("file_blob") and note):
        text, method = note, "note-text"
    elif re.search(r"\.(zip|rar|7z|mp4|mp3|mov|avi)($|\?)", name.lower()):
        # Archives/media have no classifiable text — don't download them.
        method = "archive-or-media"
    elif item.get("file_blob"):
        data = _download(item["file_blob"])
        text, image, method = extract_content(name, data)
    else:
        method = "no-content"
    if not text and image is None:
        # Nothing classifiable inside — fall back to the hint rules so a
        # "…LMS Submission.zip" still lands in the right bucket.
        category, hint_source, _ = classify_by_hints(
            slot, name, item.get("hours_type"), item.get("evidence_kind"))
        confidence, matches = 0.3, True
        reason = f"No readable content ({method}); classified from {hint_source} hint."
        method = f"{method}:hints"
    else:
        category, confidence, matches, reason = _llm_classify(client, model, slot, name, text, image)
    return {
        "evidence_id": evidence_id,
        "aptem_id": int(item["learner_id"]),
        "name": name,
        "category": category,
        "confidence": confidence,
        "mismatch": not matches,
        "method": method,
        "extracted_chars": len(text) if text else None,
        "reason": reason,
    }


def classify_batch(aptem_id=None, month=None, limit=50, workers=1, shard=0, shards=1, log=print):
    """Classify the next unclassified evidence items from their content.

    Downloads/extraction/model calls run in ``workers`` threads; all database
    writes stay on the main thread (one connection, no pool contention).
    Only learners present in the Last_audit cohort are processed."""
    from concurrent.futures import ThreadPoolExecutor, as_completed
    from openai import OpenAI

    api_key = getattr(settings, "OPENAI_API_KEY", "")
    if not api_key:
        raise RuntimeError("OPENAI_API_KEY is not configured.")
    model = getattr(settings, "OPENAI_MODEL", "") or "gpt-4o-mini"
    # Tight timeouts: on a flaky network a hung call must fail fast and move
    # on — failed items stay unclassified and are retried on the next run.
    client = OpenAI(api_key=api_key, timeout=45, max_retries=1)

    conditions = [
        "c.evidence_id IS NULL",
        # In-system learners only — never spend on learners outside the cohort.
        f'EXISTS (SELECT 1 FROM "Last_audit"."learners" l WHERE l.aptem_id = e.learner_id)',
    ]
    params = []
    if aptem_id:
        conditions.append("e.learner_id = %s")
        params.append(aptem_id)
    if month:
        conditions.append(
            "to_char(coalesce(e.completed_date, e.submission_date, e.created_date), 'YYYY-MM') = %s"
        )
        params.append(month)
    if shards and int(shards) > 1:
        # Disjoint slice of the queue, so parallel loop instances never
        # download or classify the same item (no duplicate API spend).
        conditions.append("e.evidence_id %% %s = %s")
        params.extend([int(shards), int(shard)])
    params.append(limit)

    with _connection().cursor() as cursor:
        ensure_classification_table(cursor)
        cursor.execute(
            f"""
            SELECT e.evidence_id, e.learner_id, e.evidence_name, e.evidence_kind,
                   e.hours_type, e.component_name, e.file_blob, e.note_content
            FROM {EVIDENCE_ITEMS} e
            LEFT JOIN {CLASSIFICATIONS} c ON c.evidence_id = e.evidence_id
            WHERE {' AND '.join(conditions)}
            ORDER BY e.evidence_id DESC
            LIMIT %s
            """,
            params,
        )
        pending = _dict_rows(cursor)

    done = failed = mismatches = 0
    workers = max(1, int(workers or 1))

    def _run(item):
        try:
            return _prepare_item(client, model, item)
        except Exception as error:  # noqa: BLE001 — a bad file must not stop the batch
            return {"evidence_id": int(item["evidence_id"]),
                    "name": item.get("evidence_name") or "?", "error": error}

    with ThreadPoolExecutor(max_workers=workers) as pool:
        # as_completed, NOT map: map yields in order, so one hung download
        # blocks every finished result behind it (minutes-long write stalls).
        futures = [pool.submit(_run, item) for item in pending]
        with _connection().cursor() as cursor:
            for future in as_completed(futures):
                result = future.result()
                name = str(result.get("name") or "?")
                if "error" in result:
                    failed += 1
                    log(f"  #{result['evidence_id']} {name[:44]:44} -> FAILED: {result['error']}")
                    continue
                cursor.execute(
                    f"""
                    INSERT INTO {CLASSIFICATIONS} (
                        evidence_id, aptem_id, category, confidence, mismatch,
                        method, model_name, extracted_chars, reason
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
                    ON CONFLICT (evidence_id) DO UPDATE SET
                        category = EXCLUDED.category,
                        confidence = EXCLUDED.confidence,
                        mismatch = EXCLUDED.mismatch,
                        method = EXCLUDED.method,
                        model_name = EXCLUDED.model_name,
                        extracted_chars = EXCLUDED.extracted_chars,
                        reason = EXCLUDED.reason,
                        classified_at = now()
                    """,
                    [
                        result["evidence_id"], result["aptem_id"], result["category"],
                        result["confidence"], result["mismatch"], result["method"],
                        model, result["extracted_chars"], result["reason"],
                    ],
                )
                done += 1
                mismatches += 1 if result["mismatch"] else 0
                log(f"  #{result['evidence_id']} {name[:44]:44} -> {result['category']:22} conf {result['confidence']:.2f}"
                    + ("  [MISFILED]" if result["mismatch"] else ""))
    return {"processed": done, "failed": failed, "mismatches": mismatches, "pending_batch": len(pending)}
