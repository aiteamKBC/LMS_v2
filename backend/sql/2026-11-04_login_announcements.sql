-- Owner-run in Neon SQL Editor only. No runtime provisioning or migrations.
-- Site-wide announcement banners, authored from Super Admin -> Announcements
-- (backend/login/announcements.py). A banner shows on every page while
-- "Starts_at" <= now() < "Ends_at".
CREATE TABLE IF NOT EXISTS login."Announcements" (
    id bigserial PRIMARY KEY,
    "Message" text NOT NULL
        CHECK (length(btrim("Message")) BETWEEN 1 AND 500),
    "Background_color" varchar(7) NOT NULL
        CHECK ("Background_color" ~ '^#[0-9A-Fa-f]{6}$'),
    "Starts_at" timestamptz NOT NULL,
    "Ends_at" timestamptz NOT NULL,
    "Created_by" text,
    "Created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "Updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK ("Ends_at" > "Starts_at")
);

-- The public "what is live now" read filters on "Ends_at" > now(); ended rows
-- accumulate, so this keeps that read off a sequential scan as history grows.
CREATE INDEX IF NOT EXISTS "Announcements_ends_at_idx"
    ON login."Announcements" ("Ends_at");

-- Read-only verification (run separately after creation).
SELECT column_name, data_type, is_nullable
FROM information_schema.columns
WHERE table_schema = 'login' AND table_name = 'Announcements'
ORDER BY ordinal_position;
