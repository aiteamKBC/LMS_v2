-- One enrolment row per email address, enforced by the database.
-- Written 2026-09-18. NOT YET RUN anywhere.
--
-- WHY
--   enrolment."Created_users" has no unique index on the address, so the same
--   person can be enrolled twice. "Learner".learners does have one
--   (learners_email_normalized_uniq on the generated email_normalized column),
--   so a duplicated pair can only ever own one mirror row between them. The
--   mirror attaches to whichever enrolment row is synced first, and every later
--   sync from the other row fights it for the same record.
--
--   That is what happened to Shelley Cant (538/588) and Ilaria Piscopo
--   (515/587) on 17/09/2026: both already existed from an earlier import, an
--   enrolment officer created them again through the form five minutes apart,
--   and the login account went to the new row while the mirror stayed on the
--   old one. learner_profile_for_source resolves the mirror by enrolment_id and
--   falls back to the address only for profiles with no enrolment_id at all, so
--   signing in on the new id resolved to no profile: no coach, no programme
--   cycle, an empty Programme reviews panel, and "No coach has been assigned to
--   you yet" on the booking screen while the coach sat on the enrolment row all
--   along. Both were merged by
--   learner_api/management/commands/merge_duplicate_enrolments.py.
--
--   learner_api/views.py:_create_enrolment_user now refuses a duplicate address
--   before inserting, and the other three creation paths already did
--   (login/learner_enrolment.py:can_add_learner_record,
--   import_audit_learners.py's existing-email map, and the Al Fanar script's
--   pre-check + table lock). This index is what those checks cannot be: it also
--   holds for two genuinely concurrent requests -- a double-clicked Create --
--   and for anything written straight to the database, which is how the two
--   older rows arrived in the first place (their Enrolled_time_and_user is
--   null).
--
-- SHAPE
--   On lower(btrim("Email")), matching how every reader compares the column
--   (email__iexact, lower(btrim(...)), casefold()). A plain unique index on
--   "Email" would have let "Shelley.Cant@" and "shelley.cant@" coexist, which
--   is exactly the pair this is meant to stop.
--
--   Partial, excluding the blank address. merge_duplicate_enrolments retires a
--   row by blanking its email, and rows predating the enrolment form have no
--   address either; a full index would collapse all of those into one and the
--   build would fail. NULL is already exempt from a unique index, '' is not.
--
-- HOW TO RUN
--   1. Run on the test branch first, not production.
--   2. Run step 1 and confirm it returns no rows. It was empty on 2026-09-18
--      after the merge; anything appearing since must be merged first, or the
--      build in step 2 fails (and CONCURRENTLY leaves an INVALID index behind
--      -- see step 4).
--   3. CREATE INDEX CONCURRENTLY CANNOT RUN INSIDE A TRANSACTION BLOCK. Run
--      step 2 on its own. Some SQL consoles open a transaction for you; if you
--      get "cannot run inside a transaction block", that is what happened.
--   4. If the build is interrupted or fails, drop the invalid index it leaves
--      (step 4) before re-running.
--   5. Needs owner rights on the enrolment schema, so this is a DBA/owner run
--      rather than something the application performs.
--
-- Rollback: DROP INDEX CONCURRENTLY enrolment.created_users_email_uniq;


-- ---------------------------------------------------------------------------
-- 1. Pre-check. Must return zero rows before step 2 is attempted.
--    Each row returned is a person enrolled more than once: merge them with
--      python manage.py merge_duplicate_enrolments --pairs <keep>:<retire>
--    where <keep> is the id login."Login_accounts"."Subject_id" points at.
-- ---------------------------------------------------------------------------
SELECT lower(btrim("Email"))            AS email,
       count(*)                         AS rows,
       array_agg(id ORDER BY id)        AS created_user_ids,
       array_agg("Programme_status" ORDER BY id) AS statuses
  FROM enrolment."Created_users"
 WHERE coalesce(btrim("Email"), '') <> ''
 GROUP BY 1
HAVING count(*) > 1
 ORDER BY 2 DESC;


-- ---------------------------------------------------------------------------
-- 2. The index. Run this statement on its own -- not inside a transaction.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS created_users_email_uniq
    ON enrolment."Created_users" (lower(btrim("Email")))
 WHERE coalesce(btrim("Email"), '') <> '';


-- ---------------------------------------------------------------------------
-- 3. Confirm it is live and valid.
-- ---------------------------------------------------------------------------
SELECT i.relname, x.indisvalid, pg_get_indexdef(i.oid)
  FROM pg_class t
  JOIN pg_namespace n ON n.oid = t.relnamespace
  JOIN pg_index x     ON x.indrelid = t.oid
  JOIN pg_class i     ON i.oid = x.indexrelid
 WHERE n.nspname = 'enrolment'
   AND t.relname = 'Created_users'
   AND i.relname = 'created_users_email_uniq';


-- ---------------------------------------------------------------------------
-- 4. Only if step 2 was interrupted: find and drop the invalid leftover.
--    An INVALID index is inert -- it enforces nothing and serves no query.
-- ---------------------------------------------------------------------------
-- SELECT i.relname FROM pg_class t
--   JOIN pg_namespace n ON n.oid = t.relnamespace
--   JOIN pg_index x     ON x.indrelid = t.oid
--   JOIN pg_class i     ON i.oid = x.indexrelid
--  WHERE n.nspname = 'enrolment' AND t.relname = 'Created_users'
--    AND NOT x.indisvalid;
-- DROP INDEX CONCURRENTLY enrolment.created_users_email_uniq;
