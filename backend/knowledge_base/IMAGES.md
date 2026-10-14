# Book Images in Quizzes

The ingestion worker extracts WebP images, diagram regions, table snapshots,
and page previews. Quiz generation selects up to eight non-decorative images
linked to the retrieved chunks. Small and visually empty assets are excluded.
Images are sent alongside text to the existing configured vision-capable model,
using the Responses API's `input_image` format. See the
[official image input documentation](https://developers.openai.com/api/docs/guides/images-vision).
This adds image input tokens to generation costs; `tokens` in Knowledge Base
metadata still measures the retrieved text only.

Image matching is available only with at least two supplied images. The model
returns server-provided image identifiers; invented identifiers, placeholders,
external URLs and repeated images within a question are rejected. Images are
optional: a diagram with the answer written on it should not become a match.

The server inserts compressed image snapshots into the existing JSON answer
format (`image_matching_pair`). This supports preview, editing, saving, learner
display and grading without a new public media route or expiring SAS links.
Snapshots deliberately remain in saved quiz answers even if the book changes.
They add payload/database size: each image is at most 100 KiB before base64,
with a 4 MiB cumulative image-string ceiling per generated quiz. The original
book assets stay in the Knowledge Base store. This phase supports image
matching, not images attached to arbitrary multiple-choice question stems.

## Azure Configuration

Create a dedicated **private** container in the account configured by
`AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_KEY`. Configure the backend and worker:

```text
KNOWLEDGE_BASE_AZURE_CONTAINER=knowledge-base
KNOWLEDGE_BASE_STORAGE=azure
```

No container is created or made public by the storage adapter. Local storage
remains the default. Azure mode supports existing local references during a
migration; a local-mode process can read migrated blob references when the
Azure container setting is present. Restart backend and worker after changing
their environment. Existing local files are not automatically migrated.

From `backend`, preview and then apply a migration for one book:

```powershell
python manage.py migrate_knowledge_to_azure --book-id <book-uuid>
python manage.py migrate_knowledge_to_azure --book-id <book-uuid> --apply
```

The default is a local/read-only inventory. Apply copies all local sources,
assets and previews for that book, verifies bytes downloaded from Azure, then
atomically changes source/asset references. It retains local files. Shared
deduplicated assets use one blob. Retries verify existing blobs instead of
overwriting them; partially copied blobs can be reused after a failed run.
Use the intended database and stop ingestion for that book while migrating.

## Offline Checks

These settings never load `.env`; the tests use mocked storage/AI and in-memory
repositories rather than live database tables:

```powershell
python -m django test knowledge_base.tests_quiz_images knowledge_base.tests_azure_storage knowledge_base.tests_assets knowledge_base.tests_retrieval quiz_api.tests_generate_golden learner_api.tests_quiz_reading --settings=knowledge_base.tests_settings
```

Live AI generation and live Azure upload are separate from these offline tests.
