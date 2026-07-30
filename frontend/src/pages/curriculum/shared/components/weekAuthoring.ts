// Neutral re-export point for the week-authoring UI that both builders share:
// the sortable component rail, the per-component editor and the week overview
// panel. The three components genuinely belong to both pages — a week must look
// and behave identically in the week builder and inside the module builder's
// accordion — so they are shared deliberately, not by accident.
//
// Why this module exists: the components live in week-builder/page.tsx, which
// also carries @dnd-kit, the RichTextEditor and the rest of that 2,284-line page
// (~159 kB in one chunk). A direct `module-builder/page -> week-builder/page`
// import therefore made Module Builder download all of it eagerly, and created a
// page <-> page import cycle (week-builder/page imports back from
// module-builder/componentAuthoringModel).
//
// Routing both builders through this module gives the bundler one neutral edge to
// split on and keeps the page files from naming each other. Consumers that only
// need these components when a week is expanded should import the lazy wrappers
// in ./weekAuthoringLazy instead.
export {
  ComponentEditor,
  WeekComponentRail,
  WeekOverviewPanel,
} from '@/pages/curriculum/week-builder/page';

export type {
  GroupOption,
  WeekComponentRailProps,
  WeekComponentUploader,
  WeekScope,
} from '@/pages/curriculum/week-builder/page';
