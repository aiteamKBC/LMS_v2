"""All SQL for the Knowledge Base. Every statement targets schema "knowledge"
only -- nothing here reads or writes any other LMS table.

Writes made while processing a job are fenced: they succeed only while the
worker still holds the job's lease, so a worker that lost its lease (crash,
restart, stale heartbeat) can never overwrite the one that took over.
"""
from __future__ import annotations

import json

from django.db import connections, transaction

DB = "default"
BULK_TIMEOUT = "60s"


class LeaseLost(RuntimeError):
    """Another worker owns this job now; stop without writing."""


def _vector_literal(values):
    return "[" + ",".join(f"{v:.7g}" for v in values) + "]"


def _cursor():
    return connections[DB].cursor()


def _rows(cur):
    cols = [c[0] for c in cur.description]
    return [dict(zip(cols, row)) for row in cur.fetchall()]


class Repository:
    # -- registry -------------------------------------------------------------
    def find_version_by_sha(self, file_sha):
        with _cursor() as cur:
            cur.execute("SELECT id, book_id FROM knowledge.book_versions WHERE file_sha256 = %s", [file_sha])
            rows = _rows(cur)
        return rows[0] if rows else None

    def create_book_version(self, *, title, scopes, file_sha, file_name, size, storage_ref, edition, user, build_versions, space_id):
        with transaction.atomic(using=DB), _cursor() as cur:
            cur.execute("INSERT INTO knowledge.books (title, created_by) VALUES (%s, %s) RETURNING id", [title, user])
            book_id = cur.fetchone()[0]
            self._add_scopes(cur, book_id, scopes)
            cur.execute(
                "INSERT INTO knowledge.book_versions (book_id, edition_label, file_sha256, file_name, size_bytes, storage_ref, created_by)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s) RETURNING id",
                [book_id, edition, file_sha, file_name, size, storage_ref, user])
            version_id = cur.fetchone()[0]
            build_id = self._create_build(cur, version_id, build_versions, space_id)
        return {"book_id": book_id, "version_id": version_id, "build_id": build_id}

    def add_scopes(self, book_id, scopes):
        with transaction.atomic(using=DB), _cursor() as cur:
            self._add_scopes(cur, book_id, scopes)

    def _add_scopes(self, cur, book_id, scopes):
        for code in scopes:
            cur.execute("INSERT INTO knowledge.book_scopes (book_id, scope_code) VALUES (%s, %s) ON CONFLICT DO NOTHING",
                        [book_id, code])

    def _create_build(self, cur, version_id, build_versions, space_id):
        cur.execute("INSERT INTO knowledge.builds (book_version_id, embedding_space_id, versions) VALUES (%s, %s, %s) RETURNING id",
                    [version_id, space_id, json.dumps(build_versions)])
        build_id = cur.fetchone()[0]
        cur.execute("INSERT INTO knowledge.ingestion_jobs (build_id) VALUES (%s)", [build_id])
        return build_id

    def active_space(self):
        with _cursor() as cur:
            cur.execute("SELECT id, provider, model, dims FROM knowledge.embedding_spaces WHERE status = 'active'")
            rows = _rows(cur)
        return rows[0] if rows else None

    def job_context(self, build_id):
        with _cursor() as cur:
            cur.execute(
                "SELECT b.id AS build_id, b.embedding_space_id, v.id AS version_id, v.storage_ref, v.page_count,"
                " bk.id AS book_id, bk.title FROM knowledge.builds b"
                " JOIN knowledge.book_versions v ON v.id = b.book_version_id"
                " JOIN knowledge.books bk ON bk.id = v.book_id WHERE b.id = %s", [build_id])
            return _rows(cur)[0]

    # -- job queue --------------------------------------------------------------
    def claim_job(self, lease_id, stale_minutes):
        with transaction.atomic(using=DB), _cursor() as cur:
            cur.execute(
                "SELECT id, build_id, attempts, max_attempts, stage FROM knowledge.ingestion_jobs"
                " WHERE (state IN ('queued', 'failed', 'paused') AND next_attempt_at <= now() AND attempts < max_attempts)"
                "    OR (state = 'running' AND heartbeat_at < now() - make_interval(mins => %s))"
                " ORDER BY requested_at FOR UPDATE SKIP LOCKED LIMIT 1", [stale_minutes])
            rows = _rows(cur)
            if not rows:
                return None
            job = rows[0]
            cur.execute(
                "UPDATE knowledge.ingestion_jobs SET state = 'running', lease_id = %s, attempts = attempts + 1,"
                " heartbeat_at = now(), started_at = coalesce(started_at, now()) WHERE id = %s", [lease_id, job["id"]])
        job["attempts"] += 1
        return job

    def heartbeat(self, job_id, lease_id, stage, progress):
        with _cursor() as cur:
            cur.execute(
                "UPDATE knowledge.ingestion_jobs SET heartbeat_at = now(), stage = %s, progress = %s"
                " WHERE id = %s AND lease_id = %s AND state = 'running'",
                [stage, json.dumps(progress), job_id, lease_id])
            if cur.rowcount != 1:
                raise LeaseLost(job_id)

    def finish_job(self, job_id, lease_id, state, error="", backoff_minutes=0):
        with _cursor() as cur:
            cur.execute(
                "UPDATE knowledge.ingestion_jobs SET state = %s, last_error = %s, finished_at = now(),"
                " next_attempt_at = now() + make_interval(mins => %s), lease_id = NULL"
                " WHERE id = %s AND lease_id = %s", [state, error[:1500], backoff_minutes, job_id, lease_id])
            if cur.rowcount != 1:
                raise LeaseLost(job_id)

    def requeue_build(self, build_id):
        with _cursor() as cur:
            cur.execute("UPDATE knowledge.ingestion_jobs SET state = 'queued', attempts = 0, next_attempt_at = now(),"
                        " last_error = '' WHERE build_id = %s AND state <> 'running'", [build_id])
            return cur.rowcount == 1

    def worker_seen(self, worker_id, host, pid, version):
        with _cursor() as cur:
            cur.execute(
                "INSERT INTO knowledge.worker_heartbeats (worker_id, host, pid, version, last_seen_at) VALUES (%s, %s, %s, %s, now())"
                " ON CONFLICT (worker_id) DO UPDATE SET host = excluded.host, pid = excluded.pid,"
                " version = excluded.version, last_seen_at = now()", [worker_id, host, pid, version])

    # -- pages ---------------------------------------------------------------------
    def set_page_count(self, version_id, page_count):
        with _cursor() as cur:
            cur.execute("UPDATE knowledge.book_versions SET page_count = %s WHERE id = %s", [page_count, version_id])

    def stored_pages(self, version_id, extractor_version):
        with _cursor() as cur:
            cur.execute("SELECT pdf_page FROM knowledge.pages WHERE book_version_id = %s AND extractor_version = %s",
                        [version_id, extractor_version])
            return {row[0] for row in cur.fetchall()}

    def save_pages(self, job, version_id, extractor_version, pages):
        with transaction.atomic(using=DB), _cursor() as cur:
            self._fence(cur, job)
            cur.execute(f"SET LOCAL statement_timeout = '{BULK_TIMEOUT}'")
            cur.executemany(
                "INSERT INTO knowledge.pages (book_version_id, pdf_page, extractor_version, printed_label, status, text, blocks)"
                " VALUES (%s, %s, %s, %s, %s, %s, %s)"
                " ON CONFLICT (book_version_id, pdf_page, extractor_version) DO NOTHING",
                [[version_id, p.pdf_page, extractor_version, p.printed_label, p.status, p.text,
                  json.dumps([{"t": l.text, "s": l.size, "b": l.bold, "y": l.y0} for l in p.lines])]
                 for p in pages])

    def load_pages(self, version_id, extractor_version):
        with _cursor() as cur:
            cur.execute("SELECT pdf_page, printed_label, status, blocks FROM knowledge.pages"
                        " WHERE book_version_id = %s AND extractor_version = %s ORDER BY pdf_page",
                        [version_id, extractor_version])
            rows = _rows(cur)
        for row in rows:  # jsonb may arrive as text depending on the driver setup
            if isinstance(row["blocks"], str):
                row["blocks"] = json.loads(row["blocks"])
        return rows

    # -- assets ----------------------------------------------------------------------
    def save_assets(self, job, build_id, items):
        """items: (asset fields, occurrence fields). Returns nothing; idempotent per page."""
        with transaction.atomic(using=DB), _cursor() as cur:
            self._fence(cur, job)
            for asset, occ in items:
                cur.execute(
                    "INSERT INTO knowledge.assets (sha256, media_type, width, height, size_bytes, storage_ref)"
                    " VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT (sha256) DO UPDATE SET sha256 = excluded.sha256 RETURNING id",
                    [asset["sha256"], asset["media_type"], asset["width"], asset["height"], asset["size_bytes"], asset["storage_ref"]])
                asset_id = cur.fetchone()[0]
                cur.execute(
                    "INSERT INTO knowledge.asset_occurrences (asset_id, build_id, pdf_page, bbox, kind, book_caption, label_text)"
                    " SELECT %s, %s, %s, %s, %s, %s, %s WHERE NOT EXISTS (SELECT 1 FROM knowledge.asset_occurrences"
                    " WHERE asset_id = %s AND build_id = %s AND pdf_page = %s AND kind = %s)",
                    [asset_id, build_id, occ["pdf_page"], list(occ["bbox"]), occ["kind"], occ["caption"], occ["label_text"],
                     asset_id, build_id, occ["pdf_page"], occ["kind"]])

    def load_occurrences(self, build_id):
        with _cursor() as cur:
            cur.execute(
                "SELECT o.id, o.asset_id, o.pdf_page, o.kind, o.book_caption, o.label_text, a.sha256,"
                " a.manual_description, a.vision_description FROM knowledge.asset_occurrences o"
                " JOIN knowledge.assets a ON a.id = o.asset_id WHERE o.build_id = %s ORDER BY o.pdf_page, o.id", [build_id])
            return _rows(cur)

    # -- structure and chunks ---------------------------------------------------------
    def replace_structure(self, job, build_id, sections, chunks, occurrence_links, decorative_ids):
        """Rebuild sections/chunks of one build in a single transaction."""
        with transaction.atomic(using=DB), _cursor() as cur:
            self._fence(cur, job)
            cur.execute(f"SET LOCAL statement_timeout = '{BULK_TIMEOUT}'")
            cur.execute("DELETE FROM knowledge.chunks WHERE build_id = %s", [build_id])
            cur.execute("DELETE FROM knowledge.sections WHERE build_id = %s", [build_id])
            ids = {}
            for s in sections:
                cur.execute(
                    "INSERT INTO knowledge.sections (build_id, parent_id, level, ordinal, number, title, pdf_page_start, pdf_page_end)"
                    " VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    [build_id, ids.get(s.parent), s.level, s.ordinal, s.number, s.title, s.pdf_page_start, s.pdf_page_end])
                ids[s.ordinal] = cur.fetchone()[0]
            chunk_ids = {}
            for c in chunks:
                cur.execute(
                    "INSERT INTO knowledge.chunks (build_id, section_id, ordinal, kind, content, embed_text, content_sha256,"
                    " token_count, pdf_page_start, pdf_page_end) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                    [build_id, ids.get(c.section_ordinal), c.ordinal, c.kind, c.content, c.embed_text, c.content_sha256,
                     c.token_count, c.pdf_page_start, c.pdf_page_end])
                chunk_ids[c.ordinal] = cur.fetchone()[0]
            for occurrence_id, section_ordinal, chunk_ordinal, relation in occurrence_links:
                cur.execute("UPDATE knowledge.asset_occurrences SET section_id = %s WHERE id = %s",
                            [ids.get(section_ordinal), occurrence_id])
                if chunk_ordinal in chunk_ids:
                    cur.execute("INSERT INTO knowledge.chunk_assets (chunk_id, occurrence_id, relation) VALUES (%s, %s, %s)"
                                " ON CONFLICT DO NOTHING", [chunk_ids[chunk_ordinal], occurrence_id, relation])
            cur.execute("UPDATE knowledge.asset_occurrences SET decorative = (id = ANY(%s)) WHERE build_id = %s",
                        [list(decorative_ids), build_id])

    def chunks_without_vectors(self, build_id, space_id, limit):
        with _cursor() as cur:
            cur.execute(
                "SELECT c.id, c.content_sha256, c.embed_text FROM knowledge.chunks c"
                " WHERE c.build_id = %s AND NOT EXISTS (SELECT 1 FROM knowledge.chunk_vectors v"
                " WHERE v.chunk_id = c.id AND v.embedding_space_id = %s) ORDER BY c.ordinal LIMIT %s",
                [build_id, space_id, limit])
            return _rows(cur)

    def cached_embeddings(self, shas, space_id):
        if not shas:
            return {}
        with _cursor() as cur:
            cur.execute("SELECT content_sha256, embedding::text FROM knowledge.embeddings"
                        " WHERE embedding_space_id = %s AND content_sha256 = ANY(%s)", [space_id, list(shas)])
            return {sha.strip(): text for sha, text in cur.fetchall()}

    def store_vectors(self, job, space_id, new_embeddings, chunk_vectors):
        """new_embeddings: [(sha, vector list, tokens)]; chunk_vectors: [(chunk_id, vector literal)]."""
        with transaction.atomic(using=DB), _cursor() as cur:
            self._fence(cur, job)
            cur.execute(f"SET LOCAL statement_timeout = '{BULK_TIMEOUT}'")
            cur.executemany(
                "INSERT INTO knowledge.embeddings (content_sha256, embedding_space_id, embedding, token_count)"
                " VALUES (%s, %s, %s::vector, %s) ON CONFLICT DO NOTHING",
                [[sha, space_id, _vector_literal(vec), tokens] for sha, vec, tokens in new_embeddings])
            cur.executemany(
                "INSERT INTO knowledge.chunk_vectors (chunk_id, embedding_space_id, embedding) VALUES (%s, %s, %s::vector)"
                " ON CONFLICT DO NOTHING", [[chunk_id, space_id, literal] for chunk_id, literal in chunk_vectors])

    # -- verification and activation ------------------------------------------------------
    def verification_counts(self, build_id, space_id):
        with _cursor() as cur:
            cur.execute(
                "SELECT (SELECT count(*) FROM knowledge.chunks WHERE build_id = %s),"
                " (SELECT count(*) FROM knowledge.chunks c WHERE c.build_id = %s AND NOT EXISTS"
                "   (SELECT 1 FROM knowledge.chunk_vectors v WHERE v.chunk_id = c.id AND v.embedding_space_id = %s)),"
                " (SELECT count(*) FROM knowledge.chunks WHERE build_id = %s AND section_id IS NULL)",
                [build_id, build_id, space_id, build_id])
            total, missing, orphan = cur.fetchone()
        return {"chunks": total, "chunks_without_vector": missing, "chunks_without_section": orphan}

    def record_issues(self, job, build_id, issues):
        with transaction.atomic(using=DB), _cursor() as cur:
            self._fence(cur, job)
            cur.execute("DELETE FROM knowledge.ingestion_issues WHERE build_id = %s AND resolved_at IS NULL", [build_id])
            cur.executemany("INSERT INTO knowledge.ingestion_issues (build_id, pdf_page, stage, reason, retriable)"
                            " VALUES (%s, %s, %s, %s, %s)",
                            [[build_id, i["pdf_page"], i["stage"], i["reason"], i["retriable"]] for i in issues])

    def set_build_status(self, job, build_id, status, completeness):
        with transaction.atomic(using=DB), _cursor() as cur:
            self._fence(cur, job)
            cur.execute("UPDATE knowledge.builds SET status = %s, completeness = %s WHERE id = %s",
                        [status, json.dumps(completeness), build_id])

    def activate_build(self, build_id, accepted_by=None):
        """Atomically make this build the live version of its book. The previous
        version keeps serving until this commits; readers never see a mix."""
        with transaction.atomic(using=DB), _cursor() as cur:
            cur.execute("SELECT b.status, v.id, v.book_id FROM knowledge.builds b"
                        " JOIN knowledge.book_versions v ON v.id = b.book_version_id WHERE b.id = %s FOR UPDATE OF b", [build_id])
            status, version_id, book_id = cur.fetchone()
            if status not in ("ready", "needs_review"):
                raise ValueError(f"Build {build_id} is {status}; only ready or accepted builds can be activated.")
            if status == "needs_review" and not accepted_by:
                raise ValueError("A build with gaps needs an explicit acceptance.")
            cur.execute("SELECT id FROM knowledge.books WHERE id = %s FOR UPDATE", [book_id])
            cur.execute("UPDATE knowledge.builds SET status = 'superseded' WHERE status = 'active' AND book_version_id IN"
                        " (SELECT id FROM knowledge.book_versions WHERE book_id = %s)", [book_id])
            cur.execute("UPDATE knowledge.builds SET status = 'active', activated_at = now(), accepted_by = %s,"
                        " accepted_at = CASE WHEN %s::text IS NULL THEN NULL ELSE now() END WHERE id = %s",
                        [accepted_by, accepted_by, build_id])
            cur.execute("UPDATE knowledge.book_versions SET active_build_id = %s WHERE id = %s", [build_id, version_id])
            cur.execute("UPDATE knowledge.books SET current_version_id = %s WHERE id = %s", [version_id, book_id])

    # -- read side for the Library page ---------------------------------------------------------
    def list_scopes(self):
        with _cursor() as cur:
            cur.execute("SELECT code, name FROM knowledge.scopes ORDER BY sort_order")
            return _rows(cur)

    def list_books(self, scope=None, include_archived=False):
        where, params = ["TRUE"], []
        if not include_archived:
            where.append("bk.status = 'active'")
        if scope:
            where.append("EXISTS (SELECT 1 FROM knowledge.book_scopes s WHERE s.book_id = bk.id AND s.scope_code = %s)")
            params.append(scope.upper())
        with _cursor() as cur:
            cur.execute(
                "SELECT bk.id, bk.title, bk.status AS book_status, bk.created_at, bk.current_version_id,"
                " (SELECT array_agg(scope_code ORDER BY scope_code) FROM knowledge.book_scopes s WHERE s.book_id = bk.id) AS scopes,"
                " lv.id AS version_id, lv.file_name, lv.size_bytes, lv.page_count, lv.edition_label,"
                " lb.id AS build_id, lb.status AS build_status, lb.completeness,"
                " j.state AS job_state, j.stage AS job_stage, j.progress AS job_progress, j.last_error, j.attempts"
                " FROM knowledge.books bk"
                " LEFT JOIN LATERAL (SELECT * FROM knowledge.book_versions v WHERE v.book_id = bk.id"
                "   ORDER BY v.created_at DESC LIMIT 1) lv ON TRUE"
                " LEFT JOIN LATERAL (SELECT * FROM knowledge.builds b WHERE b.book_version_id = lv.id"
                "   ORDER BY b.created_at DESC LIMIT 1) lb ON TRUE"
                " LEFT JOIN knowledge.ingestion_jobs j ON j.build_id = lb.id"
                f" WHERE {' AND '.join(where)} ORDER BY bk.created_at DESC", params)
            rows = _rows(cur)
        for row in rows:
            for key in ("completeness", "job_progress"):
                if isinstance(row.get(key), str):
                    row[key] = json.loads(row[key])
        return rows

    def book_outline(self, build_id, limit=2000):
        with _cursor() as cur:
            cur.execute(
                "SELECT s.id, s.parent_id, s.level, s.number, s.title, s.pdf_page_start, s.pdf_page_end,"
                " (SELECT count(*) FROM knowledge.chunks c WHERE c.section_id = s.id) AS chunks,"
                " (SELECT count(*) FROM knowledge.asset_occurrences o WHERE o.section_id = s.id AND NOT o.decorative) AS assets"
                " FROM knowledge.sections s WHERE s.build_id = %s ORDER BY s.ordinal LIMIT %s", [build_id, limit])
            return _rows(cur)

    def build_issues(self, build_id):
        with _cursor() as cur:
            cur.execute("SELECT id, pdf_page, stage, reason, retriable, resolved_at FROM knowledge.ingestion_issues"
                        " WHERE build_id = %s ORDER BY pdf_page NULLS FIRST, id", [build_id])
            return _rows(cur)

    def build_status(self, build_id):
        with _cursor() as cur:
            cur.execute("SELECT status FROM knowledge.builds WHERE id = %s", [build_id])
            row = cur.fetchone()
        return row[0] if row else None

    def worker_last_seen(self):
        with _cursor() as cur:
            cur.execute("SELECT max(last_seen_at), now() FROM knowledge.worker_heartbeats")
            return cur.fetchone()

    # -- helpers ----------------------------------------------------------------------------
    def _fence(self, cur, job):
        cur.execute("SELECT 1 FROM knowledge.ingestion_jobs WHERE id = %s AND lease_id = %s AND state = 'running' FOR UPDATE",
                    [job["id"], job["lease_id"]])
        if cur.fetchone() is None:
            raise LeaseLost(job["id"])
