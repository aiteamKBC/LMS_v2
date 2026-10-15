# KSB standards migration: Production runbook

**Read this first:** run **only** the steps below, **in this order**, one at a time. Do **not** run the folder's files in sequence.

| Never run during the migration | Why |
|---|---|
| `03_rollback.sql`, `04b_pin_remediation_rollback.sql` | Rollback only (see the bottom of this page) |
| `07_orphan_recovery.sql`, `07b_orphan_recovery_rollback.sql` | Not part of this release |
| `06_unresolved_review.sql` | Report for the curriculum team; read-only, not needed here |

Every step runs in its own `psql`/SQL editor session against **Production**. Stop at the first step whose result is not what is written here.

**Decisions this release implements (15 Oct 2026):**
- Marketing Executive Level 4 moves to ST0596; 61 ME learners are repinned to ST0596 and 161 MM learners to ST0612.
- 55 mislabelled ME pins are fixed (step 8).
- Only evidence-backed learner rows (≈19) are registered as not counting. The 81 rows whose "heading" label was only a lookup keep counting, as they do today.
- Learners 271, 211 and 212 and the 3 orphan rows are left as they are.

---

## Before you start

0. **The application must be deployed from `main`** (PR #386 or later). This is safe before the migration: it was verified to give identical figures on unmigrated data.

## Steps

1. **Restore point.** In the Neon console, create a snapshot (or branch) of Production. Write its name down: `__________`.
2. **Build the plan:** `01_plan.sql`.
   - Takes about 15 s.
   - Expected: no error. Notices about existing schemas are fine.
3. **Check the plan:** run this query.
   ```sql
   select action, count(*) from ksb_mig.progress_plan group by 1 order by 1;
   select action, count(*) from ksb_mig.pin_plan where action = 'repin' group by 1;
   select verdict, count(*) from ksb_mig.recon group by 1;
   select status, count(*) from ksb_mig.legacy_rows group by 1 order by 1;
   ```
   Expected (rehearsed on a copy of Production taken 15 Oct 07:06 UTC; live data may move a few rows):
   - `repoint` ≈ 1,328; `review_group_heading` ≈ 6; `review_no_profile` ≈ 4.
   - `repin` 222.
   - recon: **no `DIFFERENT` row**.
   - `legacy_rows`:
     - `excluded_other_standard` 9;
     - `excluded_group_heading` 0;
     - `valid_code_lookup_text` 31;
     - `valid_code_no_text` 50;
     - the rest `valid_ssot_code`.
4. **Fingerprints before:** run `08_verify_protected.sql` and `09_verify_touched.sql`. **Save both outputs** (copy to a file).
5. **Migrate:** `02_apply.sql`.
   - Takes about 5 s.
   - Expected final notice: `ksb standards migration applied: {... "learners_repinned": 222, "mappings_repointed": 1488, "learner_ksb_rows_repointed": ≈1328, "exclusions_from_plan": ≈10, "exclusions_legacy": 9 ...}`.
   - If it raises **any** error, nothing was changed: stop and send me the message.
6. **Verify:**
   - `05_reconcile.sql`, part (b), expected counts: ≈ **19** rows registered, 222 learners repinned, 1 programme, 54 modules.
   - `08_verify_protected.sql` again: **every line must equal step 4.** (After step 8 one line, "learner_ksb_assignments (learners outside the repin plan)", changes; that is the 55 pins, and it is expected.)
7. **Restart the services** on the server: `systemctl restart 'lms-*.service'`.
8. **Pin fix (55 learners):** in one session, run
   ```sql
   SET ksb_pin_fix.confirm = 'yes';
   ```
   then `04_pin_remediation_plan.sql`. Expected notice: `pin remediation: 55 learners repinned` (or slightly fewer).
9. **Spot-check in the app:** an ME learner's dashboard KSB %, a coach caseload, the ME programme page, and a review form with a signed Skills Radar.

## Rollback (only if needed), in this order

1. `SET ksb_pin_fix.rollback = 'yes';` then `04b_pin_remediation_rollback.sql`.
2. `03_rollback.sql`. It refuses while step 1 is still needed, and it aborts if rows were edited after the apply (it lists them).
3. `09_verify_touched.sql` and `08_verify_protected.sql`: must equal step 4.
4. Restart the services.

**Last resort:** restore the step-1 snapshot.
