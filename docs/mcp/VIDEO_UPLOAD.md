# Device MP4 to LMS and Bunny through MCP

## Goal and current status

The manager finishes a video as an MP4 on their device, chooses an existing curriculum destination,
and asks ChatGPT to save it to the LMS. The LMS validates the request, retains a stable playback
source and queues the existing Bunny copy. Return the actual save and transfer states.

This is an additional implementation track, not an existing MCP capability. The current MCP has
lookup tools and a preview/apply framework but no business write or video upload tools registered.
Accept the Step 6 read-only fixes before enabling video writes. Quiz/structure tools are separate
work and are not prerequisites for this track.

## 1. Verify file transfer from the existing ChatGPT session

Confirmed input: an MP4 on the manager's device. The manager's existing ChatGPT session already
has access to device files. Reuse that access; no separate watcher/helper is included in this track.

A server-hosted MCP does not receive the file merely because ChatGPT can read it. Verify the
actual ChatGPT experience and its transfer capability with one synthetic MP4:

- A client supporting ChatGPT file inputs can pass a file reference to an MCP tool declared with
  `_meta["openai/fileParams"]`; the server receives a downloadable file reference, not a device path.
- If the existing device-enabled client transfers files using an authenticated upload endpoint,
  use that capability to send the bytes and obtain an account-owned upload reference.
- Confirm which path the actual client supports before implementing the transfer adapter. Device
  file access alone does not establish support for either transfer method.

Do not assume that a ChatGPT attachment, local path or conversation link is a downloadable video.
Prove receipt of one synthetic MP4 through the existing session before promising automatic transfer.
Neither transfer adapter is implemented by this document. File-input contract:
[OpenAI MCP tool metadata](https://developers.openai.com/plugins/reference#_meta-fields-on-tool-descriptor).

## 2. Reuse the existing LMS contracts

- Resolve programme, module and video component ids from existing records; never infer ownership
  from a matching display name. Refuse ambiguous or missing destinations.
- Use the authenticated LMS account and its current permissions. Do not accept an account id from
  the assistant as an authority to act for somebody else.
- Stage the actual bytes through a bounded, authenticated upload. Return an opaque upload reference
  owned by that account, not a device path or an arbitrary server path. Keep binary video out of
  JSON tool arguments, logs and prompts.
- Enforce the existing 300 MB limit and validate the MP4 bytes, not just its name or MIME type.
- Decide retention and cleanup for staged uploads, including abandoned and failed transfers.

## 3. Add the video tools

Use narrow, explicit schemas and the existing tools/dispatcher framework:

1. Lookup: reuse the existing module/structure tools to find a saved video component. Creation of a
   new component requires a separate explicit requirement; do not silently create curriculum items.
2. Prepare the video save: validate the account-owned upload reference and destination, then show a
   preview using the branch's existing preview/confirm/apply convention.
3. Apply: save through the established curriculum video upload service and return the authoritative
   result. The LMS sets fixed provider/source-type/upload fields and preserves unrelated settings.
4. Status: report LMS save and Bunny transfer/encoding separately, including recoverable failures.

The existing dispatcher accepts JSON only. File forwarding needs an explicit, restricted extension
or a shared authenticated service adapter; a fake POST containing a file path is not sufficient.
Do not add a generic SQL, arbitrary HTTP or arbitrary filesystem tool.

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
2. Configure the HTTPS MCP/OAuth routes, authentication, feature flag and a pilot-account restriction.
3. Configure durable upload storage, secrets and supervised worker startup. Copying code onto a host
   does not start a worker or install an automatic uploader on the manager's device.
4. Add the custom MCP connection in the manager's supported ChatGPT account and authenticate as the
   intended LMS account. Reuse the existing device-file access and verify the selected transfer adapter.
5. Review the relevant Neon connector's direct-write permissions. A second route with unrestricted SQL
   writes can bypass MCP validation; adding the custom MCP does not change those permissions.
6. Run a scoped pilot, record actual deployment and transfer results, and document recovery and rollback.

## Acceptance checklist

- [x] Source confirmed: local MP4; reuse existing ChatGPT device-file access without a new helper.
- [ ] Actual client and its file-transfer mechanism verified.
- [ ] One synthetic device MP4 received through that mechanism.
- [ ] Account-owned upload staging and cleanup implemented.
- [ ] Video preview/apply and status tools registered with server-side validation.
- [ ] Existing LMS storage and Bunny worker integrated; retry/failure cases tested.
- [ ] Pilot restrictions, operational controls and deployment configuration verified.
- [ ] Live account connection and separately authorised video checks recorded.
- [ ] Direct-write bypass routes reviewed for the participating accounts.
