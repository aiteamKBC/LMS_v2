-- Scoped answer-key repair for AI Assisted Learning 3, question 15.
-- Evidence: https://www.microsoft.com/en-gb/dynamics-365/resources/what-is-a-cdp
-- A CDP unifies multiple customer data sources into a single customer view.
-- All four options were incorrectly marked correct on a single-choice question.
-- Preserve every question/answer ID and all learner history; do not regrade.
-- Save the four answer rows before applying. Rollback is a targeted restoration
-- of their is_correct/updated_at values, never a whole-database restore.
-- Run on the verified LMS enrolment database after PR review and merge.
BEGIN;
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '30s';

DO $$
DECLARE
    actual_ids bigint[];
    actual_texts text[];
    actual_flags boolean[];
    changed integer;
BEGIN
    PERFORM id FROM curriculum.quizzes
    WHERE id = 5128
      AND title = 'AI Assisted Learning 3: Sources of marketing data for AI'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Quiz identity changed; stop and review.';
    END IF;

    PERFORM id FROM curriculum.quiz_questions
    WHERE id = 87626 AND quiz_id = 5128 AND NOT is_archived
      AND question_type = 'single_choice'
      AND question_text = 'A mid-sized B2B organisation wants to unify CRM, analytics and email data to create a single customer view. A senior leader asks what a customer data platform is in practical terms. The marketing manager gives a concise definition. Which definition is most accurate?'
    FOR UPDATE;
    IF NOT FOUND THEN
        RAISE EXCEPTION 'Question identity changed; stop and review.';
    END IF;

    PERFORM id FROM curriculum.quiz_answers
    WHERE question_id = 87626 ORDER BY id FOR UPDATE;
    SELECT array_agg(id::bigint ORDER BY id),
           array_agg(answer_text ORDER BY id),
           array_agg(is_correct ORDER BY id)
    INTO actual_ids, actual_texts, actual_flags
    FROM curriculum.quiz_answers WHERE question_id = 87626;

    IF actual_ids IS DISTINCT FROM ARRAY[332017,332018,332019,332020]::bigint[]
       OR actual_texts IS DISTINCT FROM ARRAY[
           'system that unifies customer data from multiple sources to create a single customer view.',
           'system used only to create social media posts.',
           'spreadsheet that manually lists all historic campaigns.',
           'replacement for customer consent and governance rules.'
       ]::text[] THEN
        RAISE EXCEPTION 'Answer identity/content changed; stop and review.';
    END IF;

    IF actual_flags = ARRAY[true,false,false,false] THEN
        RAISE NOTICE 'Answer key already repaired; no changes.';
        RETURN;
    END IF;
    IF actual_flags IS DISTINCT FROM ARRAY[true,true,true,true] THEN
        RAISE EXCEPTION 'Unexpected answer key; stop and review.';
    END IF;

    UPDATE curriculum.quiz_answers
    SET is_correct = false, updated_at = CURRENT_TIMESTAMP
    WHERE question_id = 87626 AND id IN (332018,332019,332020)
      AND is_correct = true;
    GET DIAGNOSTICS changed = ROW_COUNT;
    IF changed <> 3 THEN
        RAISE EXCEPTION 'Expected exactly three answer-key changes, got %.', changed;
    END IF;
END $$;

COMMIT;
