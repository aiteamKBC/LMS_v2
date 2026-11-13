# MCP video operations and pilot checklist

This guide describes the implemented server code. It is not evidence of deployment or a live ChatGPT/Bunny transfer.

## What runs where

- MCP/OAuth HTTP endpoints run inside the existing Django backend. No separate MCP worker is required.
- The existing `process_curriculum_videos --watch` worker performs queued Bunny transfers independently.
- ChatGPT desktop/web supplies a file reference. The MCP server never reads a path on the manager's device.
- The video track saves into existing video components in draft modules. The separately gated
  `create_curriculum_component` tool can create a typed draft component inside an existing module/week.
  Modules and weeks must already exist, and publishing stays in the LMS. Every save uses preview,
  confirmation and `apply_change`.

## Configuration

Set deployment configuration through the established secret/configuration mechanism, not committed `.env` files.

| Setting | Purpose |
| --- | --- |
| `MCP_ENABLED` | Default off. Gates MCP and OAuth endpoints. |
| `MCP_VIDEO_UPLOADS_ENABLED` | Default off. Independently gates video proposal, apply and status. |
| `MCP_COMPONENT_CREATION_ENABLED` | Default off. Allows preview/apply of the ten supported non-Teams draft component types, in existing modules/weeks only. |
| `MCP_QUIZ_CREATION_ENABLED` | Default off. Allows `create_quiz_draft`: a draft quiz with questions, linked to an existing quiz component, plus KSB mappings. |
| `MCP_CONTENT_EDITING_ENABLED` | Default off. Allows `map_ksbs` (add/change KSB mappings) and `add_lesson_content` (Reading lesson text) on existing components of draft modules. |
| `MCP_PUBLIC_BASE_URL` | Public HTTPS origin, without `/mcp` or a trailing slash. |
| `MCP_PILOT_ACCOUNT_IDS` | Comma-separated permitted account ids. Also requires the existing staff/curriculum grant. Configure a restricted list for the pilot. |
| `MCP_ALLOWED_REDIRECT_HOSTS` | Allowed OAuth callback hosts for the intended clients. |
| `MCP_ALLOWED_ORIGINS` | Explicit browser origins, if needed by the intended client. |
| `BUNNY_STREAM_ENABLED` | Existing Bunny integration must be configured/enabled for video operations. |
| Existing Bunny/storage secrets | Remain on the backend; do not paste them into ChatGPT. |

Prerequisites: the four existing MCP OAuth/pending-change tables and existing curriculum video-import schema
must exist in the verified target. This change requires no additional table or migration. Apply missing
prerequisites only through the repository's reviewed database/deployment process.

## Routing and startup

1. Review/merge to main and deploy using AGENTS.md and the actual environment's established pipeline.
2. Forward `/mcp`, `/mcp/`, `/oauth/*`, `/.well-known/oauth-authorization-server`, and the root/path forms of
   `/.well-known/oauth-protected-resource` (including `/mcp` and `/mcp/` suffixes) to Django, not the frontend SPA.
3. Disable intermediary caching on MCP and OAuth action endpoints. Verify metadata URLs and the bearer challenge
   from outside the host; receiving a frontend HTML page is a routing failure.
4. Restart/roll the existing backend service. Confirm durable upload storage is shared by the backend and video
   worker, and that the existing video worker is supervised and restarts after host/container replacement.
5. Schedule `python manage.py mcp_cleanup` through the environment's established periodic-job mechanism, after
   verifying the database and storage targets. The command deletes expired private stages and old MCP journal rows.
   `--dry-run` reports counts without deleting files/rows. No scheduler is installed by this change.
6. Refresh the custom MCP connection's tool metadata and start a new chat after deploying the new tools.

## File handoff

`save_curriculum_video` advertises `_meta["openai/fileParams"] = ["file"]`. Its file field requires a
downloadable HTTPS `download_url` and `file_id`, with optional `file_name`/`mime_type`. It validates real MP4
bytes and the 300 MB limit. It refuses local paths, private network destinations, invalid media and unsafe ids.

Device access in a ChatGPT session does not prove it can populate this field. Test a synthetic MP4 in both the
manager's intended desktop and web clients. If either client cannot transfer a file reference, record that
limitation; do not invent a download URL or claim that the server can read their device. A public multipart
upload-ingest endpoint or a new local helper is not implemented here.

Private staging is recorded in closed internal pending-change rows before storage. User previews expire after
15 minutes; the fallback staging ledger expires after one day. Cleanup only deletes paths under that row's
account-specific `mcp_video_staging` prefix. The stable LMS playback file is retained after Bunny copying.

## Check results and recover failures

- A preview has not changed curriculum content. Check its programme/module/week/component and file details.
- Applying the same preview twice returns the stored result and performs no second upload.
- Changed programme/group/week/source state or changed staged bytes require a new preview.
- `lms_saved` after apply confirms the upload endpoint returned saved source settings; it does not mean Bunny
  encoding is finished. Use `get_video_import_status` for the latest import state.
- Status reports `lms_source_recorded` from the saved source reference; it is not an independent blob/playback check.
- `source_changed` means the latest import belongs to an older source. Never present that copy as the current video.
- An `unknown` apply outcome may have saved the file. Verify the component and import status before preparing another
  upload. Automatic repeated applies are refused after that attempt.
- Storage/transfer failures remain failures. Use the established LMS/Bunny retry workflow after checking the actual state.

## Access, revocation and rollback

- The pilot list and curriculum grant are rechecked at consent, token refresh and bearer use.
- Review the participating accounts' direct Neon SQL-write access separately. MCP validation cannot constrain writes
  made through a different connector. No Neon credentials or permissions are changed by this implementation.
- Existing OAuth revocation disconnects the relevant token family. The planned super-admin token-management UI and
  bulk account-revocation controls are not implemented by this video change.
- A suspension related to a compromise needs a password reset before the account is restored. Restore alone does
  not revoke every previously unused MCP token (see the accepted Step 11 follow-up).
- To stop new video operations, disable `MCP_VIDEO_UPLOADS_ENABLED`; to stop MCP/OAuth completely, disable
  `MCP_ENABLED` and roll/restart the service so the intended deployment settings take effect. This does not cancel
  jobs already queued for the existing Bunny worker.
- Preserve OAuth/pending journals, stored LMS files, import records and learner history during rollback. Roll back
  reviewed application code using the established procedure; do not delete playback files to undo a deployment.

## Acceptance evidence still required

- A verified pilot database/storage target, deployed commit and healthy worker.
- Actual desktop and web file handoff and a separately authorised Bunny transfer/playback check.
- Restricted pilot-account configuration and confirmation that other accounts are refused.
- Direct-write bypass review and the remaining Step 11/12 operational/security acceptance checks.

Automated tests use SQLite-only settings, in-memory database fakes, private temporary test files and mocked
HTTP/storage/Bunny calls. They do not prove a production deployment or a real ChatGPT file transfer.

## Live modules: warning, not a block

Authored modules have no draft/published state. `curriculum.modules` has no status column, so the structure
read always reports `status: "draft"`, and the tools' "draft module" check does not separate live modules
from unused ones.

Instead, every write preview counts the learners who have the module on their training plan
(`Learner.learner_training_plan_modules.module_ref`). This is a count only; no learner is named.

- **Learners found.** The preview warns: "LIVE MODULE: N learner(s) have this module on their training
  plan…". The write is still allowed after confirmation. This is the owner's decision, made on 2026-11-11.
- **Count unreadable.** The warning says to treat the module as live.
- **Not counted.** Learners with progress records only, and no plan entry, are not counted. The progress
  table (~284k rows) has no index that starts with `module_ref`.

## File uploads and component edits (2026-11-11)

| Setting | Purpose |
| --- | --- |
| `MCP_FILE_UPLOADS_ENABLED` | Default off. Allows `save_component_file`: reading, PowerPoint and podcast files uploaded into existing components. |

**`save_component_file`**
- **Input.** The file comes either attached in the chat (a ChatGPT file reference) or as a pasted public link.
  Google Drive and SharePoint share links are converted to download links.
- **Checks.** The file must use an extension the LMS allows for that component type
  (`COMPONENT_UPLOAD_EXTENSIONS`) and have the matching file signature. Web pages are refused. The limit
  is 300 MB.
- **Staging.** At preview the file is staged privately under `mcp_file_staging/<account>/`. `mcp_cleanup` also
  removes expired file stages.
- **Upload.** Apply uploads the file through `POST curriculum/components/<id>/upload/`. It then points the
  component at the file with a revision-checked component PATCH, and reads the result back.
- **LMS bug found (reported, not fixed).** `_update_component_upload_settings` writes a `settings` key, but the
  column is `settings_json`. `authoring_upsert` drops the unknown key, so the upload endpoint never attaches
  the file itself, yet still reports `savedToComponent: true`.
- **Failed attach.** If the attach fails after the upload, the database rolls back, but the stored file stays
  in upload storage with nothing pointing at it.

**`update_component`**
- It changes a component's title, description, expected OTJH or points, and only the fields given. It
  refuses HTML and refuses a title already used by another component in the same week.

**Every MCP component PATCH also sends `duration`.** The LMS PATCH rebuilds `settings.durationMinutes` from
`duration`. When `durationMinutes` is 0, that value reads as expected hours × 60, so without `duration` a
single-field edit would silently set the component's duration (for example, to 120 minutes).

## Structure creation and admin controls (2026-11-11)

| Setting | Purpose |
| --- | --- |
| `MCP_STRUCTURE_CREATION_ENABLED` | Default off. Allows `create_programme`, `create_cohort`, `create_group` and `create_module` (Step 10). |

**Super-admin connection controls (Step 11.2)**
- These are not gated by `MCP_ENABLED`; they work even when it is off.
- They use the session cookie with CSRF, and only super-admins get in.
- There is no screen yet; call them from the browser console or a script while signed in.

| Request | What it does |
| --- | --- |
| `GET /oauth/admin/tokens?account_id=<id>` | Lists live connections: account, client, when connected and last used, expiry. |
| `POST /oauth/admin/revoke` `{"account_id": n}` | Revokes every MCP connection of that account. |
| `POST /oauth/admin/revoke` `{"family_id": "<uuid>"}` | Revokes one connection. |
| `POST /oauth/admin/clients/<client_id>/disable` | Disables the client and revokes its tokens. |

After restoring a suspended account, revoke all of its connections. This closes the suspend → restore gap from
the Step 3 review.
