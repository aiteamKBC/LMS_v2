# Fixing the SharePoint-to-Azure copy failure

The reported error is `403 CannotVerifyCopySource`. It occurred while Azure was asked to retrieve a source URL. This is different from the earlier question about a user's Azure Portal roles. The screenshot does not establish the exact reason why the source fetch failed.

## What changes

Download the actual file through an authorised SharePoint connection, then upload its bytes using `upload_material_file.py`. The helper uses Azure `upload_blob`, never `upload_blob_from_url` or `start_copy_from_url`. No `.env` setting switches an external tool from URL copying to file uploading.

The helper is a separate operational tool for the manager's handoff. The LMS's normal curriculum uploader already uploads file content. No production LMS code has been changed for this fix.

## Steps for the manager

1. Download the actual document/audio/video from SharePoint to the computer or authorised execution environment running the helper. Use the SharePoint Download action, or a connected tool that returns binary file content. A page title, text extraction, preview URL or sign-in page is not the file.
2. Identify the verified module catalogue ID and stable component ID using the main handoff. The helper validates ID format but cannot check database ownership, because it never connects to Neon. Do not invent a destination or use the placeholders below literally.
3. Extract the updated handoff ZIP. The helper and `PRIVATE_CONNECTIONS.env` must remain together, or specify the configuration path using `--env`.
4. In a terminal in that folder, ensure Python and its Azure library are available:

```powershell
python -m pip install azure-storage-blob
```

5. Preview the planned upload. Replace all angle-bracket placeholders with actual values:

```powershell
python upload_material_file.py --file "C:\Downloads\lesson.pdf" --module-id "<verified-module-id>" --component-id "<allocated-component-id>"
```

The preview hashes the local file and prints its proposed destination. It makes no network requests and changes nothing in Azure or Neon. Inspect the module ID, component ID and container.

6. Run the same command with `--execute` to upload and read back the destination for SHA-256 verification:

```powershell
python upload_material_file.py --file "C:\Downloads\lesson.pdf" --module-id "<verified-module-id>" --component-id "<allocated-component-id>" --execute
```

The result supplies `blobName`, `lmsUrl`, file size and checksum. Save that result in the week's placement manifest. A successful storage transfer does not by itself create a curriculum component or make it visible to learners. Continue the owner-reviewed SQL and placement process in `HANDOFF_EN_GB.md`.

## What the helper does

- Uploads local file bytes into the existing curriculum container using the supplied account/key.
- Uses the selected module/component IDs and a filename containing the content checksum.
- Never overwrites or deletes an existing blob. If the destination exists, it verifies and reuses identical content; different content fails verification.
- Rejects empty files, unsupported extensions, obvious downloaded HTML pages and files over 300 MiB.
- Streams uploads and verification reads in chunks rather than loading the entire file into memory.
- Reports success only after reading the destination and comparing its size and SHA-256.
- Does not create containers, change permissions, access the database or call LMS APIs.

If verification fails after a new upload, the file may remain in Azure for inspection. The helper does not automatically delete it. A network failure can also leave an unverified upload; retrying the same stable source verifies an existing destination safely.

The helper can store MP4/WebM and caption assets directly, but that does not implement new video/caption support in the LMS. Retain the main handoff's display and registration checks. Standalone HTML packages are not supported.

## If downloading is unavailable in the current connection

Finish the content and placement manifest, and report that binary download capability is missing. The manager can download the file manually and run the helper, or an authorised integration can fetch Microsoft Graph `GET /drives/{drive-id}/items/{item-id}/content` and follow the returned download URL. This helper does not obtain Microsoft sign-in tokens or add SharePoint permissions.

Being able to search or read text from SharePoint does not prove that the current tool exposes the original file bytes. Do not claim that another attempt at the same URL-copy operation has fixed the problem.

## Message to use in the manager's session

```text
Use the attached TRANSFER_FIX_EN_GB.md and upload_material_file.py.
Retrieve the actual file bytes through the authorised SharePoint connection,
save the file locally, and run the helper's preview with the verified module
and component IDs. Once the destination matches the authorised task, run with
--execute. Report the verified blob name, LMS URL, size and SHA-256. Preserve
existing uploads and do not write to Neon. If your current tools cannot retrieve
binary files or run the helper, state exactly which capability is missing.
```

## Verification and sources

The helper was checked locally with simulated Azure clients, including new uploads, safe retries, conflicting destination bytes and failure redaction. No real SharePoint file was supplied for this fix, and no production upload or database change was performed. Live transfer still requires the actual file and verified destination IDs.

- [Microsoft Graph: download file content](https://learn.microsoft.com/en-us/graph/api/driveitem-get-content?view=graph-rest-1.0)
- [Azure: upload files and streams with Python](https://learn.microsoft.com/en-us/azure/storage/blobs/storage-blob-upload-python)
