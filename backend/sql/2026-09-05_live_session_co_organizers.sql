-- Co-organisers of a Teams live-session series. They are invited like anyone
-- else on the calendar event, but get the `coorganizer` role on the online
-- meeting, so they can start and manage the recording, admit people from the
-- lobby and change the meeting options without owning the calendar.
--
-- Safe to re-run. Existing series keep an empty list and behave exactly as now.
alter table curriculum."live_sessions"
  add column if not exists co_organizers jsonb not null default '[]'::jsonb;
