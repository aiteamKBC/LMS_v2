# Compact Gantt trial — 12 September 2026

The learner's module timeline keeps all modules that overlap the chosen year, including undated modules. It uses 52px rows, sticky month headings and module labels, and a sticky coaching-review row. Progress fills and colours indicate activity status. Module names open the module; timeline bars open an adjacent details panel. The panel includes dates, activity progress, recorded hours, staff and available sessions.

`Today` brings the current month into view; `Current module` selects an unfinished module scheduled today. `Full screen` expands the same chart using the existing accessible modal and preserves its scroll position. On narrow screens the details panel temporarily fills the chart area; closing it restores the chart. Closing current-module details reveals that module's row and the current month.

There is no module pagination, month-based module filtering, quarter zoom or replacement card view. Month selection still updates the training-plan cards. Clicking a bar keeps the page at the timeline instead of scrolling to those cards.

## Scoped undo

The exact pre-trial files are saved outside the repository at:

`C:\Users\LENOVO\AppData\Local\Temp\lms-gantt-before-compact-20260912-060804`

Original files in that directory come from `frontend/src/pages/learner/training-plan-timeline/`:

- `ModuleTimeline.tsx`
- `ModuleTimeline.module.css`
- `TrainingPlanDetails.tsx`
- `page.test.tsx`
- `loading.test.tsx`

The `after` subdirectory records the corresponding completed trial files. For a later undo, compare current files with these snapshots and reverse only the trial's changes. Do not restore an entire file if it contains later edits. In `TrainingPlanDetails.tsx`, the only trial change is the callback passed to `ModuleTimeline`: restore `onModuleSelect={selectModule}`.

New files belonging to this trial:

- `frontend/src/pages/learner/training-plan-timeline/TimelineInspector.tsx`
- `frontend/src/pages/learner/training-plan-timeline/ModuleTimeline.test.tsx`
- `frontend/scripts/gantt-compact-smoke.mjs`
- `docs/gantt-compact-trial.md`

Keep other existing training-plan, Monthly Logs and backend work. Several timeline files were already untracked or modified before this trial; Git HEAD is not its rollback baseline.

## Verification

- Timeline and learner workspace suites: 70 tests passed.
- Scoped ESLint passed for the timeline and inspector components.
- Frontend production build passed.
- `node scripts/gantt-compact-smoke.mjs` passed against the local Vite server using synthetic data and blocked API requests. It checks 36 retained rows, row height, sticky headings/reviews, inspector navigation, scroll preservation, full-screen Escape, and layouts at 1600, 1024, 768, 390 and 320px. It also checks that closing current-module details on mobile reveals the relevant row and month.

The smoke script creates and removes its own temporary preview entry. Browser checks use an isolated context and do not authenticate or change database data.
