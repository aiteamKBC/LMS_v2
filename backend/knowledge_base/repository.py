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
    def book_storage_records(self, book_id):
        """Only the selected book's versions and their assets, including old builds."""
        with _cursor() as cur:
            cur.execute("SELECT id, storage_ref, page_count, file_sha256 FROM knowledge.book_versions WHERE book_id = %s",
                        [str(book_id)])
            versions = _rows(cur)
            cur.execute(
                "SELECT DISTINCT a.id, a.storage_ref, a.sha256 FROM knowledge.assets a"
                " JOIN knowledge.asset_occurrences o ON o.asset_id = a.id"
                " JOIN knowledge.builds b ON b.id = o.build_id"
                " JOIN knowledge.book_versions v ON v.id = b.book_version_id WHERE v.book_id = %s", [str(book_id)])
            return versions, _rows(cur)

    def replace_storage_refs(self, versions, assets):
        # Compare-and-swap prevents a concurrent migration from being overwritten.
        with transaction.atomic(using=DB), _cursor() as cur:
            for table, records in (("book_versions", versions), ("assets", assets)):
                for record in records:
                    cur.execute(f"UPDATE knowledge.{table} SET storage_ref = %s WHERE id = %s AND storage_ref = %s",
                                [record["new_ref"], record["id"], record["storage_ref"]])
                    if cur.rowcount != 1:
                        raise RuntimeError("Book storage changed during migration; retry the command.")

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

    def rename_book(self, book_id, title):
        """Change only the display title. Returns False when the book does not exist."""
        with _cursor() as cur:
            cur.execute("UPDATE knowledge.books SET title = %s WHERE id = %s", [title, book_id])
            return cur.rowcount == 1

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
                "SELECT b.id AS build_id, b.embedding_space_id, s.provider AS space_provider, s.model AS space_model,"
                " s.dims AS space_dims, v.id AS version_id, v.storage_ref, v.page_count,"
                " bk.id AS book_id, bk.title FROM knowledge.builds b"
                " JOIN knowledge.embedding_spaces s ON s.id = b.embedding_space_id"
                " JOIN knowledge.book_versions v ON v.id = b.book_version_id"
                " JOIN knowledge.books bk ON bk.id = v.book_id WHERE b.id = %s", [build_id])
            return _rows(cur)[0]

    # -- job queue --------------------------------------------------------------
    def claim_job(self, lease_id, stale_minutes, space=None):
        """``space`` = (provider, model, dims) of the worker: it only takes books
        whose vectors it can produce, and leaves the others queued untouched."""
        space_filter, params = "", [stale_minutes]
        if space is not None:
            space_filter = (" AND EXISTS (SELECT 1 FROM knowledge.builds b JOIN knowledge.embedding_spaces s"
                            " ON s.id = b.embedding_space_id WHERE b.id = j.build_id"
                            " AND s.provider = %s AND s.model = %s AND s.dims = %s)")
            params += list(space)
        with transaction.atomic(using=DB), _cursor() as cur:
            cur.execute(
                "SELECT j.id, j.build_id, j.attempts, j.max_attempts, j.stage FROM knowledge.ingestion_jobs j"
                " WHERE ((j.state IN ('queued', 'failed', 'paused') AND j.next_attempt_at <= now() AND j.attempts < j.max_attempts)"
                "    OR (j.state = 'running' AND j.heartbeat_at < now() - make_interval(mins => %s)))"
                f"{space_filter}"
                " ORDER BY j.requested_at FOR UPDATE SKIP LOCKED LIMIT 1", params)
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

    # -- retrieval (read-only) ---------------------------------------------------------------
    def images_for_chunks(self, chunk_ids, limit=24):
        if not chunk_ids:
            return []
        with _cursor() as cur:
            cur.execute(
                "WITH candidates AS (SELECT DISTINCT ON (a.id) a.id, a.storage_ref, a.sha256, a.media_type,"
                " a.size_bytes, o.id AS occurrence_id, o.pdf_page, o.book_caption, o.label_text,"
                " c.id AS chunk_id, c.build_id, array_position(%s::bigint[], c.id) AS chunk_rank,"
                " CASE ca.relation WHEN 'asset_chunk' THEN 0 WHEN 'referenced' THEN 1 ELSE 2 END AS relation_rank"
                " FROM knowledge.chunk_assets ca"
                " JOIN knowledge.chunks c ON c.id = ca.chunk_id"
                " JOIN knowledge.asset_occurrences o ON o.id = ca.occurrence_id AND o.build_id = c.build_id"
                " JOIN knowledge.assets a ON a.id = o.asset_id"
                " WHERE c.id = ANY(%s) AND NOT o.decorative AND a.media_type = 'image/webp'"
                " AND a.width >= 96 AND a.height >= 96"
                " ORDER BY a.id, chunk_rank, relation_rank, o.id)"
                " SELECT *, row_number() OVER (PARTITION BY chunk_id ORDER BY relation_rank, id) AS image_rank"
                " FROM candidates ORDER BY image_rank, chunk_rank LIMIT %s", [list(chunk_ids), list(chunk_ids), limit])
            return _rows(cur)

    def active_builds(self, book_ids):
        """Live build of each requested book (archived or unprocessed books are skipped)."""
        if not book_ids:
            return []
        with _cursor() as cur:
            cur.execute(
                "SELECT bk.id AS book_id, bk.title, b.id AS build_id, b.embedding_space_id, s.dims,"
                " s.provider AS space_provider, s.model AS space_model,"
                " (SELECT array_agg(scope_code ORDER BY scope_code) FROM knowledge.book_scopes bs WHERE bs.book_id = bk.id) AS scopes"
                " FROM knowledge.books bk"
                " JOIN knowledge.book_versions v ON v.id = bk.current_version_id"
                " JOIN knowledge.builds b ON b.id = v.active_build_id AND b.status = 'active'"
                " JOIN knowledge.embedding_spaces s ON s.id = b.embedding_space_id"
                " WHERE bk.status = 'active' AND bk.id::text = ANY(%s)", [[str(i) for i in book_ids]])
            return _rows(cur)

    def sections_for_builds(self, build_ids):
        with _cursor() as cur:
            cur.execute("SELECT id, build_id, parent_id, level, ordinal, number, title, pdf_page_start, pdf_page_end"
                        " FROM knowledge.sections WHERE build_id = ANY(%s::uuid[]) ORDER BY build_id, ordinal",
                        [[str(b) for b in build_ids]])
            return _rows(cur)

    def chunk_index(self, build_ids):
        """Chunk metadata without content (cheap) for whole-book planning."""
        with _cursor() as cur:
            cur.execute("SELECT id, build_id, section_id, ordinal, kind, token_count, pdf_page_start, pdf_page_end"
                        " FROM knowledge.chunks WHERE build_id = ANY(%s::uuid[]) ORDER BY build_id, ordinal",
                        [[str(b) for b in build_ids]])
            return _rows(cur)

    def chunk_contents(self, chunk_ids):
        if not chunk_ids:
            return {}
        with _cursor() as cur:
            cur.execute("SELECT id, content FROM knowledge.chunks WHERE id = ANY(%s)", [list(chunk_ids)])
            return dict(cur.fetchall())

    def search_chunks(self, build_ids, space_id, dims, query_vector, query_text, limit=40):
        """Hybrid search: vector similarity and full-text rank, fused with RRF.
        Only chunks of the given live builds, only vectors of one embedding space."""
        dims = int(dims)
        builds = [str(b) for b in build_ids]
        with _cursor() as cur:
            cur.execute(
                f"""
                WITH q AS (SELECT %s::vector({dims}) AS v, plainto_tsquery('english', %s) AS t),
                vec AS (
                    SELECT c.id, (cv.embedding::vector({dims})) <=> q.v AS distance,
                           row_number() OVER (ORDER BY (cv.embedding::vector({dims})) <=> q.v) AS r
                    FROM knowledge.chunk_vectors cv JOIN knowledge.chunks c ON c.id = cv.chunk_id, q
                    WHERE cv.embedding_space_id = %s AND c.build_id = ANY(%s::uuid[])
                    ORDER BY (cv.embedding::vector({dims})) <=> q.v LIMIT %s),
                txt AS (
                    SELECT c.id, row_number() OVER (ORDER BY ts_rank(c.tsv, q.t) DESC) AS r
                    FROM knowledge.chunks c, q
                    WHERE c.build_id = ANY(%s::uuid[]) AND c.tsv @@ q.t
                    ORDER BY ts_rank(c.tsv, q.t) DESC LIMIT %s)
                SELECT c.id, c.build_id, c.section_id, c.ordinal, c.kind, c.token_count, c.pdf_page_start, c.pdf_page_end,
                       coalesce(1.0 / (60 + vec.r), 0) + coalesce(1.0 / (60 + txt.r), 0) AS score,
                       vec.distance, txt.r IS NOT NULL AS text_match
                FROM knowledge.chunks c LEFT JOIN vec ON vec.id = c.id LEFT JOIN txt ON txt.id = c.id
                WHERE vec.id IS NOT NULL OR txt.id IS NOT NULL
                ORDER BY score DESC
                """,
                [query_vector, query_text, space_id, builds, limit, builds, limit])
            return _rows(cur)

    def search_chunks_text(self, build_ids, query_text, limit=40):
        """Full-text search only, for when the topic cannot be embedded with the
        model of these builds' vectors. Same row shape as search_chunks."""
        builds = [str(b) for b in build_ids]
        with _cursor() as cur:
            cur.execute(
                """
                WITH q AS (SELECT plainto_tsquery('english', %s) AS t)
                SELECT c.id, c.build_id, c.section_id, c.ordinal, c.kind, c.token_count, c.pdf_page_start, c.pdf_page_end,
                       1.0 / (60 + row_number() OVER (ORDER BY ts_rank(c.tsv, q.t) DESC)) AS score,
                       NULL::float8 AS distance, TRUE AS text_match
                FROM knowledge.chunks c, q
                WHERE c.build_id = ANY(%s::uuid[]) AND c.tsv @@ q.t
                ORDER BY ts_rank(c.tsv, q.t) DESC LIMIT %s
                """,
                [query_text, builds, limit])
            return _rows(cur)

    def log_generation(self, record, sources):
        """Provenance of one generation with books. Never raises into the caller."""
        with transaction.atomic(using=DB), _cursor() as cur:
            cur.execute(
                "INSERT INTO knowledge.generation_log (created_by, mode, question_count, request, coverage_plan,"
                " kb_tokens, ceiling_tokens, counterfactual_tokens) VALUES (%s, %s, %s, %s, %s, %s, %s, %s) RETURNING id",
                [record["created_by"], record["mode"], record["question_count"], json.dumps(record["request"]),
                 json.dumps(record["coverage_plan"]), record["kb_tokens"], record["ceiling_tokens"], record.get("counterfactual_tokens")])
            generation_id = cur.fetchone()[0]
            cur.executemany(
                "INSERT INTO knowledge.generation_sources (generation_id, block_index, position, chunk_id, build_id, token_count)"
                " VALUES (%s, %s, %s, %s, %s, %s)",
                [[generation_id, s["block"], s["position"], s["chunk_id"], s["build_id"], s["tokens"]] for s in sources])
        return generation_id

    def log_question_sources(self, generation_id, rows):
        with transaction.atomic(using=DB), _cursor() as cur:
            cur.executemany(
                "INSERT INTO knowledge.generation_question_sources (generation_id, question_index, question_sha256,"
                " chunk_id, confidence, method) VALUES (%s, %s, %s, %s, %s, %s) ON CONFLICT DO NOTHING",
                [[generation_id, r["index"], r["sha"], r["chunk_id"], r["confidence"], r["method"]] for r in rows])

    # -- helpers ----------------------------------------------------------------------------
    def _fence(self, cur, job):
        cur.execute("SELECT 1 FROM knowledge.ingestion_jobs WHERE id = %s AND lease_id = %s AND state = 'running' FOR UPDATE",
                    [job["id"], job["lease_id"]])
        if cur.fetchone() is None:
            raise LeaseLost(job["id"])
