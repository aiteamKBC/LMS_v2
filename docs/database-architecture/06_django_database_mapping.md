# Django, API and integration compatibility

Scope: static repository analysis compared with the verified branch catalog. No application imports, startup, schema setup or backend/browser tests. [Provenance](evidence/audit_provenance.json).

## Coverage and artifacts

Indexed **4,043 tracked source files**, **132 model definitions** including three abstract definitions, **1,703 explicit/inherited field records**, **144 repository migrations**, and **854 URL definitions**. Python parsing reported no syntax errors. Dependency/build directories, files above 4 MB and pattern scanning of lines above 4,000 characters were excluded. Models were extracted from model-named modules; dynamically defined models and other locations may need follow-up.

- [Every-table dependency matrix](evidence/dependency_matrix.csv): table → model → source/service references → endpoint-function candidates → feature/application.
- [Detailed references](evidence/table_code_references.csv), [models](evidence/django_models.csv), [fields](evidence/django_fields.csv), [routes](evidence/api_routes.csv).
- [Migration reconciliation](evidence/migration_reconciliation.csv), [raw declaration differences](evidence/orm_database_differences.csv), [reviewed dispositions](evidence/reviewed_dispositions.csv).

The matrix covers all 595 local tables but is not a complete runtime call graph. Module-level URLconf associations are candidates; direct function-name matches need import/call-path confirmation. Dynamic SQL and external consumers remain unresolved. A table without code references is not proven unused.

## Connections and migration ownership

`backend/config/settings.py:615` resolves the default connection; enrolment, audit, audit_clone and kbc_attendance have separate alias rules. This audit used none of those connection settings. `backend/learner_api/routers.py:11` routes learner/enrolment/login models to enrolment and blocks normal migrations for specified externally owned aliases, with a narrow explicit migration hint.

Most mapped models are unmanaged. Django `managed=False` controls table lifecycle; it does not make ORM operations read-only. Writer permissions, routing and ownership remain separate. [Django Meta documentation](https://docs.djangoproject.com/en/6.0/ref/models/options/).

Raw SQL, management commands and runtime `ensure_*` helpers coexist. Examples: wizard schema generation (`backend/enrolment_api/wizard_layout.py:486`) and actual-hours setup (`backend/audit_api/actual_hours/tables.py:159`). Dynamic-form schema generation can be intentional. Do not remove it without tracing its product contract; establish one reviewed migration/writer authority per object.

## Reviewed declaration differences

Raw comparison found **171 nullability differences**, **58 type differences**, **seven absent table mappings**, and **four explicit missing fields** on a guarded legacy model. These are not 240 confirmed application failures. Views may expose nullable catalog metadata over NOT NULL base columns; alias and conditional availability matter.

18 chat/coach `_table_name(test_name, production_name)` mappings were resolved by reading the helper and choosing its non-SQLite branch without importing settings.

| Case | Assessment | Preserve |
| --- | --- | --- |
| `Coach.coach_calendar_event` | Compatibility view over Learner base table | View name, writable contract and base unique indexes |
| `Learner.learners.email` | Generated normalized-email uniqueness | Login normalization and identity ownership |
| `Learner.learner_ksbs` | Legacy shape differs; column guard exists | Canonical KSB graph and guarded fallback |
| Migration `0020_progress_soft_archive_state` | Not recorded; physical column exists | Existing data and correct state-only semantics |

Absent mappings: `programme_audit.assets`, `curriculum.module_authoring_advanced_details`, `Feedback.feedback_external_campaigns`, `Feedback.feedback_external_recipients`, `Learner.Active_users`, `Learner.Unactive_users`, and `Learner.Absence`. Determine optionality, routing and actual consumers before treating any as a deployment defect or creating tables.

`LearnerKsb` explicitly expects `position`, `number`, `ksb_type`, and `description`, absent from the physical table. Its implicit Django `id` is also absent; the real table has a composite PK. The existing guard checks the complete required shape, so this is not permission to replace historical keys.

## Migration history

`public.django_migrations` has **209 records**. **143 of 144** repository migrations are recorded; framework/dependency records are not all source files in this repository. The missing entry is `learner_api.0020_progress_soft_archive_state`, using `SeparateDatabaseAndState(database_operations=[])`. Nullable `deleted_at timestamptz` already exists physically. Reconcile state through the intended reviewed workflow; do not add the column again or fake history. No migration was run.

## Compatibility matrix boundaries

Preserve permanent learner versus enrolment identity; commercial/apprenticeship distinctions; server-side role/ownership gates; omitted/null/cleared updates; UTC instants and business timezones; signed reviews, verified attendance, evidence and historical progress. Keep API response fields, status/error behavior and cache scoping unchanged unless a later task explicitly changes them.

External consumers include foreign attendance sources, audit aliases, sync/import commands, reporting schemas and other applications not represented here. Their owners and contracts are adoption prerequisites. Mock Graph, email and storage in routine tests. No Teams-listed file or imported behavior changed in this phase, so Teams tests are not required.
