"""Seed a Curriculum Review template for every programme that has none yet,
for the two system Review Types ('mcm' / 'progress_review').

Run ``backfill_review_types`` first: it seeds the Review Types themselves and
classifies any template that predates them. This command only creates the
templates a programme is still missing entirely.

Why this exists: Coach's /coach/meetings and /coach/progress-reviews pages
used to compute their own occurrence dates from two hard-coded constants (30
days, 12 weeks) for every learner, unconditionally. Coach now reads
recurrence/eligibility/questions from whichever enabled review_templates row
a programme has classified with the 'mcm' / 'progress_review' Review Type -- and
produces ZERO occurrences for a programme that has none. Without this
backfill, cutting Coach over would silently stop generating Monthly Coaching
Meetings and Progress Reviews for every programme nobody has configured a
template for yet in Curriculum.

This seeds, per programme lacking one:

  * a Monthly Coaching Meeting template (1 month interval, unlimited
    occurrences) with the existing hard-coded question set ported in as
    real Curriculum sections/fields -- so the coach-facing form does not go
    blank the day this ships.
  * a Progress Review template (12 week interval, unlimited occurrences)
    with no fields yet -- Progress Review's coach-facing "form" today is the
    slide/PPTX pack plus a single sign-off, not a question set (see
    progress_reviews_api), so there is nothing existing to port. A
    Curriculum admin adds fields for it when ready.

Both retain the Coach interval and eligibility defaults. New MCM templates
require coach and learner signatures so the completed meeting can be exported
as a signed PDF. Progress Review retains its existing coach sign-off default.

Idempotent: a programme that already has an enabled template for a surface
(created by this command or by a curriculum admin by hand) is left alone.

Dry-run by default: pass --apply to write.
"""
from django.core.management.base import BaseCommand

from ... import review_types
from ... import reviews
from ... import views as curriculum_views


def _agreement_field(field_id, title):
    return {"id": "", "title": title, "fieldType": "boolean", "required": True, "configuration": {"variant": "agreement"}}


def _statement_field(field_id, title, description):
    return {"id": "", "title": title, "fieldType": "title_description", "required": False, "configuration": {"description": description}}


def _text_field(title, *, required=True, placeholder=""):
    return {"id": "", "title": title, "fieldType": "text_multiline", "required": required, "configuration": {"placeholder": placeholder}}


def _yes_no_field(title, *, required=True):
    return {"id": "", "title": title, "fieldType": "boolean", "required": required, "configuration": {}}


def _select_field(title, options, *, required=True):
    return {"id": "", "title": title, "fieldType": "list_item", "required": required, "configuration": {"options": options}}


def _date_field(title, *, required=True):
    return {"id": "", "title": title, "fieldType": "date", "required": required, "configuration": {}}


def _rag_field(title, *, required=True):
    return {"id": "", "title": title, "fieldType": "list_item", "required": required, "configuration": {"options": ["Red", "Amber", "Green"]}}


# A faithful, one-time port of frontend/src/pages/shared/monthlyCoachingForm.ts
# into Curriculum sections/fields. Kept as a plain Python mirror here rather
# than imported (there is no shared runtime between the Django backend and
# the SPA) -- this command is a one-shot backfill, not a place either side
# reads from afterwards.
MCM_SECTIONS = [
    {
        "title": "Previous Meeting Summary",
        "estimatedMinutes": 0,
        "fields": [
            _select_field("Meeting", ["Previous Monthly Coaching Meeting", "No previous meeting"]),
            _text_field("Summary", placeholder="Summarise progress against the previous meeting actions, including anything still outstanding..."),
        ],
    },
    {
        "title": "Opening the Meeting (5 minutes)",
        "estimatedMinutes": 5,
        "fields": [
            _statement_field("s", "Step 1: Learner Presentation & Review (15 minutes)", "Presentation and work completed this month."),
            _statement_field("s", "Step 2: Reflection on Knowledge, Skills and Behaviours (10 minutes)", "Feedback on work and reflection on KSB development."),
            _statement_field("s", "Step 3: Learning Resources — Coach Guidance (5 minutes)", "Resources and guidance to strengthen knowledge and skills."),
            _statement_field("s", "Step 4: Preparing for Next Month (10 minutes)", "Preparation for next month and expected evidence."),
            _statement_field("s", "Step 5: Wellbeing & Safeguarding Check (5 minutes)", "A wellbeing and safeguarding check."),
            _statement_field("s", "Step 6: Learner Feedback on Teaching & Curriculum (5 minutes)", "Feedback on teaching and the programme."),
            _statement_field("s", "Step 7: Confirm Next Meeting & Close (5 minutes)", "Confirm the next meeting and agreed actions."),
        ],
    },
    {
        "title": "Learner Presentation & Review (15 minutes)",
        "estimatedMinutes": 15,
        "fields": [
            _text_field(
                "Presentation & Review",
                placeholder="Summarise the presentation, work completed, evidence reviewed and feedback given...",
            ),
        ],
    },
    {
        "title": "Reflection on Knowledge, Skills and Behaviours (10 minutes)",
        "estimatedMinutes": 10,
        "fields": [
            _text_field(
                "Knowledge reflection: How has your understanding of the key concepts covered this month developed, and how have you applied them in practice?",
                placeholder="Record the learner's knowledge reflection and practical application...",
            ),
            _text_field(
                "Skills reflection: What did you plan and deliver this month, and how did you set clear objectives and measures of success?",
                placeholder="Record the skills used, delivery approach and measures of success...",
            ),
            _text_field(
                "Behaviour reflection: Thinking about the behaviour agreed in the last coaching meeting, how did you demonstrate it in practice and what impact did it have?",
                placeholder="Record a specific example and its impact...",
            ),
            _text_field(
                "What would you do differently next time to strengthen that behaviour further, based on what you have learned?",
                placeholder="Record the learner's next development step...",
            ),
        ],
    },
    {
        "title": "Preparing for Next Month (10 minutes)",
        "estimatedMinutes": 10,
        "fields": [
            _text_field("Next Month Focus", placeholder="Record the modules, assignments, KSBs or workplace activity to focus on..."),
            _text_field("Expected Evidence Next Month", placeholder="List the evidence, assignments or workplace outputs expected..."),
        ],
    },
    {
        "title": "Learning Resources — Coach Guidance (5 minutes)",
        "estimatedMinutes": 5,
        "fields": [
            _text_field("Learning Resources", placeholder="Recommend modules, readings, videos, templates, links or other guidance..."),
            _text_field("Read", placeholder="List any specific reading or LMS material...", required=False),
            _yes_no_field("Can you confirm that the hours allocated for submissions are accurate and have been completed during paid working hours?"),
        ],
    },
    {
        "title": "Wellbeing & Safeguarding Check (5 minutes)",
        "estimatedMinutes": 5,
        "fields": [
            _agreement_field("f", "Is the workload manageable?"),
            _agreement_field("f", "Is there anything affecting your wellbeing or ability to learn?"),
            _text_field("Coach records outcome", placeholder="Record any concerns raised, support agreed or confirm that no action is required...", required=False),
            _agreement_field("f", "I know what safeguarding is and who to contact if I have a concern about myself or others."),
            _agreement_field("f", "I feel supported with my wellbeing and mental health during my studies."),
            _agreement_field("f", "I feel safe and respected during teaching sessions, online learning and workplace-related activities."),
            _agreement_field("f", "I understand how to stay safe online and have received guidance on Prevent, radicalisation and extremism."),
            _agreement_field("f", "I know how to raise concerns and feel confident that my tutor or coach would take them seriously."),
            _agreement_field("f", "Overall, I feel that my training provider takes safeguarding and wellbeing seriously."),
        ],
    },
    {
        "title": "Learner Feedback on Teaching & Curriculum (5 minutes)",
        "estimatedMinutes": 5,
        "fields": [
            _text_field("Learner Feedback", placeholder="Record the learner's feedback, including anything they would like improved...", required=False),
            _agreement_field("f", "The curriculum is well planned, clearly sequenced and helps me build knowledge and skills over time in line with the apprenticeship standard."),
            _agreement_field("f", "Teaching sessions are well delivered and help me understand how learning links to my job role and assessment requirements."),
            _agreement_field("f", "Learning resources are accessible, relevant and support my progress."),
            _agreement_field("f", "Assessment activities and feedback clearly help me improve and understand how my work contributes to meeting the KSBs."),
            _agreement_field("f", "I feel well supported by my tutor or coach and know where to go if I need help or additional support."),
            _agreement_field("f", "Overall, the curriculum and teaching are helping me make progress and prepare effectively for assessment and my future role."),
        ],
    },
    {
        "title": "Confirm Next Meeting & Close (5 minutes)",
        "estimatedMinutes": 5,
        "fields": [
            _yes_no_field("Please confirm that the next session has been booked through the coaching booking system."),
            _date_field("The date for the next coaching session is"),
        ],
    },
    {
        "title": "Meeting Summary",
        "estimatedMinutes": 0,
        "fields": [
            _text_field("Summary", placeholder="Summarise progress, key discussion points, risks, support and next steps..."),
            _text_field("Meeting notes", placeholder="Add any detailed coaching notes...", required=False),
            _rag_field("Select the overall meeting outcome."),
        ],
    },
]


def _template_payload(name, *, interval, unit, sections, review_type_id):
    return {
        "name": name,
        "enabled": True,
        # Classification only -- it says nothing about the recurrence above,
        # which stays whatever Curriculum configures.
        "reviewTypeId": review_type_id,
        "recurrence": {"interval": interval, "unit": unit},
        # Legacy behaviour applied to every learner regardless of programme
        # status -- an empty list keeps that (see review_instances.
        # learner_is_eligible: no restriction configured means eligible).
        "applicableStatuses": [],
        "signatures": {"advisor": True, "employer": False, "participant": False, "referrer": False},
        "visibleTo": {"advisor": True, "employer": True, "participant": True, "referrer": True},
        "sections": sections,
    }


class Command(BaseCommand):
    help = "Seed a default Monthly Coaching Meeting / Progress Review template for every programme missing one."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write changes. Without this flag, only reports what would happen.")

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        reviews.ensure_review_tables()
        review_types.ensure_review_types_table()
        if apply_changes:
            review_types.seed_system_review_types()

        type_ids = {}
        for code in (review_types.REVIEW_TYPE_CODE_MCM, review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW):
            type_row = review_types.get_review_type_by_code(code)
            if type_row:
                type_ids[code] = type_row.get("id")

        configs = curriculum_views.get_program_config_rows()
        programme_ids = sorted({curriculum_views.programme_config_id(c) for c in configs if curriculum_views.programme_config_id(c)})
        self.stdout.write(f"Found {len(programme_ids)} programme(s).")

        created = {code: 0 for code in (review_types.REVIEW_TYPE_CODE_MCM, review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW)}
        skipped = dict(created)

        for programme_id in programme_ids:
            for code, name, interval, unit, sections in (
                (review_types.REVIEW_TYPE_CODE_MCM, "Monthly Coaching Meeting", 1, "months", MCM_SECTIONS),
                (review_types.REVIEW_TYPE_CODE_PROGRESS_REVIEW, "Progress Review", 12, "weeks", []),
            ):
                type_id = type_ids.get(code)
                if not type_id:
                    self.stderr.write(f"  Review Type '{code}' is not seeded -- run backfill_review_types --apply first.")
                    continue

                existing = reviews.get_review_template_rows(
                    "programme_id = %s and enabled = true and review_type_id = %s",
                    [programme_id, type_id],
                )
                if existing:
                    skipped[code] += 1
                    continue

                self.stdout.write(f"{'Creating' if apply_changes else 'Would create'} {name} for programme {programme_id}")
                if not apply_changes:
                    created[code] += 1
                    continue

                payload = _template_payload(name, interval=interval, unit=unit, sections=sections, review_type_id=type_id)
                if code == review_types.REVIEW_TYPE_CODE_MCM:
                    payload['signatures']['participant'] = True
                review_id, errors = reviews.create_review(programme_id, payload, actor="backfill_mcm_pr_review_templates")
                if errors:
                    self.stderr.write(f"  FAILED for programme {programme_id} ({code}): {errors}")
                    continue
                created[code] += 1

        if apply_changes:
            curriculum_views.invalidate_curriculum_cache()

        self.stdout.write(self.style.SUCCESS(
            f"{'Created' if apply_changes else 'Would create'}: "
            + " ".join(f"{code}={count}" for code, count in sorted(created.items()))
            + "; already configured: "
            + " ".join(f"{code}={count}" for code, count in sorted(skipped.items()))
        ))
        if not apply_changes:
            self.stdout.write("Dry run -- pass --apply to write these templates.")
