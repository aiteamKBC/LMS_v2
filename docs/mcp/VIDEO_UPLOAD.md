# Device MP4 to LMS and Bunny through MCP

## Goal and current status

The manager finishes a video as an MP4 on their device, chooses an existing curriculum destination,
and asks ChatGPT to save it to the LMS. The LMS validates the request, retains a stable playback
source and queues the existing Bunny copy. Return the actual save and transfer states.

This track is implemented server-side behind `MCP_VIDEO_UPLOADS_ENABLED` (default off). It adds
`save_curriculum_video` and `get_video_import_status`, using the existing preview/apply framework.
The Step 6 safety fixes are included. Quiz/structure creation tools remain separate work and are not
prerequisites for this track. Deployment and actual desktop/web file handoff have not been verified.

## 1. Verify file transfer from the existing ChatGPT session

Confirmed input: an MP4 on the manager's device. The manager's existing ChatGPT session already
has access to device files. The manager uses both desktop Work/Codex and web ChatGPT. Reuse that
access; no separate watcher/helper is included in this track.

A server-hosted MCP does not receive the file merely because ChatGPT can read it. Verify the
actual ChatGPT experience and its transfer capability with one synthetic MP4:

- A client supporting ChatGPT file inputs can pass a file reference to an MCP tool declared with
  `_meta["openai/fileParams"]`; the server receives a downloadable file reference, not a device path.
- If the existing device-enabled client transfers files using an authenticated upload endpoint,
  use that capability to send the bytes and obtain an account-owned upload reference.
- The implemented tool accepts the standard file-reference object. Direct local-path arguments are
  refused. An independent public multipart-ingest endpoint is not part of this implementation.

Do not assume that a ChatGPT attachment, local path or conversation link is a downloadable video.
Prove receipt of one synthetic MP4 through each intended client before promising automatic transfer.
The live client-to-tool handoff is still unverified. File-input contract:
[OpenAI MCP tool metadata](https://developers.openai.com/plugins/reference#_meta-fields-on-tool-descriptor).

## 2. Reuse the existing LMS contracts

- Resolve programme, module and video component ids from existing records; never infer ownership
  from a matching display name. Refuse ambiguous or missing destinations.
- Use the authenticated LMS account and its current permissions. Do not accept an account id from
  the assistant as an authority to act for somebody else.
- The file-capable client supplies `{download_url, file_id, file_name?, mime_type?}`. The MCP tool
  retrieves HTTPS bytes with the existing public-address/redirect guards and stages them privately.
  File paths and download URLs are not returned in previews; download URLs are not retained in payloads.
- Enforce the existing 300 MB limit and validate the MP4 bytes, not just its name or MIME type.
- Staging ownership is journalled before durable storage using an internal, immediately closed
  `Mcp_pending_changes` record (`__video_upload_stage`, one-day expiry). It cannot be applied or listed
  as a user preview. No new database table is required. `mcp_cleanup` removes expired private stages
  before purging old journal rows; a successful apply also attempts immediate stage cleanup.

## 3. Video tools

Use narrow, explicit schemas and the existing tools/dispatcher framework:

1. Lookup: reuse the existing module/structure tools to find a saved video component. Creation of a
   new component requires a separate explicit requirement; do not silently create curriculum items.
2. `save_curriculum_video(programme_id, module_id, component_id, file, title?)`: check the destination
   before downloading, stage the MP4, then show a preview using the existing confirmation convention.
   Only draft modules and existing video components are writable. Programme membership is checked by id.
3. Apply: save through the established curriculum video upload service and return the authoritative
   result. The LMS sets fixed provider/source-type/upload fields and preserves unrelated settings.
4. `get_video_import_status(programme_id, module_id, component_id)`: read the latest import journal
   without starting/retrying a worker. Report a changed source instead of showing an old copy as current.
   Read status is still available if the module is published after the upload.

The dispatcher now forwards an open file object only to the existing module-video POST route. It
uses the same authenticated account and form scope, without buffering the video into a JSON/body field.
It exposes no generic SQL, arbitrary HTTP or arbitrary filesystem tool.

Apply rechecks programme/group/week/source state, account-owned staging, file size and SHA-256. A
changed destination/source or modified file is refused. A repeated apply returns the stored result.
An uncertain upload response is recorded as `unknown` and requires status verification before retrying;
it is not reported as definitely saved or definitely unsaved. Video previews are limited to 20/hour/account.

This track saves content; it does not introduce publishing. If the desired user experience removes
the branch's confirmation step or changes visibility to learners, agree that behaviour separately.

## 4. Connect storage and background processing

- Reuse `curriculum_api.video_uploads.save_mp4`, the import journal and the supervised
  `process_curriculum_videos` worker after verifying their deployment configuration.
- Keep the stable LMS playback file after the Bunny copy completes; do not retain a temporary
  ChatGPT download URL as the long-term source or replace unrelated component fields.
- Reuse the existing import identity for retries, and define idempotency for the upload/attachment
  request itself. Repeated requests must not create duplicate content or transfers.
- Do not equate a queued job, accepted upload or local save with completed Bunny encoding.

## 5. Validate before rollout

Use a verified non-production database and mocked external transfers for regression tests. Cover:

- Correct account, existing destination, persisted playback file and queued Bunny import.
- Wrong role, another account's upload reference, nonexistent ids and cross-programme destinations.
- Oversize, invalid, incomplete and missing files; abandoned uploads and cleanup.
- Retries, repeated requests, concurrent applies and failures after local save.
- Preserved component settings, learner history and unaffected neighbouring components/modules.
- A synthetic end-to-end video through the selected device transfer mechanism, followed by separately
  authorised external checks where needed. A mocked test does not prove a live ChatGPT/Bunny transfer.

## 6. Deployment and connection

1. Review and merge the scoped change to main before deployment, following AGENTS.md.
2. Configure the HTTPS MCP/OAuth routes and authentication. `MCP_ENABLED` and
   `MCP_VIDEO_UPLOADS_ENABLED` default off. `MCP_PILOT_ACCOUNT_IDS` is implemented: when configured,
   both consent and existing bearer-token requests refuse accounts outside the list.
3. Configure durable upload storage, secrets and supervised worker startup. Copying code onto a host
   does not start a worker or install an automatic uploader on the manager's device.
4. Add the custom MCP connection in the manager's supported ChatGPT account and authenticate as the
   intended LMS account. Reuse the existing device-file access and verify the selected transfer adapter.
5. Review the relevant Neon connector's direct-write permissions. A second route with unrestricted SQL
   writes can bypass MCP validation; adding the custom MCP does not change those permissions.
6. Run a scoped pilot, record actual deployment and transfer results, and document recovery and rollback.

## Acceptance checklist

- [x] Source confirmed: local MP4; reuse existing ChatGPT device-file access without a new helper.
- [x] Intended clients confirmed: desktop Work/Codex and web ChatGPT.
- [ ] Live file-reference handoff verified in each client.
- [ ] One synthetic device MP4 received through that mechanism.
- [x] Account-owned upload staging and cleanup implemented.
- [x] Video preview/apply and status tools registered with server-side validation.
- [x] Existing LMS upload endpoint integrated; retry/failure cases covered by mocked tests.
- [ ] Actual database, durable storage and supervised Bunny worker verified in the pilot environment.
- [ ] Pilot restrictions, operational controls and deployment configuration verified.
- [ ] Live account connection and separately authorised video checks recorded.
- [ ] Direct-write bypass routes reviewed for the participating accounts.
