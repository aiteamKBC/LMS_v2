"""SELECT-only verification of the completed Development Diploma cleanup.

Run from backend: .venv/Scripts/python.exe -B scripts/verify_inclusiveness_free_course_hours.py
The optional before phase remains for auditing the original snapshot only.
Never executes cleanup SQL.
"""
import argparse
import hashlib
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from scripts.verify_inclusion_canonical_targets import connect_development
from learner_api.free_course_hours import HOURS_SQL, INCLUSION_COURSES, activity_seconds

COMPLETION_FINGERPRINT = '0ef94099db08b7249452916bd2b306c1a8e6c51a3d2de20bfd95ce3edeb9a9b6'
ENROLLMENT_FINGERPRINT = 'dd1acc3ce54c9bc7960d1c499ddf741cbb695246ca658c07c5cdec1512e48c35'


def fingerprint(values):
    return hashlib.sha256(json.dumps(values, default=str, separators=(',', ':')).encode()).hexdigest()


def verify(connection, phase):
    courses = sorted(INCLUSION_COURSES)
    rows = connection.execute('''SELECT m.learner_id,count(*),count(DISTINCT m.free_component_id),
        count(*) FILTER(WHERE p.accepted),coalesce(sum(p.actual_seconds) FILTER(WHERE p.accepted),0),
        count(*) FILTER(WHERE p.id IS NOT NULL AND to_jsonb(p)=m.original_progress
            AND p.accepted IS NOT DISTINCT FROM m.accepted AND p.actual_seconds IS NOT DISTINCT FROM m.actual_seconds)
        FROM "Learner".free_course_hours_migration m
        LEFT JOIN "Learner".learner_progress_entries p ON p.id=m.old_progress_id AND p.learner_id=m.learner_id
        GROUP BY m.learner_id ORDER BY m.learner_id''').fetchall()
    assert rows == [(272,244,244,244,137310,244),(1000,244,244,0,0,244)], 'Ledger/mapping baseline differs'
    valid_links = connection.execute('''SELECT count(*) FROM "Learner".free_course_hours_migration m
        JOIN curriculum.free_programme_components a ON a.id=m.free_component_id AND a.deleted_at IS NULL
        JOIN curriculum.free_course_weeks w ON w.id=a.free_module_id AND w.course_id=m.free_course_id
        WHERE w.deleted_at IS NULL AND w.status='active' ''').fetchone()[0]
    assert valid_links == 488, 'Canonical component ownership differs'
    attribution = activity_seconds(connection.execute(HOURS_SQL, [272, courses]).fetchall())
    assert len(attribution) == 244 and sum(attribution.values()) == 137310, 'Canonical accepted hours differ'
    assert connection.execute(HOURS_SQL, [1000, courses]).fetchall() == [], 'Unexpected awarded hours'
    enrollments = connection.execute('''SELECT id,learner_id,position,free_course_ref
        FROM "Learner".learner_free_courses WHERE free_course_ref=ANY(%s) AND learner_id IN (272,1000)
        ORDER BY id''', [courses]).fetchall()
    assert enrollments == [(218+i,272,15+i,course) for i,course in enumerate(courses)], 'Enrollments changed'
    progress = connection.execute('''SELECT p.id,p.learner_id,p.free_course_ref,p.component_ref,p.is_completed,
        p.completed_at,p.activity_state,p.status,p.deleted_at FROM "Learner".learner_free_course_progress p
        WHERE p.learner_id IN (272,1000) AND p.free_course_ref=ANY(%s) ORDER BY p.id''', [courses]).fetchall()
    assert len(progress)==244 and all(p[1]==272 and p[4] and p[6]=='completed' and p[7]=='active' and p[8] is None for p in progress), 'Completion baseline differs'
    counts = connection.execute('''SELECT
        (SELECT count(*) FROM curriculum.source_courses WHERE id BETWEEN 984 AND 990),
        (SELECT count(*) FROM curriculum.source_activities WHERE source_course_id BETWEEN 984 AND 990),
        (SELECT count(*) FROM "Learner".learner_source_course_memberships WHERE source_course_id BETWEEN 984 AND 990)''').fetchone()
    assert counts == ((7,331,14) if phase=='before' else (0,0,0)), 'Catalogue/membership state differs'
    if phase == 'after':
        remaining_refs = connection.execute('''SELECT count(*) FROM curriculum.source_courses
            WHERE source_system='old_lms' AND source_course_ref=ANY(%s)''',
            [['147095','147098','147100','147102','147104','147106','147108']]).fetchone()[0]
        assert remaining_refs == 0, 'Old LMS courses were recreated under different IDs'
    # Pin the pre-cleanup timestamps/identities, not merely the number of rows.
    assert fingerprint(progress) == COMPLETION_FINGERPRINT, 'Completion identities/timestamps changed'
    assert fingerprint(enrollments) == ENROLLMENT_FINGERPRINT, 'Enrollment identities/positions changed'
    return dict(phase=phase,ledger_records=488,accepted_actual_seconds=137310,
                canonical_completed_records=244,learner_1000_enrollments=0,
                completion_fingerprint=fingerprint(progress),enrollment_fingerprint=fingerprint(enrollments),
                catalogue_counts=counts)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--phase', choices=['before','after'], default='after')
    args = parser.parse_args()
    conn = connect_development()
    try:
        print(json.dumps(verify(conn,args.phase),sort_keys=True))
    finally:
        conn.rollback()
        conn.close()
