-- Coach validation on an authored component: whether a coach has to sign the
-- component off before it counts. It sits beside `tutor_validation_required` in
-- the module builder's component details, but unlike that one it is on for every
-- component -- the builder makes an author confirm a sweet alert before turning
-- it off.
--
-- Hence `default true`, and hence every existing row coming back validated: a
-- component authored before this column existed was never deliberately exempted.
--
-- Safe to re-run.
alter table curriculum."components"
  add column if not exists coach_validation_required boolean not null default true;

-- Reusable week templates author the same component in the same editor, so the
-- flag has to survive a save there too -- otherwise placing from a template
-- silently puts coach validation back on.
alter table curriculum."week_template_components"
  add column if not exists coach_validation_required boolean not null default true;
