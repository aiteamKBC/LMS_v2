> Superseded by the [26-row supplied-list reconciliation, plus Gary and Joshua](alfanar-commercial-reconciliation-2026-09-15.md). The counts below are the earlier 21-person snapshot.

# Commercial learner preparation: Al Fanar, Gary Beacham and Joshua Bowers

Checked: 2026-09-14T21:20:20.515664+00:00

**Preview only. No database records were changed, no login accounts were created, and no invitations were sent.**

Source: `APTEMAUTOEXTRACTINGDATABASE`, table `public.aptem_auto_extracting`. Source and destination queries used PostgreSQL read-only transactions and existing project connections.

## Current scope and identity checks

- 21 distinct learners: 19 matched the Al Fanar source selection, plus Gary Beacham and Joshua Bowers explicitly requested by the owner.
- 19 new Al Fanar Users/profile records are proposed. Gary and Joshua already exist as commercial Delivery learners and must not be duplicated or moved into the Fanar group.
- 21 unique Aptem IDs and normalized emails. No conflicting IDs, normalized emails, or exact normalized-name matches were found in the checked destination records.
- The 19 Al Fanar source statuses are `NonStarter`; Gary and Joshua are `Active` in the source but `Delivery` in this LMS. Preserve the existing destination status for the two; create the other 19 as `commercial` / `Delivery` as requested.
- None of these 21 learners currently has a matched login account. Account provisioning and invitations remain deferred.
- Identity checks passing does not mean programme placement, learning plans or mailbox delivery have been verified.

## Existing requested learners

| Learner | Aptem ID | Users ID | Profile ID | Current cohort | Current group | Action |
| --- | --- | --- | --- | --- | --- | --- |
| Gary Beacham | 6443 | 291 | 593 | Feb 2026 | AI in Project Control 2026 | Preserve existing commercial Delivery records |
| Joshua Bowers | 1423 | 348 | 549 | Oct 2026 | PCP Level 6 - June 2026 | Preserve existing commercial Delivery records |

Both profiles were verified against their own enrolment IDs and shared UUIDs. Preserve existing plans and progress. Joshua source programme/group names refer to June 2026 while his destination cohort is Oct 2026; this is reported for later placement review, with no reassignment performed.

## Proposed staged import and later invitation

1. Recheck the exact candidate IDs and identities immediately before importing; stop on new collisions.
2. Create Users/enrolment records and linked learner profiles only for the 19 missing Al Fanar learners. Preserve their Aptem IDs separately from new local IDs, using a shared UUID and correct profile enrolment_id.
3. Set learner type to `commercial` and programme status to `Delivery` consistently in both new records, with profile lifecycle `delivery`.
4. Preserve Gary and Joshua as existing records in the overall 21-person preparation list.
5. Defer account provisioning and invitations. The ordinary Create user API provisions an account automatically, so a staged import that defers accounts needs a dedicated path.
6. Verify the 19 new linked records; complete programme/cohort/group, dates and learning-plan setup, then create accounts and invite the selected 21 when ready.

## Al Fanar placement still needs review

- Source programme: `Project Control Professional Level 6 - Al Fanar`.
- Source group: `PCP - November 2025 (Alfanar)`.
- Existing programme candidate: `PROG-PCP-L6` / `Project Controls Professional Level 6`.
- Existing Fanar group: `APTEM-GROUP-6db3ce476c920e5e6130bf015091f074`.
- This group currently belongs to `Feb 2026` and has no module IDs, module names or coach. A prior programme-name review identified the Fanar cohort as unresolved. Do not treat this existing relation as an approved placement.
- The source case owner is `Enrolment Team` for all 19 Fanar learners; it is not a verified delivery coach.
- Raw live source dates for the 19 Fanar learners: start `2025-10-31`, end `2027-06-29`. The start differs from the older local snapshot `2025-11-01`; do not silently convert it into a destination programme date.
- The initial 19-person Users/Delivery import can remain unassigned while destination placement and plans are prepared. Preserve Aptem IDs for later historical linkage; migrating progress and evidence is separate scope.

## Full preparation roster

| Aptem ID | Full name | Email | Selection | Proposed action |
| --- | --- | --- | --- | --- |
| 5623 | Abdulaziz Mohammed | Abdulaziz.Alhijris@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5618 | Abdulhakim Musallam | Abdulhakim.almarshadi@Alfanar.com | Al Fanar | Create commercial / Delivery |
| 5632 | Abdullah Nawaf | Abdullah.Almutrif@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5636 | Abdulrahman Saad | Abdulrahman.Alsahli@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5620 | Abdulsalam Abdulqader | Abdulsalam.AlSalehi@alfanar.com | Al Fanar | Create commercial / Delivery |
| 6145 | Adam Alrasheed | Adam.alrasheed@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5622 | Ahmed Said | ahmed.skhalifa@dar-engineering.com | Al Fanar | Create commercial / Delivery |
| 5621 | Alghareeb Atef | Alghareeb.Hegazy@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5625 | Barkat Muhammad | barakat.muhammad@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5627 | Faisal Saoud | Faisal.Almutairi@alfanar.com | Al Fanar | Create commercial / Delivery |
| 6443 | Gary Beacham | garybeacham@duck.com | Explicitly requested | Preserve existing Users 291 |
| 5635 | Hossam Khairy | hossam.abdelrassoul@alfanar.com | Al Fanar | Create commercial / Delivery |
| 1423 | Joshua Bowers | joshuab@sarginsons.co.uk | Explicitly requested | Preserve existing Users 348 |
| 5567 | Khalid Bashir | khalid.bashir@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5629 | Khalid Nasser | Khalid.Binafif@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5626 | Manishkumar Mahendra | manishkumar.varde@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5630 | Mohammed Khalid | Mohammed.Alangari@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5631 | Muhammad Usman | mohammad.khan@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5637 | Othman Hasan | Othman.milhem@Alfanar.com | Al Fanar | Create commercial / Delivery |
| 5628 | Sulaiman Mohammed | Sulaiman.Alhogail@alfanar.com | Al Fanar | Create commercial / Delivery |
| 5624 | Ziyad Mohammed | Ziyad.Almushawwah@alfanar.com | Al Fanar | Create commercial / Delivery |

Machine-readable snapshot: [alfanar-commercial-import-preview-2026-09-15.json](alfanar-commercial-import-preview-2026-09-15.json).
