import json
import re
import unicodedata
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed
from copy import deepcopy
from datetime import date
from time import sleep
from urllib.request import urlopen
from urllib.parse import urlencode

from django.core.management.base import BaseCommand
from django.db import connections, transaction


CONN = "enrolment"
API_URL = "https://kentbusinesscollege.org/wp-json/custom/v1/courses-progress"
WORD_RE = re.compile(r"[a-z0-9]+")
DATE_RE = re.compile(
    r"\b(?:(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})|(\d{4})[/-](\d{1,2})[/-](\d{1,2}))\b"
)
WEAK_PROGRAMME_WORDS = {
    "level",
    "l",
    "apprenticeship",
    "apprenticeships",
    "levy",
    "funded",
    "new",
}


def clean_text(value):
    if value is None:
        return ""
    text = str(value).replace("\ufeff", "").replace("ï»¿", "")
    text = unicodedata.normalize("NFKD", text)
    text = "".join(ch for ch in text if not unicodedata.combining(ch))
    text = text.replace("&", " and ")
    text = re.sub(r"[^a-zA-Z0-9]+", " ", text).lower()
    return re.sub(r"\s+", " ", text).strip()


def words(value):
    return WORD_RE.findall(clean_text(value))


def programme_words(value):
    return [word for word in words(value) if word not in WEAK_PROGRAMME_WORDS and not word.isdigit()]


def programme_match_score(programme, record):
    required = set(programme_words(programme))
    if not required:
        return 0
    haystack = clean_text(f"{record.get('course') or ''} {record.get('course_category') or ''}")
    hay_words = set(words(haystack))

    if required.issubset(hay_words):
        return 100

    # Singular/plural drift: "control" vs "controls".
    singular_required = {word[:-1] if word.endswith("s") else word for word in required}
    singular_hay = {word[:-1] if word.endswith("s") else word for word in hay_words}
    if singular_required.issubset(singular_hay):
        return 95

    overlap = singular_required & singular_hay
    if len(overlap) >= max(2, len(singular_required) - 1):
        return 85
    return 0


def filter_records_for_programme(programme_structure, records):
    programme = programme_structure.get("programme") if isinstance(programme_structure, dict) else ""
    scored = [(programme_match_score(programme, record), record) for record in records]
    strong = [record for score, record in scored if score >= 95]
    if strong:
        return strong
    return [record for score, record in scored if score >= 85]


def parse_embedded_dates(value):
    parsed = []
    for match in DATE_RE.finditer(str(value or "")):
        if match.group(1):
            day = int(match.group(1))
            month = int(match.group(2))
            year = int(match.group(3))
            if year < 100:
                year += 2000
        else:
            year = int(match.group(4))
            month = int(match.group(5))
            day = int(match.group(6))
        try:
            parsed.append(date(year, month, day))
        except ValueError:
            continue
    return parsed


def month_key(value):
    if not value:
        return None
    try:
        return str(value)[:7]
    except (TypeError, ValueError):
        return None


def word_phrase_in(needle, haystack):
    left = words(needle)
    right = words(haystack)
    if not left or not right or len(left) > len(right):
        return False
    for index in range(len(right) - len(left) + 1):
        if right[index : index + len(left)] == left:
            return True
    return False


def parse_api_payload(payload):
    if isinstance(payload, dict) and isinstance(payload.get("value"), list):
        return payload["value"]
    if isinstance(payload, list):
        return payload
    return []


def component_sort_key(item):
    return (
        item.get("section_order") if item.get("section_order") is not None else 999999,
        item.get("component_order") if item.get("component_order") is not None else 999999,
        item.get("component_id") or item.get("quiz_id") or 0,
    )


def component_payload(item):
    kind = item.get("component_kind") or ("quiz" if item.get("quiz_id") else "lesson")
    payload = {
        "componentId": item.get("component_id") or item.get("quiz_id"),
        "title": item.get("title") or "",
        "kind": kind,
        "postType": item.get("post_type") or "",
        "order": item.get("component_order"),
        "completed": bool(item.get("completed") or item.get("passed")),
    }
    material_type = item.get("material_type")
    if material_type:
        payload["materialType"] = material_type
    if kind == "quiz":
        payload["attempted"] = bool(item.get("attempted"))
        payload["passed"] = bool(item.get("passed"))
        payload["bestScorePercent"] = item.get("best_score_percent")
    return {key: value for key, value in payload.items() if value not in (None, "")}


def weeks_from_lms_course(record):
    grouped = {}
    for source_key in ("materials", "quizzes"):
        for item in record.get(source_key) or []:
            section_title = item.get("section_title") or ""
            if not clean_text(section_title):
                continue
            section_id = item.get("section_id") or f"title:{clean_text(section_title)}"
            current = grouped.setdefault(
                section_id,
                {
                    "sectionId": item.get("section_id"),
                    "week": section_title,
                    "sectionOrder": item.get("section_order"),
                    "_items": [],
                },
            )
            current["_items"].append(item)

    weeks = []
    for section in grouped.values():
        seen_components = set()
        components = []
        for item in sorted(section["_items"], key=component_sort_key):
            component_id = item.get("component_id") or item.get("quiz_id")
            dedupe_key = (
                item.get("component_kind") or item.get("post_type") or "component",
                component_id,
                clean_text(item.get("title")),
            )
            if dedupe_key in seen_components:
                continue
            seen_components.add(dedupe_key)
            components.append(component_payload(item))
        weeks.append(
            {
                "week": section["week"],
                "sectionId": section["sectionId"],
                "sectionOrder": section["sectionOrder"],
                "courseId": record.get("course_id"),
                "course": record.get("course") or "",
                "components": components,
            }
        )
    return sorted(weeks, key=lambda week: (week.get("sectionOrder") or 999999, week.get("sectionId") or 0, week["week"]))


def month_module_norms(month):
    modules = month.get("modules")
    if not isinstance(modules, list):
        return []
    return [(module, clean_text(module)) for module in modules if clean_text(module)]


def score_week_for_month(week, month):
    expected_month = month_key(month.get("date"))
    if expected_month:
        for parsed in parse_embedded_dates(week.get("week")):
            if parsed.strftime("%Y-%m") == expected_month:
                return 120, f"explicit date in LMS section title: {parsed.isoformat()}"

    module_norms = month_module_norms(month)
    if not module_norms:
        return 0, ""

    week_norm = clean_text(week.get("week"))
    for original, module_norm in module_norms:
        if week_norm and week_norm == module_norm:
            return 100, f"section title exact: {original}"

    for original, module_norm in module_norms:
        if week_norm and len(words(week_norm)) >= 2 and word_phrase_in(week_norm, module_norm):
            return 90, f"section title inside month item: {original}"
        if module_norm and len(words(module_norm)) >= 3 and word_phrase_in(module_norm, week_norm):
            return 88, f"month item inside section title: {original}"

    component_titles = [component.get("title") or "" for component in week.get("components") or []]
    component_norms = [(title, clean_text(title)) for title in component_titles if clean_text(title)]
    for original, module_norm in module_norms:
        for title, component_norm in component_norms:
            if component_norm == module_norm:
                return 84, f"component title exact: {original}"
            if len(words(module_norm)) >= 3 and word_phrase_in(module_norm, component_norm):
                return 80, f"month item inside component title: {original}"
            if len(words(component_norm)) >= 3 and word_phrase_in(component_norm, module_norm):
                return 78, f"component title inside month item: {title}"

    return 0, ""


def assign_weeks_to_months(programme_structure, lms_records, min_score):
    output = {
        "programme": programme_structure.get("programme") or "",
        "months": [],
    }
    months = programme_structure.get("months") if isinstance(programme_structure.get("months"), list) else []
    month_weeks = [[] for _ in months]
    report = {
        "matchedWeeks": 0,
        "unmatchedWeeks": 0,
        "ambiguousWeeks": 0,
        "matchedCourses": set(),
    }

    programme_records = filter_records_for_programme(programme_structure, lms_records)
    report["candidateCourses"] = sorted({record.get("course_id") for record in programme_records if record.get("course_id")})

    weeks = []
    for record in programme_records:
        for week in weeks_from_lms_course(record):
            weeks.append(week)

    for week in weeks:
        scores = []
        for index, month in enumerate(months):
            score, reason = score_week_for_month(week, month)
            if score:
                scores.append((score, index, reason))
        scores.sort(reverse=True)
        if not scores or scores[0][0] < min_score:
            report["unmatchedWeeks"] += 1
            continue
        if len(scores) > 1 and scores[0][0] == scores[1][0]:
            report["ambiguousWeeks"] += 1
            continue
        best_score, month_index, reason = scores[0]
        week_payload = deepcopy(week)
        week_payload["matchScore"] = best_score
        week_payload["matchedBy"] = reason
        month_weeks[month_index].append(week_payload)
        report["matchedWeeks"] += 1
        if week.get("courseId"):
            report["matchedCourses"].add(week["courseId"])

    for index, month in enumerate(months):
        output["months"].append(
            {
                "month": month.get("month") or "",
                "date": month.get("date"),
                "weeks": sorted(
                    month_weeks[index],
                    key=lambda week: (week.get("sectionOrder") or 999999, week.get("sectionId") or 0, week.get("week") or ""),
                ),
            }
        )

    report["matchedCourses"] = sorted(report["matchedCourses"])
    report["monthsWithWeeks"] = sum(1 for item in month_weeks if item)
    return output, report


def empty_weeks_structure(programme_structure):
    months = programme_structure.get("months") if isinstance(programme_structure.get("months"), list) else []
    return {
        "programme": programme_structure.get("programme") or "",
        "months": [
            {
                "month": month.get("month") or "",
                "date": month.get("date"),
                "weeks": [],
            }
            for month in months
        ],
    }


class Command(BaseCommand):
    help = "Inject LMS API weeks/components into Audit.learner_match.programme_structure."

    def add_arguments(self, parser):
        parser.add_argument("--url", default=API_URL, help="LMS courses-progress API URL.")
        parser.add_argument("--commit", action="store_true", help="Write changes. Default is dry-run.")
        parser.add_argument("--limit", type=int, default=0, help="Limit learner_match rows processed.")
        parser.add_argument("--offset", type=int, default=0, help="Skip this many learner_match rows.")
        parser.add_argument("--aptem-id", type=int, default=None, help="Process one aptem_id.")
        parser.add_argument("--lms-id", type=int, default=None, help="Process one lms_id.")
        parser.add_argument("--min-score", type=int, default=80, help="Minimum confidence score for month matching.")
        parser.add_argument("--retries", type=int, default=2, help="Retries per LMS user request.")
        parser.add_argument("--workers", type=int, default=8, help="Parallel LMS user requests.")
        parser.add_argument("--paged-api", action="store_true", help="Fetch LMS API by pages before falling back to per-user misses.")
        parser.add_argument("--per-page", type=int, default=500, help="LMS page size when --paged-api is used.")
        parser.add_argument("--max-pages", type=int, default=20, help="Maximum LMS pages to fetch with --paged-api.")

    def fetch_json(self, url):
        with urlopen(url, timeout=120) as response:
            payload = json.loads(response.read().decode("utf-8-sig"))
        return parse_api_payload(payload)

    def fetch_lms_records_for_user(self, url, user_id, retries):
        separator = "&" if "?" in url else "?"
        request_url = f"{url}{separator}{urlencode({'user_id': int(user_id)})}"
        last_error = None
        for attempt in range(retries + 1):
            try:
                return self.fetch_json(request_url)
            except Exception as exc:  # noqa: BLE001 - report and keep the batch moving
                last_error = exc
                if attempt < retries:
                    sleep(1 + attempt)
        raise last_error

    def fetch_lms_records(self, url, user_ids, retries, workers):
        by_user = defaultdict(list)
        failed = {}
        unique_user_ids = sorted({int(item) for item in user_ids if item is not None})

        def load_user(user_id):
            return user_id, self.fetch_lms_records_for_user(url, user_id, retries)

        with ThreadPoolExecutor(max_workers=max(1, workers)) as executor:
            futures = {executor.submit(load_user, user_id): user_id for user_id in unique_user_ids}
            for future in as_completed(futures):
                user_id = futures[future]
                try:
                    loaded_user_id, records = future.result()
                except Exception as exc:  # noqa: BLE001 - keep report deterministic
                    failed[user_id] = str(exc)
                    continue
                for record in records:
                    record_user_id = record.get("user_id")
                    if record_user_id is not None and int(record_user_id) == loaded_user_id:
                        by_user[loaded_user_id].append(record)
        return by_user, failed

    def fetch_lms_records_by_pages(self, url, user_ids, per_page, max_pages):
        wanted = {int(item) for item in user_ids if item is not None}
        by_user = defaultdict(list)
        seen_page_signatures = set()
        for page in range(1, max_pages + 1):
            separator = "&" if "?" in url else "?"
            request_url = f"{url}{separator}{urlencode({'per_page': per_page, 'page': page})}"
            records = self.fetch_json(request_url)
            if not records:
                break
            signature = tuple((record.get("user_id"), record.get("course_id")) for record in records[:20])
            if signature in seen_page_signatures:
                break
            seen_page_signatures.add(signature)
            for record in records:
                record_user_id = record.get("user_id")
                if record_user_id is not None and int(record_user_id) in wanted:
                    by_user[int(record_user_id)].append(record)
            if wanted and wanted.issubset(set(by_user)):
                break
        return by_user

    def fetch_learner_rows(self, cur, options):
        where = ["programme_structure is not null"]
        params = []
        if options["aptem_id"] is not None:
            where.append("aptem_id = %s")
            params.append(options["aptem_id"])
        if options["lms_id"] is not None:
            where.append("lms_id = %s")
            params.append(options["lms_id"])
        sql = (
            'select aptem_id, learner_name, learner_email, lms_id, programme_structure '
            'from "Audit".learner_match where '
            + " and ".join(where)
            + " order by aptem_id"
        )
        if options["limit"]:
            sql += " limit %s"
            params.append(options["limit"])
        if options["offset"]:
            if not options["limit"]:
                sql += " limit all"
            sql += " offset %s"
            params.append(options["offset"])
        cur.execute(sql, params)
        return cur.fetchall()

    def lms_records_for_row(self, row, by_user):
        _aptem_id, _name, _email, lms_id, _structure = row
        if lms_id is not None:
            return by_user.get(int(lms_id), [])
        return []

    def handle(self, *args, **options):
        commit = options["commit"]
        conn = connections[CONN]
        summary = {
            "processed": 0,
            "updated": 0,
            "no_lms_match": 0,
            "no_week_match": 0,
            "unmatched_weeks": 0,
            "ambiguous_weeks": 0,
            "api_failures": 0,
            "empty_shape_updates": 0,
        }

        with transaction.atomic(using=CONN):
            cur = conn.cursor()
            rows = self.fetch_learner_rows(cur, options)
            if options["paged_api"]:
                by_user = self.fetch_lms_records_by_pages(
                    options["url"],
                    [row[3] for row in rows],
                    options["per_page"],
                    options["max_pages"],
                )
                missing_ids = [
                    row[3] for row in rows
                    if row[3] is not None and int(row[3]) not in by_user
                ]
            else:
                by_user = defaultdict(list)
                missing_ids = [row[3] for row in rows if row[3] is not None]

            per_user, failed_users = self.fetch_lms_records(
                options["url"],
                missing_ids,
                options["retries"],
                options["workers"],
            )
            for user_id, records in per_user.items():
                by_user[user_id].extend(records)
            summary["api_failures"] = len(failed_users)
            for row in rows:
                aptem_id, learner_name, email, lms_id, programme_structure = row
                summary["processed"] += 1
                if isinstance(programme_structure, str):
                    programme_structure = json.loads(programme_structure)
                if not isinstance(programme_structure, dict):
                    continue

                records = self.lms_records_for_row(row, by_user)
                if not records:
                    summary["no_lms_match"] += 1
                    new_structure = empty_weeks_structure(programme_structure)
                    summary["empty_shape_updates"] += 1
                    if commit:
                        cur.execute(
                            'update "Audit".learner_match set programme_structure = %s::json where aptem_id = %s',
                            [json.dumps(new_structure, ensure_ascii=False), aptem_id],
                        )
                    if lms_id in failed_users:
                        self.stdout.write(
                            f'aptem_id={aptem_id} lms_id={lms_id} learner="{learner_name}" '
                            f'api_error="{failed_users[lms_id]}"'
                        )
                    continue

                new_structure, report = assign_weeks_to_months(programme_structure, records, options["min_score"])
                summary["unmatched_weeks"] += report["unmatchedWeeks"]
                summary["ambiguous_weeks"] += report["ambiguousWeeks"]
                if report["matchedWeeks"] == 0:
                    summary["no_week_match"] += 1
                    summary["empty_shape_updates"] += 1
                    if commit:
                        cur.execute(
                            'update "Audit".learner_match set programme_structure = %s::json where aptem_id = %s',
                            [json.dumps(new_structure, ensure_ascii=False), aptem_id],
                        )
                    continue

                summary["updated"] += 1
                self.stdout.write(
                    f'aptem_id={aptem_id} lms_id={lms_id} matched_by=lms_id '
                    f'learner="{learner_name}" months={report["monthsWithWeeks"]} '
                    f'weeks={report["matchedWeeks"]} unmatched={report["unmatchedWeeks"]} '
                    f'ambiguous={report["ambiguousWeeks"]} courses={report["matchedCourses"]}'
                )

                if commit:
                    cur.execute(
                        'update "Audit".learner_match set programme_structure = %s::json where aptem_id = %s',
                        [json.dumps(new_structure, ensure_ascii=False), aptem_id],
                    )

            if not commit:
                transaction.set_rollback(True, using=CONN)

        mode = "COMMITTED" if commit else "DRY RUN - no changes written"
        self.stdout.write(self.style.SUCCESS(f"\n{mode}: {summary}"))
