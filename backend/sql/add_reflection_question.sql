-- Reflection question: the text an author writes for a component whose
-- "Reflection required" toggle is on.
--
-- curriculum.components."Reflection_Question" already exists (added by hand on
-- 2026-08-26) -- the statement below is here only so a fresh database matches,
-- and is a no-op against Neon.
alter table curriculum.components
  add column if not exists "Reflection_Question" text;

-- Week templates are authored through the same component editor, so a template
-- has to be able to hold a question too. This one is NOT in Neon yet.
-- Until it is applied the question still round-trips for templates, but only
-- through the legacy settings_json.reflectionPrompt key.
alter table curriculum.week_template_components
  add column if not exists reflection_question text;
