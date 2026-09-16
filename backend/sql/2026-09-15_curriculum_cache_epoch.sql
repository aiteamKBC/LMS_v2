-- Shared curriculum cache generation counter.
--
-- Why this table exists
-- ---------------------
-- Every curriculum payload is cached per worker for CURRICULUM_CACHE_TTL_SECONDS
-- (1800s). A write retires those caches by moving a generation counter that all
-- workers read. That counter used to live in Django's cache -- which is
-- LocMemCache unless a Redis CACHE_URL is set, and production sets none. With
-- nine services of two workers, a write bumped the counter in exactly one of
-- eighteen process-local caches; the other seventeen kept serving their
-- pre-write payload for the rest of the half hour. A cohort, group, module or
-- authored week saved correctly and then did not appear, until enough reloads
-- happened to land back on the worker that took the write.
--
-- The database is the one store all eighteen workers genuinely share, so the
-- counter lives here now. curriculum_api.views.ensure_curriculum_epoch_table()
-- creates it on first use as well; running this first simply means the very
-- first request after a deploy does not pay for the DDL, and it works even if
-- the application role is not allowed to create tables at runtime.
--
-- Cost: one single-row read per worker per SHARED_EPOCH_POLL_SECONDS (3s), and
-- one UPDATE per request that writes.
--
-- Setting CACHE_URL to a Redis instance remains strictly better and needs no
-- code change: it makes the *payloads* shared too, so one worker's ~13s rebuild
-- after a write serves all of them instead of each rebuilding its own.

create schema if not exists "curriculum";

create table if not exists "curriculum"."cache_epoch" (
    id    integer primary key,
    epoch bigint not null default 0
);

insert into "curriculum"."cache_epoch" (id, epoch)
values (1, 0)
on conflict (id) do nothing;

-- Check:
--   select * from "curriculum"."cache_epoch";
-- `epoch` must increase by one for each request that writes curriculum data.
