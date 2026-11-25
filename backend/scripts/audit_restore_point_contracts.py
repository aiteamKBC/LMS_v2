"""Read-only historical restore diagnostics; no snapshot bodies leave this report.

Encoding matches and retained event integrity are not restoration rehearsals.
Uses the existing branch/endpoint allowlist and read-only transaction helper.
"""
import hashlib
import itertools
import json
from collections import Counter

from verify_inclusion_canonical_targets import connect_development


def main():
    with connect_development() as db:
        report = {'branch': 'br-raspy-sky-abvs8lq9', 'read_only': True}
        report['hash_encodings'] = db.execute('''SELECT length(snapshot_hash),count(*),
            count(*) FILTER(WHERE encode(sha256(convert_to(snapshot::text,'UTF8')),'hex')=snapshot_hash),
            count(*) FILTER(WHERE md5(snapshot::text)=snapshot_hash)
            FROM "Learner".learner_month_restore_points GROUP BY 1 ORDER BY 1''').fetchall()
        report['hash_encoding_columns'] = ['hash_length','records','sha256_jsonb_text_matches','md5_jsonb_text_matches']
        report['journal_original_agreement'] = db.execute('''SELECT count(*),
            count(*) FILTER(WHERE p.snapshot_hash=r.snapshot_hash AND p.snapshot=r.snapshot),
            count(*) FILTER(WHERE p.report_month=r.report_month),
            count(*) FILTER(WHERE p.row_count=r.row_count AND p.document_count=r.document_count)
            FROM "Learner".learner_month_restore_points r
            JOIN structured_manual_activities.manual_month_restore_points p
            ON p.id::numeric=(substring(r.source_ref from '([0-9]+)$'))::numeric
            WHERE r.source_system='journal' ''').fetchone()
        report['journal_agreement_columns'] = ['records','payload_and_hash','month','row_and_document_counts']
        report['restore_events'] = db.execute('''SELECT count(*),
            count(*) FILTER(WHERE target.id IS NULL),count(*) FILTER(WHERE pre.id IS NULL),
            count(*) FILTER(WHERE target.aptem_id IS DISTINCT FROM e.aptem_id OR pre.aptem_id IS DISTINCT FROM e.aptem_id),
            count(*) FILTER(WHERE target.report_month IS DISTINCT FROM e.report_month OR pre.report_month IS DISTINCT FROM e.report_month),
            count(*) FILTER(WHERE e.from_snapshot_hash IS DISTINCT FROM pre.snapshot_hash),
            count(*) FILTER(WHERE e.to_snapshot_hash IS DISTINCT FROM target.snapshot_hash)
            FROM structured_manual_activities.manual_month_restore_events e
            LEFT JOIN structured_manual_activities.manual_month_restore_points target ON target.id=e.restore_point_id
            LEFT JOIN structured_manual_activities.manual_month_restore_points pre ON pre.id=e.pre_restore_point_id''').fetchone()
        report['restore_event_columns'] = ['records','missing_target','missing_pre_state','owner_mismatch',
                                           'month_mismatch','from_hash_mismatch','to_hash_mismatch']
        report['event_points_without_canonical_copy'] = db.execute('''WITH ids AS (
            SELECT restore_point_id AS id FROM structured_manual_activities.manual_month_restore_events
            UNION SELECT pre_restore_point_id FROM structured_manual_activities.manual_month_restore_events),
            missing AS (SELECT p.* FROM ids JOIN structured_manual_activities.manual_month_restore_points p USING(id)
            WHERE NOT EXISTS(SELECT 1 FROM "Learner".learner_month_restore_points r
              WHERE r.source_system='journal' AND (substring(r.source_ref from '([0-9]+)$'))::numeric=p.id))
            SELECT point_kind,count(*),count(*) FILTER(WHERE EXISTS(
                SELECT 1 FROM "Learner".learners l WHERE l.aptem_id=missing.aptem_id))
            FROM missing GROUP BY point_kind ORDER BY point_kind''').fetchall()
        report['missing_copy_columns'] = ['kind','records','owners_present_in_canonical_learners']
        report['restore_routines'] = db.execute('''SELECT n.nspname,p.proname,p.prokind
            FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
            WHERE n.nspname NOT IN ('pg_catalog','information_schema') AND
            (p.proname ILIKE '%%restor%%' OR p.prosrc ~* '(restore.?point|month.?restore|manual.journal.restore)')
            ORDER BY 1,2''').fetchall()
        report['restore_triggers'] = db.execute('''SELECT n.nspname,c.relname,t.tgname
            FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
            WHERE c.relname ILIKE '%%restore%%' AND NOT t.tgisinternal''').fetchall()
        # Bounded encoding diagnostics only; do not infer an original contract.
        matches = Counter()
        samples = db.execute('''SELECT snapshot_hash,snapshot FROM "Learner".learner_month_restore_points
            WHERE source_system='journal' ORDER BY id LIMIT 20''').fetchall()
        for digest, snapshot in samples:
            scopes = {'whole': snapshot, 'content': {k:snapshot[k] for k in ('rows','row_ksbs','documents') if k in snapshot},
                      'rows': snapshot.get('rows'), 'without_schema': {k:v for k,v in snapshot.items() if k!='schema'}}
            for name, value in scopes.items():
                for sort, ascii_only, compact in itertools.product((True, False), repeat=3):
                    payload = json.dumps(value, sort_keys=sort, ensure_ascii=ascii_only,
                        separators=(',', ':') if compact else None, default=str)
                    if hashlib.sha256(payload.encode()).hexdigest() == digest:
                        matches[f'{name}:sorted={sort}:ascii={ascii_only}:compact={compact}'] += 1
        report['journal_encoding_sample'] = {'records': len(samples), 'matched_encodings': dict(matches)}
        report['restoration_rehearsal'] = 'NOT RUN: implementation and versioned contracts not located'
        print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
