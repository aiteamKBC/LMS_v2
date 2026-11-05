-- Curriculum cache scope epochs -- step 2: apply.
--
-- Adds ONE new, empty table. No existing table, column or row is touched.
-- Each row is a cache generation: '*' for writes the backend cannot attribute,
-- otherwise a programme_id. The backend moves them after a curriculum save and
-- keys each programme's cached pages on them (curriculum_api/cache_scope.py).
-- Until this table exists the backend keeps today's global invalidation.
--
-- Idempotent. Safe while the application is running.

begin;

create table if not exists curriculum.cache_scope_epoch (
    scope varchar(255) primary key,
    epoch bigint not null default 0
);

-- The unscoped generation. Seeded from the clock rather than 0 so that a
-- table dropped by the rollback and created again can never hand out a
-- generation an old cached page was stored under.
insert into curriculum.cache_scope_epoch (scope, epoch)
values ('*', (extract(epoch from clock_timestamp()) * 1000)::bigint)
on conflict (scope) do nothing;

commit;
