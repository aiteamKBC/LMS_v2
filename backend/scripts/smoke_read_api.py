r"""Read-only smoke test for representative LMS API routes.

Run from backend with:
    .venv\Scripts\python.exe scripts\smoke_read_api.py
"""
from __future__ import annotations

import json
import os
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(BACKEND_DIR))
os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

import django

django.setup()

from django.test import Client


client = Client(SERVER_NAME="localhost")
results: list[tuple[int, str, str]] = []


def get(path: str) -> dict:
    try:
        response = client.get(path)
        body = response.content[:300].decode("utf-8", "replace").replace("\n", " ")
        results.append((response.status_code, path, body))
        if (
            response.status_code == 200
            and response.get("Content-Type", "").startswith("application/json")
        ):
            return json.loads(response.content)
    except Exception as exc:  # pragma: no cover - diagnostic script
        results.append((999, path, repr(exc)))
    return {}


programmes = get("/curriculum_api/curriculum/programmes/").get("results", [])
modules = get("/curriculum_api/curriculum/modules/").get("results", [])
cohorts = get("/curriculum_api/curriculum/cohorts/").get("results", [])
groups = get("/curriculum_api/curriculum/groups/").get("results", [])
sessions = get("/curriculum_api/curriculum/sessions/").get("results", [])
standards = get("/curriculum_api/curriculum/standards/").get("results", [])
weeks = get("/curriculum_api/curriculum/week-templates/").get("results", [])
components = get("/curriculum_api/curriculum/components/").get("results", [])
frameworks = get("/curriculum_api/curriculum/ksb-frameworks/").get("results", [])
staffing = get("/curriculum_api/curriculum/staffing/").get("results", [])
holidays = get("/curriculum_api/curriculum/holidays/").get("results", [])
tutors = get("/curriculum_api/curriculum/tutors/").get("results", [])
coaches = get("/curriculum_api/curriculum/coaches/").get("results", [])

if programmes:
    programme_id = programmes[0]["id"]
    for suffix in ("detail/", "ksb-coverage/", "learner-ksb-impact/", "cohorts/", ""):
        get(f"/curriculum_api/curriculum/programmes/{programme_id}/{suffix}")
    get(f"/curriculum_api/curriculum/free-programmes/{programme_id}/modules/")

if modules:
    module_id = modules[0].get("moduleCatalogueId") or modules[0]["id"]
    for suffix in ("structure/", "settings/", "ksb-coverage/", ""):
        get(f"/curriculum_api/curriculum/modules/{module_id}/{suffix}")

if cohorts:
    cohort_id = cohorts[0]["id"]
    for suffix in ("ksb-coverage/", "groups/", ""):
        get(f"/curriculum_api/curriculum/cohorts/{cohort_id}/{suffix}")

if groups:
    group_id = groups[0]["id"]
    get(f"/curriculum_api/curriculum/groups/{group_id}/")
    get(f"/curriculum_api/curriculum/groups/{group_id}/modules/")

detail_collections = (
    (sessions, "sessions"),
    (standards, "standards"),
    (weeks, "week-templates"),
    (frameworks, "ksb-frameworks"),
    (staffing, "staffing"),
    (holidays, "holidays"),
    (tutors, "tutors"),
    (coaches, "coaches"),
)
for rows, collection in detail_collections:
    if rows:
        get(f"/curriculum_api/curriculum/{collection}/{rows[0]['id']}/")

if weeks:
    get(f"/curriculum_api/curriculum/weeks/{weeks[0]['id']}/ksb-coverage/")
if components:
    component_id = components[0]["id"]
    get(f"/curriculum_api/curriculum/components/{component_id}/")
    get(f"/curriculum_api/curriculum/components/{component_id}/ksb-mappings/")

quizzes = get("/quiz_api/quizzes/").get("results", [])
if quizzes:
    quiz_id = quizzes[0]["id"]
    for suffix in ("", "course-links/", "download/", "preview/", "students/", "questions/"):
        get(f"/quiz_api/quizzes/{quiz_id}/{suffix}")

engagement_collections = (
    ("rewards", "rewards"),
    ("voucher-claims", "claims"),
    ("recognitions", "recognitions"),
    ("events", "events"),
    ("event-bookings", "bookings"),
    ("clubs", "clubs"),
    ("points-rules", "rules"),
    ("flash-cards/decks", "decks"),
)
engagement_rows: dict[str, list] = {}
for collection, key in engagement_collections:
    data = get(f"/engagement_api/{collection}/")
    rows = data.get(key, data.get("results", []))
    engagement_rows[collection] = rows
    if rows:
        get(f"/engagement_api/{collection}/{rows[0]['id']}/")

clubs = engagement_rows.get("clubs", [])
if clubs:
    club_id = clubs[0]["id"]
    meetings = get(f"/engagement_api/clubs/{club_id}/meetings/").get("meetings", [])
    if meetings:
        get(f"/engagement_api/clubs/{club_id}/meetings/{meetings[0]['id']}/")

decks = engagement_rows.get("flash-cards/decks", [])
if decks:
    get(f"/engagement_api/flash-cards/decks/{decks[0]['id']}/cards/")

for path in (
    "/coach_api/coach/caseload",
    "/coach_api/coach/attendance",
    "/coach_api/coach/absence-reports",
    "/coach_api/coach/evidence-awaiting-review",
    "/coach_api/coach/marking-queue",
    "/coach_api/coach/monthly-activity",
    "/coach_api/coach/timetable",
):
    get(path)

for learner_id in (1, 2, 4, 5, 20):
    get(f"/audit_api/learners/{learner_id}/")

failures = [
    result
    for result in results
    if result[0] == 400 or result[0] >= 500
]
non_success = [result for result in results if result[0] != 200]
print(
    f"TOTAL {len(results)} | OK {len(results) - len(failures)} | "
    f"EXPECTED 404/405 {len(non_success) - len(failures)} | "
    f"BAD 400/5XX {len(failures)}"
)
for status, path, body in failures:
    print(f"FAIL {status} {path} {body}")

raise SystemExit(1 if failures else 0)
