# Aptem Additional Hours — Post-write report (2026-10-04)

## Scope and decision

- Scope: the 37 learners from the approved dry run.
- Write scope: only the six rows classified `NEW_LEGITIMATE` and explicitly approved.
- No LMS Activity, Aptem mirror, Journal, Old LMS, or unresolved candidate was changed.
- Write status: completed and independently verified.

## Rows written

| Aptem ID | Learner | Evidence IDs | Month(s) | Added | Azure links |
|---:|---|---|---|---:|---:|
| 5144 | Edirisinghege Wimalaratne | 24506 | 2025-11 | 00:45:00 | 2 |
| 652 | Emma Ford | 5826 | 2025-06 | 04:00:00 | 2 |
| 652 | Emma Ford | 5823, 6282 | 2025-07 | 12:00:00 | 4 |
| 652 | Emma Ford | 36744 | 2026-04 | 08:00:00 | 2 |
| 1000 | Joanna Farn | 27693 | 2025-12 | 08:00:00 | 2 |
| **Total** |  | **6** |  | **32:45:00** | **12** |

Each row has one canonical progress parent, one Aptem source lineage row, and the existing blobs were linked from `fetch-aptem-evidences`; no upload or duplicate blob was created.

## SSOT Actual vs Aptem Actual

| Aptem ID | Learner | SSOT before | SSOT after | Aptem Actual (all) | After − Aptem |
|---:|---|---:|---:|---:|---:|
| 5144 | Edirisinghege Wimalaratne | 318:00:01 | 318:45:01 | 329:42:00 | -11:41:59 |
| 652 | Emma Ford | 160:11:08 | 184:11:08 | 171:13:00 | +12:58:08 |
| 1000 | Joanna Farn | 491:09:16 | 500:09:16 | 601:02:00 | -100:52:44 |

## Aggregate verification for all 37

- SSOT before: **7,436:51:59**
- SSOT after: **7,469:36:59**
- Increase: **32:45:00**
- Aptem Actual (all): **8,611:32:00**
- Aggregate difference after − Aptem: **-1,141:55:01**
- Active duplicate Aptem source IDs: **0**
- Negative Accepted Actual rows: **0**
- New Azure document links: **12**

## Remaining review-only items

- 25 `AMBIGUOUS` candidates remain unchanged.
- 6 `DURATION_CONFLICT` candidates remain unchanged.
- 26 `UNSUPPORTED` candidates remain unchanged.
- 6 `REPRESENTED_ZERO` candidates remain unchanged.
- No LMS rows were excluded because no exact duplicate identity was proven.

The group is **not ready for closure**: the six approved evidence rows are written and verified, but the remaining review-only cases keep the 37-learner scope below Aptem overall.
