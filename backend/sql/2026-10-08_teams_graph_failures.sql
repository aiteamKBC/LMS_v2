-- Owner-run SQL only; no Django migration.
--
-- A durable record of Microsoft Graph writes the Teams paths saw refused, for
-- the intermittent HTTP 403 on PATCH users/{organiser}/onlineMeetings/{id}.
-- Written by backend/curriculum_api/teams_graph_failure_log.py
-- (record_graph_failure); read by the same module and by the queries below.
--
-- Creates one new, empty table and two indexes on it. No existing table is
-- altered and nothing is backfilled. Takes no lock on any existing relation.
--
-- Until this is applied every failure is still written to the process log
-- (logger "curriculum_api.teams_graph_failure_log", with "stored=no"), and no
-- save behaves differently: the insert is skipped, never failed.
--
-- What it does NOT contain: access tokens, client secrets, request bodies
-- (attendee lists) or learner data. graph_message is Microsoft's error text,
-- cut to 1000 characters with anything shaped like a credential redacted.
--
-- Retention: rows are not deleted automatically. A prune statement is at the
-- bottom, commented out; pruning is the owner's decision.

CREATE TABLE IF NOT EXISTS curriculum.teams_graph_failures (
    id                  bigserial     PRIMARY KEY,
    occurred_at         timestamptz   NOT NULL DEFAULT now(),
    -- online_meeting_options_patch, online_meeting_resolve,
    -- online_meeting_options_confirm or calendar_event_save.
    operation           varchar(64)   NOT NULL,
    live_session_id     varchar(128)  NOT NULL DEFAULT '',
    online_meeting_id   varchar(512)  NOT NULL DEFAULT '',
    organizer_email     varchar(254)  NOT NULL DEFAULT '',
    -- The Entra object ID used in the Graph path (users/{id}/onlineMeetings).
    organizer_object_id varchar(64)   NOT NULL DEFAULT '',
    -- Which option groups the write carried: ["settings"], ["roles"] or both.
    option_groups       jsonb         NOT NULL DEFAULT '[]'::jsonb,
    http_status         integer,
    graph_code          varchar(128)  NOT NULL DEFAULT '',
    graph_message       text          NOT NULL DEFAULT '',
    -- Microsoft's request-id: what Microsoft support asks for.
    graph_request_id    varchar(64)   NOT NULL DEFAULT '',
    graph_method        varchar(10)   NOT NULL DEFAULT '',
    graph_path          varchar(512)  NOT NULL DEFAULT '',
    -- The LMS's own X-Request-ID for the save that made the call.
    lms_request_id      varchar(64)   NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS teams_graph_failures_series_idx
    ON curriculum.teams_graph_failures (live_session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS teams_graph_failures_organizer_idx
    ON curriculum.teams_graph_failures (organizer_object_id, occurred_at DESC);

-- Read-only verification (run separately after creation).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'curriculum' AND table_name = 'teams_graph_failures'
ORDER BY ordinal_position;

-- Useful read-only queries for the 403 investigation:
--
-- Refusals per organiser and operation, last 30 days:
-- SELECT organizer_object_id, operation, http_status, graph_code, count(*), max(occurred_at)
-- FROM curriculum.teams_graph_failures
-- WHERE occurred_at > now() - interval '30 days'
-- GROUP BY 1, 2, 3, 4 ORDER BY 5 DESC;
--
-- Request IDs to hand to Microsoft support for one meeting series:
-- SELECT occurred_at, operation, option_groups, http_status, graph_code, graph_request_id, graph_message
-- FROM curriculum.teams_graph_failures
-- WHERE live_session_id = '<LIVE-...>' ORDER BY occurred_at DESC;

-- Optional prune (owner's decision; not run by the LMS):
-- DELETE FROM curriculum.teams_graph_failures WHERE occurred_at < now() - interval '365 days';
