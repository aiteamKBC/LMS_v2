# Curriculum learner assignment

The programme workspace has **Assign learners** on each cohort and module row.
The drawer searches names/emails and filters programme, company, programme status
and existing assignment. Individual selections survive filter changes. Select all
applies to matching, unassigned learners only; already assigned learners are disabled.

## Assignment rules

- Cohort assignment places the selected learners in that cohort and adds all its
  current live modules, including modules delivered through different groups.
  An existing group is retained only when it belongs to the same cohort. Otherwise
  the group is cleared; no group is selected automatically.
- Module assignment adds only the selected module and preserves learner placement.
- Both actions preserve other assigned modules and their stored content.
- Saved entries carry `assignmentMode: explicit`. Plan readers and subsequent
  edits preserve this marker so an explicit selection cannot inherit extra group
  modules. Older plans continue using their existing inheritance behavior.
- Module/week/component rosters include direct module assignments, including
  learners placed in another programme. Programme/cohort rosters remain based on
  placement. Delivery profiles are updated when they already exist; assignment
  does not activate an account or change learner/company details or dates.

## API

Staff-only GET and POST:

```text
/curriculum_api/curriculum/cohorts/{id}/learner-assignments/
/curriculum_api/curriculum/modules/{id}/learner-assignments/
```

GET returns target details, learner filter fields, existing assignment and totals.
POST accepts `{ "learnerIds": ["1", "2"] }` and adds those learners. It never
removes learners omitted from the request. Writes lock the selected learner rows
and use one transaction for source plans and existing delivery mirrors. Repeated
assignment is idempotent. No schema migration is needed.

## Verification

```powershell
# From backend, using isolated SQLite test databases:
.\.venv\Scripts\python.exe manage.py test curriculum_api.tests_learner_assignments learner_api.tests_learning_plan_mirror learner_api.tests_learning_plan_programmes learner_api.tests_module_propagation --settings=config.settings_sqlite_test --noinput

# From frontend:
npm test -- src/pages/curriculum/shared/entities/__tests__/learnerAssignmentDrawer.test.tsx src/pages/curriculum/programme-detail/__tests__/programmeWorkspace.test.tsx --maxWorkers=2
npm run build
```
