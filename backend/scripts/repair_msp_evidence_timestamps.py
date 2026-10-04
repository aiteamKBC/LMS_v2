"""Repair date-only Aptem evidence timestamps for one MSP group.

The importer intentionally keeps an Aptem evidence item as one canonical
progress row.  This command adds reporting segments only when the attached
document contains date ranges and per-range time totals that reconcile exactly
to the imported duration.  It never changes hours, evidence status, source
dates, journal rows, or existing progress rows.

Default mode is a read-only preview.  Applying a preview requires both the
reviewed database name and fingerprint returned by the preview.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import date, datetime, time, timedelta
from decimal import Decimal
import hashlib
import io
import json
import os
from pathlib import Path
import re
from typing import Any
from zoneinfo import ZoneInfo
import zipfile
import xml.etree.ElementTree as ET

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Jsonb

from azure.storage.blob import BlobServiceClient
from docx import Document
from pypdf import PdfReader


UK = ZoneInfo("Europe/London")
CONTAINER = "fetch-aptem-evidences"
GROUP = "Ray-Managing Successful Programmes (MSP) Jan 2026"
DAILY_LIMIT_MINUTES = 8 * 60
WEEKLY_LIMIT_MINUTES = 12 * 60
MONTHS = {
    name.lower(): index
    for index, name in enumerate(
        ("January", "February", "March", "April", "May", "June",
         "July", "August", "September", "October", "November", "December"),
        1,
    )
}
MONTHS.update({name[:3].lower(): number for name, number in MONTHS.items()})


def env_values() -> dict[str, str]:
    values = dict(os.environ)
    env_path = Path(__file__).resolve().parents[1] / ".env"
    if env_path.exists():
        for raw in env_path.read_text(encoding="utf-8-sig").splitlines():
            line = raw.strip()
            if line and not line.startswith("#") and "=" in line:
                key, value = line.split("=", 1)
                values.setdefault(key.strip(), value.strip().strip('"').strip("'"))
    return values


def database_url(values: dict[str, str]) -> str:
    for key in ("ENROLMENT_DATABASE_URL", "Database_url", "DATABASEURL", "DATABASE_URL"):
        if values.get(key):
            return values[key]
    raise ValueError("No configured enrolment database.")


def digest(value: Any) -> str:
    return hashlib.sha256(
        json.dumps(value, default=str, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


def normal_text(value: str) -> str:
    value = value.replace("\u2013", "-").replace("\u2014", "-")
    # A few legacy Word files contain a replacement glyph where a dash was
    # decoded.  It is safe to treat it as punctuation, never as a digit.
    value = value.replace("\ufffd", "-").replace("\u00ad", "-")
    return value


def parse_date_range(value: str) -> tuple[date, date] | None:
    value = normal_text(value)
    value = re.sub(r"(?<=\d)(?:st|nd|rd|th)\b", "", value, flags=re.I)
    listed = re.match(r"\s*(\d{1,2})\s+([A-Za-z]+)\s+(20\d{2})(.*)$", value)
    if listed:
        month = MONTHS.get(listed.group(2).lower())
        if month:
            days = [int(listed.group(1))]
            days.extend(
                int(item) for item in re.findall(r",\s*(\d{1,2})(?:\s+[A-Za-z]+)?", listed.group(4))
            )
            if len(days) > 1:
                try:
                    return date(int(listed.group(3)), month, min(days)), date(int(listed.group(3)), month, max(days))
                except ValueError:
                    return None
    match = re.search(
        r"(?<!\d)(\d{1,2})\s*(?:to|-)?\s*(\d{1,2})?\s*"
        r"([A-Za-z]+)\s+(20\d{2})(?!\d)", value, re.I,
    )
    if not match:
        # Date: 01/07/26 is used by some learner templates.
        numeric = re.search(r"(?<!\d)(\d{1,2})/(\d{1,2})/(\d{2,4})(?!\d)", value)
        if not numeric:
            return None
        year = int(numeric.group(3))
        if year < 100:
            year += 2000
        try:
            item = date(year, int(numeric.group(2)), int(numeric.group(1)))
        except ValueError:
            return None
        return item, item
    start = int(match.group(1))
    end = int(match.group(2) or start)
    month = MONTHS.get(match.group(3).lower())
    if not month:
        return None
    year = int(match.group(4))
    try:
        return date(year, month, start), date(year, month, end)
    except ValueError:
        return None


def minutes_from(value: str) -> int | None:
    match = re.search(r"(\d+)\s*h\s*(\d+)\s*m", normal_text(value), re.I)
    if match:
        return int(match.group(1)) * 60 + int(match.group(2))
    match = re.search(r"(\d+)\s*hours?\s*(?:and\s*)?(\d+)\s*minutes?", value, re.I)
    if match:
        return int(match.group(1)) * 60 + int(match.group(2))
    match = re.search(r"(\d+(?:\.\d+)?)\s*h(?:ours?)?\b", normal_text(value), re.I)
    if match:
        return int(round(float(match.group(1)) * 60))
    return None


def document_text(blob: str, service: BlobServiceClient) -> str:
    data = service.get_blob_client(CONTAINER, blob).download_blob().readall()
    lowered = blob.lower()
    if lowered.endswith(".docx"):
        return docx_text(data)
    if lowered.endswith(".pdf"):
        return pdf_text(data)
    if lowered.endswith(".xlsx"):
        return xlsx_text(data)
    if lowered.endswith(".pptx"):
        return pptx_text(data)
    if lowered.endswith(".zip"):
        pieces: list[str] = []
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            for name in archive.namelist():
                try:
                    payload = archive.read(name)
                    name_lower = name.lower()
                    if name_lower.endswith(".docx"):
                        pieces.append(docx_text(payload))
                    elif name_lower.endswith(".pdf"):
                        pieces.append(pdf_text(payload))
                    elif name_lower.endswith(".xlsx"):
                        pieces.append(xlsx_text(payload))
                    elif name_lower.endswith(".pptx"):
                        pieces.append(pptx_text(payload))
                    elif name_lower.endswith(".txt"):
                        pieces.append(payload.decode("utf-8", "ignore"))
                except Exception:
                    # A corrupt/unreadable nested attachment makes the item
                    # ineligible for automatic allocation; it is not a reason
                    # to fail the whole group.
                    continue
        return "\n".join(pieces)
    return ""


def docx_text(data: bytes) -> str:
    document = Document(io.BytesIO(data))
    parts = [paragraph.text for paragraph in document.paragraphs]
    for table in document.tables:
        for row in table.rows:
            # Keep each table row on one line.  Aptem's template stores
            # "Date:" and its value as separate paragraphs inside one cell;
            # without whitespace normalisation the two-cell pairing is lost.
            parts.append(" | ".join(re.sub(r"\s+", " ", cell.text).strip() for cell in row.cells))
    return "\n".join(parts)


def pdf_text(data: bytes) -> str:
    return "\n".join((page.extract_text() or "") for page in PdfReader(io.BytesIO(data)).pages)


def xlsx_text(data: bytes) -> str:
    """Extract visible XLSX cell values without evaluating formulas."""
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        shared: list[str] = []
        try:
            root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
            ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
            for item in root.findall("x:si", ns):
                shared.append("".join(node.text or "" for node in item.iter() if node.tag.endswith("}t")))
        except KeyError:
            pass
        pieces: list[str] = []
        ns = {"x": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
        for name in archive.namelist():
            if not name.startswith("xl/worksheets/") or not name.endswith(".xml"):
                continue
            try:
                root = ET.fromstring(archive.read(name))
            except Exception:
                continue
            for row in root.findall(".//x:row", ns):
                values: list[str] = []
                for cell in row.findall("x:c", ns):
                    value = cell.find("x:v", ns)
                    if value is None or value.text is None:
                        continue
                    text = value.text
                    if cell.get("t") == "s":
                        try:
                            text = shared[int(text)]
                        except (ValueError, IndexError):
                            pass
                    values.append(text)
                if values:
                    pieces.append(" | ".join(values))
        return "\n".join(pieces)


def pptx_text(data: bytes) -> str:
    with zipfile.ZipFile(io.BytesIO(data)) as archive:
        pieces: list[str] = []
        for name in archive.namelist():
            if not name.startswith("ppt/slides/") or not name.endswith(".xml"):
                continue
            try:
                root = ET.fromstring(archive.read(name))
            except Exception:
                continue
            pieces.extend(node.text or "" for node in root.iter() if node.tag.endswith("}t"))
        return "\n".join(pieces)


def parse_sections(text: str) -> list[dict[str, Any]]:
    """Extract documented date ranges and their own time totals.

    Aptem Word templates normally expose these as a two-cell table row.  The
    fallback regex handles the same content after PDF/text extraction.
    """
    sections: list[dict[str, Any]] = []
    table_sections: list[dict[str, Any]] = []
    seen: set[tuple[str, str, int]] = set()

    def add(raw_date: str, raw_time: str) -> None:
        date_range = parse_date_range(raw_date)
        minutes = minutes_from(raw_time)
        if not date_range or minutes is None or minutes <= 0:
            return
        key = (date_range[0].isoformat(), date_range[1].isoformat(), minutes)
        if key in seen:
            return
        seen.add(key)
        sections.append({"start": date_range[0], "end": date_range[1], "minutes": minutes})

    # This path preserves Word table cell boundaries and therefore avoids
    # accidentally pairing a quiz's date with another section's duration.
    for line in text.splitlines():
        cells = [re.sub(r"\s+", " ", part.replace("\n", " ")).strip() for part in line.split("|")]
        date_cells = [cell for cell in cells if "date:" in cell.lower()]
        time_cells = [cell for cell in cells if "total time spent:" in cell.lower()]
        if date_cells and time_cells:
            date_range = parse_date_range(date_cells[0])
            minutes = minutes_from(time_cells[0])
            if date_range and minutes:
                table_sections.append({"start": date_range[0], "end": date_range[1], "minutes": minutes})

    # A Word table is authoritative and can legitimately contain repeated
    # same-day rows (for example, separate KSB modules each taking 50 minutes).
    # The fallback regex would collapse those rows or count them twice, so use
    # the table extraction as-is when it found any sections.
    if table_sections:
        return table_sections

    compact = re.sub(r"\s+", " ", normal_text(text))
    activity_markers = list(re.finditer(r"Activity\s+Date\s*:", compact, re.I))
    if activity_markers:
        for index, marker in enumerate(activity_markers):
            chunk_end = activity_markers[index + 1].start() if index + 1 < len(activity_markers) else len(compact)
            chunk = compact[marker.end():chunk_end]
            date_text = re.split(r"\s+Reflection\s*:", chunk, maxsplit=1, flags=re.I)[0]
            date_range = parse_date_range(date_text)
            time_match = re.search(
                r"(?:Total\s+Time\s+Spent|Time\s+Spent)\s*:\s*"
                r"(\d+(?:\.\d+)?\s*h(?:\s*\d+\s*m)?)", chunk, re.I,
            )
            minutes = minutes_from(time_match.group(1)) if time_match else None
            if date_range and minutes:
                sections.append({"start": date_range[0], "end": date_range[1], "minutes": minutes})
        if sections:
            return sections
    pattern = re.compile(
        r"(?:Activity\s+Date|Date(?:\s+completed)?|Completed\s+Date)\s*:\s*"
        r"((?:\d{1,2}(?:st|nd|rd|th)?\s*(?:to|-)\s*)?"
        r"\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+20\d{2}|"
        r"\d{1,2}/\d{1,2}/\d{2,4})"
        r".*?(?:Total\s+Time\s+Spent|Time\s+Spent)\s*:\s*([^|\n]+)", re.I,
    )
    for match in pattern.finditer(compact):
        add(match.group(1), match.group(2))
    return sections


def reconcile_sections(sections: list[dict[str, Any]], target_minutes: int) -> list[dict[str, Any]]:
    """Select document sections that reconcile to the imported Aptem minutes.

    Some templates include a separate KSB summary or round their displayed
    section totals.  We may omit a clearly non-matching summary section, or
    trim at most ten displayed minutes from the final selected section to the
    authoritative Aptem duration.  Larger mismatches remain manual review.
    """
    if not sections or target_minutes <= 0:
        return []
    total = sum(int(section["minutes"]) for section in sections)
    if total == target_minutes:
        return sections
    states: dict[int, list[int]] = {0: []}
    for index, section in enumerate(sections):
        minutes = int(section["minutes"])
        for current, indexes in list(states.items()):
            value = current + minutes
            if value <= target_minutes + 10 and value not in states:
                states[value] = indexes + [index]
    exact = states.get(target_minutes)
    if exact is not None:
        return [sections[index] for index in exact]
    candidates = [value for value in states if target_minutes < value <= target_minutes + 10]
    if not candidates:
        return []
    value = min(candidates)
    selected = [dict(sections[index]) for index in states[value]]
    selected[-1]["minutes"] -= value - target_minutes
    return [section for section in selected if section["minutes"] > 0]


def break_periods(payload: dict[str, Any]) -> list[tuple[date, date]]:
    result: list[tuple[date, date]] = []
    reconciliation = payload.get("reconciliation") if isinstance(payload, dict) else None
    periods = reconciliation.get("break_evidence", {}).get("periods", []) if isinstance(reconciliation, dict) else []
    for period in periods if isinstance(periods, list) else []:
        try:
            start = date.fromisoformat(str(period.get("start")))
            end = date.fromisoformat(str(period.get("end")))
        except (AttributeError, TypeError, ValueError):
            continue
        result.append((start, end))
    return result


def in_break(day: date, periods: list[tuple[date, date]]) -> bool:
    return any(start <= day <= end for start, end in periods)


def weekdays(start: date, end: date, programme_start: date, programme_end: date,
             periods: list[tuple[date, date]]) -> list[date]:
    first = max(start, programme_start)
    last = min(end, programme_end)
    result: list[date] = []
    while first <= last:
        if first.weekday() < 5 and not in_break(first, periods):
            result.append(first)
        first += timedelta(days=1)
    return result


def nearest_weekdays(anchor: date, programme_start: date, programme_end: date,
                     periods: list[tuple[date, date]]) -> list[date]:
    """Return valid working days nearest to an evidence/activity anchor."""
    days = weekdays(programme_start, programme_end, programme_start, programme_end, periods)
    return sorted(days, key=lambda day: (abs((day - anchor).days), day))


def prefix_sections(sections: list[dict[str, Any]], target_minutes: int) -> list[dict[str, Any]]:
    """Keep source/index order when the document exceeds Aptem's total."""
    remaining = target_minutes
    selected: list[dict[str, Any]] = []
    for section in sections:
        if remaining <= 0:
            break
        item = dict(section)
        item["minutes"] = min(int(item["minutes"]), remaining)
        if item["minutes"] > 0:
            selected.append(item)
            remaining -= int(item["minutes"])
    return selected


def week_key(day: date) -> tuple[int, int]:
    iso = day.isocalendar()
    return int(iso.year), int(iso.week)


def profile_state(cur, group: str) -> tuple[list[dict[str, Any]], dict[int, dict[str, Any]]]:
    cur.execute(
        '''SELECT l.id,l.aptem_id,l.full_name,l.start_date,l.end_date,
                  a."Start-Date" AS source_start,a."End-Date" AS source_end
           FROM "Learner".learners l
           JOIN "LMS"."Aptem_users" a ON a."ID"=l.aptem_id
          WHERE a."Group"=%s ORDER BY l.aptem_id''', [group],
    )
    rows = cur.fetchall()
    return rows, {int(row["id"]): row for row in rows}


def current_rows(cur, learner_ids: list[int]) -> list[dict[str, Any]]:
    cur.execute(
        '''SELECT p.id,p.learner_id,p.actual_seconds,p.reporting_started_at,p.reporting_ended_at,
                  p.reporting_month,p.source_system,p.source_activity_id,p.source_payload
             FROM "Learner".learner_progress_entries p
            WHERE p.learner_id=ANY(%s) AND p.deleted_at IS NULL AND p.accepted IS TRUE''',
        [learner_ids],
    )
    rows = cur.fetchall()
    cur.execute(
        '''SELECT progress_id,id,actual_seconds,reporting_started_at,reporting_ended_at
             FROM "Learner".learner_activity_reporting_segments
            WHERE learner_id=ANY(%s) ORDER BY progress_id,segment_order,id''',
        [learner_ids],
    )
    segments: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for segment in cur.fetchall():
        segments[int(segment["progress_id"])].append(segment)
    for row in rows:
        row["segments"] = segments.get(int(row["id"]), [])
    return rows


def evidence_rows(cur, evidence_ids: list[int]) -> dict[int, dict[str, Any]]:
    cur.execute(
        '''SELECT evidence_id,learner_id,evidence_name,spent_time,file_blob,evidence_raw
             FROM fetching_evidence.evidence_items
            WHERE evidence_id=ANY(%s) AND evidence_status='Accepted' AND file_blob IS NOT NULL''',
        [evidence_ids],
    )
    return {int(row["evidence_id"]): row for row in cur.fetchall()}


def source_evidence_id(row: dict[str, Any]) -> int | None:
    payload = row.get("source_payload") or {}
    try:
        return int(payload.get("Id"))
    except (TypeError, ValueError):
        return None


def row_is_estimated(row: dict[str, Any]) -> bool:
    """Return whether a row/its reporting allocation is non-authoritative."""
    payload = row.get("source_payload") or {}
    reconciliation = payload.get("reconciliation") or {}
    allocation = reconciliation.get("reporting_allocation") or {}
    return bool(
        allocation.get("estimated")
        or reconciliation.get("estimated")
        or payload.get("recording_estimated")
        or payload.get("actual_estimated")
    )


def allocate_plan(row: dict[str, Any], evidence: dict[str, Any], owner: dict[str, Any],
                  daily_load: dict[date, int], weekly_load: dict[tuple[int, int], int],
                  existing_end: dict[date, datetime | None], fallback: bool = False) -> dict[str, Any] | None:
    target = int(row["actual_seconds"] or 0)
    if target <= 0 or int(Decimal(str(evidence["spent_time"])) * 60) != target:
        return None
    raw = row.get("source_payload") or {}
    raw_text = evidence.get("_document_text")
    if raw_text is None:
        raw_text = document_text(evidence["file_blob"], allocate_plan.service)
    document_sections = parse_sections(raw_text)
    target_minutes = int(Decimal(str(evidence["spent_time"])))
    document_total = sum(int(section["minutes"]) for section in document_sections)
    sections = reconcile_sections(document_sections, target_minutes)
    estimated = False
    if not sections and fallback:
        sections = prefix_sections(document_sections, target_minutes)
        # A fallback is never authoritative, including when the document
        # contains no parseable sections and the full duration is placed on
        # the nearest valid weekdays.
        estimated = True
    elif not sections:
        return None
    # Even when an exact subset can be selected, omitting/reducing source
    # sections means the imported Aptem duration does not equal the document
    # total. Keep that distinction visible for approval.
    if document_total != target_minutes:
        estimated = True
    selected_minutes = sum(int(section["minutes"]) for section in sections)
    deferred_seconds = max(0, target - selected_minutes * 60)
    if selected_minutes * 60 > target:
        return None
    if deferred_seconds:
        estimated = True
    if not sections and not fallback:
        return None
    try:
        programme_start = owner["source_start"] or owner["start_date"]
        programme_end = owner["source_end"] or owner["end_date"]
        programme_start = programme_start if isinstance(programme_start, date) else date.fromisoformat(str(programme_start))
        programme_end = programme_end if isinstance(programme_end, date) else date.fromisoformat(str(programme_end))
    except (TypeError, ValueError):
        return None
    periods = break_periods(raw)
    allocations: list[dict[str, Any]] = []
    planned_daily = defaultdict(int, daily_load)
    planned_weekly = defaultdict(int, weekly_load)
    planned_end = dict(existing_end)
    def allocate_on_days(days: list[date], remaining: int) -> int:
        for day in days:
            if remaining <= 0:
                break
            week = week_key(day)
            capacity = DAILY_LIMIT_MINUTES * 60 - planned_daily[day]
            if capacity <= 0:
                continue
            seconds = min(remaining, capacity)
            seconds -= seconds % 60
            if seconds <= 0:
                continue
            start = planned_end.get(day)
            if start is None or start.astimezone(UK).date() != day:
                start = datetime.combine(day, time(9, 0), tzinfo=UK)
            else:
                start = max(start, datetime.combine(day, time(9, 0), tzinfo=UK))
            end = start + timedelta(seconds=seconds)
            if end.astimezone(UK).date() != day or end.astimezone(UK).time() > time(19, 0):
                continue
            allocations.append({"date": day, "seconds": seconds, "start": start, "end": end})
            planned_daily[day] += seconds
            planned_weekly[week] += seconds
            planned_end[day] = end
            remaining -= seconds
        return remaining

    for section in sections:
        days = weekdays(section["start"], section["end"], programme_start, programme_end, periods)
        if not days:
            if fallback:
                deferred_seconds += int(section["minutes"]) * 60
                estimated = True
                continue
            return None
        remaining = allocate_on_days(days, int(section["minutes"]) * 60)
        if remaining:
            if fallback:
                deferred_seconds += remaining
                estimated = True
            else:
                return None
    if deferred_seconds:
        source_at = row["reporting_started_at"] or row["reporting_ended_at"]
        anchor = source_at.astimezone(UK).date() if source_at else programme_start
        anchors = [anchor]
        for section in document_sections:
            anchors.extend([section["start"], section["end"]])
        days = nearest_weekdays(anchor, programme_start, programme_end, periods)
        days.sort(key=lambda day: (min(abs((day - item).days) for item in anchors), day))
        deferred_seconds = allocate_on_days(days, deferred_seconds)
        if deferred_seconds:
            return None
    if sum(item["seconds"] for item in allocations) != target:
        return None
    return {
        "progress_id": int(row["id"]),
        "learner_id": int(row["learner_id"]),
        "evidence_id": int(evidence["evidence_id"]),
        "source_date": (row["reporting_started_at"] or row["reporting_ended_at"]).isoformat(),
        "estimated": estimated,
        "allocation_method": "nearest_valid_weekday_index_fallback" if estimated else "documented_date_ranges_weekday_segments",
        "document_sections": [
            {"start": section["start"].isoformat(), "end": section["end"].isoformat(),
             "minutes": int(section["minutes"])} for section in document_sections
        ],
        "sections": [
            {"start": section["start"].isoformat(), "end": section["end"].isoformat(),
             "minutes": int(section["minutes"])} for section in sections
        ],
        "segments": [
            {"seconds": item["seconds"], "start": item["start"].isoformat(),
             "end": item["end"].isoformat(), "month": item["date"].strftime("%Y-%m")}
            for item in allocations
        ],
    }


def plan(cur, group: str, service: BlobServiceClient, limit: int | None,
         fallback: bool = False) -> dict[str, Any]:
    owners, by_id = profile_state(cur, group)
    learner_ids = [int(owner["id"]) for owner in owners]
    rows = current_rows(cur, learner_ids)
    evidence_ids = [evidence_id for evidence_id in (source_evidence_id(row) for row in rows) if evidence_id is not None]
    evidence = evidence_rows(cur, evidence_ids)
    existing_progress = {int(row["progress_id"]) for row in sum((row["segments"] for row in rows), [])}
    # Build the authoritative pre-repair load first.  Estimated allocations are
    # intentionally excluded: they remain visible in reports, but must not
    # block a dated repair or count toward the actual-hours rules.
    base_daily: dict[date, int] = defaultdict(int)
    base_weekly: dict[tuple[int, int], int] = defaultdict(int)
    for row in rows:
        if row_is_estimated(row):
            continue
        if row["segments"]:
            for segment in row["segments"]:
                at = segment["reporting_started_at"]
                if not at:
                    continue
                day = at.astimezone(UK).date()
                seconds = int(segment["actual_seconds"] or 0)
                base_daily[day] += seconds
                base_weekly[week_key(day)] += seconds
        else:
            at = row["reporting_started_at"] or row["reporting_ended_at"]
            if at:
                day = at.astimezone(UK).date()
                seconds = int(row["actual_seconds"] or 0)
                base_daily[day] += seconds
                base_weekly[week_key(day)] += seconds

    bad_days = {day for day, seconds in base_daily.items() if seconds > DAILY_LIMIT_MINUTES * 60}
    bad_weeks = {week for week, seconds in base_weekly.items() if seconds > WEEKLY_LIMIT_MINUTES * 60}
    candidate_rows: list[dict[str, Any]] = []
    for row in rows:
        row_id = int(row["id"])
        if row_id in existing_progress or row_is_estimated(row):
            continue
        if row["source_system"] != "aptem" or source_evidence_id(row) is None:
            continue
        parent_at = row["reporting_started_at"] or row["reporting_ended_at"]
        if not parent_at:
            continue
        day = parent_at.astimezone(UK).date()
        # Include every readable attachment participating in a real daily or
        # weekly violation, not only large single rows.  This catches several
        # smaller evidence items whose combined date-only total exceeded 8h.
        evidence_item = evidence.get(source_evidence_id(row) or -1)
        file_name = str((evidence_item or {}).get("file_blob") or "").lower()
        readable = file_name.endswith((".docx", ".pdf", ".xlsx", ".pptx", ".zip"))
        if readable and (day.weekday() >= 5 or day in bad_days or week_key(day) in bad_weeks):
            candidate_rows.append(row)

    # Large/date-only imports and weekend rows are still prioritised within a
    # bounded preview.  Non-selected rows are added back to the load below.
    candidate_rows.sort(key=lambda row: (-int(row["actual_seconds"] or 0), int(row["id"])))
    if limit:
        candidate_rows = candidate_rows[:limit]
    candidate_evidence = {
        int(source_evidence_id(row)): evidence[int(source_evidence_id(row))]
        for row in candidate_rows
        if source_evidence_id(row) in evidence
    }
    # Keep file-backed evidence in scope.  Each format is parsed only when its
    # own explicit dates and durations reconcile to the imported total;
    # malformed or aggregate files remain manual-review exceptions.
    candidate_rows = [
        row for row in candidate_rows
        if (item := candidate_evidence.get(int(source_evidence_id(row))))
        and str(item.get("file_blob") or "").lower().endswith((".docx", ".pdf", ".xlsx", ".pptx", ".zip"))
    ]
    selected_candidate_ids = {int(row["id"]) for row in candidate_rows}
    # Rebuild the load without selected parents, while keeping all excluded
    # rows and existing segments authoritative.  This prevents a proposed
    # segment from hiding an existing same-day violation.
    daily_load: dict[date, int] = defaultdict(int)
    weekly_load: dict[tuple[int, int], int] = defaultdict(int)
    existing_end: dict[date, datetime | None] = {}
    for row in rows:
        row_id = int(row["id"])
        if row_is_estimated(row) or row_id in selected_candidate_ids:
            continue
        if row["segments"]:
            for segment in row["segments"]:
                at = segment["reporting_started_at"]
                if not at:
                    continue
                day = at.astimezone(UK).date()
                seconds = int(segment["actual_seconds"] or 0)
                daily_load[day] += seconds
                weekly_load[week_key(day)] += seconds
                existing_end[day] = max(existing_end.get(day) or segment["reporting_ended_at"], segment["reporting_ended_at"])
        else:
            at = row["reporting_started_at"] or row["reporting_ended_at"]
            if not at:
                continue
            seconds = int(row["actual_seconds"] or 0)
            day = at.astimezone(UK).date()
            daily_load[day] += seconds
            weekly_load[week_key(day)] += seconds
            existing_end[day] = max(existing_end.get(day) or at, row["reporting_ended_at"] or at)
    candidate_evidence = {
        int(source_evidence_id(row)): candidate_evidence[int(source_evidence_id(row))]
        for row in candidate_rows
    }
    # Blob reads dominate this audit.  Download the bounded candidate set in
    # parallel, while parsing and database work remain deterministic below.
    def load_document(item: tuple[int, dict[str, Any]]) -> tuple[int, str | None, str | None]:
        evidence_id, evidence_row = item
        try:
            return evidence_id, document_text(evidence_row["file_blob"], service), None
        except Exception as exc:
            return evidence_id, None, type(exc).__name__

    with ThreadPoolExecutor(max_workers=8) as executor:
        futures = [executor.submit(load_document, item) for item in candidate_evidence.items()]
        for future in as_completed(futures):
            evidence_id, raw_text, error = future.result()
            if raw_text is not None:
                candidate_evidence[evidence_id]["_document_text"] = raw_text
            else:
                candidate_evidence[evidence_id]["_document_error"] = error
    plans: list[dict[str, Any]] = []
    skipped: list[dict[str, Any]] = []
    # Bind the service without expanding the helper signature in every call.
    allocate_plan.service = service
    for row in candidate_rows:
        evidence_id = source_evidence_id(row)
        item = evidence.get(evidence_id or -1)
        if item is None:
            skipped.append({"progress_id": int(row["id"]), "reason": "evidence_file_not_found"})
            continue
        if item.get("_document_error"):
            skipped.append({"progress_id": int(row["id"]), "evidence_id": evidence_id,
                            "reason": f"read_error:{item['_document_error']}"})
            continue
        try:
            proposal = allocate_plan(
                row, item, by_id[int(row["learner_id"])], daily_load, weekly_load,
                existing_end, fallback=fallback,
            )
        except Exception as exc:
            proposal = None
            skipped.append({"progress_id": int(row["id"]), "evidence_id": evidence_id, "reason": f"read_error:{type(exc).__name__}"})
        if proposal is None:
            skipped.append({"progress_id": int(row["id"]), "evidence_id": evidence_id, "reason": "no_exact_date_time_allocation"})
            continue
        plans.append(proposal)
        for item_plan in proposal["segments"]:
            day = datetime.fromisoformat(item_plan["start"]).astimezone(UK).date()
            seconds = int(item_plan["seconds"])
            daily_load[day] += seconds
            weekly_load[week_key(day)] += seconds
            existing_end[day] = datetime.fromisoformat(item_plan["end"])
    return {
        "group": group,
        "learner_count": len(owners),
        "candidate_progress_count": len(candidate_rows),
        "fallback": fallback,
        "plans": plans,
        "skipped": skipped,
    }


def apply(cur, report: dict[str, Any], expected_database: str, expected_fingerprint: str) -> int:
    database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
    if database != expected_database:
        raise ValueError("Database differs from reviewed preview.")
    reviewed_report = dict(report)
    reviewed_report.pop("fingerprint", None)
    fingerprint = digest(reviewed_report)
    if fingerprint != expected_fingerprint:
        raise ValueError("Data or preview changed; run the read-only preview again.")
    plans = report["plans"]
    if not plans:
        return 0
    run = cur.execute(
        '''INSERT INTO "Learner".activity_sync_runs
           (run_key,run_kind,status,dry_run,source_counts,result_counts)
           VALUES (%s,%s,'running',false,%s,%s) RETURNING id''',
        [
            "msp-evidence-timestamp-repair:" + expected_fingerprint,
            "msp-evidence-timestamp-repair",
            Jsonb({"group": report["group"], "candidate_progress_count": report["candidate_progress_count"],
                   "fallback": report.get("fallback", False)}),
            Jsonb({"planned_progress": len(plans), "planned_segments": sum(len(p["segments"]) for p in plans),
                   "estimated_progress": sum(bool(p.get("estimated")) for p in plans)}),
        ],
    ).fetchone()["id"]
    for item in plans:
        progress = cur.execute(
            '''SELECT id,learner_id,actual_seconds,source_payload
                 FROM "Learner".learner_progress_entries WHERE id=%s AND deleted_at IS NULL FOR UPDATE''',
            [item["progress_id"]],
        ).fetchone()
        if not progress or int(progress["learner_id"]) != item["learner_id"]:
            raise ValueError("Progress row changed or ownership no longer matches.")
        if cur.execute(
            'SELECT 1 FROM "Learner".learner_activity_reporting_segments WHERE progress_id=%s LIMIT 1',
            [item["progress_id"]],
        ).fetchone():
            raise ValueError("A planned progress row already has reporting segments.")
        if sum(int(segment["seconds"]) for segment in item["segments"]) != int(progress["actual_seconds"] or 0):
            raise ValueError("Segment total does not equal original actual seconds.")
        for order, segment in enumerate(item["segments"], start=1):
            cur.execute(
                '''INSERT INTO "Learner".learner_activity_reporting_segments
                   (progress_id,learner_id,segment_order,actual_seconds,
                    reporting_started_at,reporting_ended_at,reporting_month,sync_run_id)
                   VALUES (%s,%s,%s,%s,%s,%s,%s,%s)''',
                [item["progress_id"], item["learner_id"], order, segment["seconds"],
                 datetime.fromisoformat(segment["start"]), datetime.fromisoformat(segment["end"]),
                 segment["month"], run],
            )
        payload = dict(progress["source_payload"] or {})
        reconciliation = dict(payload.get("reconciliation") or {})
        reconciliation["reporting_allocation"] = {
            "method": item.get("allocation_method", "documented_date_ranges_weekday_segments"),
            "estimated": bool(item.get("estimated")),
            "approval_required": bool(item.get("estimated")),
            "source_evidence_id": item["evidence_id"],
            "original_reporting_date": item["source_date"],
            "index_rule": "source document order; nearest valid weekday fallback" if item.get("estimated") else None,
            "document_sections": item.get("document_sections", []),
            "sections": item["sections"],
            "segment_total_seconds": sum(int(segment["seconds"]) for segment in item["segments"]),
        }
        payload["reconciliation"] = reconciliation
        cur.execute(
            '''UPDATE "Learner".learner_progress_entries
                  SET source_payload=%s,ssot_updated_at=now() WHERE id=%s''',
            [Jsonb(payload), item["progress_id"]],
        )
    cur.execute(
        '''UPDATE "Learner".activity_sync_runs
              SET status='completed',finished_at=now(),updated_at=now(),result_counts=%s
            WHERE id=%s''',
        [Jsonb({"planned_progress": len(plans), "created_segments": sum(len(p["segments"]) for p in plans)}), run],
    )
    return int(run)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--group", default=GROUP)
    parser.add_argument("--limit", type=int)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--fallback", action="store_true",
                        help="allow clearly-labelled nearest-weekday/index estimates for unmatched evidence")
    parser.add_argument("--summary", action="store_true", help="print counts and fingerprint without the full plan payload")
    parser.add_argument("--expected-database")
    parser.add_argument("--expected-fingerprint")
    args = parser.parse_args()
    if args.apply and not (args.expected_database and args.expected_fingerprint):
        parser.error("--apply requires --expected-database and --expected-fingerprint")
    values = env_values()
    service = BlobServiceClient.from_connection_string(values["AZURE_STORAGE_CONNECTION_STRING"])
    with psycopg.connect(database_url(values), connect_timeout=20, row_factory=dict_row) as connection:
        connection.read_only = not args.apply
        with connection.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout=120000")
            report = plan(cur, args.group, service, args.limit, fallback=args.fallback)
            database = cur.execute("SELECT current_database() AS name").fetchone()["name"]
            report["database"] = database
            report["fingerprint"] = digest(report)
            if args.apply:
                run_id = apply(cur, report, args.expected_database, args.expected_fingerprint)
                print(json.dumps({"database": database, "run_id": run_id,
                                  "applied_progress": len(report["plans"]),
                                  "created_segments": sum(len(p["segments"]) for p in report["plans"])}, default=str))
            elif args.summary:
                reasons: dict[str, int] = defaultdict(int)
                for item in report["skipped"]:
                    reasons[str(item["reason"])] += 1
                print(json.dumps({
                    "database": database,
                    "group": report["group"],
                    "learner_count": report["learner_count"],
                    "candidate_progress_count": report["candidate_progress_count"],
                    "planned_progress_count": len(report["plans"]),
                    "planned_segment_count": sum(len(item["segments"]) for item in report["plans"]),
                    "estimated_progress_count": sum(bool(item.get("estimated")) for item in report["plans"]),
                    "fallback": report.get("fallback", False),
                    "planned_progress_ids": [item["progress_id"] for item in report["plans"]],
                    "planned_evidence_ids": [item["evidence_id"] for item in report["plans"]],
                    "skipped_count": len(report["skipped"]),
                    "skip_reasons": reasons,
                    "fingerprint": report["fingerprint"],
                }, default=str))
            else:
                print(json.dumps(report, default=str, ensure_ascii=False))


if __name__ == "__main__":
    main()
