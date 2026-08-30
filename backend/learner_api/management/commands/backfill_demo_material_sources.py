"""Backfill missing material sources for the three inspection-demo learners.

Safe by default: dry-run only, scoped to learner ids 98/99/100 unless the caller
passes a different explicit list, and never overwrites an existing source.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from django.conf import settings
from django.core.management.base import BaseCommand, CommandError
from django.db import connections, transaction
from django.utils import timezone

from curriculum_api.management.commands.import_mba_curriculum import legacy_rows
from learner_api.learner_detail import build_learner_detail
from learner_api.models import EnrolmentUser


CONN = "enrolment"
DEFAULT_LEARNERS = [98, 99, 100]

TARGET_KEYS = {
    "video": ["videoUrl"],
    "podcast": ["audioUrl", "podcastUrl"],
    "audio": ["audioUrl", "podcastUrl"],
    "reading": ["resourceUrl", "uploadedFileUrl", "fileUrl"],
    "powerpoint": ["presentationUrl", "uploadedFileUrl", "resourceUrl"],
    "presentation": ["presentationUrl", "uploadedFileUrl", "resourceUrl"],
    "slides": ["presentationUrl", "uploadedFileUrl", "resourceUrl"],
}

WRITE_KEY = {
    "video": "videoUrl",
    "podcast": "podcastUrl",
    "audio": "audioUrl",
    "reading": "resourceUrl",
    "powerpoint": "presentationUrl",
    "presentation": "presentationUrl",
    "slides": "presentationUrl",
}


def clean(value: Any) -> str:
    return str(value or "").strip()


def normal_type(value: Any) -> str:
    return clean(value).lower().replace("-", "_").replace(" ", "_")


def as_dict(value: Any) -> dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return dict(parsed) if isinstance(parsed, dict) else {}
        except (TypeError, ValueError):
            return {}
    return {}


def first_url(*values: Any) -> str:
    for value in values:
        text = clean(value)
        if text:
            return text
    return ""


def printable(value: Any) -> str:
    """Console-safe text for Windows terminals that default to cp1252."""
    return clean(value).encode("ascii", "replace").decode("ascii")


def has_source(component: dict[str, Any]) -> bool:
    if component.get("isQuiz"):
        meta = component.get("quizMeta") or {}
        return bool(meta.get("quizId") and (meta.get("questions") or 0) > 0)
    return bool(
        clean(component.get("videoUrl"))
        or clean(component.get("audioUrl"))
        or clean(component.get("resourceUrl"))
        or clean(component.get("contentHtml"))
        or clean(component.get("liveSessionUrl"))
        or clean(component.get("teamsLiveSessionId"))
    )


@dataclass
class Candidate:
    component_id: str
    source_url: str
    file_name: str
    source: str


class Command(BaseCommand):
    help = "Dry-run/apply missing material-source backfill for inspection demo learners."

    def add_arguments(self, parser):
        parser.add_argument("--learners", nargs="+", type=int, default=DEFAULT_LEARNERS)
        parser.add_argument("--apply", action="store_true", help="Write changes. Default is dry-run.")
        parser.add_argument("--dry-run", action="store_true", help="Do not write changes. This is the default.")
        parser.add_argument("--batch-size", type=int, default=25)

    def handle(self, *args, **options):
        learner_ids: list[int] = options["learners"]
        apply = bool(options["apply"])
        batch_size = int(options["batch_size"] or 25)
        if batch_size < 1 or batch_size > 100:
            raise CommandError("--batch-size must be between 1 and 100")

        details = []
        missing: dict[str, dict[str, Any]] = {}
        for learner_id in learner_ids:
            learner = EnrolmentUser.all_learners.using(CONN).get(pk=learner_id)
            detail = build_learner_detail(learner, learner_id)
            components = detail.get("components") or []
            empty = [component for component in components if not has_source(component)]
            details.append((learner_id, detail.get("name"), detail.get("programme"), len(components), empty))
            for component in empty:
                component_id = clean(component.get("componentId"))
                if component_id:
                    missing[component_id] = component

        self.stdout.write("Inspection demo source backfill")
        self.stdout.write(f"mode: {'APPLY' if apply else 'DRY-RUN'}")
        self.stdout.write(f"learners: {', '.join(map(str, learner_ids))}")
        for learner_id, name, programme, total, empty in details:
            self.stdout.write(f"- {learner_id}: {name} | {programme} | components={total} missing={len(empty)}")

        if not missing:
            self.stdout.write(self.style.SUCCESS("Nothing missing. No changes needed."))
            return

        candidates = self._find_candidates(set(missing))
        to_update = []
        for component_id, component in missing.items():
            candidate = candidates.get(component_id)
            if not candidate:
                continue
            ctype = normal_type(component.get("type"))
            key = WRITE_KEY.get(ctype)
            if not key:
                continue
            to_update.append((component_id, key, candidate))

        self.stdout.write("")
        self.stdout.write(f"missing components: {len(missing)}")
        self.stdout.write(f"fillable candidates: {len(to_update)}")
        self.stdout.write(f"still missing: {len(missing) - len(to_update)}")

        if to_update:
            self.stdout.write("")
            self.stdout.write("Will update:")
            for component_id, key, candidate in to_update:
                self.stdout.write(f"- {component_id}: {key} <- {candidate.source_url[:140]} ({candidate.source})")

        still_missing = [component for cid, component in missing.items() if cid not in {item[0] for item in to_update}]
        if still_missing:
            self.stdout.write("")
            self.stdout.write("Still missing source:")
            for component in still_missing:
                self.stdout.write(
                    f"- {printable(component.get('componentId'))} | {printable(component.get('type'))} | "
                    f"{printable(component.get('component') or component.get('display'))} | "
                    f"{printable(component.get('module'))} / {printable(component.get('week'))}"
                )

        if not apply:
            self.stdout.write("")
            self.stdout.write("Dry-run only. Re-run with --apply to write fillable candidates.")
            return

        if not to_update:
            self.stdout.write(self.style.WARNING("No fillable candidates found. No database writes made."))
            return

        self._backup_settings([component_id for component_id, _key, _candidate in to_update])
        self._apply_updates(to_update, batch_size)
        self.stdout.write(self.style.SUCCESS(f"Updated {len(to_update)} component(s)."))

    def _find_candidates(self, component_ids: set[str]) -> dict[str, Candidate]:
        candidates: dict[str, Candidate] = {}
        candidates.update(self._audit_candidates(component_ids))
        for component_id, candidate in self._legacy_export_candidates(component_ids).items():
            candidates.setdefault(component_id, candidate)
        return candidates

    def _audit_candidates(self, component_ids: set[str]) -> dict[str, Candidate]:
        if not component_ids:
            return {}
        found: dict[str, Candidate] = {}
        with connections[CONN].cursor() as cursor:
            cursor.execute(
                """
                SELECT table_name
                FROM information_schema.columns
                WHERE table_schema = 'programme_audit' AND column_name = 'component_id'
                ORDER BY CASE WHEN table_name = 'assets' THEN 0 ELSE 1 END, table_name
                """
            )
            tables = [row[0] for row in cursor.fetchall()]
            for table in tables:
                cursor.execute(
                    """
                    SELECT column_name
                    FROM information_schema.columns
                    WHERE table_schema='programme_audit' AND table_name=%s
                    """,
                    [table],
                )
                columns = {row[0] for row in cursor.fetchall()}
                wanted = [
                    key for key in (
                        "component_id", "source_url", "embed_url", "file_name",
                        "settings", "raw_component",
                    )
                    if key in columns
                ]
                if "component_id" not in wanted:
                    continue
                selected = ", ".join(f'"{key}"' for key in wanted)
                cursor.execute(
                    f'SELECT {selected} FROM "programme_audit"."{table}" WHERE component_id = ANY(%s)',
                    [list(component_ids)],
                )
                for row in cursor.fetchall():
                    item = dict(zip(wanted, row))
                    component_id = clean(item.get("component_id"))
                    if not component_id or component_id in found:
                        continue
                    settings = as_dict(item.get("settings"))
                    raw = as_dict(item.get("raw_component"))
                    source_url = first_url(
                        item.get("source_url"), item.get("embed_url"),
                        settings.get("videoUrl"), settings.get("audioUrl"), settings.get("podcastUrl"),
                        settings.get("resourceUrl"), settings.get("uploadedFileUrl"),
                        raw.get("videoUrl"), raw.get("resourceUrl"),
                    )
                    if source_url:
                        found[component_id] = Candidate(
                            component_id=component_id,
                            source_url=source_url,
                            file_name=clean(item.get("file_name")),
                            source=f"programme_audit.{table}",
                        )
        return found

    def _legacy_export_candidates(self, component_ids: set[str]) -> dict[str, Candidate]:
        found: dict[str, Candidate] = {}
        for row in legacy_rows():
            for section in (row.get("curriculum") or {}).get("sections") or []:
                for material in section.get("materials") or []:
                    component_id = clean(material.get("component_id"))
                    if not component_id or component_id not in component_ids or component_id in found:
                        continue
                    links = material.get("links") if isinstance(material.get("links"), list) else []
                    files = material.get("files") if isinstance(material.get("files"), list) else []
                    attachments = material.get("attachments") if isinstance(material.get("attachments"), list) else []
                    link_url = first_url(material.get("link_url"), material.get("url"), *(item.get("url") for item in links if isinstance(item, dict)))
                    file_url = first_url(
                        *(item.get("original_file_url") or item.get("url") for item in [*files, *attachments] if isinstance(item, dict))
                    )
                    source_url = file_url or link_url
                    if source_url:
                        title = first_url(
                            *(item.get("title") or item.get("filename") for item in [*files, *attachments] if isinstance(item, dict))
                        )
                        found[component_id] = Candidate(component_id, source_url, title, "legacy_rows")
        return found

    def _backup_settings(self, component_ids: list[str]) -> None:
        backup_dir = Path(settings.BASE_DIR) / "backfill_reports"
        backup_dir.mkdir(parents=True, exist_ok=True)
        path = backup_dir / f"demo_material_sources_backup_{timezone.now().strftime('%Y%m%d_%H%M%S')}.json"
        with connections[CONN].cursor() as cursor:
            cursor.execute(
                "SELECT id, settings_json FROM curriculum.components WHERE id = ANY(%s)",
                [component_ids],
            )
            rows = [{"id": row[0], "settings_json": row[1]} for row in cursor.fetchall()]
        path.write_text(json.dumps(rows, ensure_ascii=False, indent=2, default=str), encoding="utf-8")
        self.stdout.write(f"Backup written: {path}")

    def _apply_updates(self, updates: list[tuple[str, str, Candidate]], batch_size: int) -> None:
        now = timezone.now()
        for index in range(0, len(updates), batch_size):
            batch = updates[index:index + batch_size]
            with transaction.atomic(using=CONN):
                with connections[CONN].cursor() as cursor:
                    for component_id, key, candidate in batch:
                        cursor.execute(
                            "SELECT type, settings_json FROM curriculum.components WHERE id=%s FOR UPDATE",
                            [component_id],
                        )
                        row = cursor.fetchone()
                        if not row:
                            continue
                        ctype, settings = row
                        settings = as_dict(settings)
                        keys = TARGET_KEYS.get(normal_type(ctype), [key])
                        if any(clean(settings.get(existing_key)) for existing_key in keys):
                            continue
                        settings[key] = candidate.source_url
                        if candidate.file_name and not clean(settings.get("fileName")):
                            settings["fileName"] = candidate.file_name
                        settings.setdefault("sourceBackfilledFrom", candidate.source)
                        settings["sourceBackfilledAt"] = now.isoformat()
                        cursor.execute(
                            "UPDATE curriculum.components SET settings_json=%s::jsonb, updated_at=%s WHERE id=%s",
                            [json.dumps(settings, ensure_ascii=False), now, component_id],
                        )
