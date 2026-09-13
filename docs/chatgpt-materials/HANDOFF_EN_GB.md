# Complete learning week: authoring, storage and LMS placement

Language: British English (`en-GB`). Prepared for the project owner and the manager's ChatGPT Work session. Reference date: 13 September 2026.

## Purpose of this file

Use these instructions to prepare a complete learning week and place its materials in the **specific LMS module or modules selected by the manager**. The required outcome is a correctly linked week that appears in Module Builder and is available to learners who have that module in their learning plan.

Produce reading material, presentation slides, audio, video where generation tools are available, a native LMS quiz, an assignment brief and rubric, and reflection prompts. Use British spelling and terminology throughout learner-facing material, including “programme”, “organisation”, “authorise” and “personalised”. Preserve API field names and database identifiers exactly, regardless of their spelling.

The operational copy at `backend/.env.chatgpt-materials.private` contains these instructions as comments alongside the actual database and Azure configuration values. It remains a valid environment file and is ignored by Git. Do not echo credentials in messages, logs, manifests, SQL deliverables, browser code or learner materials.

This is an instruction and configuration package. It does not create an integration, upload files, publish a week or assign learners by itself. `week-package.example.json` is a proposed handoff format, not an existing import endpoint's request body. Its example assets have not been generated.

## Required destination: select this before preparing an import

Ask the manager which programme and module will receive the week. Look up the available records and return their titles **and exact IDs** for selection. Do not select a module merely because its title resembles the subject. Use `inspect-target.sql` for read-only discovery.

Record the following for every destination:

| Manifest field | Required meaning |
| --- | --- |
| `target.selectionStatus` | Keep `unselected` until the actual destination is identified; use `verified` only after checking it |
| `target.mode` | `module_week` for a week in a learner module; `week_template` for a reusable template |
| `target.moduleAction` | `use_existing` by default; `create_new` only when the manager specifically requests a new module |
| `target.programmeId`, `target.programmeName` | The verified parent programme ID and its display name |
| `target.moduleCatalogueId`, `target.moduleTitle` | The canonical `curriculum.modules.module_catalogue_id` and exact module title |
| `target.cohortId`, `target.groupId` | The verified delivery context when applicable; these do not assign a module to learners by themselves |
| `target.weekAction` | `create_new` or `update_existing`; never infer replacement from a matching week number alone |
| `target.weekId`, `target.weekNumber` | A stable week ID and the intended position within the selected module |
| `target.weekTemplateId` | Required for template mode; template content requires a subsequent placement step to reach learners |

If the manager selects several modules, prepare **one placement manifest per module**. The same reviewed file may be reused, but each placement needs its own correctly linked week and component records. A single `curriculum.components` row has one `module_catalogue_id` and one `week_id`; do not reuse its ID to move it between modules.

For `create_new`, obtain the new module's title, programme, delivery context and intended learner assignment before preparing SQL. A new catalogue row is not automatically in anyone's learning plan. Do not silently create a new programme, cohort, group or learner assignment. Prepare any separately authorised assignment work for the owner; otherwise report it as outstanding.

Summarise the selected destination in this form before preparing an import:

```text
Programme: <verified name> [<programme_id>]
Module: <verified title> [<module_catalogue_id>]
Module action: use existing / create new
Cohort and group: <verified IDs, or not applicable>
Week: <title>, number <n> [<week_id>]
Week action: create new / update existing
Learner visibility: assignment verified / assignment required / template only
```

No actual programme or module has been selected in this handoff. Destination placeholders must not be treated as real IDs. Content drafting can proceed while the destination is being resolved; target-specific uploads and SQL must wait for verified placement.

## Stable IDs and relationships

1. Reuse existing programme and module IDs exactly. Do not substitute a programme name, module title, list index, display label or `training-module-...` alias for the canonical module catalogue ID.
2. For genuinely new records, allocate stable IDs once, using the application's conventions (`MOD-...`, `WEEK-...`, `COMP-...`, and `WTC-...` for template components), and check for collisions. Keep authoring IDs within their 128-character column limits. Do not regenerate them on retry.
3. Set `curriculum.weeks.module_catalogue_id` to the selected module ID.
4. For every module component, set `curriculum.components.module_catalogue_id` to that same module ID and `curriculum.components.week_id` to the selected week ID. Verify that the referenced week belongs to that module.
5. Map the manifest's component `settings` object to the SQL column **`settings_json`**. The SQL table does not have a `settings` column.
6. Create native quiz records using their actual database-generated numeric IDs. Connect each quiz to its component through `quiz_component_links`, set the appropriate module/week link in `quiz_course_links`, and keep `settings_json.linkedQuizId` consistent. Connect each answer to the actual question ID. Do not use example string IDs for numeric quiz/question/answer IDs.
7. For module reflections, keep `components."Reflection_Question"` and `settings_json.reflectionPrompt` consistent. In the verified template schema, use `settings_json.reflectionPrompt`; do not assume a separate reflection-question column exists there.
8. Use verified KSB IDs and valid classification/weight metadata. Preserve existing links and learner assessment history when updating content.
9. Maintain a placement map containing `packageId`, version, programme ID, module ID, week ID, component IDs, quiz IDs, question/answer IDs where relevant, asset checksums, blob names and LMS URLs.
10. A retry must verify the existing record and checksum before reusing it. An existing ID with different ownership or unexpected content is a conflict, not permission to overwrite it. The proposed manifest has no automatic idempotency support in the current application.

The required relationship is:

```text
Selected programme
  -> selected module_catalogue_id already assigned to the intended learners
     -> weeks.id, with weeks.module_catalogue_id = selected module
        -> components.id, with components.week_id = selected week
           and components.module_catalogue_id = selected module
           -> settings_json links to files and/or a real linked quiz
```

## What makes the week appear to learners

The current learner code resolves the weeks and components from the master `curriculum` tables using the **module IDs already assigned in each learner's structured training plan**. Adding a complete week under one of those exact module IDs allows the learner view to pick up its new content on a subsequent successful load, subject to access rules and caches.

An ID alone is not sufficient. Verify all of the following:

- The target module is assigned to the intended learners; the module's programme/group labels alone do not prove assignment.
- The module, week and components have the correct ownership relationships and are not accidentally deleted or detached into the reuse library. Do not alter deletion flags to bypass access rules.
- Learner access and programme-start requirements are satisfied.
- The backend's default database and the learner `enrolment` connection read the intended curriculum data. Different environment overrides can point them at different databases.
- All required assets exist, quiz links resolve, and the relevant curriculum caches have been refreshed.
- The actual learner page displays and opens the week. For legacy plans without module IDs, do not promise automatic propagation; the existing compatibility path must be checked separately.

Do not copy weeks or components into every learner snapshot as a guessed “backfill”. Do not write into learner progress, answers or enrolment records merely to make content appear. A Week Template is reusable authoring content; it is not automatically assigned learning.

`contentStatus: "Draft"` alone is not a reliable visibility barrier for content attached to a live learner module. Keep incomplete content in the handoff or a suitable authoring template until the complete placement is ready.

## Connection settings and actual values

The private operational file contains actual values copied from `backend/.env`, plus clearly labelled derived connection fields. No new credentials or permission grants have been created.

| Setting | Purpose |
| --- | --- |
| `Database_url` / `DATABASE_URL` | The selected PostgreSQL connection string, including the credentials and connection options |
| `ENROLMENT_DATABASE_URL` | The configured or resolved learner-database connection; compare it with the authoring connection |
| `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, `PGPASSWORD`, `PGSSLMODE`, `PGCHANNELBINDING` | Convenience values derived from the selected connection string; the complete URI remains authoritative |
| `AZURE_STORAGE_ACCOUNT`, `AZURE_STORAGE_KEY` | Account and key used by the current curriculum storage helper |
| `AZURE_CURRICULUM_CONTAINER` | Curriculum container; the code default is `curriculum-uploads` |
| `AZURE_STORAGE_CONNECTION_STRING` | Existing optional Azure SDK connection string, if present; the current curriculum helper uses account and key |
| `AZURE_BLOB_SERVICE_URL` | Derived Blob service endpoint for the selected storage account |
| `LMS_BASE_URL` | Configured front-end origin when available; its deployed reachability still needs verification |
| `TARGET_*`, `PACKAGE_ID` | Proposed handoff controls; these are not new Django settings or database columns |

For the authoring database, Django selects `DATABASE_URL`, then `DATABASEURL`, then `Database_url`. Its learner connection selects `ENROLMENT_DATABASE_URL`, then `Database_url`, then `DATABASEURL`, then `DATABASE_URL`. Process environment overrides may differ from the local file.

The database connection URI is the credential needed for PostgreSQL. A Neon management API key is a different credential and is not required to insert content into existing PostgreSQL tables. No guessed Neon API key, LMS bearer token or OpenAI generation key is supplied.

The curriculum API currently uses a staff session. The existing `KBC_LMS_API_KEY` is used for legacy-service requests and is not established as authentication for curriculum uploads. Configure an authorised service connection rather than inventing a bearer-token header.

## Tables used for this work

The companion `schema-reference.json` contains the previously verified columns, defaults and constraints for these 15 tables. Recheck the live schema before preparing final SQL if the application has changed.

| Table in `curriculum` | Responsibility |
| --- | --- |
| `programmes` | Parent programme |
| `modules` | Canonical module catalogue record and delivery context |
| `weeks` | Actual module week, outcomes and order |
| `components` | Actual learning items, stable links and `settings_json` |
| `week_templates`, `week_template_components` | Reusable authoring templates, separate from learner placement |
| `ksb_mappings` | Programme/module/week/component KSB mappings |
| `quizzes`, `quiz_questions`, `quiz_answers` | Native quiz definitions, questions, choices and answer keys |
| `quiz_component_links`, `quiz_course_links` | Quiz placement in the component and module/week |
| `free_courses`, `free_course_weeks`, `free_programme_components` | Separate free-course path; use only when that destination is selected |

Do not use `programme_audit.assets` for a new teaching week or put authoring records into learner answer/progress tables.

## Files, storage paths and display

For module materials, the established storage mapping is:

```text
Container: curriculum-uploads (or the actual configured value)
Blob:      <moduleCatalogueId>/<componentId>/<unique-versioned-file-name.ext>
LMS URL:   /curriculum_api/curriculum/uploads/<moduleCatalogueId>/<componentId>/<unique-versioned-file-name.ext>
Local:     MEDIA_ROOT/curriculum_component_uploads/<moduleCatalogueId>/<componentId>/<unique-versioned-file-name.ext>
```

Do not put `curriculum_component_uploads/` at the start of the Azure blob name. Week Template uploads currently use `week-template/<componentId>/<filename>`. Reuse stable database IDs when updating an item but give changed file bytes a new versioned blob name: local cached files are read first, so overwriting a blob at the same path may leave an old local copy in use.

Save the stable LMS URL in `settings_json`, without storage keys or expiring SAS tokens. The backend streams the private Azure file through the LMS route. The deployment must serve `/curriculum_api/` through the LMS origin and preserve the relevant authentication and framing behaviour.

| Component type | Important settings | Intended learner display |
| --- | --- | --- |
| `reading` | `readingSource`, `readingContent`, `resourceUrl` | Clean inline reading and/or a PDF/document viewer |
| `powerpoint` | `presentationUrl`, `fileName`, `speakerNotes` | Slides, with a PDF fallback in the asset inventory |
| `podcast` | `podcastSource`, `podcastUrl`, `transcript` | Audio player plus transcript |
| `video` | `sourceType`, `videoUrl`, `durationMinutes` | Video player; uploaded video needs a supported ingestion route |
| `quiz` | `buildMode`, `linkedQuizId`, `passMarkPercentage`, `attemptsAllowed` | Native LMS quiz with actual question and answer records |
| `assignment` | `assignmentBrief`, `assignmentFileUrl`, `submissionInstructions`, `markingRubric` | Assignment and existing submission flow |
| `reflection` | `reflectionPrompt`, `minimumWordCount`, `learnerGuidance` | Reflection and existing review flow |

File-backed items also need `uploadedFileName`, `uploadedFileUrl`, `uploadedFileSize`, `uploadedFileContentType` and `uploadSource` where the existing settings contract expects them. Keep `expected_otjh`, ordering, validation requirements and points explicit and consistent with the learning plan.

Use the existing viewer appropriate to each type. A whole week in one iframe does not supply native per-activity tracking or quiz marking. HTML reading is content, not a mechanism for executing arbitrary JavaScript. Interactive HTML packages require a separately designed hosting and isolation route. Real live-session links must come from the authorised scheduling workflow; do not invent Teams URLs.

## Current implementation limits

- The existing upload limit is `300 * 1024 * 1024` bytes, displayed as 300 MB.
- Reading and assignment uploads accept `.txt`, `.doc`, `.docx`, `.pdf`, `.rtf`, `.odt`. PowerPoint accepts `.ppt`, `.pptx`, `.pps`, `.ppsx`, `.pdf`. Podcast accepts `.mp3`, `.m4a`, `.mp4`, `.wav`, `.aac`, `.ogg`, `.oga`, `.webm`.
- The current curriculum uploader does not accept the `video` component type or standalone HTML packages. Do not mislabel video as a podcast to bypass it. If tools cannot generate a real media asset, deliver its script and report the asset as missing.
- `POST /curriculum_api/curriculum/components/<id>/upload/` accepts multipart `file`, `componentType` and `moduleCatalogueId`. The reviewed `update_component_upload_settings` helper writes `settings` although the table column is `settings_json`; do not treat `savedToComponent: true` as proof that the link persisted. Verify the actual saved column. This handoff does not repair the helper.
- `POST /curriculum_api/curriculum/week-components/<id>/upload/` stores the file and returns metadata; it does not persist the template component settings.
- Saving a template's component list currently replaces that list. A partial list can remove unrelated content. Module structure updates also require care to preserve the rest of the structure.
- `backfill_uploads_from_azure` warms the local file cache. It does not create weeks, register material, assign learners or replace the placement process.
- Manual SQL bypasses application validation, version history and cache invalidation. The final change package must account for these explicitly. Some curriculum caches last 1,800 seconds; a browser refresh alone does not invalidate them. Use a reviewed curriculum-specific cache refresh, covering shared cache and workers, rather than a global Redis flush.

## Required delivery workflow

1. Resolve the destination and record the exact IDs and whether the target is an existing module, a new module or a template.
2. Produce the complete week in British English and a manifest containing stable IDs, component order, learning time and file references. Keep quiz answer keys separate from learner-visible reading.
3. Review outcomes, subject accuracy, KSB mappings, quiz answers, accessibility, transcripts/captions and the assignment rubric. Record each real file's MIME type, size and SHA-256.
4. Upload verified files through an authorised connection using unique versioned paths. Record the returned blob names and stable LMS URLs. Resolve every `asset://...` reference before preparing database content.
5. Prepare exact SQL using the verified destination IDs and file URLs. Include relationship/conflict checks and the complete week, components, quiz records and links in a transaction. Do not overwrite an unrelated record on an ID conflict. Include the required validation/version-history treatment and read-only verification queries.
6. The project owner reviews and executes the SQL in Neon SQL Editor. Follow repository `AGENTS.md`: the agent must not run database-changing SQL, write through application APIs, create/run migrations, commit, push/pull, or open/update pull requests.
7. After the owner's changes and the reviewed cache refresh, verify Module Builder and an authorised learner's view. Do not invoke a seemingly read-only application route without checking for incidental database writes; some learner GET handlers refresh stored snapshots.
8. Verify the week title, order, outcomes, every material, quiz launch/questions, assignment and reflection flow. Confirm an unassigned learner is not granted access. Any test that submits answers or changes progress must be performed by the owner through an authorised workflow, not by this agent.
9. Return a placement report listing every module/week/component/quiz ID, file URL and verification result. Clearly label anything awaiting upload, SQL execution, assignment, cache refresh or learner verification. Only claim the week is live after actual confirmation.

No target-specific INSERT/UPDATE SQL is supplied yet because the manager has not selected a destination or supplied a final week. A complete automatic publishing integration remains future work and must respect or explicitly change the repository's database-write policy.

## Companion files and implementation evidence

- `week-package.example.json`: proposed manifest and sample component structures.
- `inspect-target.sql`: read-only module discovery and placement checks.
- `schema-reference.json`: database catalogue snapshot, containing no learner data or credentials.
- `.env.example`: configuration names without real secrets.
- `backend/.env.chatgpt-materials.private`: operational copy, including these instructions and actual configuration values.
- `backend/curriculum_api/views.py` and `upload_storage.py`: IDs, authoring settings, uploads and caching.
- `backend/learner_api/learner_detail.py`, especially `_resolve_from_master`: live content resolution for assigned module IDs.
- `backend/learner_api/mappers.py` and `active_users.py`: learner-plan source and hydration.
- `backend/quiz_api/models.py` and `views.py`: quiz records and links.
- `backend/login/api_gate.py`: API authentication and role checks.

This handoff documents the reviewed behaviour. It does not claim that a full week has been uploaded or imported.
