"""Read-only preview of ten enrolment learners starting at Anna Rundell.

Run from backend: .venv/Scripts/python scripts/inspect_student_activity_pilot.py
No Django startup hooks, migrations or database writes are invoked.
"""

import json
import os
import sys
from pathlib import Path

import psycopg
from psycopg.rows import dict_row

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from config.settings import DATABASES  # noqa: E402

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")
from learner_api.student_activity_data import read_student_activity  # noqa: E402


def connect(alias):
    settings = DATABASES.get(alias, DATABASES["default"])
    connection = psycopg.connect(
        host=settings["HOST"], port=settings["PORT"], dbname=settings["NAME"],
        user=settings["USER"], password=settings["PASSWORD"],
        sslmode=settings.get("OPTIONS", {}).get("sslmode", "require"),
        connect_timeout=10, row_factory=dict_row,
    )
    connection.read_only = True
    return connection


def main():
    with connect("enrolment") as connection:
        with connection.cursor() as cursor:
            cursor.execute('''
                SELECT id, "Username" AS name, aptem_id, "Learner_type" AS kind
                FROM enrolment."Created_users"
                WHERE lower(trim("Username")) = 'anna rundell'
                ORDER BY id
            ''')
            anchors = cursor.fetchall()
            if len(anchors) != 1:
                raise RuntimeError(f"Expected one Anna Rundell record, found {len(anchors)}")
            cursor.execute('''
                SELECT id, "Username" AS name, aptem_id, "Learner_type" AS kind
                FROM enrolment."Created_users"
                WHERE id >= %s ORDER BY id LIMIT 10
            ''', [anchors[0]["id"]])
            learners = cursor.fetchall()
    print(json.dumps({"selection": "Created_users.id ascending, starting at Anna Rundell", "learners": learners}, default=str, indent=2), flush=True)
    with connect("audit") as connection:
        with connection.cursor(row_factory=psycopg.rows.tuple_row) as cursor:
            for learner in learners:
                payload = read_student_activity(cursor, int(learner["aptem_id"]))
                if payload is None:
                    raise RuntimeError(f"Missing audit match for learner {learner['id']}")
                assert len({row["activity_id"] for row in payload["activities"]}) == payload["count"], "Duplicate activity placements"
                print(json.dumps({"preview": {"enrolment_id": learner["id"], **{key: value for key, value in payload.items() if key != "activities"}}}, default=str), flush=True)


if __name__ == "__main__":
    main()
