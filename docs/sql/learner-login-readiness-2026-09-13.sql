-- OWNER-EXECUTED ONLY. Prepared for the Neon SQL Editor; NOT executed by Codex.
-- Provisions missing learner accounts with NO password. Does not send invitations,
-- activate programmes, assign curriculum, replace existing accounts or merge people.
-- After checking these records, send invitations from Accounts; learners choose
-- their own passwords using the application's invitation flow.

-- 1. Inspect conflicting identities first. Keep both learner records unchanged.
-- The read-only check on 2026-09-13 found learner 500 sharing the email already
-- owned by account 194 (learner 499). The owner must resolve that identity.
-- The owner confirmed these are TWO DIFFERENT PEOPLE and will supply learner 500's
-- correct email. Do not merge them or attach learner 500 to learner 499's account.
SELECT u.id AS learner_id, u."Username", u."Email", a.id AS conflicting_account_id,
       a."Subject_type", a."Subject_id", a."Role"
FROM enrolment."Created_users" u
JOIN login."Login_accounts" a ON lower(btrim(a."Email")) = lower(btrim(u."Email"))
WHERE NOT EXISTS (
    SELECT 1 FROM login."Login_accounts" own
    WHERE own."Subject_type" = 'learner' AND own."Subject_id" = u.id
);

-- 2. Provision only unambiguous, missing accounts. Re-running skips existing rows.
-- Expected snapshot: 367 eligible accounts; the conflicting learner stays excluded.
WITH candidates AS (
    SELECT u.id, lower(btrim(u."Email")) AS email, u."Username" AS display_name
    FROM enrolment."Created_users" u
    WHERE u."Programme_status" IN ('Delivery', 'Active')
      AND btrim(u."Email") ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      AND NOT EXISTS (
          SELECT 1 FROM login."Login_accounts" a
          WHERE (a."Subject_type" = 'learner' AND a."Subject_id" = u.id)
             OR lower(btrim(a."Email")) = lower(btrim(u."Email"))
      )
      AND NOT EXISTS (
          SELECT 1 FROM enrolment."Created_users" other
          WHERE other.id <> u.id
            AND lower(btrim(other."Email")) = lower(btrim(u."Email"))
      )
)
INSERT INTO login."Login_accounts"
    ("Subject_type", "Subject_id", "Email", "Display_name", "Role",
     "Password_hash", "Is_active", "Failed_attempts", "Created_at", "Updated_at")
SELECT 'learner', id, email, display_name, 'learner', '', TRUE, 0, now(), now()
FROM candidates
ON CONFLICT DO NOTHING
RETURNING id AS account_id, "Subject_id" AS learner_id, "Email";

-- 3. Verify remaining records. Account creation alone does not finish onboarding.
SELECT u.id AS learner_id, u."Username", u."Programme_status",
       CASE WHEN a.id IS NULL THEN 'No account'
            WHEN NOT a."Is_active" THEN 'Account disabled'
            WHEN COALESCE(a."Password_hash", '') = '' THEN 'Password not set'
            ELSE 'Password configured' END AS account_state
FROM enrolment."Created_users" u
LEFT JOIN login."Login_accounts" a
    ON a."Subject_type" = 'learner' AND a."Subject_id" = u.id
ORDER BY u.id;
