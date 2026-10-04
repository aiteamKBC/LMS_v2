# Aptem non-active users - Programme_status update

- Date: 2026-10-04
- Mode: APPLIED
- Source: `"LMS".non_active_users` matched to `enrolment."Created_users"` on `aptem_id` = `ID`
- Rule: only learners on `Delivery` whose Aptem status is `NonStarter` or `EnteredEpa` are changed, written exactly as Aptem has them. Only `Programme_status` is written.
- Full learner list: `non_active_users_status_update_2026-10-04.xlsx`

## Summary

| Outcome | Learners | Breakdown |
| --- | ---: | --- |
| Changed (Delivery -> Aptem status) | 37 | EnteredEpa: 18, NonStarter: 19 |
| Flagged for manual review (left on Delivery) | 1 | Onboarding: 1 |
| Already matching Aptem | 13 | Withdrawn: 13 |
| Matched, not on Delivery, differs (untouched) | 0 | none |
| Aptem ID not found in Created_users | 299 | Completed: 16, EnteredEpa: 52, NonStarter: 5, Onboarding: 114, ReadyToEnrol: 45, UnderReview: 3, Withdrawn: 64 |

## Changed learners (LMS id -> new status)

| LMS id | Aptem id | Old status | New status |
| ---: | ---: | --- | --- |
| 139 | 1792 | Delivery | EnteredEpa |
| 140 | 2438 | Delivery | EnteredEpa |
| 147 | 3598 | Delivery | EnteredEpa |
| 171 | 1325 | Delivery | EnteredEpa |
| 181 | 1567 | Delivery | EnteredEpa |
| 209 | 1740 | Delivery | EnteredEpa |
| 236 | 1330 | Delivery | EnteredEpa |
| 271 | 3582 | Delivery | EnteredEpa |
| 352 | 1836 | Delivery | EnteredEpa |
| 356 | 1900 | Delivery | EnteredEpa |
| 370 | 1779 | Delivery | EnteredEpa |
| 371 | 3404 | Delivery | EnteredEpa |
| 412 | 1873 | Delivery | EnteredEpa |
| 436 | 1001 | Delivery | EnteredEpa |
| 444 | 1679 | Delivery | EnteredEpa |
| 483 | 1428 | Delivery | EnteredEpa |
| 491 | 964 | Delivery | EnteredEpa |
| 498 | 1540 | Delivery | EnteredEpa |
| 549 | 5623 | Delivery | NonStarter |
| 551 | 5618 | Delivery | NonStarter |
| 552 | 5632 | Delivery | NonStarter |
| 553 | 5636 | Delivery | NonStarter |
| 554 | 5620 | Delivery | NonStarter |
| 555 | 6145 | Delivery | NonStarter |
| 557 | 5622 | Delivery | NonStarter |
| 558 | 5621 | Delivery | NonStarter |
| 559 | 5625 | Delivery | NonStarter |
| 560 | 5627 | Delivery | NonStarter |
| 561 | 5635 | Delivery | NonStarter |
| 563 | 5567 | Delivery | NonStarter |
| 564 | 5629 | Delivery | NonStarter |
| 565 | 5626 | Delivery | NonStarter |
| 566 | 5631 | Delivery | NonStarter |
| 567 | 5630 | Delivery | NonStarter |
| 569 | 5637 | Delivery | NonStarter |
| 572 | 5628 | Delivery | NonStarter |
| 573 | 5624 | Delivery | NonStarter |

## Flagged for manual review

Aptem says `Onboarding`, but moving a Delivery learner back to Onboarding redirects them to the onboarding wizard, so this was left unchanged by agreement.

| LMS id | Aptem id | LMS status | Aptem status |
| ---: | ---: | --- | --- |
| 469 | 15861 | Delivery | Onboarding |

## Notes

- `NonStarter` and `EnteredEpa` are not in `PROGRAMME_STATUS_CHOICES`; they display as-is, the learning plan becomes read-only, and they cannot be re-selected from the status dropdown.
- Unmatched Aptem IDs (see the `No LMS match` sheet) have no `Created_users.aptem_id`; they were not matched by name or email.
