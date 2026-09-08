"""AI-assisted first draft of coach feedback for a learner submission.

What this is
------------
A coach opens a submission in the marking queue and presses "Generate AI
feedback". This assembles the three inputs the marking policy calls for --
the learner's own evidence, the KSB framework their programme is assessed
against, and the marking prompt in AI_marking_prompt.MD -- sends them to the
configured OpenAI model, and returns a draft report for the coach to edit.

What this is not
----------------
It never marks anything. The output lands in the feedback textarea as text the
coach can rewrite or discard; no status changes, no KSBs are awarded, nothing
is written to the submission until the coach presses one of the decision
buttons themselves. That is the policy's own first non-negotiable -- human
oversight is mandatory -- and it is enforced here by the endpoint simply having
no write path, not by convention.

The three inputs
----------------
1. Evidence. The learner's written reflection, workplace application, employer
   benefit and declared time, plus the text of any approved evidence file they
   uploaded (PDF and DOCX are read; images are named but not read, since this
   model call is text-only). Nothing is inferred beyond what they submitted.

2. KSB framework, scoped to the activity. Read from the component's own
   ksb_mappings -- the codes the curriculum author assigned to this specific
   activity -- and marked authoritative in the prompt, so the model may only
   map to those. The whole programme profile is deliberately not sent: offering
   71 codes for one reading task invites a mapping the activity was never
   designed to evidence, and a coach reading a plausible claim has no easy way
   to see that the activity does not carry that KSB at all.

3. The prompt. Loaded from AI_marking_prompt.MD at the repository root rather
   than pasted in here, because it is the document the training team edits.
   Keeping one copy means their next revision takes effect without a code
   change, and there is no second version to drift out of date.

4. The end-point assessment plan for the learner's apprenticeship standard,
   from EPA_files/. The prompt asks for an EPA portfolio contribution rating,
   which is only meaningful against the plan that actually governs the
   standard, so the right one is selected by standard reference (ST0845, ST0596
   or ST0612) rather than by guessing from the programme name.

The prompt file is written for an n8n workflow and carries {{ $('Webhook')... }}
placeholders. Those are substituted where this system has the equivalent value
and stripped where it does not, so the model never sees raw template syntax --
see _render_prompt.
"""
import json
import logging
import re
from pathlib import Path

from django.conf import settings
from django.db import DatabaseError, connections
from django.http import JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.views.decorators.http import require_POST

from .auth import authenticated_coach_email, coach_access_required, read_only_view

logger = logging.getLogger(__name__)

#: The assignment marking policy, maintained by the training team. Repository
#: root, so a revision takes effect without a code change.
PROMPT_PATH = Path(settings.BASE_DIR).parent / "AI_marking_prompt.MD"

#: The reflection-validation policy. A separate document because it is a
#: different job: an assignment is a work product assessed against the EPA plan
#: and the whole KSB framework, while a reflection is a short piece of writing
#: about one activity, judged mainly on whether it genuinely engages with that
#: activity. Running the assignment policy over a reflection produced a
#: thousand words of portfolio assessment about a fifteen-minute video.
REFLECTION_PROMPT_PATH = Path(settings.BASE_DIR).parent / "AI_reflection_prompt.MD"

#: A reflection draft is 90-130 words, which is ~200 tokens of prose. The
#: ceiling is well above that because this model spends completion tokens on
#: internal reasoning before emitting any text: at 400 the budget was consumed
#: before the answer began and the call returned empty. Brevity is the prompt's
#: job; this only stops a runaway.
MAX_REFLECTION_OUTPUT_TOKENS = 2_000

#: Evidence text is truncated before it reaches the model. Long enough for a
#: full portfolio assignment, short enough that one oversized upload cannot
#: blow the context window or the bill.
MAX_EVIDENCE_CHARS = 60_000

#: Per-file cap, so one large PDF cannot crowd out the learner's own writing.
MAX_FILE_CHARS = 20_000

#: The model is asked for 1000-1200 words of prose; this leaves headroom
#: without inviting an essay.
MAX_OUTPUT_TOKENS = 4_000

#: Extensions we can read as text. Images are listed for the model as context
#: ("a screenshot was provided") but their content is not read.
TEXT_EXTRACTORS = {".pdf", ".docx", ".txt", ".md"}

#: End-point assessment plans, one per apprenticeship standard. The prompt asks
#: for an EPA portfolio contribution rating and says to use the EPA name and
#: IFaTE standard only where actually provided, so supplying the right plan is
#: what lets that section be grounded rather than guessed.
EPA_DIR = Path(__file__).resolve().parent / "EPA_files"

#: Which plan governs which standard. Keyed on the standard reference because
#: that is what the KSB profile already records (ksb_profiles.standard_source_id
#: holds "st0845-v1-1"), so the link is data rather than a name match:
#:
#:   ST0845  project controls professional   -- also used for associate project
#:                                              manager, per the training team
#:   ST0596  marketing executive
#:   ST0612  marketing manager
EPA_BY_STANDARD = {
    "st0845": "PCP_EPA.pdf",
    "st0596": "ME_EPA.pdf",
    "st0612": "MM_EPA.pdf",
}

#: Fallback for programmes whose profile carries no standard reference, matched
#: against the programme or profile name. Deliberately narrow: a wrong EPA plan
#: is worse than none, because the rating would cite the wrong assessment.
EPA_BY_NAME = (
    (("project control", "pcp", "associate project manager", "apm"), "PCP_EPA.pdf"),
    (("marketing executive", "marketing exec"), "ME_EPA.pdf"),
    (("marketing manager",), "MM_EPA.pdf"),
)

#: The plans run to 65-91k characters. Sent whole rather than excerpted -- the
#: grading descriptors, portfolio requirements and KSB references are spread
#: throughout, so windowing would cut the rating loose from its criteria.
MAX_EPA_CHARS = 60_000


def _error(message, status, code):
    return JsonResponse({"error": message, "code": code}, status=status)


def _s(value):
    return str(value or "").strip()


# --------------------------------------------------------------------------- #
# Input 1: the learner's evidence
# --------------------------------------------------------------------------- #

def extract_file_text(content_type, filename, data):
    """Readable text from an uploaded evidence file, or '' when there is none.

    Never raises. A file that cannot be parsed is reported to the coach as
    unreadable rather than failing the whole request -- the rest of the
    submission is still worth marking.
    """
    suffix = Path(filename or "").suffix.lower()
    try:
        if suffix == ".pdf" or "pdf" in _s(content_type):
            import pypdf
            import io

            reader = pypdf.PdfReader(io.BytesIO(data))
            pages = [page.extract_text() or "" for page in reader.pages]
            return "\n\n".join(page for page in pages if page.strip())
        if suffix == ".docx" or "wordprocessingml" in _s(content_type):
            import docx
            import io

            document = docx.Document(io.BytesIO(data))
            parts = [p.text for p in document.paragraphs if p.text.strip()]
            # Tables carry a lot of portfolio evidence -- KPI figures, action
            # plans -- and are invisible if only paragraphs are read.
            for table in document.tables:
                for row in table.rows:
                    cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
                    if cells:
                        parts.append(" | ".join(cells))
            return "\n".join(parts)
        if suffix in {".txt", ".md"}:
            return data.decode("utf-8", errors="replace")
    except Exception:  # noqa: BLE001 - an unreadable file is a reportable state
        logger.warning("Could not extract text from evidence file %s", filename, exc_info=True)
        return ""
    return ""


def collect_evidence_files(learner_kind, learner_id, activity_id):
    """Approved evidence for this submission, with text where we can read it.

    Matched on component_ref, which is how the upload path records what a file
    was submitted against (learner_api.evidence). Only approved files are read:
    a pending file has not cleared scanning, and sending it to a third party
    before it has would defeat the point of the quarantine.
    """
    files = []
    try:
        with connections["default"].cursor() as cur:
            cur.execute(
                """
                SELECT container, blob_name, original_filename, content_type, size_bytes
                  FROM "Learner"."evidence_files"
                 WHERE learner_kind = %s
                   AND learner_id = %s
                   AND component_ref = %s
                   AND status = 'approved'
                 ORDER BY uploaded_at
                """,
                [_s(learner_kind), _s(learner_id), _s(activity_id)],
            )
            rows = cur.fetchall()
    except DatabaseError:
        logger.warning("Could not list evidence files for %s/%s", learner_kind, learner_id, exc_info=True)
        return []

    from learner_api.evidence_storage import download_blob_bytes

    for container, blob_name, filename, content_type, size_bytes in rows:
        entry = {"filename": filename, "contentType": content_type, "size": size_bytes, "text": ""}
        if Path(filename or "").suffix.lower() in TEXT_EXTRACTORS:
            try:
                data = download_blob_bytes(container, blob_name)
                entry["text"] = extract_file_text(content_type, filename, data)[:MAX_FILE_CHARS]
            except Exception:  # noqa: BLE001 - storage is best-effort here
                logger.warning("Could not download evidence blob %s", blob_name, exc_info=True)
        files.append(entry)
    return files


def build_evidence_text(submission, files):
    """Everything the learner submitted, as one block of labelled prose.

    Labelled rather than raw JSON so the model reads it as a person's
    submission and can quote it back, which the prompt requires it to do.
    """
    sections = []

    def add(label, value):
        text = _s(value)
        if text:
            sections.append(f"{label}\n{text}")

    add("Activity", submission.get("activityTitle"))
    add("Activity type", submission.get("activityType"))
    add("Module", submission.get("module"))
    add("Week", submission.get("week"))
    add("Learning reflection", submission.get("learningReflection"))

    application_type = _s(submission.get("applicationType"))
    application_text = _s(submission.get("applicationText"))
    if application_type or application_text:
        add("Workplace application", f"{application_type}\n{application_text}".strip())

    benefits = submission.get("selectedBenefits") or []
    if benefits:
        add("Employer benefits selected", ", ".join(_s(b) for b in benefits if _s(b)))
    add("Employer benefit explanation", submission.get("benefitExplanation"))

    explanations = submission.get("ksbExplanations") or {}
    if isinstance(explanations, dict) and explanations:
        lines = [f"{code}: {_s(text)}" for code, text in explanations.items() if _s(text)]
        if lines:
            add("KSBs the learner suggested, with their explanations", "\n".join(lines))

    claimed = _s(submission.get("actualTimeHours"))
    planned = _s(submission.get("plannedOtjh"))
    if claimed or planned:
        add("Claimed learning time", f"Learner claimed {claimed or 'not stated'}; planned {planned or 'not stated'}")

    for entry in files:
        name = _s(entry.get("filename")) or "Unnamed file"
        text = _s(entry.get("text"))
        if text:
            add(f"Uploaded evidence file: {name}", text)
        else:
            # Named but not read: the model must know a file exists without
            # being free to describe contents it was never given.
            sections.append(
                f"Uploaded evidence file: {name}\n"
                f"(This file was submitted but its contents could not be read as text. "
                f"Do not describe or assess its contents.)"
            )

    return "\n\n".join(sections)[:MAX_EVIDENCE_CHARS]


# --------------------------------------------------------------------------- #
# Input 2: the KSB framework
# --------------------------------------------------------------------------- #

def _decode_json(value):
    """curriculum JSONB columns are sometimes JSON strings holding JSON."""
    for _ in range(4):
        if not isinstance(value, str):
            break
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None
    return value


def _programme_links(programme_name):
    """The programme ids and KSB profile references behind a programme name.

    The marking queue stores a display name ("MBA"), while KSB profiles are
    keyed on programme *ids* ("PROG-2026..."), so the name has to be resolved
    through curriculum.programmes first. A name can map to several rows -- the
    same programme rebuilt for a new cohort -- so every match is returned.
    """
    try:
        with connections["default"].cursor() as cur:
            cur.execute(
                """
                SELECT programme_id, ksb_profile_source_id
                  FROM curriculum.programmes
                 WHERE lower(btrim(name)) = %s
                """,
                [_s(programme_name).lower()],
            )
            rows = cur.fetchall()
    except DatabaseError:
        logger.warning("Could not resolve programme %s", programme_name, exc_info=True)
        return [], []

    ids = [_s(row[0]) for row in rows if _s(row[0])]
    sources = [_s(row[1]) for row in rows if _s(row[1])]
    return ids, sources


def load_component_ksbs(activity_id):
    """The KSBs assigned to this component, as the curriculum author set them.

    This is the framework the model is allowed to map against. Handing over the
    whole programme profile instead -- 71 codes for a single reading task --
    invites the model to claim KSBs the activity was never designed to evidence,
    and a coach reading a plausible mapping has no easy way to tell that the
    activity does not carry that KSB at all.

    Returns ``(text, count)``. A count of zero is meaningful and must not be
    quietly replaced with the programme list: it says the component has no KSBs
    assigned yet, which is a fact about the curriculum the coach should see.
    """
    try:
        with connections["default"].cursor() as cur:
            cur.execute(
                "SELECT title, ksb_mappings FROM curriculum.components WHERE id = %s",
                [_s(activity_id)],
            )
            row = cur.fetchone()
    except DatabaseError:
        logger.warning("Could not load component KSBs for %s", activity_id, exc_info=True)
        return "", 0

    if not row:
        return "", 0

    title, mappings = row
    mappings = _decode_json(mappings) or []
    if not isinstance(mappings, list):
        return "", 0

    lines = []
    for item in mappings:
        if not isinstance(item, dict):
            continue
        code = _s(item.get("ksb_code"))
        description = _s(item.get("description"))
        if not code:
            continue
        # Classification and weight are carried through because the author used
        # them to say which KSBs this activity mainly evidences and which it
        # only touches -- a distinction the feedback should respect.
        qualifiers = []
        classification = _s(item.get("classification"))
        weight_class = _s(item.get("weight_class"))
        if classification:
            qualifiers.append(classification)
        if weight_class:
            qualifiers.append(f"{weight_class} weighting")
        suffix = f" [{', '.join(qualifiers)}]" if qualifiers else ""
        lines.append(f"{code}: {description}{suffix}" if description else f"{code}{suffix}")

    if not lines:
        return "", 0

    header = f"KSBs assigned to this activity ({_s(title)})"
    return f"{header}\n\n" + "\n".join(lines), len(lines)


def load_ksb_framework(programme_name, programme_id=None):
    """The KSB list this learner's programme is assessed against.

    A programme reaches its profile by any of three routes, all of which are in
    use in the live data, so all three are tried in order of directness:

    1. ``programmes.ksb_profile_source_id`` naming a profile id outright.
    2. The same column naming an apprenticeship standard ("standard:st0845-v1-1"),
       matched against ``ksb_profiles.standard_source_id``.
    3. The profile's own ``programme_ids`` list containing the programme id or
       its name.

    Returns ``(text, count)``. The count lets the caller tell the coach when no
    framework was found, rather than quietly asking the model to map KSBs with
    nothing authoritative to map against -- which is when it starts inventing
    codes that look real.
    """
    try:
        with connections["default"].cursor() as cur:
            cur.execute(
                """
                SELECT id, name, ksb_items, programme_ids, standard_source_id
                  FROM curriculum.ksb_profiles
                 WHERE is_active = true
                   AND ksb_items IS NOT NULL
                """
            )
            rows = cur.fetchall()
    except DatabaseError:
        logger.warning("Could not load KSB profiles", exc_info=True)
        return "", 0

    linked_ids, linked_sources = _programme_links(programme_name)
    wanted_ids = {_s(programme_id)} | set(linked_ids)
    wanted_ids.discard("")
    wanted_name = _s(programme_name).lower()
    # "standard:st0845-v1-1" refers to standard_source_id "st0845-v1-1".
    wanted_standards = {
        source.split(":", 1)[1].lower() for source in linked_sources if ":" in source
    }
    wanted_profile_ids = {
        source.lower() for source in linked_sources if not source.startswith("standard:")
    }

    def score(row):
        """Lower is a more direct link, so the best match wins."""
        profile_id, name, _items, programme_ids, standard_source = row
        if _s(profile_id).lower() in wanted_profile_ids:
            return 0
        if _s(standard_source).lower() in wanted_standards:
            return 1
        ids = _decode_json(programme_ids) or []
        ids = [_s(i) for i in ids] if isinstance(ids, list) else []
        if wanted_ids & set(ids):
            return 2
        if wanted_name and wanted_name in {i.lower() for i in ids}:
            return 3
        if wanted_name and wanted_name == _s(name).lower():
            return 4
        return 99

    candidates = sorted(((score(row), row) for row in rows), key=lambda pair: pair[0])
    if not candidates or candidates[0][0] == 99:
        return "", 0

    _rank, (_profile_id, name, items, _programme_ids, _standard) = candidates[0]
    items = _decode_json(items) or []
    if not isinstance(items, list) or not items:
        return "", 0

    lines = []
    for item in items:
        if not isinstance(item, dict):
            continue
        code = _s(item.get("code"))
        description = _s(item.get("description"))
        if code and description:
            lines.append(f"{code}: {description}")
    if not lines:
        return "", 0
    return f"KSB profile: {name}\n\n" + "\n".join(lines), len(lines)


# --------------------------------------------------------------------------- #
# The end-point assessment plan
# --------------------------------------------------------------------------- #

def _programme_standard(programme_name):
    """The apprenticeship standard reference behind a programme, e.g. "st0845".

    Read from the KSB profile the programme resolves to, so the EPA plan is
    chosen by the same link that chose the KSBs rather than by a second,
    independently-drifting rule.
    """
    def root(reference):
        # "st0845-v1-1" -> "st0845": the plan covers the standard itself, not a
        # particular version of its KSB list.
        return _s(reference).lower().split("-", 1)[0]

    ids, sources = _programme_links(programme_name)
    profile_ids = []
    for source in sources:
        if source.lower().startswith("standard:"):
            return root(source.split(":", 1)[1])
        profile_ids.append(source)

    # A programme can instead name its profile outright, and that profile
    # records the standard it came from -- so follow the link rather than
    # treating the absence of a "standard:" prefix as no standard at all.
    if not profile_ids and not ids:
        return ""

    try:
        with connections["default"].cursor() as cur:
            cur.execute(
                """
                SELECT id, standard_source_id, programme_ids
                  FROM curriculum.ksb_profiles
                 WHERE is_active = true
                   AND standard_source_id IS NOT NULL
                """
            )
            rows = cur.fetchall()
    except DatabaseError:
        logger.warning("Could not resolve the standard for %s", programme_name, exc_info=True)
        return ""

    wanted_profiles = {p.lower() for p in profile_ids}
    wanted_ids = {i.lower() for i in ids}
    for profile_id, standard_source, programme_ids in rows:
        if _s(profile_id).lower() in wanted_profiles:
            return root(standard_source)
        linked = _decode_json(programme_ids) or []
        linked = {_s(i).lower() for i in linked} if isinstance(linked, list) else set()
        if wanted_ids & linked:
            return root(standard_source)
    return ""


def load_epa_plan(programme_name, ksb_profile_name=""):
    """The end-point assessment plan for this learner's standard.

    Chosen by standard reference where the programme has one, and otherwise by
    a narrow name match. Deliberately narrow: citing the wrong EPA plan would
    ground the portfolio rating in criteria that do not apply, which is worse
    than the prompt's own fallback of omitting what was not provided.

    Returns ``(text, filename)`` -- the filename so the coach can be told which
    plan the rating was judged against.
    """
    standard = _programme_standard(programme_name)
    filename = EPA_BY_STANDARD.get(standard, "")

    if not filename:
        haystack = f"{_s(programme_name)} {_s(ksb_profile_name)}".lower()
        for needles, candidate in EPA_BY_NAME:
            if any(needle in haystack for needle in needles):
                filename = candidate
                break

    if not filename:
        return "", ""

    path = EPA_DIR / filename
    if not path.exists():
        logger.warning("EPA plan %s is referenced but missing from %s", filename, EPA_DIR)
        return "", ""

    try:
        import pypdf

        reader = pypdf.PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]
        text = "\n".join(page for page in pages if page.strip())
    except Exception:  # noqa: BLE001 - a missing plan degrades, never fails
        logger.warning("Could not read the EPA plan %s", filename, exc_info=True)
        return "", ""

    return text[:MAX_EPA_CHARS], filename


# --------------------------------------------------------------------------- #
# Input 3: the marking prompt
# --------------------------------------------------------------------------- #

#: n8n expression syntax in the prompt file: {{ $('Webhook').item.json... }}
N8N_PLACEHOLDER = re.compile(r"\{\{[^{}]*\}\}")


def load_prompt_document(path=None):
    """The marking policy as the training team wrote it.

    Read from disk on each call rather than cached at import, so an edit to
    AI_marking_prompt.MD takes effect on the next generation without a restart.
    The file is small and this runs once per coach click.
    """
    path = path or PROMPT_PATH
    try:
        return path.read_text(encoding="utf-8")
    except OSError:
        logger.error("Could not read the marking prompt at %s", path, exc_info=True)
        return ""


def _render_prompt(document, values):
    """Fill the prompt's n8n placeholders from this system's own values.

    The file was authored for an n8n workflow, so it refers to nodes that do
    not exist here. Each placeholder is replaced with the matching value where
    we have one, and with a plain statement of absence where we do not -- the
    prompt itself instructs the model not to invent details beyond the fields
    provided, so saying "not provided" is the honest substitution and leaves
    that instruction able to do its job. Leaving the raw {{ ... }} in place
    would instead read to the model as content.
    """
    def substitute(match):
        expression = match.group(0)
        for key, value in values.items():
            if key in expression:
                return _s(value) or "not provided"
        return "not provided"

    return N8N_PLACEHOLDER.sub(substitute, document)


def build_messages(submission, evidence_text, ksb_text, epa_text=""):
    """The system and user messages for the marking call.

    The prompt document holds both halves, marked "(System Message)" and
    "(User Message)". Rather than parse that structure -- which would break the
    moment the training team reformats the file -- the whole rendered document
    is sent as the system message, and the user message carries the assembled
    inputs under the headings the prompt names. The model therefore sees the
    policy in full, and the evidence separately, which is the arrangement the
    policy assumes.
    """
    document = load_prompt_document()
    learner_name = _s(submission.get("learner"))
    rendered = _render_prompt(document, {
        "student_name": learner_name,
        "evidence_name": _s(submission.get("activityTitle")),
        "evidence_id": _s(submission.get("activityId")),
        "KSB_Framework": ksb_text,
        "inputData.text": evidence_text,
        "evidence_url": "not provided",
        "job_title": "not provided",
        "company_name": "not provided",
        "company_industry": "not provided",
        "description": "not provided",
        # The prompt reads the EPA plan from this node, so the plan is
        # substituted here as well as being sent under its own heading.
        "Extract from File1": epa_text,
    })

    system = (
        rendered
        + "\n\nAdditional operating notes for this deployment.\n"
        "You are producing a draft for a qualified coach to review, edit and "
        "decide upon. Write the learner feedback report only. Do not state or "
        "imply a final decision, and do not award KSBs.\n"
        "The KSB framework you have been given is the set assigned to this "
        "specific activity by the curriculum author, not the whole programme "
        "standard. Map only to codes in that list. If the activity evidences "
        "none of them, say so plainly rather than reaching for a KSB that is "
        "not on the list, and never cite a code that does not appear there.\n"
        + (
            "The end-point assessment plan for this apprenticeship standard is "
            "provided, so ground the EPA portfolio contribution rating in it.\n"
            if epa_text else
            "No end-point assessment plan was available for this programme, so "
            "do not name an EPA or IFaTE standard.\n"
        )
        + "Employer context fields and an approved reference set were not "
        "supplied, so follow the prompt's instruction to omit what is not "
        "provided rather than inferring it."
    )

    user = (
        f"Please assess the following student evidence.\n\n"
        f"Student Name: {learner_name or 'not provided'}\n"
        f"Evidence Name: {_s(submission.get('activityTitle')) or 'not provided'}\n"
        f"Evidence ID: {_s(submission.get('activityId')) or 'not provided'}\n"
        f"Submission type hint: {_s(submission.get('activityType')) or 'not provided'}\n\n"
        f"Student Document Content as text:\n{evidence_text or '(no written content was submitted)'}\n\n"
        f"KSB Framework (authoritative, and limited to this activity):\n"
        f"{ksb_text or '(no KSBs are assigned to this activity, so no KSB mapping can be verified)'}"
    )
    if epa_text:
        user += f"\n\nEPA_File (end-point assessment plan):\n{epa_text}"
    return system, user


# --------------------------------------------------------------------------- #
# The endpoint
# --------------------------------------------------------------------------- #

def _openai_client():
    try:
        from openai import OpenAI
    except ImportError:
        return None
    return OpenAI(api_key=settings.OPENAI_API_KEY)


def generate_marking_feedback(submission):
    """Draft feedback for one submission. Returns ``(text, meta)``.

    Raises RuntimeError with a coach-readable message when the draft cannot be
    produced, so the caller can turn it into one clear error rather than a
    stack trace in the UI.
    """
    evidence_files = collect_evidence_files(
        submission.get("learnerKind"), submission.get("learnerId"), submission.get("activityId"),
    )
    evidence_text = build_evidence_text(submission, evidence_files)
    if not evidence_text.strip():
        raise RuntimeError(
            "This submission has no written content or readable evidence to assess."
        )

    # Scoped to the activity, not the programme: the model may only map to the
    # KSBs this component was authored to evidence.
    ksb_text, ksb_count = load_component_ksbs(submission.get("activityId"))
    epa_text, epa_file = load_epa_plan(submission.get("programme"))
    system, user = build_messages(submission, evidence_text, ksb_text, epa_text)
    if not system.strip():
        raise RuntimeError("The marking prompt could not be loaded on the server.")

    client = _openai_client()
    if client is None:
        raise RuntimeError("The OpenAI client library is not installed on the server.")

    try:
        response = client.chat.completions.create(
            model=settings.OPENAI_MODEL,
            messages=[
                {"role": "system", "content": system},
                {"role": "user", "content": user},
            ],
            max_completion_tokens=MAX_OUTPUT_TOKENS,
        )
    except Exception as exc:  # noqa: BLE001 - surfaced to the coach as one message
        logger.exception("AI marking generation failed")
        raise RuntimeError(f"The AI service could not be reached: {exc}") from exc

    text = _s(response.choices[0].message.content if response.choices else "")
    if not text:
        raise RuntimeError("The AI service returned an empty response. Try again.")

    return text, {
        "model": settings.OPENAI_MODEL,
        "ksbCount": ksb_count,
        "epaFile": epa_file,
        "evidenceFiles": [
            {
                "filename": f["filename"],
                "readable": bool(_s(f.get("text"))),
            }
            for f in evidence_files
        ],
        "evidenceChars": len(evidence_text),
    }


@csrf_exempt
@require_POST
@coach_access_required
@read_only_view
def coach_marking_ai_feedback(request, submission_id):
    """POST /coach_api/coach/marking-queue/<id>/ai-feedback

    Returns a draft only. Nothing about the submission is modified: the coach
    edits the text and then presses one of the existing decision buttons, which
    is the only path that writes.

    POST rather than GET because the submission text and KSB framework are far
    too large to pass as query parameters, and because it costs a model call --
    not because it mutates. ``read_only_view`` records that, so a super-admin
    reading a coach's workspace can generate a draft without the view-as guard
    refusing it as a write; there is nothing here for that guard to protect.
    """
    from django.db.models.functions import Lower, Trim

    from learner_api.models import LearnerProfile

    from .views import (
        MARKING_QUEUE_COLUMNS,
        normalize_email,
        serialize_marking_submission,
    )

    if not settings.OPENAI_API_KEY:
        return _error(
            "AI marking is not configured on this server.", 503, "openai_not_configured",
        )

    # Scoped to this coach's own caseload, exactly as the read endpoint is: the
    # submission text is the learner's personal writing, and generating a draft
    # is still a read of it. Matching on enrolment_id rather than the profile
    # pk for the reason given in coach_marking_queue -- the two are disjoint.
    owner_email = authenticated_coach_email(request)
    allowed_learner_ids = [
        str(learner_id)
        for learner_id in (
            LearnerProfile.objects.annotate(coach_email_key=Lower(Trim("coach_email")))
            .filter(coach_email_key=normalize_email(owner_email))
            .values_list("enrolment_id", flat=True)
        )
        if learner_id is not None
    ]
    if not allowed_learner_ids:
        return _error("That submission could not be found.", 404, "not_found")

    try:
        with connections["enrolment"].cursor() as cur:
            cur.execute(
                f"""
                select {MARKING_QUEUE_COLUMNS}
                  from "Learner".learning_reflection_submissions
                 where id = %s and learner_id = any(%s)
                """,
                [str(submission_id), allowed_learner_ids],
            )
            columns = [column[0] for column in cur.description]
            value = cur.fetchone()
    except DatabaseError as exc:
        logger.exception("Could not load the submission for AI marking.")
        return _error(f"Database error: {exc}", 502, "database_error")
    if not value:
        return _error("That submission could not be found.", 404, "not_found")

    submission = serialize_marking_submission(dict(zip(columns, value)))

    # Which policy applies depends on what is being marked. An assignment is a
    # work product assessed against the EPA plan; a reflection is a short piece
    # of writing about one activity. They have separate prompts because they are
    # separate jobs -- see coach_api.ai_reflection.
    from .ai_reflection import generate_reflection_feedback
    from .views import ASSIGNMENT_ACTIVITY_TYPES

    is_assignment = (
        _s(submission.get("activityType")).lower() in ASSIGNMENT_ACTIVITY_TYPES
    )
    try:
        if is_assignment:
            text, meta = generate_marking_feedback(submission)
        else:
            text, meta = generate_reflection_feedback(submission)
    except RuntimeError as exc:
        return _error(str(exc), 502, "ai_generation_failed")

    return JsonResponse({"feedback": text, "meta": meta})
