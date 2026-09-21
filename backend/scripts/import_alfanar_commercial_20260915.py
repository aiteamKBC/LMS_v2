"""Import the owner's reviewed 26 Al Fanar records, preserving Gary and Joshua.

Default: read-only preflight. --apply writes only missing enrolment/profile pairs.
No Django startup, schema changes, login accounts, invitations or placement writes.
The reviewed roster hash prevents this one-off command importing a changed list.
"""
from __future__ import annotations

import argparse
from collections import Counter
from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
os.environ["CURRICULUM_WARM"] = "0"

from config import settings as config
import psycopg
from psycopg.rows import dict_row

ROSTER = ROOT / "reports/alfanar-commercial-reconciliation-2026-09-15.json"
APPROVED_HASH = "b84ef1f90048d65851814493505ae7c6ba91cfe229fdbb3b9e05653392eeca90"


def norm(value):
    return (value or "").strip().lower()


def name_key(value):
    return re.sub(r"\s+", " ", norm(value))


def phone_key(value):
    return re.sub(r"\D", "", value or "")


def require(condition, message):
    if not condition:
        raise ValueError(message)


def load_roster():
    data = json.loads(ROSTER.read_text(encoding="utf-8"))
    require(data["pending_identity_question"]["resolution"]["decision"] ==
            "retain_both_email_records_separately", "Both Adam records must be approved")
    rows = sorted([
        {"name": x["full_name"].strip(), "email": x["normalized_email"],
         "phone": x["phone"].strip(), "organisation": x["organisation"],
         "aptem_id": str(x["source_ids"][0]) if x["source_ids"] else None,
         "action": x["proposed_action"],
         "existing_id": x["target_enrolment_ids"][0] if x["target_enrolment_ids"] else None,
         "existing_profile_id": x["target_profile_ids"][0] if x["target_profile_ids"] else None}
        for x in data["candidates"]
    ], key=lambda x: x["email"])
    digest = hashlib.sha256(json.dumps(rows, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
    require(digest == APPROVED_HASH, "Roster differs from the reviewed 28-record manifest")
    require(len(rows) == len({x["email"] for x in rows}) == 28, "Expected 28 distinct emails")
    require(Counter(x["action"] for x in rows) ==
            {"create_commercial_delivery": 26, "preserve_existing": 2}, "Unexpected action counts")
    for row in rows:
        require(row["name"] and re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]+", row["email"]),
                "Missing name or invalid email")
    return rows


@contextmanager
def connection(cfg, *, readonly):
    with psycopg.connect(
        host=cfg["HOST"], port=cfg.get("PORT") or 5432, dbname=cfg["NAME"],
        user=cfg["USER"], password=cfg["PASSWORD"],
        sslmode=cfg.get("OPTIONS", {}).get("sslmode", "require"),
        connect_timeout=10, row_factory=dict_row,
    ) as conn:
        conn.read_only = readonly
        with conn.cursor() as cur:
            cur.execute("SET LOCAL statement_timeout='30s'")
            cur.execute("SET LOCAL lock_timeout='10s'")
            cur.execute("SHOW transaction_read_only")
            require(cur.fetchone()["transaction_read_only"] == ("on" if readonly else "off"),
                    "Unexpected transaction mode")
        yield conn
        if readonly:
            conn.rollback()


def verify_source(rows):
    cfg = config.database_from_url(os.environ["APTEMAUTOEXTRACTINGDATABASE"])
    emails = [x["email"] for x in rows]
    ids = [int(x["aptem_id"]) for x in rows if x["aptem_id"]]
    with connection(cfg, readonly=True) as conn, conn.cursor() as cur:
        cur.execute('''SELECT "ID" AS aptem_id, "FullName" AS name, "Email" AS email
                       FROM public.aptem_auto_extracting
                       WHERE lower(btrim("Email"))=ANY(%s) OR "ID"=ANY(%s)
                       ORDER BY "ID"''', (emails, ids))
        source = cur.fetchall()
    for row in rows:
        matches = [s for s in source if norm(s["email"]) == row["email"] or
                   (row["aptem_id"] and str(s["aptem_id"]) == row["aptem_id"])]
        if row["aptem_id"]:
            require(len(matches) == 1 and norm(matches[0]["email"]) == row["email"] and
                    str(matches[0]["aptem_id"]) == row["aptem_id"],
                    f"Source identity changed: {row['email']}")
        else:
            require(not matches, f"New Aptem identity now exists; review before linking: {row['email']}")
    return source


def snapshot(cur, rows):
    emails = [x["email"] for x in rows]
    ids = [x["aptem_id"] for x in rows if x["aptem_id"]]
    names = [name_key(x["name"]) for x in rows]
    phones = [phone_key(x["phone"]) for x in rows]
    cur.execute(r'''SELECT to_jsonb(u) AS row FROM enrolment."Created_users" u
        WHERE lower(btrim("Email"))=ANY(%s) OR aptem_id=ANY(%s)
           OR lower(regexp_replace(btrim("Username"),'\s+',' ','g'))=ANY(%s)
           OR regexp_replace("Phone_number",'[^0-9]','','g')=ANY(%s) ORDER BY id''',
                (emails, ids, names, phones))
    enrolments = [x["row"] for x in cur.fetchall()]
    eids = [x["id"] for x in enrolments]
    cur.execute(r'''SELECT to_jsonb(l) AS row FROM "Learner".learners l
        WHERE lower(btrim(email))=ANY(%s) OR enrolment_id=ANY(%s)
           OR lower(regexp_replace(btrim(full_name),'\s+',' ','g'))=ANY(%s)
           OR regexp_replace(phone_number,'[^0-9]','','g')=ANY(%s) ORDER BY id''',
                (emails, eids, names, phones))
    profiles = [x["row"] for x in cur.fetchall()]
    cur.execute('''SELECT id,"Subject_type" AS subject_type,"Subject_id" AS subject_id,
                         "Email" AS email,"Role" AS role
        FROM login."Login_accounts"
        WHERE lower(btrim("Email"))=ANY(%s)
           OR ("Subject_type"='learner' AND "Subject_id"=ANY(%s)) ORDER BY id''', (emails, eids))
    accounts = cur.fetchall()
    cur.execute('''SELECT count(*) AS count FROM login."Invitations"
                   WHERE lower(btrim("Email"))=ANY(%s)''', (emails,))
    invitations = cur.fetchone()["count"]
    cur.execute('''SELECT (SELECT count(*) FROM enrolment."Created_users") AS enrolments,
                         (SELECT count(*) FROM "Learner".learners) AS profiles''')
    totals = cur.fetchone()
    return {"enrolments": enrolments, "profiles": profiles, "accounts": accounts,
            "invitation_count": invitations, "table_counts": totals}


def validate(snap, rows, *, final=False):
    require(not snap["accounts"] and snap["invitation_count"] == 0,
            "Unexpected account/invitation exists; do not overwrite or reset it")
    wanted = {x["email"] for x in rows}
    require(all(norm(e["Email"]) in wanted for e in snap["enrolments"]),
            "Another enrolment matches a source ID, name or phone; identity review required")
    require(all(norm(p["email"]) in wanted for p in snap["profiles"]),
            "Another learner profile matches a name or phone; identity review required")
    missing = []
    for row in rows:
        matches = [e for e in snap["enrolments"] if norm(e["Email"]) == row["email"] or
                   (row["aptem_id"] and str(e.get("aptem_id")) == row["aptem_id"])]
        require(len(matches) <= 1, f"Duplicate enrolment identity: {row['email']}")
        if not matches:
            require(not final and row["action"] == "create_commercial_delivery",
                    f"Expected existing enrolment missing: {row['email']}")
            require(not any(norm(p["email"]) == row["email"] for p in snap["profiles"]),
                    f"Unlinked profile exists: {row['email']}")
            missing.append(row)
            continue
        e = matches[0]
        require(norm(e["Email"]) == row["email"] and
                name_key(e["Username"]) == name_key(row["name"]),
                f"Enrolment name/email disagreement: {row['email']}")
        require((e.get("aptem_id") or None) == row["aptem_id"],
                f"Aptem identity disagreement: {row['email']}")
        profiles = [p for p in snap["profiles"] if norm(p["email"]) == row["email"] or
                    p.get("enrolment_id") == e["id"] or p.get("uuid") == e["uuid"]]
        require(len(profiles) == 1, f"Expected one linked profile: {row['email']}")
        p = profiles[0]
        require(p["enrolment_id"] == e["id"] and p["uuid"] == e["uuid"] and
                norm(p["email"]) == row["email"] and name_key(p["full_name"]) == name_key(row["name"]),
                f"Profile linkage/name/email disagreement: {row['email']}")
        require(e["Learner_type"] == p["learner_type"] == "commercial" and
                e["Programme_status"] == p["programme_status"] == "Delivery" and
                p["lifecycle_status"] == "delivery", f"Unexpected status/type: {row['email']}")
        if row["action"] == "preserve_existing":
            require(e["id"] == row["existing_id"] and p["id"] == row["existing_profile_id"],
                    f"Existing local IDs changed: {row['email']}")
        else:
            require(e["Invite_to_platform"] is False and e[" Status"] == "FullUser" and
                    e["Type"] == "User", f"Unexpected new record flags: {row['email']}")
            require(e["Phone_number"] == p["phone_number"] == row["phone"] and
                    e["Orgnization"] == row["organisation"] and e["Employer"] == row["organisation"],
                    f"Imported contact data mismatch: {row['email']}")
            require(all(not e.get(k) for k in ("Programme", "Cohort", "Group", "Start_date", "End_date",
                        "Learning_plan", "Training_plan", "Coach_name", "Coach_email")),
                    f"Unexpected enrolment placement/plan: {row['email']}")
            require(all(not p.get(k) for k in ("programme", "programme_id", "cohort", "cohort_id",
                        "group_name", "group_id", "start_date", "end_date", "coach_name", "coach_email")),
                    f"Unexpected profile placement: {row['email']}")
    return missing


INSERT_PAIR = '''
WITH e AS (
    INSERT INTO enrolment."Created_users"
        ("Learner_type","Invite_to_platform","Username","Email","Phone_number",
         " Status","Type","Programme_status","Orgnization","Employer",aptem_id,
         "Enrolled_time_and_user")
    VALUES ('commercial',false,%s,%s,%s,'FullUser','User','Delivery',%s,%s,%s,%s)
    RETURNING id,uuid,"Username","Email","Phone_number"
), p AS (
    INSERT INTO "Learner".learners
        (full_name,email,phone_number,lifecycle_status,programme_status,learner_type,uuid,enrolment_id)
    SELECT "Username","Email","Phone_number",'delivery','Delivery','commercial',uuid,id FROM e
    RETURNING id,enrolment_id,uuid
)
SELECT e.id AS enrolment_id,p.id AS profile_id,e.uuid,e."Email" AS email
FROM e JOIN p ON p.enrolment_id=e.id AND p.uuid=e.uuid
'''


def save(path, value):
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, default=str) + "\n", encoding="utf-8")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Apply the reviewed roster in one transaction")
    args = parser.parse_args()
    rows = load_roster()
    source = verify_source(rows)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    base = ROOT / "reports" / f"alfanar-commercial-import-{stamp}"
    before_path = Path(str(base) + "-before.json")
    result_path = Path(str(base) + "-result.json")
    with connection(config.DATABASES["enrolment"], readonly=not args.apply) as conn:
        with conn.cursor() as cur:
            if args.apply:
                cur.execute('''LOCK TABLE enrolment."Created_users", "Learner".learners
                               IN SHARE ROW EXCLUSIVE MODE''')
                cur.execute('''LOCK TABLE login."Login_accounts", login."Invitations" IN SHARE MODE''')
            before = snapshot(cur, rows)
            missing = validate(before, rows)
            save(before_path, {"mode": "apply_preflight" if args.apply else "read_only_preflight",
                               "roster_hash": APPROVED_HASH, "rows": rows, "source_identity_check": source,
                               "snapshot": before, "missing_count": len(missing)})
            if not args.apply:
                print(json.dumps({"mode": "read_only_preflight", "verified_records": len(rows),
                                  "missing_enrolment_profile_pairs": len(missing),
                                  "existing_pairs": len(rows) - len(missing), "accounts": 0,
                                  "invitations": 0, "report": str(before_path)}))
                return
            inserted = []
            for row in missing:
                cur.execute(INSERT_PAIR, (row["name"], row["email"], row["phone"],
                            row["organisation"], row["organisation"], row["aptem_id"],
                            f"Owner-authorized Al Fanar commercial import {stamp}"))
                pair = cur.fetchone()
                require(pair is not None, "Insert did not return one linked pair")
                inserted.append(pair)
            after = snapshot(cur, rows)
            validate(after, rows, final=True)
            require(len(after["enrolments"]) == len(after["profiles"]) == 28, "Expected 28 linked pairs")
            for table in ("enrolments", "profiles"):
                require(after["table_counts"][table] - before["table_counts"][table] == len(inserted),
                        f"Unexpected total change in {table}")
                actual = {x["id"]: x for x in after[table]}
                require(all(actual.get(x["id"]) == x for x in before[table]),
                        f"A pre-existing {table} record changed")
            save(result_path, {"state": "validated_before_commit", "roster_hash": APPROVED_HASH,
                               "before_report": str(before_path), "inserted": inserted, "snapshot": after})
        conn.commit()
    # Confirm persistence using a fresh read-only transaction.
    with connection(config.DATABASES["enrolment"], readonly=True) as conn, conn.cursor() as cur:
        verified = snapshot(cur, rows)
        validate(verified, rows, final=True)
        for table in ("enrolments", "profiles"):
            actual = {x["id"]: x for x in verified[table]}
            require(all(actual.get(x["id"]) == x for x in before[table]),
                    f"Pre-existing {table} changed during persistence verification")
    result = {"state": "committed_and_verified", "verified_at_utc": datetime.now(timezone.utc).isoformat(),
              "roster_hash": APPROVED_HASH, "before_report": str(before_path), "inserted": inserted,
              "inserted_enrolments": len(inserted), "inserted_profiles": len(inserted),
              "verified_total_records": 28, "existing_records_preserved": 2,
              "login_accounts_created": 0, "invitations_sent": 0,
              "placement": "New records unassigned; existing Gary/Joshua placement preserved",
              "verified_snapshot": verified}
    save(result_path, result)
    print(json.dumps({k: v for k, v in result.items() if k not in ("verified_snapshot", "inserted")}))
    print(json.dumps({"result_report": str(result_path), "inserted": inserted}, default=str))


if __name__ == "__main__":
    main()
