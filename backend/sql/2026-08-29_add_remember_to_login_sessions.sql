-- Rolling session expiry: persist the "remember me" choice on the session row.
--
-- Why the column is needed
-- ------------------------
-- Sessions now renew their own expiry while the person is working
-- (login/sessions.py touch_session), bounded by an absolute ceiling anchored on
-- Created_at. Renewal happens long after sign-in, so it cannot ask the request
-- whether "remember me" was ticked — which policy governs the session has to be
-- readable from the row itself:
--
--   normal        rolling 12 hours, absolute ceiling  7 days
--   remember me   rolling 14 days,  absolute ceiling 90 days
--
-- Backwards compatibility
-- -----------------------
-- NOT NULL DEFAULT false backfills every existing session as a normal one. That
-- is deliberate: the true value is not recoverable for rows written before the
-- column existed, and false is the safer of the two policies. No existing
-- session is invalidated by this change — renewal only ever moves Expires_at
-- *forward*, so a session already carrying a longer expiry simply keeps it and
-- retires on its original schedule.
--
-- Safe to re-run. Additive only; no existing column, row or index is touched.
--
-- Applied automatically by `python manage.py apply_login_tables` (which is
-- idempotent and contains the same statement). This file exists for applying it
-- straight to Neon without running the command.

-- 1. Inspect first: does the column already exist, and how many live sessions
--    would be affected by the backfill?
select (
         select count(*)
           from information_schema.columns
          where table_schema = 'login'
            and table_name   = 'Login_sessions'
            and column_name  = 'Remember'
       ) as remember_column_exists,
       count(*) filter (where "Revoked_at" is null and "Expires_at" > now())
         as live_sessions_backfilled_as_normal
  from login."Login_sessions";

-- 2. Apply.
alter table login."Login_sessions"
  add column if not exists "Remember" boolean not null default false;

-- 3. Verify.
select column_name, data_type, is_nullable, column_default
  from information_schema.columns
 where table_schema = 'login'
   and table_name   = 'Login_sessions'
   and column_name  = 'Remember';
