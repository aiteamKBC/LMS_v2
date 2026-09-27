"""Manual corrections to a generated deck.

A generated deck is rendered from a review pack built from the database. When
a figure or a piece of evidence is not right, the owner of the deck (the
learner for an MCM, the coach for a Progress Review) corrects it here and the
deck is rendered again from the corrected pack, as a NEW run that points at
the one it revises — the original generated deck is never overwritten.

Only the fields below can be changed, and every value is validated, so an
edit can correct what a slide shows but never break the pack's shape:

  learner      full_name, programme, employer, manager_name, coach
  attendance   attendance_percentage, engagement_notes
  progress     current / target programme progress %, next_module
  otj          completed / required hours (variance is recomputed), risk_status
  evidence     the items the evidence slides show: text, KSB codes, and the
               photo (keep, replace with an upload, or remove); items can be
               added, removed and reordered (saved as pack["slide_evidence"])
  ksbs         the "KSBs to strengthen" cards
  actions      the SMART targets
  epa          current_readiness                  (Progress Review only)
  manager_questions                               (Progress Review only)

`editable_view` is the same shape the frontend edits and posts back to
`apply_edits`. A value shown on a slide as "Not available" is null here.
"""
from __future__ import annotations

import copy
import re
from datetime import date

from .evidence_images import blob_image_ref, parse_blob_image_ref
from .review_pack import NOT_AVAILABLE, evidence_pool_keys

RISK_STATUSES = ("On track", "Need attention", "At risk")
MAX_EVIDENCE_ITEMS = 30
# Evidence items that get a photo frame, in order: the MCM keeps one evidence
# slide (4 frames), the Progress Review three (4 + 3 + 3). Items past this
# still count in the pack's totals but are not pictured.
PHOTO_SLOTS = {"mcm": 4, "progress_review": 10}
MAX_PRIORITY_KSBS = 4    # cards on "KSBs to Strengthen Next"
MAX_ACTIONS = 4          # rows on "SMART Targets & Action Plan"
MAX_MANAGER_QUESTIONS = 8
MAX_KSB_CODES = 12
KSB_CODE = re.compile(r"^[A-Za-z]{1,3}\d{1,3}(\.\d{1,3})?$")
EDIT_UPLOAD_FOLDER = "edits"
# Text limits only guard against abuse — each slide already trims what it
# draws (text_fit.clamp), and text the generator produced (full KSB standard
# wording, long file names) must always pass when saved back unchanged.
SHORT_TEXT = 300
LONG_TEXT = 2000


class EditError(ValueError):
    """An edit that cannot be applied; the message is safe to show the user."""


def upload_prefix(learner_id) -> str:
    """Blob folder an edit's uploaded photos live in — one per learner, so an
    edit can only ever reference that learner's own uploads."""
    return f"{EDIT_UPLOAD_FOLDER}/{int(learner_id)}/"


# --------------------------------------------------------------------------- #
# pack -> editable view
# --------------------------------------------------------------------------- #

def _shown(value):
    return None if value in (None, "", NOT_AVAILABLE) else value


def _percent_shown(value):
    """EPA readiness is stored as "50%"; everything else as a number."""
    value = _shown(value)
    if isinstance(value, str) and value.endswith("%"):
        value = value[:-1]
    try:
        return float(value) if value is not None else None
    except (TypeError, ValueError):
        return None


def editable_view(pack: dict, *, review_kind: str) -> dict:
    learner, attendance, progress, otj = (pack.get(k) or {} for k in ("learner", "attendance", "progress", "otj"))
    evidence = []
    for key in evidence_pool_keys(pack):
        for index, item in enumerate(pack.get(key) or []):
            evidence.append({
                "ref": f"{key}:{index}",
                "evidence_title": _shown(item.get("evidence_title")),
                "evidence_summary": _shown(item.get("evidence_summary")),
                "evidence_date": _shown(item.get("evidence_date")),
                "ksb_mappings": list(item.get("ksb_mappings") or []),
                "image_ref": _shown(item.get("image_or_screenshot_link")),
            })
    view = {
        "kind": review_kind,
        "learner": {k: _shown(learner.get(k)) for k in ("full_name", "programme", "employer", "manager_name", "coach")},
        "attendance": {
            "attendance_percentage": _percent_shown(attendance.get("attendance_percentage")),
            "engagement_notes": _shown(attendance.get("engagement_notes")),
        },
        "progress": {
            "current_programme_progress_percentage": _percent_shown(progress.get("current_programme_progress_percentage")),
            "target_progress_percentage": _percent_shown(progress.get("target_progress_percentage")),
            "next_module": _shown(progress.get("next_module")),
        },
        "otj": {
            "completed_otj_hours": _percent_shown(otj.get("completed_otj_hours")),
            "required_otj_hours_to_date": _percent_shown(otj.get("required_otj_hours_to_date")),
            "risk_status": _shown(otj.get("risk_status")),
        },
        "evidence": evidence,
        "evidence_photo_slots": PHOTO_SLOTS.get(review_kind, PHOTO_SLOTS["progress_review"]),
        "priority_ksbs": [
            {k: _shown(item.get(k)) for k in ("code", "description", "how_to_evidence")}
            for item in (pack.get("ksbs") or {}).get("priority_next", [])[:MAX_PRIORITY_KSBS]
        ],
        "actions": [
            {k: _shown(item.get(k)) for k in ("title", "detail", "owner", "due_by")}
            for item in (pack.get("actions") or [])[:MAX_ACTIONS]
        ],
    }
    if review_kind != "mcm":
        view["epa"] = {"current_readiness": _percent_shown((pack.get("epa") or {}).get("current_readiness"))}
        view["manager_questions"] = list(pack.get("manager_questions") or [])[:MAX_MANAGER_QUESTIONS]
    return view


# --------------------------------------------------------------------------- #
# validators — each returns the pack value (NOT_AVAILABLE for an empty field)
# --------------------------------------------------------------------------- #

def _text(value, label, limit):
    if value is None:
        return NOT_AVAILABLE
    if not isinstance(value, str):
        raise EditError(f"{label} must be text.")
    value = " ".join(value.split())
    if len(value) > limit:
        raise EditError(f"{label} must be {limit} characters or fewer.")
    return value or NOT_AVAILABLE


def _number(value, label, *, minimum=0.0, maximum):
    if value is None or value == "":
        return NOT_AVAILABLE
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise EditError(f"{label} must be a number.")
    if not minimum <= value <= maximum:
        raise EditError(f"{label} must be between {minimum:g} and {maximum:g}.")
    return round(float(value), 1) if value != int(value) else int(value)


def _iso_date(value, label):
    if value in (None, ""):
        return NOT_AVAILABLE
    try:
        return date.fromisoformat(str(value)).isoformat()
    except ValueError as exc:
        raise EditError(f"{label} must be a date (YYYY-MM-DD).") from exc


def _ksb_codes(value, label):
    if value in (None, ""):
        return []
    if not isinstance(value, list) or len(value) > MAX_KSB_CODES:
        raise EditError(f"{label} must be a list of up to {MAX_KSB_CODES} KSB codes.")
    codes = []
    for code in value:
        code = str(code).strip().upper()
        if not KSB_CODE.match(code):
            raise EditError(f"{label}: '{code}' is not a KSB code (for example K1, S3.2, B4).")
        if code not in codes:
            codes.append(code)
    return codes


def _list(value, label, limit):
    if value is None:
        return []
    if not isinstance(value, list):
        raise EditError(f"{label} must be a list.")
    if len(value) > limit:
        raise EditError(f"{label} can have at most {limit} entries.")
    for item in value:
        if not isinstance(item, (dict, str)):
            raise EditError(f"{label} has an invalid entry.")
    return value


def _section(edits, key):
    value = edits.get(key) or {}
    if not isinstance(value, dict):
        raise EditError(f"'{key}' must be an object.")
    return value


# --------------------------------------------------------------------------- #
# editable view -> corrected pack
# --------------------------------------------------------------------------- #

def _apply_evidence(pack, items, *, learner_id):
    items = _list(items, "Evidence", MAX_EVIDENCE_ITEMS)
    pool_keys = evidence_pool_keys(pack)
    originals = {f"{key}:{i}": item for key in pool_keys for i, item in enumerate(pack.get(key) or [])}
    rebuilt = []
    uploads = upload_prefix(learner_id)

    for position, edit in enumerate(items, start=1):
        if not isinstance(edit, dict):
            raise EditError("Evidence has an invalid entry.")
        label = f"Evidence item {position}"
        ref = edit.get("ref")
        if ref is not None and ref not in originals:
            raise EditError(f"{label} does not belong to this deck.")
        original = originals.get(ref) or {}
        item = copy.deepcopy(original) or {
            "evidence_type": "Added in edit", "evidence_status": "added-in-edit",
            "evidence_file_link": NOT_AVAILABLE, "manager_verification_status": "not submitted",
            "ai_classification_summary": NOT_AVAILABLE, "evidence_strength": "unverified",
        }
        item["evidence_title"] = _text(edit.get("evidence_title"), f"{label} title", SHORT_TEXT)
        item["evidence_summary"] = _text(edit.get("evidence_summary"), f"{label} summary", LONG_TEXT)
        item["evidence_date"] = _iso_date(edit.get("evidence_date"), f"{label} date")
        item["ksb_mappings"] = _ksb_codes(edit.get("ksb_mappings"), f"{label} KSBs")

        image = edit.get("image_ref")
        if image in (None, ""):
            item["image_or_screenshot_link"] = NOT_AVAILABLE
        elif image == original.get("image_or_screenshot_link"):
            item["image_or_screenshot_link"] = image
        else:
            blob = parse_blob_image_ref(image)
            if not blob or not blob[1].startswith(uploads):
                raise EditError(f"{label}: the photo must be one uploaded for this learner.")
            item["image_or_screenshot_link"] = blob_image_ref(*blob)

        rebuilt.append(item)

    # One list, in the order the owner chose, is what the evidence slides now
    # read. The flat evidence list backs the snapshot and workplace counts, so
    # it follows what the slides show.
    pack["slide_evidence"] = rebuilt
    pack["evidence"] = list(rebuilt)


def _apply_priority_ksbs(pack, items):
    items = _list(items, "KSBs to strengthen", MAX_PRIORITY_KSBS)
    ksbs = pack.setdefault("ksbs", {})
    by_code = {item.get("code"): item for item in ksbs.get("priority_next") or []}
    out = []
    for position, edit in enumerate(items, start=1):
        if not isinstance(edit, dict):
            raise EditError("KSBs to strengthen has an invalid entry.")
        label = f"KSB card {position}"
        code = _ksb_codes([edit.get("code")] if edit.get("code") else [], f"{label} code")
        if not code:
            raise EditError(f"{label} needs a KSB code.")
        item = copy.deepcopy(by_code.get(code[0])) or {
            "coverage_percentage": NOT_AVAILABLE, "accepted_count": NOT_AVAILABLE,
            "evidence_to_retain": "Brief, output, manager comment, and a short reflection.",
        }
        item["code"] = code[0]
        item["description"] = _text(edit.get("description"), f"{label} description", LONG_TEXT)
        item["how_to_evidence"] = _text(edit.get("how_to_evidence"), f"{label} evidence idea", LONG_TEXT)
        out.append(item)
    ksbs["priority_next"] = out


def _apply_actions(pack, items):
    items = _list(items, "SMART targets", MAX_ACTIONS)
    out = []
    for position, edit in enumerate(items, start=1):
        if not isinstance(edit, dict):
            raise EditError("SMART targets has an invalid entry.")
        label = f"Target {position}"
        out.append({
            "title": _text(edit.get("title"), f"{label} title", SHORT_TEXT),
            "detail": _text(edit.get("detail"), f"{label} detail", LONG_TEXT),
            "owner": _text(edit.get("owner"), f"{label} owner", SHORT_TEXT),
            "due_by": _iso_date(edit.get("due_by"), f"{label} due date"),
        })
    pack["actions"] = out


def apply_edits(pack: dict, edits: dict, *, review_kind: str, learner_id) -> dict:
    """A corrected copy of `pack`. Raises EditError on any invalid value."""
    if not isinstance(edits, dict):
        raise EditError("The edit must be a JSON object.")
    pack = copy.deepcopy(pack)

    learner = pack.setdefault("learner", {})
    for key, label in (
        ("full_name", "Learner name"), ("programme", "Programme"), ("employer", "Employer"),
        ("manager_name", "Line manager"), ("coach", "Coach"),
    ):
        if key in _section(edits, "learner"):
            learner[key] = _text(_section(edits, "learner")[key], label, SHORT_TEXT)
    if learner.get("full_name") == NOT_AVAILABLE:
        raise EditError("Learner name cannot be empty.")

    attendance, edit = pack.setdefault("attendance", {}), _section(edits, "attendance")
    if "attendance_percentage" in edit:
        attendance["attendance_percentage"] = _number(edit["attendance_percentage"], "Attendance %", maximum=100)
    if "engagement_notes" in edit:
        attendance["engagement_notes"] = _text(edit["engagement_notes"], "Engagement notes", LONG_TEXT)

    progress, edit = pack.setdefault("progress", {}), _section(edits, "progress")
    for key, label in (
        ("current_programme_progress_percentage", "Programme progress %"),
        ("target_progress_percentage", "Programme target %"),
    ):
        if key in edit:
            progress[key] = _number(edit[key], label, maximum=100)
    if "next_module" in edit:
        progress["next_module"] = _text(edit["next_module"], "Next module", LONG_TEXT)
    current, target = progress.get("current_programme_progress_percentage"), progress.get("target_progress_percentage")
    both = all(isinstance(v, (int, float)) for v in (current, target))
    progress["progress_variance"] = current - target if both else NOT_AVAILABLE

    otj, edit = pack.setdefault("otj", {}), _section(edits, "otj")
    for key, label in (("completed_otj_hours", "OTJ hours completed"), ("required_otj_hours_to_date", "OTJ hours required")):
        if key in edit:
            otj[key] = _number(edit[key], label, maximum=10000)
    if "risk_status" in edit:
        status = edit["risk_status"]
        if status not in (None, *RISK_STATUSES):
            raise EditError(f"OTJ status must be one of: {', '.join(RISK_STATUSES)}.")
        otj["risk_status"] = status or NOT_AVAILABLE
    done, required = otj.get("completed_otj_hours"), otj.get("required_otj_hours_to_date")
    both = all(isinstance(v, (int, float)) for v in (done, required))
    otj["variance"] = round(done - required, 1) if both else NOT_AVAILABLE

    if "evidence" in edits:
        _apply_evidence(pack, edits["evidence"], learner_id=learner_id)
    if "priority_ksbs" in edits:
        _apply_priority_ksbs(pack, edits["priority_ksbs"])
    if "actions" in edits:
        _apply_actions(pack, edits["actions"])

    if review_kind != "mcm":
        if "current_readiness" in _section(edits, "epa"):
            readiness = _number(_section(edits, "epa")["current_readiness"], "EPA readiness %", maximum=100)
            pack.setdefault("epa", {})["current_readiness"] = (
                f"{readiness}%" if readiness != NOT_AVAILABLE else NOT_AVAILABLE
            )
        if "manager_questions" in edits:
            questions = _list(edits["manager_questions"], "Manager questions", MAX_MANAGER_QUESTIONS)
            pack["manager_questions"] = [
                q for q in (_text(q, f"Manager question {i}", LONG_TEXT) for i, q in enumerate(questions, 1))
                if q != NOT_AVAILABLE
            ]
    return pack
