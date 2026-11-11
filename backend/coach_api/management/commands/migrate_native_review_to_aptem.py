"""Move the work saved on a Curriculum (native) Review onto the Aptem Review
that owns the same occurrence.

An Aptem-sourced learner reads and signs their imported Reviews only
(coach_api.review_sources.resolve_review_source). A native Review Instance
created for such a learner -- or one left behind on a Learner profile that was
later deleted and rebuilt -- is therefore unreachable for them, however much
work it holds. This command copies that work onto the imported Review and
leaves it awaiting signatures.

Answers only. Signatures are deliberately NOT copied: the imported Review is a
different document, so it is signed on its own evidence, and the native
signatures stay where they are as history.

Field identity is not shared between the two systems: Curriculum keys answers
by ``REVF-...`` IDs, Aptem by ``section-N:name`` keys. The two forms are the
same questionnaire, so fields are paired by (section title, field title), which
is unique within each form and is verified to be unique before anything is
written.

Nothing here writes Aptem source rows, native Review Instances, calendar rows
or Microsoft Graph. Dry run is the default.

    python manage.py migrate_native_review_to_aptem \
        --native-instance REVI-xxxx --aptem-review 21694 \
        --owner coach@example.com [--apply]
"""
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction


DISPLAY_ONLY_NATIVE_TYPES = {"title_description"}
DISPLAY_ONLY_APTEM_TYPE = 11


def _decoded(value):
    """Curriculum answers arrive as the stored jsonb document, so a saved
    string reads back as ``'"Agree"'``. Decode once; leave anything that is
    not JSON exactly as it is."""
    import json

    if not isinstance(value, str):
        return value
    try:
        return json.loads(value)
    except (TypeError, ValueError):
        return value


def _text(value):
    return " ".join(str(value if value is not None else "").split())


def _pair_key(section_title, field_title):
    return (_text(section_title).casefold(), _text(field_title).casefold())


def _walk_fields(snapshot, child_keys):
    """(section title, field) for every field at any depth.

    Both forms nest the children of a yes/no question inside the parent rather
    than listing them beside it -- Curriculum under ``yesFields``/``noFields``
    (curriculum_api.review_instances._flatten_snapshot_fields), the imported
    form under ``ifTrue``/``ifFalse`` (coach_api.migrated_reviews._visible_fields).
    A walk that stops at the top level silently loses them, and the answers
    that belong to them with it.
    """
    for section in snapshot.get("sections") or []:
        section_title = section.get("title") or section.get("name")
        pending = list(section.get("fields") or [])
        while pending:
            field = pending.pop(0)
            yield section_title, field
            for child_key in child_keys:
                pending.extend(field.get(child_key) or [])


def _native_pairs(snapshot):
    """{(section, title): field_id} for every answerable Curriculum field."""
    pairs, duplicates = {}, []
    for section_title, field in _walk_fields(snapshot, ("yesFields", "noFields")):
        if field.get("fieldType") in DISPLAY_ONLY_NATIVE_TYPES:
            continue
        key = _pair_key(section_title, field.get("title"))
        if key in pairs:
            duplicates.append(key)
        pairs[key] = field.get("id")
    return pairs, duplicates


def _aptem_pairs(snapshot):
    """{(section, title): aptem_key} for every answerable imported field."""
    pairs, duplicates = {}, []
    for section_title, field in _walk_fields(snapshot, ("ifTrue", "ifFalse")):
        try:
            aptem_type = int(field.get("aptemType"))
        except (TypeError, ValueError):
            aptem_type = None
        if aptem_type == DISPLAY_ONLY_APTEM_TYPE:
            continue
        key = _pair_key(section_title, field.get("title"))
        if key in pairs:
            duplicates.append(key)
        pairs[key] = field.get("key")
    return pairs, duplicates


def _option_values(snapshot):
    """{aptem_key: [allowed option, ...]} so a dry run can flag a bad value.

    Options are kept EXACTLY as the imported template stores them, padding
    included ("no concerns ", " Agree"). migrated_reviews.validate_answers
    compares a list_item answer to them with ``in``, with no trimming, so an
    answer must carry the same padding or it is rejected.
    """
    allowed = {}
    for _section_title, field in _walk_fields(snapshot, ("ifTrue", "ifFalse")):
        options = field.get("options")
        if not isinstance(options, list) or not options:
            continue
        values = [
            item.get("value") if isinstance(item, dict) else item
            for item in options
        ]
        values = [value for value in values if isinstance(value, str) and value.strip()]
        if values:
            allowed[field.get("key")] = values
    return allowed


def _canonical_option(value, options):
    """The template's own spelling of this choice, or None when it is not one.

    Curriculum and the imported form hold the same vocabulary with different
    padding and casing, so matching ignores both -- but the value written is
    always the imported template's exact string.
    """
    wanted = _text(value).casefold()
    if not wanted:
        return None
    return next((option for option in options if _text(option).casefold() == wanted), None)


class Command(BaseCommand):
    help = "Copy a native Review Instance's answers onto its learner's imported Aptem Review."

    def add_arguments(self, parser):
        parser.add_argument("--native-instance", required=True,
                            help="Curriculum Review Instance ID (REVI-...) holding the work.")
        parser.add_argument("--aptem-review", required=True,
                            help="Target imported review's Aptem review ID (e.g. 21694).")
        parser.add_argument("--owner", required=True,
                            help="Coach who owns the learner; must match the learner's current coach.")
        parser.add_argument("--apply", action="store_true",
                            help="Write the change. Without it the command only reports.")
        parser.add_argument("--allow-unmapped", action="store_true",
                            help="Proceed even if some answered native fields have no imported twin.")

    # ---------------------------------------------------------------- loading

    def _load_native(self, instance_id):
        from curriculum_api import review_instances as native_reviews
        from curriculum_api import views as curriculum_views

        instance = native_reviews.get_review_instance(instance_id)
        if not instance:
            raise CommandError(f"Native review instance {instance_id} was not found.")
        snapshot = curriculum_views.as_json_value(instance.get("definition_snapshot"), {})
        if not snapshot.get("sections"):
            raise CommandError("The native instance has no frozen form definition to read.")
        rows = native_reviews.get_review_instance_answers(instance_id)
        answers = {}
        for field_id, row in rows.items():
            value = _decoded(row.get("answer"))
            if value is None or _text(value) == "":
                continue
            answers[field_id] = value
        return instance, snapshot, answers

    def _native_learner_email(self, instance):
        from coach_api.models import CoachCalendarEvent

        event_id = instance.get("calendar_event_id")
        if not event_id:
            return ""
        record = CoachCalendarEvent.objects.filter(pk=event_id).first()
        return _text(getattr(record, "learner_email", "")).casefold()

    def _load_target(self, owner, aptem_review_id):
        from coach_api import views as coach_views

        event_key = f"imported-review:{aptem_review_id}"
        definition = coach_views._imported_review_definition(owner, event_key)
        if definition is None:
            raise CommandError(
                f"{event_key} does not resolve for {owner}. Check the Aptem review ID "
                "and that the learner is on this coach's caseload."
            )
        return event_key, definition

    # ----------------------------------------------------------------- guards

    def _check_target(self, definition, native_instance, owner):
        from learner_api.models import EnrolmentUser, LearnerProfile
        from coach_api.models import ImportedReviewInstance
        from coach_api.review_sources import source_for_learner

        profile_id = definition["instance"]["learnerId"]
        profile = LearnerProfile.objects.filter(pk=profile_id).first()
        if profile is None:
            raise CommandError(f"The imported review's learner profile {profile_id} is missing.")
        source = (EnrolmentUser.all_learners.filter(pk=profile.enrolment_id).first()
                  if profile.enrolment_id else None)
        identity = source_for_learner(source, profile)
        if identity.kind != "aptem":
            raise CommandError(
                f"Learner {profile_id} resolves to review source '{identity.kind}', not 'aptem'. "
                "This command only moves work onto an Aptem-owned review."
            )
        if _text(profile.coach_email).casefold() != _text(owner).casefold():
            raise CommandError(
                f"Learner {profile_id} is assigned to {profile.coach_email}, not {owner}."
            )
        # The native row may point at a deleted profile ID, so identity is
        # confirmed on the stored learner email rather than on that number.
        stored_email = self._native_learner_email(native_instance)
        profile_email = _text(profile.email).casefold()
        if stored_email and profile_email and stored_email != profile_email:
            raise CommandError(
                "The native review belongs to a different learner email than the imported "
                "review's learner. Refusing to move work between learners."
            )
        if not definition.get("canInitialize") and not definition.get("migratedForm"):
            raise CommandError(
                "The imported review cannot be initialized (no approved migrated template, "
                "or it is a historical/preview-only row)."
            )
        existing = ImportedReviewInstance.objects.filter(
            learner_id=profile_id, source_review_id=int(definition["historicalReview"]["id"]),
        ).first()
        if existing is not None:
            raise CommandError(
                f"An imported review overlay already exists (id {existing.pk}, "
                f"status {existing.status}). Refusing to overwrite existing work."
            )
        return profile

    # ---------------------------------------------------------------- mapping

    def _target_snapshot(self, definition, profile):
        from coach_api.migrated_initialization import _review_snapshot
        from coach_api.migrated_reviews import review_family
        from coach_api.migrated_templates import resolve_template

        family = review_family((definition.get("historicalReview") or {}).get("type"))
        template = resolve_template(definition["migratedProgrammeKey"], family)
        if template is None:
            raise CommandError("No approved migrated template is assigned for this review family.")
        return _review_snapshot(template, profile.id)

    def _semantic_targets(self, native_snapshot, target_snapshot):
        """{native field_id: imported key} for fields the project already pairs
        by meaning rather than by title. The Meeting Summary is titled
        'Summary' in Curriculum and 'Meeting Summary' in the imported form, and
        both sides already expose a resolver for it."""
        from coach_api.migrated_reviews import meeting_summary_field as imported_summary_field
        from curriculum_api.review_instances import meeting_summary_field as native_summary_field

        native_field = native_summary_field(native_snapshot) or {}
        imported_field = imported_summary_field(target_snapshot) or {}
        if native_field.get("id") and imported_field.get("key"):
            return {native_field["id"]: imported_field["key"]}
        return {}

    def _map_answers(self, native_snapshot, native_answers, target_snapshot):
        native_pairs, native_dupes = _native_pairs(native_snapshot)
        aptem_pairs, aptem_dupes = _aptem_pairs(target_snapshot)
        if native_dupes or aptem_dupes:
            raise CommandError(
                "A (section, field) title is repeated inside a form, so fields cannot be "
                f"paired safely. Native: {native_dupes}. Imported: {aptem_dupes}."
            )
        semantic = self._semantic_targets(native_snapshot, target_snapshot)
        allowed = _option_values(target_snapshot)
        by_field_id = {field_id: key for key, field_id in native_pairs.items()}
        mapped, unmapped, recased = {}, [], []
        for field_id, value in native_answers.items():
            pair = by_field_id.get(field_id)
            target_key = semantic.get(field_id) or (aptem_pairs.get(pair) if pair else None)
            if not target_key:
                unmapped.append((field_id, pair))
                continue
            options = allowed.get(target_key)
            if options and value not in options:
                # The two forms hold the same choice with different padding and
                # casing ("No concerns" / "no concerns "). The imported
                # template's exact string wins, and the substitution is
                # reported. Anything that is not the same choice is left alone
                # so the caller sees it rejected rather than guessed at.
                canonical = _canonical_option(value, options)
                if canonical is not None:
                    recased.append((target_key, value, canonical))
                    value = canonical
            mapped[target_key] = value
        return mapped, unmapped, recased

    # ----------------------------------------------------------------- report

    def _unmapped_titles(self, field_ids):
        """Name the fields that could not be paired, including ones dropped from
        this instance's frozen definition, so the report says what to re-enter."""
        if not field_ids:
            return {}
        from curriculum_api import views as curriculum_views

        placeholders = ", ".join(["%s"] * len(field_ids))
        rows = curriculum_views.fetch_all(
            f"select id, title, field_type from "
            f"{curriculum_views.table_name('review_fields')} where id in ({placeholders})",
            list(field_ids),
        )
        return {row["id"]: (row.get("title"), row.get("field_type")) for row in rows}

    def _report(self, native_instance, definition, mapped, unmapped, recased,
                native_answers, target_snapshot):
        allowed = _option_values(target_snapshot)
        self.stdout.write("")
        self.stdout.write(f"  native instance : {native_instance['id']} (status {native_instance['status']})")
        self.stdout.write(f"  native learner  : {native_instance['learner_id']}")
        self.stdout.write(f"  target review   : {definition['instance']['id']} "
                          f"(learner {definition['instance']['learnerId']}, "
                          f"planned {definition['instance'].get('targetDate')})")
        self.stdout.write(f"  answers found   : {len(native_answers)}")
        self.stdout.write(f"  answers mapped  : {len(mapped)}")
        titles = self._unmapped_titles([field_id for field_id, _pair in unmapped])
        for field_id, _pair in unmapped:
            title, field_type = titles.get(field_id, (None, None))
            label = f"{title!r} ({field_type})" if title else "not in this form's definition"
            self.stdout.write(self.style.WARNING(
                f"    UNMAPPED  {field_id}  {label}"
                f"  value={_text(native_answers.get(field_id))[:60]!r}"
            ))
        for key, was, now in recased:
            self.stdout.write(f"    re-cased  {key}: {was!r} -> {now!r}")
        suspect = [
            (key, value) for key, value in mapped.items()
            if key in allowed and value not in allowed[key]
        ]
        for key, value in suspect:
            self.stdout.write(self.style.ERROR(
                f"    VALUE NOT IN OPTIONS {key}: {_text(value)!r} not in {allowed[key]}"
            ))
        return suspect

    # ----------------------------------------------------------------- handle

    def handle(self, *args, **options):
        owner = _text(options["owner"])
        native_instance, native_snapshot, native_answers = self._load_native(options["native_instance"])
        if not native_answers:
            raise CommandError("The native review instance has no saved answers to move.")
        event_key, definition = self._load_target(owner, _text(options["aptem_review"]))
        profile = self._check_target(definition, native_instance, owner)
        target_snapshot = self._target_snapshot(definition, profile)
        mapped, unmapped, recased = self._map_answers(native_snapshot, native_answers, target_snapshot)

        self.stdout.write(self.style.MIGRATE_HEADING(
            "DRY RUN -- nothing written" if not options["apply"] else "APPLYING"
        ))
        suspect = self._report(native_instance, definition, mapped, unmapped, recased,
                               native_answers, target_snapshot)

        if unmapped and not options["allow_unmapped"]:
            raise CommandError(
                f"{len(unmapped)} answered native field(s) have no imported twin. "
                "Re-run with --allow-unmapped to move the rest and handle these by hand."
            )
        if suspect:
            raise CommandError(
                f"{len(suspect)} mapped value(s) are outside the imported field's options. "
                "Fix the source answers first; the imported form would reject them."
            )
        if not options["apply"]:
            self.stdout.write(self.style.SUCCESS(
                f"Would move {len(mapped)} answer(s) onto {event_key} and leave it awaiting signatures."
            ))
            return

        from coach_api.migrated_completion import submit
        from coach_api.migrated_initialization import initialize_imported_review

        with transaction.atomic():
            overlay, created = initialize_imported_review(owner, definition)
            if not created:
                raise CommandError("The imported review overlay already existed; nothing was moved.")
            submit(overlay, mapped)
        self.stdout.write(self.style.SUCCESS(
            f"Moved {len(mapped)} answer(s) onto overlay {overlay.pk} ({event_key}); "
            f"status is now {overlay.status}. No signatures were copied -- the coach signs it, "
            "then the learner is prompted."
        ))
