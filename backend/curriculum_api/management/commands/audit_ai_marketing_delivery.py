"""Read-only delivery check for every AI in Marketing file and media source."""

import json
import re
from collections import Counter
from concurrent.futures import ThreadPoolExecutor, as_completed

from django.core.management.base import BaseCommand
from django.db import connection

from curriculum_api.ai_marketing_curriculum import _legacy_attachment_id
from learner_api.media_proxy import _open_google_drive_file, _open_legacy_attachment


DRIVE_RE = re.compile(r"drive\.google\.com/file/d/([\w-]{10,})")


def _json(value):
    if isinstance(value, dict):
        return value
    try:
        parsed = json.loads(value or "{}")
    except (TypeError, ValueError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def _probe(item):
    component_id, kind, title, source_url, raw = item
    upstream = None
    try:
        if kind == "video":
            match = DRIVE_RE.search(source_url or "")
            if not match:
                return component_id, kind, title, "missing Drive id"
            upstream = _open_google_drive_file(match.group(1), "bytes=0-31")
        else:
            attachment_id = _legacy_attachment_id(source_url, raw)
            if not attachment_id:
                return component_id, kind, title, "missing attachment id"
            upstream = _open_legacy_attachment(attachment_id, "bytes=0-31")
        if upstream is None:
            return component_id, kind, title, "source returned no stream"
        content_type = (upstream.headers.get("Content-Type") or "").lower()
        signature = upstream.read(16)
        if kind == "video" and not content_type.startswith("video/"):
            return component_id, kind, title, f"expected video, got {content_type or 'unknown'}"
        if kind == "audio" and not content_type.startswith("audio/"):
            return component_id, kind, title, f"expected audio, got {content_type or 'unknown'}"
        if kind == "reading":
            reading_type = str((_json(raw).get("reading") or {}).get("reading_type") or "").lower()
            if reading_type == "pdf" and not (content_type == "application/pdf" or signature.startswith(b"%PDF")):
                return component_id, kind, title, f"expected PDF, got {content_type or 'unknown'}"
            if reading_type in {"ppt", "pptx"} and not signature.startswith(b"PK"):
                return component_id, kind, title, f"expected OOXML deck, got {content_type or 'unknown'}"
        return component_id, kind, title, ""
    except Exception as error:  # noqa: BLE001 - report every remote source failure
        return component_id, kind, title, f"{type(error).__name__}: {error}"
    finally:
        if upstream is not None:
            upstream.close()


class Command(BaseCommand):
    help = "Probe every AI in Marketing document, audio file and video source without changing data."

    def add_arguments(self, parser):
        parser.add_argument("--workers", type=int, default=8)

    def handle(self, *args, **options):
        with connection.cursor() as cursor:
            cursor.execute(
                "SELECT component_id, content_kind, title, source_url, raw_component "
                "FROM programme_audit.ai_in_marketing "
                "WHERE content_kind IN ('reading', 'audio', 'video') ORDER BY title"
            )
            items = [
                (row[0], row[1], row[2], row[3], _json(row[4]))
                for row in cursor.fetchall()
            ]

        failures = []
        counts = Counter(item[1] for item in items)
        workers = max(1, min(int(options["workers"]), 16))
        with ThreadPoolExecutor(max_workers=workers) as executor:
            futures = [executor.submit(_probe, item) for item in items]
            for future in as_completed(futures):
                result = future.result()
                if result[3]:
                    failures.append(result)

        self.stdout.write(
            f'Checked {len(items)} sources: '
            + ", ".join(f"{kind}={count}" for kind, count in sorted(counts.items()))
        )
        for component_id, kind, title, error in sorted(failures):
            self.stderr.write(f"  FAIL {component_id} [{kind}] {title}: {error}")
        if failures:
            self.stderr.write(self.style.ERROR(f"FAILED: {len(failures)} source(s) need attention."))
        else:
            self.stdout.write(self.style.SUCCESS("PASS: every document/audio/video source returned its expected media type."))

