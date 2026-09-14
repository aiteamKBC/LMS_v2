# MCM PDF after learner signing

Monthly coaching reviews now offer **Download signed PDF** in the learner form and the coach's review modal. The PDF includes the saved questions and answers and a final signature page containing each required party's original saved mark, name and signing timestamp. The layout uses landscape A4, the section tables and the KBC crest from the supplied Aptem MCM reference. No learner data or signature from either reference document is embedded in the implementation.

## Rules and scope

- The server requires the instance to be completed, the learner to have signed and every other required party to have signed. Missing signature images or metadata block export. Invalid image bytes also block generation; a name is never substituted for a signature.
- The learner endpoint reuses the existing review ownership/visibility checks. The coach endpoint reuses the assigned-coach check. PDF responses use `private, no-store`.
- Fields come from the instance's saved Curriculum definition and recorded answers. Hidden conditional branches and disabled sections are omitted. Long answers paginate; page counts depend on the configured form and its answers.
- Submitted review answers are rejected by the draft-save endpoint once signing begins, matching the existing read-only form.
- Existing MCM templates were checked read-only: both already require coach and learner signatures. All three existing MCM instances also require learner signatures. No live database changes were made. Later database reads were intermittently affected by DNS failure.
- New MCM defaults select the learner signature. Existing instance snapshots are not rewritten.
- This change implements the MCM download. The supplied PR PDF remains a reference for the subsequent PR export work.

## Validation

- 34 backend tests passed: signed PDF generation, incomplete/invalid signatures, saved signature evidence, final-signature completion, long answers, conditional fields, ownership refusals and existing learner review access.
- 29 frontend tests passed: download state, server errors, PDF response handling and existing coach/learner signature components.
- Production frontend build passed.
- Generated a synthetic five-page MCM sample and visually inspected all pages, including the final signature page. Tested marks are explicitly labelled as test signatures. Source PDFs were not altered.
- TypeScript check: 24 diagnostics elsewhere in the project, zero in the changed PDF/form files checked.
- The broader review-builder suite has nine failures, reproduced against its unchanged HEAD implementation (17 pass, 9 fail). Those tests expect the old Create review flow rather than the current step-based form.
- Added `reportlab==5.0.1` to backend requirements and installed it locally. Production environments need the updated backend dependencies when deploying.

Browser end-to-end verification with a signed-in learner was unavailable in this session. No genuine learner or coach signature was created, and no meeting invitations were sent.

Cleanup of the temporary inspection images/PDFs was rejected by the tool policy, including a second attempt limited to explicitly named generated files. They remain under `tmp/pdfs/`; the `aptem-review-reference` subfolder contains renderings of the user-supplied records and should not be committed. Original files in Downloads are unchanged.
