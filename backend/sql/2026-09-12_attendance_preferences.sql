-- Run manually in the Neon SQL Editor. No source attendance rows are changed.
CREATE TABLE IF NOT EXISTS "Learner".attendance_preferences (
    learner_id bigint PRIMARY KEY REFERENCES enrolment."Created_users"(id) ON DELETE CASCADE,
    mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('live', 'lazy')),
    requested_mode text CHECK (requested_mode = 'lazy'),
    status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'approved', 'declined')),
    request_id uuid,
    manager_email text NOT NULL DEFAULT '',
    email_sent boolean NOT NULL DEFAULT false,
    updated_at timestamptz NOT NULL DEFAULT now(),
    CHECK ((status = 'pending') = (requested_mode IS NOT NULL AND request_id IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS "Learner".attendance_reminders (
    learner_id bigint NOT NULL REFERENCES enrolment."Created_users"(id) ON DELETE CASCADE,
    session_key text NOT NULL,
    sent_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (learner_id, session_key)
);
