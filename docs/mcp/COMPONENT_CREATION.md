# Create draft components through MCP

Implemented tool: `create_curriculum_component`. It creates one component after preview/confirmation,
through the existing authenticated component API. This capability is independently default-off:
`MCP_COMPONENT_CREATION_ENABLED=1`. No schema change or separate MCP worker is needed.

## Scope

The programme, saved draft module and week must already exist. Lookup tools supply their ids.
Types are restricted to `video`, `podcast`, `reading`, `powerpoint`, `quiz`, `assignment`, `reflection`,
`checkpoint`, `monthly-ksb-quiz` and `coaching-preparation`. Live Teams sessions, recording placeholders,
retired workplace evidence, publishing and creating parents are excluded.

This creates a typed draft container with backend settings defaults and the Module Builder's hours,
points and validation flags. Optional `expected_otjh`, `points` and Markdown `description` can be supplied.
It does not add quiz questions, KSB mappings or media. The video tool can upload an MP4 separately.
Other content-authoring/upload tools remain future work.

The server checks programme membership by id and uses uncached module reads. The confirmed payload
contains the exact component defaults and destination. Changes to those require a new preview.
At apply, PostgreSQL row locks keep the existing module/week present while the normal API saves;
the API's legacy missing-parent fallback cannot provision parents through this tool. Unsupported
databases without row locking refuse the apply. No business data is written with raw SQL.

Same-title components (case and whitespace ignored) in the selected week are refused with the existing id.
Two MCP previews for the same title cannot both create it. This is an MCP guard, not a new database-wide
title uniqueness constraint for other editors. Reapplying a successful preview returns its original result.
An uncertain outcome is closed against automatic retries; inspect that week before preparing another change.
Existing components, KSB mappings, Teams settings and learner records are not sent in the create payload.

## Local MCP Inspector test

Use the previously verified local backend configuration and the same authenticated Inspector connection.
Identify the actual database before starting the server; this workflow writes a real draft component if
the local backend uses a real database. Do not run automated regression tests against that database.

1. In the backend terminal, add this process-only setting, then restart the backend:

   ```powershell
   $env:MCP_COMPONENT_CREATION_ENABLED="1"
   .\.venv\Scripts\python.exe manage.py runserver localhost:8000 --noreload
   ```

   Keep the other MCP/OAuth settings from the existing local setup. For the later MP4 step also keep
   `MCP_VIDEO_UPLOADS_ENABLED=1` and the existing configured Bunny/storage integration.

2. Refresh the Inspector tools list. Use `find_programmes`, `find_modules` and `get_module_structure`
   to obtain a real programme id, saved draft module id and week id. Do not invent these values.
3. Call `create_curriculum_component` with the following, replacing every `ACTUAL_...` value:

   ```json
   {
     "programme_id": "ACTUAL_PROGRAMME_ID",
     "module_id": "ACTUAL_DRAFT_MODULE_ID",
     "week_id": "ACTUAL_WEEK_ID",
     "type": "video",
     "title": "Inspector MP4 Test"
   }
   ```

4. Inspect the preview. No curriculum component has been created yet. After confirming its destination
   and defaults, call `apply_change` with the returned `preview_id`.
5. Copy `result.component_id` from the apply result. Refresh the module in the LMS and verify that the
   Video component appears in the selected week, with neighbouring content unchanged.
6. Use this component id with `save_curriculum_video`; confirm/apply that separate upload preview, then
   use `get_video_import_status`. Inspector needs a real downloadable HTTPS MP4 reference, not a device
   path. The existing upload/import services are reused.
7. Repeat the same creation `apply_change` call: it should report `already_applied` with the same component id.
   Preparing a second creation with the same title in the same week should refuse and name that existing id.

When Bunny is enabled, the existing component-save wrapper can wake the shared Bunny import worker,
even though a new empty draft has no MP4 to import. As with video uploads, inspect the shared import queue
before live testing; unrelated queued imports may be processed. No live Teams action is required.

## Automated validation

Run only with the repository's verified SQLite-only settings and isolated cache:

```powershell
cd backend
.\.venv\Scripts\python.exe manage.py test mcp_api login.tests_api_gate curriculum_api.test_bunny_stream --settings=config.settings_sqlite_test --noinput
```

Component regressions cover all ten types, current Module Builder defaults, actual component API/service
payloads with fake storage, zero-hour videos, scope/flag/role refusals, duplicate/stale previews, parent-lock
checks, replay and the create-to-MP4 handoff. They do not prove live PostgreSQL concurrency, client file
handoff, external storage or Bunny encoding. No Teams implementation file is changed by this feature.
