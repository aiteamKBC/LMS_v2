-- Apply only AFTER 0010 and the recipient-specific question code are deployed.
-- One completed response keeps its original question. Eight unstarted learners
-- receive the replacement from the effective instant onward. If the roster or
-- response count changed, this transaction aborts for a fresh review.
BEGIN;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  correction_at timestamptz := clock_timestamp() + interval '2 minutes';
  recipient_count integer;
  response_count integer;
  answer_count integer;
  inserted_count integer;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "Feedback".feedback_deliveries d
    JOIN "Feedback".feedback_forms f ON f.id=d.form_id
    WHERE d.id=164 AND d.form_id=47 AND f.form_type='post_lecture'
      AND d.status='open' AND d.question_set_pinned
      AND d.session_title='Marketing Strategy&Planning - Session 4'
      AND d.starts_at='2026-10-27 09:00:00+00'::timestamptz
  ) THEN
    RAISE EXCEPTION 'Target lecture no longer matches; stopped';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM "Feedback".feedback_delivery_questions dq
    JOIN "Feedback".feedback_questions old_q ON old_q.id=dq.question_id
    JOIN "Feedback".feedback_questions new_q ON new_q.id=271
    JOIN "Feedback".feedback_form_sections s ON s.id=old_q.section_id
    WHERE dq.delivery_id=164 AND old_q.id=278 AND s.form_id=47
      AND new_q.section_id=old_q.section_id
      AND old_q.question_type='rating' AND new_q.question_type='rating'
      AND btrim(old_q.question_text)='Which case study did you find most useful or challenging, and why?'
      AND btrim(new_q.question_text)='How effectively did the tutor check learners'' understanding?'
      AND NOT EXISTS (
        SELECT 1 FROM "Feedback".feedback_delivery_questions already
        WHERE already.delivery_id=164 AND already.question_id=271
      )
  ) THEN
    RAISE EXCEPTION 'Question selection no longer matches; stopped';
  END IF;

  SELECT count(*) INTO recipient_count
  FROM "Feedback".feedback_delivery_recipients
  WHERE delivery_id=164 AND revoked_at IS NULL;
  SELECT count(*) INTO response_count
  FROM "Feedback".feedback_responses
  WHERE delivery_id=164;
  SELECT count(*) INTO answer_count
  FROM "Feedback".feedback_answers a
  JOIN "Feedback".feedback_responses r ON r.id=a.response_id
  WHERE r.delivery_id=164 AND a.question_id=278;
  IF recipient_count<>9 OR response_count<>1 OR answer_count<>1 THEN
    RAISE EXCEPTION 'Recipient/response state changed; stopped';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "Feedback".feedback_responses
    WHERE delivery_id=164 AND status='completed'
  ) THEN
    RAISE EXCEPTION 'Historical response is no longer completed; stopped';
  END IF;
  IF EXISTS (
    SELECT 1 FROM "Feedback".feedback_delivery_question_overrides o
    JOIN "Feedback".feedback_delivery_recipients r ON r.id=o.recipient_id
    WHERE r.delivery_id=164
  ) THEN
    RAISE EXCEPTION 'An override already exists for this lecture; stopped';
  END IF;

  INSERT INTO "Feedback".feedback_delivery_question_overrides
    (recipient_id, original_question_id, replacement_question_id, effective_at)
  SELECT r.id,278,271,correction_at
  FROM "Feedback".feedback_delivery_recipients r
  WHERE r.delivery_id=164 AND r.revoked_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM "Feedback".feedback_responses response
      WHERE response.delivery_id=164 AND response.learner_id=r.learner_id
    );
  GET DIAGNOSTICS inserted_count = ROW_COUNT;
  IF inserted_count<>8 THEN
    RAISE EXCEPTION 'Expected eight unstarted recipients, got %; rolled back',inserted_count;
  END IF;
END $$;

COMMIT;

-- Read-only verification: eight overrides and one historical response.
SELECT count(*) AS corrected_recipients
FROM "Feedback".feedback_delivery_question_overrides o
JOIN "Feedback".feedback_delivery_recipients r ON r.id=o.recipient_id
WHERE r.delivery_id=164 AND o.original_question_id=278 AND o.replacement_question_id=271;
