-- Phase 4G.4 reviewed fixture DDL/DML design.
-- STATUS: SECURITY OBJECTS EXECUTED ON THE TEST BRANCH; FIXTURE NOT CREATED.
-- Target only: green-term-97168878 / br-orange-shadow-abm8uwwe / neondb.
-- The :provisioner_password token is a psql variable, never a committed secret.

BEGIN;

DO $guard$
BEGIN
  IF current_database() <> 'neondb'
     OR current_setting('neon.branch_id', true) <> 'br-orange-shadow-abm8uwwe'
     OR current_setting('neon.endpoint_id', true) <> 'ep-dawn-block-ab5vob3x'
     OR current_user <> 'neondb_owner'
  THEN
    RAISE EXCEPTION 'Phase 4G.4 DDL target identity mismatch';
  END IF;
END
$guard$;

CREATE ROLE lms_fixture_owner NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOINHERIT NOREPLICATION NOBYPASSRLS;

-- Reset from Parent removed the branch-local provisioner, so the refreshed
-- test branch required creation rather than alteration.
CREATE ROLE lms_fixture_provisioner LOGIN PASSWORD :'provisioner_password'
  NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS
  CONNECTION LIMIT 1;

-- Neon branch owners are deliberately not superusers. A transaction-local
-- ownership handoff therefore needs SET ROLE authority on the new NOLOGIN
-- owner. This membership is revoked below before the transaction can commit;
-- any intervening error rolls the roles and membership back together.
GRANT lms_fixture_owner TO neondb_owner;
ALTER ROLE lms_fixture_provisioner SET statement_timeout = '30s';
ALTER ROLE lms_fixture_provisioner SET lock_timeout = '2s';
ALTER ROLE lms_fixture_provisioner SET idle_in_transaction_session_timeout = '15s';
ALTER ROLE lms_fixture_provisioner SET search_path = pg_catalog;

REVOKE ALL ON DATABASE neondb FROM lms_fixture_owner, lms_fixture_provisioner;
GRANT CONNECT ON DATABASE neondb TO lms_fixture_owner, lms_fixture_provisioner;

GRANT USAGE ON SCHEMA enrolment, "Learner", login, "Engagement",
  fetching_evidence, public, "Coach", curriculum, chat
  TO lms_fixture_owner;

-- Exact write surface for the fixed fixture body and its existing triggers.
GRANT SELECT, INSERT, UPDATE, DELETE ON
  enrolment."Created_users",
  "Learner".learners,
  login."Login_accounts",
  login."Login_sessions",
  "Learner".learner_training_plan_modules,
  "Learner".learner_training_plan_weeks,
  "Learner".learner_training_plan_components,
  "Learner".learner_progress_entries
  TO lms_fixture_owner;

GRANT USAGE, SELECT ON SEQUENCE
  enrolment."Created_users_id_seq",
  "Learner".learners_id_seq,
  login."Login_accounts_id_seq",
  login."Login_sessions_id_seq",
  "Learner".learner_training_plan_modules_id_seq,
  "Learner".learner_training_plan_weeks_id_seq,
  "Learner".learner_training_plan_components_id_seq,
  "Learner".learner_progress_entries_id_seq
  TO lms_fixture_owner;

-- Trigger execution needs these privileges even though the fixed fixture values
-- are designed to produce zero reward or attendance rows.
GRANT SELECT ON
  "Learner".source_lms_attendance,
  "Engagement".shared_reward_sessions,
  "Engagement".shared_reward_config,
  "Engagement".learning_reward_policies,
  "Engagement".shared_reward_outbox,
  "Engagement".shared_reward_saved_progress,
  login."Invitations", login."Password_resets", login."Login_audit",
  fetching_evidence.platform_read_model_outbox,
  public.platform_read_model_outbox
  TO lms_fixture_owner;
GRANT INSERT ON
  "Engagement".shared_reward_outbox,
  "Engagement".shared_reward_saved_progress
  TO lms_fixture_owner;

-- Read-only dependency surface used by cleanup's catalog-derived FK check.
-- A future FK on an ungranted table makes cleanup fail closed with permission
-- denied; it does not broaden cleanup.
GRANT SELECT ON
  "Coach".coach_absence_report,
  "Coach".coach_attendance_adjustment,
  "Coach".coach_calendar_event_learner_link,
  "Coach".coach_imported_review_instance,
  "Coach".coach_manual_attendance,
  "Coach".coach_migrated_review_signature,
  "Coach".review_source_reconciliation,
  "Learner".attendance_preferences,
  "Learner".attendance_reminders,
  "Learner".extra_activities,
  "Learner".learner_activity_documents,
  "Learner".learner_activity_reporting_segments,
  "Learner".learner_activity_revisions,
  "Learner".learner_activity_sources,
  "Learner".learner_external_identities,
  "Learner".learner_free_courses,
  "Learner".learner_journal_rows,
  "Learner".learner_ksb_assignments,
  "Learner".learner_month_restore_points,
  "Learner".learner_monthly_locks,
  "Learner".learner_monthly_signatures,
  "Learner".learner_monthly_targets,
  "Learner".learner_progress_historical_components,
  "Learner".learner_progress_ksbs,
  "Learner".learner_quiz_answers,
  "Learner".learner_source_course_memberships,
  "Learner".personal_course_enrolments,
  "Learner".progress_transfer_requests,
  "Learner".review_documents,
  "Learner".subject_activity_attempts,
  chat.conversations, chat.message_receipts, chat.messages,
  curriculum.live_session_learner_attendance,
  curriculum.source_planned_hours_bulk_items,
  enrolment."Apprenticeship_Agreements",
  enrolment."Enrolment_Documents",
  enrolment."Enrolment_Reviews",
  enrolment."ILR_Documents",
  enrolment."Training_Plan_Documents",
  enrolment."Wizard_Ilr_Learner_Details",
  enrolment."Wizard_Introduction",
  enrolment."Wizard_Ksb_Assessments",
  enrolment."Wizard_Plr_Records",
  enrolment."Wizard_Policy_Acks",
  enrolment."Written_Agreements",
  login."Mcp_oauth_codes", login."Mcp_oauth_tokens",
  login."Mcp_pending_changes"
  TO lms_fixture_owner;

CREATE SCHEMA benchmark_admin;
REVOKE ALL ON SCHEMA benchmark_admin FROM PUBLIC;

CREATE TABLE benchmark_admin.fixture_receipts (
  receipt_id uuid PRIMARY KEY,
  namespace text UNIQUE NOT NULL CHECK (
    namespace ~ '^phase4g_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ),
  payload jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
REVOKE ALL ON benchmark_admin.fixture_receipts FROM PUBLIC;

CREATE FUNCTION benchmark_admin.provision_phase4g_fixture(
  p_namespace text,
  p_token_hash text,
  p_expires_at timestamptz
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_now timestamptz := clock_timestamp();
  v_email text := p_namespace || '@example.invalid';
  v_uuid uuid := gen_random_uuid();
  v_receipt_id uuid := gen_random_uuid();
  v_learning_plan jsonb;
  v_enrolment_id bigint;
  v_learner_id bigint;
  v_account_id bigint;
  v_session_id bigint;
  v_module_id bigint;
  v_week_id bigint;
  v_component_id bigint;
  v_progress_ids bigint[];
  v_progress_start bigint;
  v_receipt jsonb;
BEGIN
  IF session_user <> 'lms_fixture_provisioner' THEN
    RAISE EXCEPTION 'Fixture function caller is not the provisioner';
  END IF;
  IF current_database() <> 'neondb'
     OR current_setting('neon.branch_id', true) <> 'br-orange-shadow-abm8uwwe'
     OR current_setting('neon.endpoint_id', true) <> 'ep-dawn-block-ab5vob3x'
  THEN
    RAISE EXCEPTION 'Fixture target identity mismatch';
  END IF;
  IF p_namespace !~ '^phase4g_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR p_token_hash !~ '^[0-9a-f]{64}$'
     OR p_expires_at < v_now + interval '30 minutes'
     OR p_expires_at > v_now + interval '90 minutes'
  THEN
    RAISE EXCEPTION 'Invalid fixture namespace, token hash, or expiry';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('phase4g.fixture', 0));

  -- Historical trigger rows can outlive their progress row. Never let a new
  -- fixture reuse one of those orphaned progress IDs: it would appear to own a
  -- side effect that predates the fixture and make cleanup unsafe. This check
  -- happens before any application insert or sequence consumption.
  SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END
    INTO v_progress_start
  FROM "Learner".learner_progress_entries_id_seq;
  IF EXISTS (SELECT 1 FROM "Learner".learner_progress_entries
             WHERE id BETWEEN v_progress_start AND v_progress_start + 356)
     OR EXISTS (SELECT 1 FROM "Engagement".shared_reward_outbox
                WHERE progress_id BETWEEN v_progress_start AND v_progress_start + 356)
     OR EXISTS (SELECT 1 FROM "Engagement".shared_reward_saved_progress
                WHERE progress_id BETWEEN v_progress_start AND v_progress_start + 356)
  THEN
    RAISE EXCEPTION 'Fixture progress identity range collides with existing rows';
  END IF;

  IF EXISTS (SELECT 1 FROM enrolment."Created_users"
             WHERE lower(coalesce("Email", '')) = lower(v_email)
                OR lower(coalesce("Username", '')) = lower(v_email)
                OR "Programme" = p_namespace OR "Cohort" = p_namespace
                OR "Group" = p_namespace)
     OR EXISTS (SELECT 1 FROM "Learner".learners
                WHERE lower(email) = lower(v_email)
                   OR programme = p_namespace OR cohort = p_namespace
                   OR group_name = p_namespace)
     OR EXISTS (SELECT 1 FROM login."Login_accounts"
                WHERE lower("Email") = lower(v_email))
     OR EXISTS (SELECT 1 FROM login."Login_sessions"
                WHERE "Token_hash" = p_token_hash)
     OR EXISTS (SELECT 1 FROM "Learner".learner_training_plan_modules
                WHERE module_ref = p_namespace || ':module')
     OR EXISTS (SELECT 1 FROM "Learner".learner_training_plan_weeks
                WHERE week_ref = p_namespace || ':week')
     OR EXISTS (SELECT 1 FROM "Learner".learner_training_plan_components
                WHERE component_ref = p_namespace || ':component')
     OR EXISTS (SELECT 1 FROM benchmark_admin.fixture_receipts
                WHERE namespace = p_namespace)
  THEN
    RAISE EXCEPTION 'Fixture namespace collision';
  END IF;

  v_learning_plan := jsonb_build_object(
    'modules', jsonb_build_array(jsonb_build_object(
      'id', p_namespace || ':module', 'title', p_namespace || ' module',
      'weeks', jsonb_build_array(jsonb_build_object(
        'id', p_namespace || ':week', 'title', p_namespace || ' week',
        'components', jsonb_build_array(jsonb_build_object(
          'id', p_namespace || ':component',
          'title', p_namespace || ' component', 'type', 'component'
        ))
      ))
    ))
  );

  INSERT INTO enrolment."Created_users" (
    "Learner_type", "Invite_to_platform", "Username", "Preferred_name",
    "Email", "Programme", "Cohort", "Group", "Type", " Status",
    "Programme_status", "Learning_plan", "Free_courses", uuid
  ) VALUES (
    'apprenticeship', false, v_email, p_namespace, v_email,
    p_namespace, p_namespace, p_namespace, 'apprenticeship', 'Active',
    'Active', v_learning_plan, '[]'::jsonb, v_uuid
  ) RETURNING id INTO v_enrolment_id;

  INSERT INTO "Learner".learners (
    full_name, email, lifecycle_status, programme,
    programme_status, cohort, group_name, learner_type, uuid, enrolment_id,
    learning_plan
  ) VALUES (
    p_namespace, v_email, 'Active', p_namespace,
    'Active', p_namespace, p_namespace, 'apprenticeship', v_uuid,
    v_enrolment_id, v_learning_plan
  ) RETURNING id INTO v_learner_id;

  UPDATE enrolment."Created_users"
     SET learner_id = v_learner_id
   WHERE id = v_enrolment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture enrolment link update failed'; END IF;

  INSERT INTO login."Login_accounts" (
    "Subject_type", "Subject_id", "Email", "Display_name", "Role",
    "Password_hash", "Is_active", "Failed_attempts"
  ) VALUES (
    'learner', v_enrolment_id, v_email, p_namespace, 'learner', '', true, 0
  ) RETURNING id INTO v_account_id;

  INSERT INTO login."Login_sessions" (
    "Account_id", "Token_hash", "Expires_at", "Ip_address", "User_agent",
    "Last_seen_at", "Remember"
  ) VALUES (
    v_account_id, p_token_hash, p_expires_at, '127.0.0.1',
    'Phase4G.4 synthetic benchmark', p_expires_at, false
  ) RETURNING id INTO v_session_id;

  INSERT INTO "Learner".learner_training_plan_modules (
    learner_id, position, module_ref, module_title, curriculum_module_id
  ) VALUES (
    v_learner_id, 0, p_namespace || ':module', p_namespace || ' module', NULL
  ) RETURNING id INTO v_module_id;

  INSERT INTO "Learner".learner_training_plan_weeks (
    plan_module_id, position, week_ref, week_title, curriculum_week_id
  ) VALUES (
    v_module_id, 0, p_namespace || ':week', p_namespace || ' week', NULL
  ) RETURNING id INTO v_week_id;

  INSERT INTO "Learner".learner_training_plan_components (
    plan_week_id, position, component_ref, component_title,
    curriculum_component_id, component_type
  ) VALUES (
    v_week_id, 0, p_namespace || ':component',
    p_namespace || ' component', NULL, 'component'
  ) RETURNING id INTO v_component_id;

  WITH inserted AS (
    INSERT INTO "Learner".learner_progress_entries (
      learner_id, entry_order, kind,
      module_ref, module_title, week_ref, week_title,
      component_ref, component_title, component_type, plan_component_id,
      programme_ref, programme_title, cohort_ref, cohort_title,
      group_ref, group_title, submitted_at,
      time_tracking_session_ref, source_system, source_activity_id,
      source_attempt_key, canonical_activity_key, activity_status,
      source_payload, kbc_attendance_key
    )
    SELECT
      v_learner_id, n, 'component',
      p_namespace || ':module', p_namespace || ' module',
      p_namespace || ':week', p_namespace || ' week',
      p_namespace || ':component', p_namespace || ' component',
      'component', v_component_id,
      p_namespace, p_namespace, p_namespace, p_namespace,
      p_namespace, p_namespace, NULL,
      '', '', '', '', '', '', '{}'::jsonb, NULL
    FROM generate_series(1, 357) AS n
    RETURNING id, entry_order
  )
  SELECT array_agg(id ORDER BY entry_order) INTO v_progress_ids FROM inserted;

  IF cardinality(v_progress_ids) <> 357 THEN
    RAISE EXCEPTION 'Fixture progress receipt cardinality failed';
  END IF;
  IF (SELECT count(*) FROM "Learner".learner_progress_entries
      WHERE learner_id = v_learner_id) <> 357 THEN
    RAISE EXCEPTION 'Fixture learner progress cardinality failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "Learner".learner_progress_entries
             WHERE id = ANY(v_progress_ids)
               AND (plan_component_id <> v_component_id
                    OR kbc_attendance_key IS NOT NULL
                    OR submitted_at IS NOT NULL
                    OR time_tracking_session_ref <> '')) THEN
    RAISE EXCEPTION 'Fixture progress containment values failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "Engagement".shared_reward_outbox
             WHERE progress_id = ANY(v_progress_ids)) THEN
    RAISE EXCEPTION 'Fixture reward outbox containment failed';
  END IF;
  IF EXISTS (SELECT 1 FROM "Engagement".shared_reward_saved_progress
             WHERE progress_id = ANY(v_progress_ids)) THEN
    RAISE EXCEPTION 'Fixture saved reward containment failed';
  END IF;
  IF EXISTS (SELECT 1 FROM login."Invitations"
             WHERE "Account_id" = v_account_id OR lower("Email") = lower(v_email)) THEN
    RAISE EXCEPTION 'Fixture invitation containment failed';
  END IF;
  IF EXISTS (SELECT 1 FROM login."Password_resets"
             WHERE "Account_id" = v_account_id OR lower("Email") = lower(v_email)) THEN
    RAISE EXCEPTION 'Fixture password reset containment failed';
  END IF;
  IF EXISTS (SELECT 1 FROM login."Login_audit"
             WHERE "Account_id" = v_account_id OR lower("Email") = lower(v_email)) THEN
    RAISE EXCEPTION 'Fixture login audit containment failed';
  END IF;
  IF EXISTS (SELECT 1 FROM fetching_evidence.platform_read_model_outbox
             WHERE scope_id IN (v_enrolment_id::text, v_learner_id::text)
                OR payload::text LIKE '%' || p_namespace || '%') THEN
    RAISE EXCEPTION 'Fixture fetching read-model containment failed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.platform_read_model_outbox
             WHERE scope_id IN (v_enrolment_id::text, v_learner_id::text)
                OR payload::text LIKE '%' || p_namespace || '%') THEN
    RAISE EXCEPTION 'Fixture public read-model containment failed';
  END IF;

  v_receipt := jsonb_build_object(
    'fixture_id', v_receipt_id,
    'receipt_id', v_receipt_id,
    'namespace', p_namespace,
    'project_id', 'green-term-97168878',
    'branch_id', 'br-orange-shadow-abm8uwwe',
    'endpoint_id', 'ep-dawn-block-ab5vob3x',
    'database', 'neondb',
    'created_at', v_now,
    'enrolment_id', v_enrolment_id,
    'learner_id', v_learner_id,
    'account_id', v_account_id,
    'session_id', v_session_id,
    'session_expires_at', p_expires_at,
    'module_id', v_module_id,
    'week_id', v_week_id,
    'component_id', v_component_id,
    'progress_ids', to_jsonb(v_progress_ids),
    'application_rows', 364,
    'control_rows', 1,
    'cleanup_verification', jsonb_build_object(
      'strategy', 'exact_receipt_primary_keys',
      'expected_application_deletes', 364,
      'expected_control_deletes', 1,
      'sequence_reset', false,
      'provision_xid', pg_current_xact_id()::text
    )
  );

  INSERT INTO benchmark_admin.fixture_receipts(receipt_id, namespace, payload)
  VALUES (v_receipt_id, p_namespace, v_receipt);
  RETURN v_receipt;
END
$function$;

CREATE FUNCTION benchmark_admin.cleanup_phase4g_fixture(
  p_receipt jsonb
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog
AS $function$
DECLARE
  v_stored jsonb;
  v_receipt_id uuid;
  v_namespace text;
  v_enrolment_id bigint;
  v_learner_id bigint;
  v_account_id bigint;
  v_session_id bigint;
  v_module_id bigint;
  v_week_id bigint;
  v_component_id bigint;
  v_progress_ids bigint[];
  v_target_oids oid[];
  v_ids bigint[];
  v_fk record;
  v_join text;
  v_dependent boolean;
  v_rows bigint;
BEGIN
  IF session_user <> 'lms_fixture_provisioner' THEN
    RAISE EXCEPTION 'Fixture cleanup caller is not the provisioner';
  END IF;
  IF current_database() <> 'neondb'
     OR current_setting('neon.branch_id', true) <> 'br-orange-shadow-abm8uwwe'
     OR current_setting('neon.endpoint_id', true) <> 'ep-dawn-block-ab5vob3x'
  THEN
    RAISE EXCEPTION 'Fixture cleanup target identity mismatch';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended('phase4g.fixture', 0));
  v_receipt_id := (p_receipt->>'receipt_id')::uuid;
  SELECT payload INTO v_stored
  FROM benchmark_admin.fixture_receipts
  WHERE receipt_id = v_receipt_id
  FOR UPDATE;
  IF v_stored IS NULL OR v_stored <> p_receipt THEN
    RAISE EXCEPTION 'Fixture receipt is missing or altered';
  END IF;

  v_namespace := v_stored->>'namespace';
  v_enrolment_id := (v_stored->>'enrolment_id')::bigint;
  v_learner_id := (v_stored->>'learner_id')::bigint;
  v_account_id := (v_stored->>'account_id')::bigint;
  v_session_id := (v_stored->>'session_id')::bigint;
  v_module_id := (v_stored->>'module_id')::bigint;
  v_week_id := (v_stored->>'week_id')::bigint;
  v_component_id := (v_stored->>'component_id')::bigint;
  SELECT array_agg(value::bigint ORDER BY ordinality)
    INTO v_progress_ids
  FROM jsonb_array_elements_text(v_stored->'progress_ids')
       WITH ORDINALITY AS p(value, ordinality);

  IF v_namespace !~ '^phase4g_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
     OR cardinality(v_progress_ids) <> 357
  THEN
    RAISE EXCEPTION 'Fixture receipt cardinality or namespace is invalid';
  END IF;

  -- Lock every owned row first; this blocks concurrent creation of new FK
  -- references while dependency checks and exact deletes run.
  PERFORM 1 FROM enrolment."Created_users"
    WHERE id = v_enrolment_id AND learner_id = v_learner_id
      AND lower("Email") = lower(v_namespace || '@example.invalid') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture enrolment ownership mismatch'; END IF;
  PERFORM 1 FROM "Learner".learners
    WHERE id = v_learner_id AND enrolment_id = v_enrolment_id
      AND lower(email) = lower(v_namespace || '@example.invalid') FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture learner ownership mismatch'; END IF;
  PERFORM 1 FROM login."Login_accounts"
    WHERE id = v_account_id AND "Subject_type" = 'learner'
      AND "Subject_id" = v_enrolment_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture account ownership mismatch'; END IF;
  PERFORM 1 FROM login."Login_sessions"
    WHERE id = v_session_id AND "Account_id" = v_account_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture session ownership mismatch'; END IF;
  PERFORM 1 FROM "Learner".learner_training_plan_modules
    WHERE id = v_module_id AND learner_id = v_learner_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture module ownership mismatch'; END IF;
  PERFORM 1 FROM "Learner".learner_training_plan_weeks
    WHERE id = v_week_id AND plan_module_id = v_module_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture week ownership mismatch'; END IF;
  PERFORM 1 FROM "Learner".learner_training_plan_components
    WHERE id = v_component_id AND plan_week_id = v_week_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Fixture component ownership mismatch'; END IF;
  PERFORM 1 FROM "Learner".learner_progress_entries
    WHERE id = ANY(v_progress_ids) AND learner_id = v_learner_id
      AND plan_component_id = v_component_id FOR UPDATE;

  IF (SELECT count(*) FROM "Learner".learner_progress_entries
      WHERE id = ANY(v_progress_ids) AND learner_id = v_learner_id
        AND plan_component_id = v_component_id) <> 357
     OR (SELECT count(*) FROM "Learner".learner_progress_entries
         WHERE learner_id = v_learner_id) <> 357
     OR (SELECT count(*) FROM "Learner".learner_training_plan_modules
         WHERE learner_id = v_learner_id) <> 1
     OR (SELECT count(*) FROM "Learner".learner_training_plan_weeks
         WHERE plan_module_id = v_module_id) <> 1
     OR (SELECT count(*) FROM "Learner".learner_training_plan_components
         WHERE plan_week_id = v_week_id) <> 1
     OR (SELECT count(*) FROM login."Login_sessions"
         WHERE "Account_id" = v_account_id) <> 1
  THEN
    RAISE EXCEPTION 'Fixture has unknown owned rows; cleanup stopped';
  END IF;

  v_target_oids := ARRAY[
    'enrolment."Created_users"'::regclass::oid,
    '"Learner".learners'::regclass::oid,
    'login."Login_accounts"'::regclass::oid,
    'login."Login_sessions"'::regclass::oid,
    '"Learner".learner_training_plan_modules'::regclass::oid,
    '"Learner".learner_training_plan_weeks'::regclass::oid,
    '"Learner".learner_training_plan_components'::regclass::oid,
    '"Learner".learner_progress_entries'::regclass::oid
  ];

  -- Dynamic SQL is derived only from trusted pg_catalog OIDs/attributes.
  -- No caller value is interpolated; fixture IDs are bound through USING.
  FOR v_fk IN
    SELECT con.oid, con.conname, con.conrelid, con.confrelid,
           con.conkey, con.confkey
    FROM pg_constraint con
    WHERE con.contype = 'f'
      AND con.confrelid = ANY(v_target_oids)
      AND NOT (con.conrelid = ANY(v_target_oids))
  LOOP
    SELECT string_agg(
             format('r.%I IS NOT DISTINCT FROM t.%I', ra.attname, ta.attname),
             ' AND ' ORDER BY keys.ord
           )
      INTO v_join
    FROM unnest(v_fk.conkey, v_fk.confkey) WITH ORDINALITY
         AS keys(r_attnum, t_attnum, ord)
    JOIN pg_attribute ra
      ON ra.attrelid = v_fk.conrelid AND ra.attnum = keys.r_attnum
    JOIN pg_attribute ta
      ON ta.attrelid = v_fk.confrelid AND ta.attnum = keys.t_attnum;

    v_ids := CASE v_fk.confrelid
      WHEN 'enrolment."Created_users"'::regclass::oid THEN ARRAY[v_enrolment_id]
      WHEN '"Learner".learners'::regclass::oid THEN ARRAY[v_learner_id]
      WHEN 'login."Login_accounts"'::regclass::oid THEN ARRAY[v_account_id]
      WHEN 'login."Login_sessions"'::regclass::oid THEN ARRAY[v_session_id]
      WHEN '"Learner".learner_training_plan_modules'::regclass::oid THEN ARRAY[v_module_id]
      WHEN '"Learner".learner_training_plan_weeks'::regclass::oid THEN ARRAY[v_week_id]
      WHEN '"Learner".learner_training_plan_components'::regclass::oid THEN ARRAY[v_component_id]
      WHEN '"Learner".learner_progress_entries'::regclass::oid THEN v_progress_ids
    END;

    EXECUTE format(
      'SELECT EXISTS (SELECT 1 FROM %s r JOIN %s t ON %s WHERE t.id = ANY($1))',
      v_fk.conrelid::regclass, v_fk.confrelid::regclass, v_join
    ) INTO v_dependent USING v_ids;
    IF v_dependent THEN
      RAISE EXCEPTION 'Unknown dependent rows through constraint %; cleanup stopped',
        v_fk.conname;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM "Engagement".shared_reward_outbox
             WHERE progress_id = ANY(v_progress_ids))
     OR EXISTS (SELECT 1 FROM "Engagement".shared_reward_saved_progress
                WHERE progress_id = ANY(v_progress_ids))
     OR EXISTS (SELECT 1 FROM login."Login_audit"
                WHERE "Account_id" = v_account_id
                   OR lower("Email") = lower(v_namespace || '@example.invalid'))
     OR EXISTS (SELECT 1 FROM fetching_evidence.platform_read_model_outbox
                WHERE scope_id IN (v_enrolment_id::text, v_learner_id::text)
                   OR payload::text LIKE '%' || v_namespace || '%')
     OR EXISTS (SELECT 1 FROM public.platform_read_model_outbox
                WHERE scope_id IN (v_enrolment_id::text, v_learner_id::text)
                   OR payload::text LIKE '%' || v_namespace || '%')
  THEN
    RAISE EXCEPTION 'Non-FK fixture side effects exist; cleanup stopped';
  END IF;

  DELETE FROM "Learner".learner_progress_entries
   WHERE id = ANY(v_progress_ids);
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 357 THEN RAISE EXCEPTION 'Progress cleanup count mismatch'; END IF;

  DELETE FROM "Learner".learner_training_plan_components WHERE id = v_component_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Component cleanup count mismatch'; END IF;
  DELETE FROM "Learner".learner_training_plan_weeks WHERE id = v_week_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Week cleanup count mismatch'; END IF;
  DELETE FROM "Learner".learner_training_plan_modules WHERE id = v_module_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Module cleanup count mismatch'; END IF;
  DELETE FROM login."Login_sessions" WHERE id = v_session_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Session cleanup count mismatch'; END IF;
  DELETE FROM login."Login_accounts" WHERE id = v_account_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Account cleanup count mismatch'; END IF;

  UPDATE enrolment."Created_users" SET learner_id = NULL
   WHERE id = v_enrolment_id AND learner_id = v_learner_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Enrolment unlink count mismatch'; END IF;
  DELETE FROM "Learner".learners WHERE id = v_learner_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Learner cleanup count mismatch'; END IF;
  DELETE FROM enrolment."Created_users" WHERE id = v_enrolment_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Enrolment cleanup count mismatch'; END IF;
  DELETE FROM benchmark_admin.fixture_receipts WHERE receipt_id = v_receipt_id;
  GET DIAGNOSTICS v_rows = ROW_COUNT;
  IF v_rows <> 1 THEN RAISE EXCEPTION 'Receipt cleanup count mismatch'; END IF;

  IF EXISTS (SELECT 1 FROM enrolment."Created_users"
             WHERE id = v_enrolment_id OR "Programme" = v_namespace
                OR lower(coalesce("Email", '')) = lower(v_namespace || '@example.invalid'))
     OR EXISTS (SELECT 1 FROM "Learner".learners
                WHERE id = v_learner_id OR programme = v_namespace
                   OR lower(email) = lower(v_namespace || '@example.invalid'))
     OR EXISTS (SELECT 1 FROM login."Login_accounts"
                WHERE id = v_account_id
                   OR lower("Email") = lower(v_namespace || '@example.invalid'))
     OR EXISTS (SELECT 1 FROM login."Login_sessions" WHERE id = v_session_id)
     OR EXISTS (SELECT 1 FROM "Learner".learner_training_plan_modules
                WHERE id = v_module_id OR module_ref = v_namespace || ':module')
     OR EXISTS (SELECT 1 FROM "Learner".learner_training_plan_weeks
                WHERE id = v_week_id OR week_ref = v_namespace || ':week')
     OR EXISTS (SELECT 1 FROM "Learner".learner_training_plan_components
                WHERE id = v_component_id OR component_ref = v_namespace || ':component')
     OR EXISTS (SELECT 1 FROM "Learner".learner_progress_entries
                WHERE id = ANY(v_progress_ids) OR learner_id = v_learner_id)
     OR EXISTS (SELECT 1 FROM benchmark_admin.fixture_receipts
                WHERE receipt_id = v_receipt_id OR namespace = v_namespace)
  THEN
    RAISE EXCEPTION 'Fixture cleanup residue assertion failed';
  END IF;

  RETURN jsonb_build_object(
    'receipt_id', v_receipt_id, 'namespace', v_namespace,
    'deleted_application_rows', 364, 'deleted_control_rows', 1,
    'cleaned_at', clock_timestamp()
  );
END
$function$;

REVOKE ALL ON ALL TABLES IN SCHEMA benchmark_admin FROM PUBLIC, lms_fixture_provisioner;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA benchmark_admin FROM PUBLIC, lms_fixture_provisioner;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA benchmark_admin FROM PUBLIC;
GRANT USAGE ON SCHEMA benchmark_admin TO lms_fixture_provisioner;
GRANT EXECUTE ON FUNCTION
  benchmark_admin.provision_phase4g_fixture(text,text,timestamptz),
  benchmark_admin.cleanup_phase4g_fixture(jsonb)
  TO lms_fixture_provisioner;

-- Finish the ownership handoff only after the creating owner has locked every
-- ACL. PostgreSQL preserves those ACLs when ownership changes.
GRANT CREATE ON SCHEMA benchmark_admin TO lms_fixture_owner;
ALTER TABLE benchmark_admin.fixture_receipts OWNER TO lms_fixture_owner;
ALTER FUNCTION benchmark_admin.provision_phase4g_fixture(text,text,timestamptz)
  OWNER TO lms_fixture_owner;
ALTER FUNCTION benchmark_admin.cleanup_phase4g_fixture(jsonb)
  OWNER TO lms_fixture_owner;
ALTER SCHEMA benchmark_admin OWNER TO lms_fixture_owner;

-- No ownership-handoff membership may survive the transaction.
REVOKE lms_fixture_owner FROM neondb_owner;

COMMIT;

-- Expected committed provision writes:
--   364 application INSERTs + 1 benchmark_admin receipt INSERT
--   + 1 Created_users UPDATE; 357 progress trigger executions; 0 trigger rows.
-- Expected committed cleanup writes:
--   364 application DELETEs + 1 receipt DELETE + 1 Created_users UPDATE.
-- Identity sequences advance by 364 on provision and are never reset, including
-- if a later containment assertion rolls the transaction back.
