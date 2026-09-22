-- A curriculum author's note for a week whose delivery day falls on a holiday.
--
-- The notice itself ("this week falls on a holiday") is derived and always
-- shown to the author. What a learner should DO about it is not derivable --
-- "no session, use the time to finish Assignment 2" is a decision, not a fact --
-- so it is authored on the week, and only the curriculum team can write it.
--
-- Two columns, deliberately: holiday_note_enabled is the publish switch and
-- holiday_note is the text. Keeping them apart lets an author turn the hint off
-- without losing what they wrote, and makes "written but not published" the
-- default for every existing row -- nothing becomes visible to a learner
-- because this ran.
--
-- The learner side additionally requires the week to actually clash (see
-- attach_curriculum_slots), so a note left behind on a week whose dates moved
-- off the holiday publishes nothing.
alter table curriculum."weeks"
  add column if not exists holiday_note_enabled boolean not null default false;
alter table curriculum."weeks"
  add column if not exists holiday_note text not null default '';
