"""Seed the two system Review Types and classify existing Review templates.

This is the code-side twin of ``sql/2026-09-13_curriculum_review_types.sql``:
the SQL file is what gets applied to Neon, this command does the identical
work for local development, a restored snapshot, or a test. Both are
idempotent and can be run in either order.

Two steps:

1. Seed ``curriculum.review_types`` with the two system types --
   Monthly Coaching Meeting (``mcm``) and Progress Review
   (``progress_review``) -- at their fixed ids, if they are not there.

2. Backfill ``review_templates.review_type_id`` from the retired
   ``review_templates.coach_surface`` column:

       coach_surface 'mcr'              -> Monthly Coaching Meeting
       coach_surface 'progress_review'  -> Progress Review

   This is the ONLY place ``coach_surface`` is ever read. It is a one-time
   inspection of existing configuration, exactly as the brief allows: from
   here on, every runtime decision reads ``review_type_id`` / the Review
   Type's stable ``code``, never the legacy column and never a template's
   name.

A template that already has a ``review_type_id`` is never touched, so a
re-run cannot undo a classification someone has since corrected in the UI. A
template that never claimed a Coach page keeps a NULL type and keeps
classifying as a generic review, until its next edit in the Review editor --
where a type is mandatory.

Dry-run by default: pass --apply to write.
"""
from django.core.management.base import BaseCommand

from ... import review_types
from ... import reviews
from ... import views as curriculum_views


class Command(BaseCommand):
    help = "Seed the system Review Types and backfill review_templates.review_type_id from the retired coach_surface column."

    def add_arguments(self, parser):
        parser.add_argument("--apply", action="store_true", help="Write changes. Without this flag, only reports what would happen.")

    def handle(self, *args, **options):
        apply_changes = options["apply"]
        reviews.ensure_review_tables()
        review_types.ensure_review_types_table()

        if apply_changes:
            seeded = review_types.seed_system_review_types()
            self.stdout.write(f"Seeded system review types: {', '.join(seeded) if seeded else 'none missing'}")
        else:
            present = {curriculum_views.clean_str(row.get('code')).lower() for row in review_types.list_review_types(include_inactive=True)}
            missing = [entry['code'] for entry in review_types.SYSTEM_REVIEW_TYPES if entry['code'] not in present]
            self.stdout.write(f"Would seed system review types: {', '.join(missing) if missing else 'none missing'}")

        if 'coach_surface' not in curriculum_views.column_names(reviews.REVIEW_TEMPLATES_TABLE):
            self.stdout.write("No coach_surface column on review_templates -- nothing to backfill.")
            return

        by_code = {}
        for code in review_types.COACH_SURFACE_LEGACY_CODES.values():
            row = review_types.get_review_type_by_code(code)
            if row:
                by_code[code] = row.get('id')

        updated = {}
        for surface, code in review_types.COACH_SURFACE_LEGACY_CODES.items():
            type_id = by_code.get(code)
            rows = reviews.get_review_template_rows(
                'coach_surface = %s and (review_type_id is null or review_type_id = %s)',
                [surface, ''],
                include_deleted=True,
            )
            if not rows:
                updated[surface] = 0
                continue
            if not type_id:
                self.stderr.write(f"  Review Type '{code}' is missing -- run with --apply to seed it first.")
                updated[surface] = 0
                continue
            self.stdout.write(
                f"{'Classifying' if apply_changes else 'Would classify'} {len(rows)} template(s) "
                f"with coach_surface='{surface}' as '{code}'."
            )
            if apply_changes:
                for row in rows:
                    curriculum_views.update_rows(
                        reviews.REVIEW_TEMPLATES_TABLE, 'id = %s', [row.get('id')],
                        {'review_type_id': type_id},
                    )
            updated[surface] = len(rows)

        unclassified = reviews.get_review_template_rows(
            'review_type_id is null or review_type_id = %s', [''],
        )
        if apply_changes:
            curriculum_views.invalidate_curriculum_cache()

        self.stdout.write(self.style.SUCCESS(
            f"{'Classified' if apply_changes else 'Would classify'}: "
            + "; ".join(f"{surface}={count}" for surface, count in sorted(updated.items()))
        ))
        if unclassified:
            self.stdout.write(
                f"{len(unclassified)} enabled/active template(s) still have no Review Type -- they keep "
                f"classifying as generic reviews until a type is chosen in the Review editor."
            )
        if not apply_changes:
            self.stdout.write("Dry run -- pass --apply to write.")
