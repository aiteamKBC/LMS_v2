# Classified assignments: direct read

The Assignments tab now reads `assignment_classification_evaluations` from the learner's latest completed `assignment_classification_runs` record. Each evaluation's primary evidence and `source_evidence_ids` are resolved against owned `evidence_items`. Portfolio selection does not filter the list. Jobs are processing metadata, not submissions.

No import, backfill worker, migration or database write is needed. The old import SQL has been retired and contains no INSERT.

The server matches enrolment ID and learner kind to Aptem using both Aptem ID and email. List, detail and original file access all use the same scoped source query. The eight-step template is read-only, with provenance `classified_legacy`; learner POSTs cannot create or overwrite these activity keys. Original files, reports, feedback and dates are presented without inventing new-form answers or grades.

Read-only live verification for Mohamed Elmasry (commercial enrolment 125 / Aptem 92) returned 31 files under 14 classified source components across 13 completion months, with 31 reports. The source query is not hardcoded to his IDs or run 4. Completion dates use Europe/London, falling back to submission dates. Files 20121 and 20122 are titled August 2025 but have recorded completion in January 2026; the recorded dates are preserved.

Open `/learner/my-learning/commercial/125?tab=assignments` directly. There is no SQL execution step.

## Eight-card historical content

Opening a historical assignment now extracts readable text from its original PDF, DOCX, XLSX, PPTX or text file, including supported entries inside ZIP archives. The wizard displays one populated card per step; Preview displays all eight cards. Original paragraphs remain verbatim extracts, with filename attribution. Matching passages are grouped by section keywords; tutor observations are separately labelled and never presented as learner declarations. The full readable assignment remains in the answer card.

Extraction runs only for the opened detail, not the list. A bounded process-memory cache is keyed by blob, source hash and source update time. It does not persist data or call an AI service. Archive size, nesting, entry count and text/page limits are enforced; scanned diagrams, unsupported files and shortened previews have explicit notices. Original files and assessment reports remain accessible.

Live read-only checks covered `WBS March 2026.zip` (evidence 35767, approximately 17,000 readable characters) and an Elmasry PDF (evidence 20128). WBS populated seven cards; the eighth accurately states that no coaching or presentation content was found. Its image-only WBS diagram remains in the original file.

Validation: 40 backend tests, 17 frontend tests and the production frontend build passed.
