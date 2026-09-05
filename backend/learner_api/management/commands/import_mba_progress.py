"""Bring a learner's history on the legacy MBA site across to the LMS.

What this maps
--------------
The MBA schema is a synced copy of the old WordPress/MasterStudy site:

    MBA.students            one row per learner  (user_id, email)
    MBA.course_curriculum   one row per course   (module_id, curriculum JSON)
    MBA.student_progress    one row per learner+course, with component_progress:
                            a list of every component and how far they got

The mapping is exact rather than fuzzy. When the MBA courses were loaded into
the curriculum system they kept their identifiers, so ``module_id`` matches
``curriculum.modules.module_catalogue_id`` and each component's ``component_id``
matches ``curriculum.components.id`` outright. Nothing is matched on title, so
there is no guessing about which component a completion belongs to; a component
that does not resolve is reported and skipped, never approximated.

Two things are written:

* the learning plan on ``enrolment."Created_users"``, built from the modules,
  weeks and components as the curriculum currently holds them -- not from the
  MBA curriculum JSON, so the plan matches what the learner's page will render.
* one ``Learner.learner_progress_entries`` row per completed component, which is
  the platform's source of truth for progress and for OTJ hours.

On-the-job hours
----------------
MBA measured time as wall-clock between opening a component and completing it,
so its figures are unusable as effort: one component in this data reads
5,969,139 seconds -- 69 days -- for a single video, and one course totals over
nine years.

Each component's time is therefore capped at the ``expected_otjh`` the
curriculum authored for it. Real effort still shows through wherever it was
plausible; the impossible figures collapse to the planned value instead of
distorting the learner's OTJH. Both numbers are kept on the row --
``claimed_seconds`` holds what MBA reported and ``verified_seconds`` the capped
figure that counts -- so the adjustment stays visible and auditable rather than
quietly rewriting history.

``verified_seconds`` is what ``completed_hours_from_progress`` reads first, so
imported hours flow through the ordinary OTJH path with no special-casing.

Idempotent: re-running replaces the rows this importer wrote rather than adding
a second copy. Progress recorded on the platform itself is left alone -- only
rows tagged ``component_link_source='mba_import'`` are cleared.

    python manage.py import_mba_progress --email someone@example.com
    python manage.py import_mba_progress --email someone@example.com --apply
"""
import json
from collections import defaultdict
from decimal import Decimal

from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction
from django.utils.dateparse import parse_datetime

#: Marks the rows this importer owns, so a re-run can replace exactly them.
IMPORT_SOURCE = "mba_import"

#: MBA post types whose progress is a quiz attempt rather than a visit.
QUIZ_POST_TYPES = {"stm-quizzes"}


def _decode(value):
    """MBA's JSONB columns hold JSON *strings* containing JSON -- sometimes twice."""
    for _ in range(4):
        if not isinstance(value, str):
            break
        try:
            value = json.loads(value)
        except (TypeError, ValueError):
            return None
    return value


def _s(value):
    return str(value or "").strip()


#: Below this, MBA's timer is treated as having recorded nothing rather than a
#: real reading. A completion genuinely finished in under a minute is possible
#: but rare; a stored 0-7 seconds is overwhelmingly the tracker not firing --
#: every one of this learner's 377 quiz completions stores exactly 0.
IMPLAUSIBLY_SHORT_SECONDS = 60


def _credit_seconds(claimed, expected_seconds):
    """What one completed component is worth, and why it was adjusted.

    MBA's per-component timing is unusable in both directions. It measured
    wall-clock between opening and completing, so a video left open over a
    weekend reads as days; and it recorded nothing at all for quizzes, which
    tracked attempts instead. In this learner's data 71 completions claim a day
    or more while 377 claim zero and 816 claim under a minute.

    So the authored ``expected_otjh`` is used as both ceiling and floor, and
    MBA's own figure is kept only where it falls plausibly between the two.
    The reasoning is that the completion is the evidence -- the platform knows
    the learner finished the component, and the curriculum already says what
    finishing it is worth. Preferring a timer that is demonstrably wrong to a
    figure the course author set would understate a learner who did the work
    just as badly as the raw seconds overstate one who left a tab open.

    Returns ``(seconds, adjustment)`` where adjustment is 'capped', 'floored'
    or '' -- reported so the size of the correction stays visible.
    """
    if not expected_seconds:
        # A component the curriculum credits no hours for contributes none,
        # however long MBA says it was open. Passing the raw figure through
        # here instead would import 75,000 hours from ~1,000 components whose
        # authored budget is zero -- the reading and video components carrying
        # MBA's largest wall-clock readings. Zero authored hours is a statement
        # that the component is not OTJH-bearing, not an absence of one.
        return 0, "uncredited"
    if claimed > expected_seconds:
        return expected_seconds, "capped"
    if claimed < IMPLAUSIBLY_SHORT_SECONDS:
        return expected_seconds, "floored"
    return claimed, ""


#: Used when a quiz has no authored pass mark. The curriculum's own average is
#: about 70, and the platform treats a missing mark this way elsewhere.
DEFAULT_PASSING_GRADE = 50


def _quiz_result(progress, passing_grade):
    """``(grade, passed)`` for a quiz attempt, in the platform's own terms.

    Two conversions, both needed for the learner's Quizzes tab to read right:

    *Scale.* MBA scores out of 100; the platform stores a 0-1 decimal and
    renders it as a percentage. Importing 85 unconverted displays as 8500%.

    *Pass.* MBA sets ``passed`` on every completed quiz regardless of score --
    in this learner's data it is true for a 5% attempt -- because it means
    "finished", not "passed". So the mark is judged against the quiz's own
    ``passing_grade`` from the curriculum instead, which is what the platform
    would have applied had the attempt been made here.
    """
    score = progress.get("best_score_percent")
    if score is None:
        score = progress.get("last_score_percent")
    if score is None:
        # Nothing to judge. Trust MBA's flag rather than failing an attempt
        # whose score simply was not recorded.
        return None, bool(progress.get("passed"))

    try:
        score = float(score)
    except (TypeError, ValueError):
        return None, bool(progress.get("passed"))

    threshold = passing_grade if passing_grade is not None else DEFAULT_PASSING_GRADE
    return round(score / 100, 4), score >= float(threshold)


def _completed(progress):
    """Whether the learner finished this component.

    ``completed`` is the flag MasterStudy sets; ``status`` is consulted too
    because some rows carry the status without the boolean.
    """
    if not isinstance(progress, dict):
        return False
    return bool(progress.get("completed")) or _s(progress.get("status")).lower() == "completed"


class Command(BaseCommand):
    help = "Import a learner's MBA course progress into their LMS training plan."

    def add_arguments(self, parser):
        parser.add_argument("--email", required=True, help="Learner's email address.")
        parser.add_argument(
            "--apply", action="store_true",
            help="Write the changes. Without it, the command only reports what it would do.",
        )

    # -- lookups ---------------------------------------------------------

    def _mba_learner(self, email):
        with connections["default"].cursor() as cur:
            cur.execute(
                'SELECT user_id, name, email FROM "MBA".students WHERE lower(email) = %s',
                [email.lower()],
            )
            return cur.fetchone()

    def _mba_progress(self, user_id):
        with connections["default"].cursor() as cur:
            cur.execute(
                """
                SELECT sp.course_id, sp.module_id, cc.course_name,
                       sp.progress_percent, sp.component_progress
                  FROM "MBA".student_progress sp
                  LEFT JOIN "MBA".course_curriculum cc ON cc.course_id = sp.course_id
                 WHERE sp.user_id = %s
                 ORDER BY sp.course_id
                """,
                [user_id],
            )
            return cur.fetchall()

    def _curriculum(self, module_refs):
        """The modules, weeks and components as the curriculum holds them now.

        Read live rather than from the MBA snapshot so the plan matches what the
        learner's page will actually render, including any edit made since the
        courses were imported.
        """
        modules = {}
        weeks_by_module = defaultdict(list)
        components = {}

        with connections["default"].cursor() as cur:
            cur.execute(
                """
                SELECT module_catalogue_id, title, programme_id, programme_name,
                       cohort_id, cohort_name, group_id, group_name, total_otjh
                  FROM curriculum.modules
                 WHERE module_catalogue_id = ANY(%s)
                   AND coalesce(is_programme_deleted, false) = false
                """,
                [module_refs],
            )
            for row in cur.fetchall():
                modules[row[0]] = {
                    "moduleTitle": row[1],
                    "programmeId": row[2],
                    "programme": row[3],
                    "cohortId": row[4],
                    "cohort": row[5],
                    "groupId": row[6],
                    "group": row[7],
                    "totalOtjh": row[8],
                }

            cur.execute(
                """
                SELECT id, module_catalogue_id, title, week_number
                  FROM curriculum.weeks
                 WHERE module_catalogue_id = ANY(%s)
                   AND coalesce(is_programme_deleted, false) = false
                 ORDER BY module_catalogue_id, display_order, week_number
                """,
                [module_refs],
            )
            for row in cur.fetchall():
                weeks_by_module[row[1]].append({
                    "weekId": row[0],
                    "weekTitle": row[2] or (f"Week {row[3]}" if row[3] else ""),
                })

            cur.execute(
                """
                SELECT id, week_id, module_catalogue_id, title, type,
                       expected_otjh, points
                  FROM curriculum.components
                 WHERE module_catalogue_id = ANY(%s)
                   AND coalesce(is_programme_deleted, false) = false
                 ORDER BY module_catalogue_id, week_id, display_order
                """,
                [module_refs],
            )
            for row in cur.fetchall():
                components[row[0]] = {
                    "weekId": row[1],
                    "moduleId": row[2],
                    "componentTitle": row[3],
                    "componentType": row[4],
                    "expectedOtjh": row[5],
                    "points": row[6],
                    "quizId": None,
                    "passingGrade": None,
                }

            # The quiz behind each quiz component, and the mark it is passed at.
            # The learner's Quizzes tab matches attempts to quizzes by this id
            # (buildLinkedQuizzes in the SPA), so an imported attempt without it
            # is invisible: the quiz keeps reading "To do" however well the
            # learner did on it.
            cur.execute(
                """
                SELECT l.component_id, l.quiz_id, q.passing_grade
                  FROM curriculum.quiz_component_links l
                  JOIN curriculum.quizzes q ON q.id = l.quiz_id
                 WHERE l.component_id = ANY(%s)
                """,
                [list(components)],
            )
            for component_id, quiz_id, passing_grade in cur.fetchall():
                component = components.get(component_id)
                if component is not None:
                    component["quizId"] = quiz_id
                    component["passingGrade"] = passing_grade

        return modules, weeks_by_module, components

    # -- plan ------------------------------------------------------------

    def _build_plan(self, rows, modules, weeks_by_module, components):
        """The training plan, ordered as the MBA rows are.

        Components are grouped under their week by ``week_id``, so a week with
        no components in the curriculum is left out rather than shown empty.
        """
        by_week = defaultdict(list)
        for component_id, component in components.items():
            by_week[component["weekId"]].append((component_id, component))

        plan = []
        plan_module_refs = []
        for _course_id, module_ref, _name, _pct, _progress in rows:
            module_ref = _s(module_ref)
            module = modules.get(module_ref)
            if not module:
                continue

            plan_weeks = []
            for week in weeks_by_module.get(module_ref, []):
                week_components = [
                    {"componentId": cid, "componentTitle": c["componentTitle"]}
                    for cid, c in by_week.get(week["weekId"], [])
                ]
                if week_components:
                    plan_weeks.append({
                        "weekId": week["weekId"],
                        "weekTitle": week["weekTitle"],
                        "components": week_components,
                    })

            if plan_weeks:
                plan.append({
                    "moduleId": module_ref,
                    "moduleTitle": module["moduleTitle"],
                    "hours": float(module["totalOtjh"] or 0),
                    "weeks": plan_weeks,
                })
                plan_module_refs.append(module_ref)

        return plan, plan_module_refs

    # -- progress --------------------------------------------------------

    def _build_entries(self, rows, modules, weeks_by_module, components):
        week_titles = {
            week["weekId"]: week["weekTitle"]
            for weeks in weeks_by_module.values()
            for week in weeks
        }

        entries = []
        unresolved = []
        capped = 0
        floored = 0
        uncredited = 0
        claimed_total = 0
        verified_total = 0

        for _course_id, module_ref, course_name, _pct, component_progress in rows:
            module_ref = _s(module_ref)
            module = modules.get(module_ref)
            if not module:
                continue

            for item in _decode(component_progress) or []:
                if not isinstance(item, dict):
                    continue
                progress = item.get("progress") or {}
                if not _completed(progress):
                    continue

                component_ref = _s(item.get("component_id"))
                component = components.get(component_ref)
                if component is None:
                    # Reported, never guessed: a completion whose component no
                    # longer exists cannot be placed in the plan.
                    unresolved.append((module_ref, component_ref, _s(item.get("title"))))
                    continue

                expected = component["expectedOtjh"]
                expected_seconds = int(Decimal(str(expected or 0)) * 3600)
                claimed = max(int(progress.get("time_spent_seconds") or 0), 0)
                verified, adjustment = _credit_seconds(claimed, expected_seconds)
                if adjustment == "capped":
                    capped += 1
                elif adjustment == "floored":
                    floored += 1
                elif adjustment == "uncredited":
                    uncredited += 1
                claimed_total += claimed
                verified_total += verified

                is_quiz = _s(item.get("post_type")) in QUIZ_POST_TYPES
                attempts = progress.get("attempts") or []
                grade, passed = _quiz_result(progress, component["passingGrade"])

                entries.append({
                    "kind": "quiz" if is_quiz else "component",
                    "module_ref": module_ref,
                    "module_title": module["moduleTitle"] or _s(course_name),
                    "week_ref": component["weekId"],
                    "week_title": week_titles.get(component["weekId"], ""),
                    "component_ref": component_ref,
                    "component_title": component["componentTitle"] or _s(item.get("title")),
                    "component_type": component["componentType"] or "",
                    "programme_ref": module["programmeId"],
                    "programme_title": module["programme"] or "",
                    "cohort_ref": module["cohortId"],
                    "cohort_title": module["cohort"] or "",
                    "group_ref": module["groupId"],
                    "group_title": module["group"] or "",
                    "expected_otjh": expected,
                    "points": component["points"],
                    # The quiz this attempt belongs to. Without it the learner's
                    # Quizzes tab cannot match the attempt to its quiz and shows
                    # the quiz as never started.
                    "quiz_ref": str(component["quizId"]) if is_quiz and component["quizId"] else None,
                    "attempt": len(attempts) or 1,
                    "grade": grade if is_quiz else None,
                    "passed": passed if is_quiz else None,
                    "started_at": parse_datetime(_s(progress.get("started_at_utc"))),
                    "submitted_at": parse_datetime(_s(progress.get("completed_at_utc"))),
                    "claimed_seconds": claimed,
                    "verified_seconds": verified,
                })

        return entries, unresolved, capped, floored, uncredited, claimed_total, verified_total

    # -- entry point -----------------------------------------------------

    def handle(self, *args, **options):
        from learner_api.active_users import recompute_completed_hours
        from learner_api.models import EnrolmentUser, LearnerProfile, LearnerProgressEntry

        email = _s(options["email"])
        apply_changes = bool(options.get("apply"))

        mba = self._mba_learner(email)
        if not mba:
            raise CommandError(f"No MBA student found for {email}.")
        user_id, mba_name, _mba_email = mba

        enrolment = EnrolmentUser.all_learners.filter(email__iexact=email).first()
        if enrolment is None:
            raise CommandError(f"No enrolment record found for {email}.")

        self.stdout.write(f"MBA student {user_id} ({mba_name}) -> enrolment {enrolment.pk}")

        rows = self._mba_progress(user_id)
        if not rows:
            raise CommandError(f"{email} has no rows in MBA.student_progress.")

        module_refs = [_s(row[1]) for row in rows if _s(row[1])]
        modules, weeks_by_module, components = self._curriculum(module_refs)

        missing = [ref for ref in module_refs if ref not in modules]
        if missing:
            self.stdout.write(self.style.WARNING(
                f"  {len(missing)} MBA module(s) are not in the curriculum and are skipped: "
                + ", ".join(missing[:5]) + (" ..." if len(missing) > 5 else "")
            ))

        plan, plan_module_refs = self._build_plan(rows, modules, weeks_by_module, components)
        entries, unresolved, capped, floored, uncredited, claimed_total, verified_total = self._build_entries(
            rows, modules, weeks_by_module, components,
        )

        self.stdout.write(
            f"  plan:     {len(plan)} module(s), "
            f"{sum(len(m['weeks']) for m in plan)} week(s), "
            f"{sum(len(w['components']) for m in plan for w in m['weeks'])} component(s)"
        )
        self.stdout.write(f"  progress: {len(entries)} completed component(s)")
        self.stdout.write(
            f"            {capped} capped (MBA time implausibly long), "
            f"{floored} floored (MBA recorded no usable time), "
            f"{uncredited} carry no authored OTJH, "
            f"{len(entries) - capped - floored - uncredited} kept as recorded"
        )
        self.stdout.write(
            f"  hours:    MBA reported {claimed_total / 3600:,.0f}h "
            f"-> importing {verified_total / 3600:,.1f}h"
        )
        if unresolved:
            self.stdout.write(self.style.WARNING(
                f"  {len(unresolved)} completion(s) name components that are not in the "
                f"curriculum and are skipped"
            ))
            for module_ref, component_ref, title in unresolved[:5]:
                self.stdout.write(f"      {module_ref} / {component_ref} {title[:50]}")

        if not apply_changes:
            self.stdout.write(self.style.WARNING("\nDry run -- nothing written. Re-run with --apply."))
            return

        with transaction.atomic(using="enrolment"):
            enrolment.learning_plan = plan
            enrolment.modules = plan_module_refs
            enrolment.save(update_fields=["learning_plan", "modules"])

            profile = LearnerProfile.objects.filter(enrolment_id=enrolment.pk).first()
            if profile is None:
                self.stdout.write(self.style.WARNING(
                    "  No Learner.learners mirror yet, so the plan is saved but progress is not: "
                    "progress entries hang off the mirror, which is created on activation. "
                    "Re-run this command once the learner is active."
                ))
                return

            # Only this importer's rows -- anything done on the platform stays.
            removed = LearnerProgressEntry.objects.filter(
                learner=profile, component_link_source=IMPORT_SOURCE,
            ).delete()[0]

            highest = (
                LearnerProgressEntry.objects.filter(learner=profile)
                .order_by("-entry_order")
                .values_list("entry_order", flat=True)
                .first()
            )
            next_order = (highest or 0) + 1

            created = [
                LearnerProgressEntry(
                    learner=profile,
                    entry_order=next_order + offset,
                    feedback="",
                    # Left empty deliberately: reported_time is the learner's own
                    # declaration, and the import has none to make on their behalf.
                    reported_time="",
                    time_taken="",
                    feed_kind=entry["kind"],
                    feed_action="Completed activity",
                    feed_title=entry["component_title"],
                    feed_detail="Imported from MBA",
                    feed_occurred_at=entry["submitted_at"],
                    component_link_status="resolved_to_current_component",
                    component_link_source=IMPORT_SOURCE,
                    time_tracking_source="mba_import_bounded_by_authored_otjh",
                    time_tracking_calculation=(
                        "expected_otjh where mba_time_spent_seconds was implausible "
                        "(over the authored budget, or under a minute), else as recorded"
                    ),
                    time_tracking_session_ref="",
                    **entry,
                )
                for offset, entry in enumerate(entries)
            ]
            LearnerProgressEntry.objects.bulk_create(created, batch_size=200)

            # LearnerProfile.completed_hours is a stored total that the submit
            # path refreshes on each submission. bulk_create goes around that,
            # so without this the learner would show 0 hours on every screen
            # that reads the column rather than recomputing from the entries.
            hours = recompute_completed_hours(profile.pk)
            self.stdout.write(f"  OTJH:     completed_hours set to {hours}")

            self.stdout.write(self.style.SUCCESS(
                f"\nWrote the plan ({len(plan)} modules) and {len(created)} progress entries "
                f"(replacing {removed} from a previous import)."
            ))
