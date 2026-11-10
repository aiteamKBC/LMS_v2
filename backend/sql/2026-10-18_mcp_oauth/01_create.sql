-- MCP server: OAuth clients, authorization codes, tokens and write previews.
-- Additive only: four new tables in the `login` schema; no existing table is altered.
--
-- Run as neondb_owner (the Neon SQL editor's default role). Every existing `login`
-- table is owned by neondb_owner with no explicit GRANTs (relacl is NULL on
-- login."Login_sessions" and its siblings), and the application connects as that
-- same role. So these tables carry no GRANTs either: ownership is the access.
--
-- Codes and tokens are stored only as the SHA-256 hex of the secret, exactly like
-- login."Login_sessions"."Token_hash"; the CHECKs refuse anything that is not one.
--
-- One transaction: either all four tables exist afterwards or none do. Re-running
-- after a successful apply fails on the first CREATE and changes nothing.

BEGIN;

DO $$
BEGIN
    IF current_user <> 'neondb_owner' THEN
        RAISE EXCEPTION 'Run as neondb_owner (current_user is %), so the tables share the login schema''s owner.', current_user;
    END IF;
END
$$;

-- --- clients (RFC 7591 dynamic registration) -----------------------------------
CREATE TABLE login."Mcp_oauth_clients" (
    id              bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Client_id"     text NOT NULL UNIQUE,
    "Client_name"   text NOT NULL,
    "Redirect_uris" jsonb NOT NULL DEFAULT '[]'::jsonb
        CHECK (jsonb_typeof("Redirect_uris") = 'array'),
    "Created_at"    timestamptz NOT NULL DEFAULT now(),
    "Disabled_at"   timestamptz
);

-- --- authorization codes (single use, 5 minutes) -------------------------------
CREATE TABLE login."Mcp_oauth_codes" (
    id               bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Code_hash"      varchar(64) NOT NULL UNIQUE
        CHECK ("Code_hash" ~ '^[0-9a-f]{64}$'),
    "Client_id"      text NOT NULL
        REFERENCES login."Mcp_oauth_clients"("Client_id"),
    "Account_id"     bigint NOT NULL
        REFERENCES login."Login_accounts"(id) ON DELETE CASCADE,
    "Code_challenge" text NOT NULL,
    "Redirect_uri"   text NOT NULL,
    "Scope"          text NOT NULL DEFAULT '',
    "Expires_at"     timestamptz NOT NULL,
    "Used_at"        timestamptz,
    "Created_at"     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mcp_oauth_codes_account_idx ON login."Mcp_oauth_codes" ("Account_id");

-- --- access + refresh tokens (1 hour / 30 days) ---------------------------------
-- A refresh rotates into a new row of the same family; reuse of a rotated refresh
-- token revokes the whole family.
CREATE TABLE login."Mcp_oauth_tokens" (
    id                   bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    "Access_hash"        varchar(64) NOT NULL UNIQUE
        CHECK ("Access_hash" ~ '^[0-9a-f]{64}$'),
    "Refresh_hash"       varchar(64) UNIQUE
        CHECK ("Refresh_hash" ~ '^[0-9a-f]{64}$'),
    "Family_id"          uuid NOT NULL,
    "Client_id"          text NOT NULL
        REFERENCES login."Mcp_oauth_clients"("Client_id"),
    "Account_id"         bigint NOT NULL
        REFERENCES login."Login_accounts"(id) ON DELETE CASCADE,
    "Scope"              text NOT NULL DEFAULT '',
    "Expires_at"         timestamptz NOT NULL,
    "Refresh_expires_at" timestamptz,
    "Revoked_at"         timestamptz,
    "Revoked_reason"     text,
    "Last_used_at"       timestamptz,
    "Created_at"         timestamptz NOT NULL DEFAULT now()
);
-- "Revoke every token for this account" on credential change / access removal.
CREATE INDEX mcp_oauth_tokens_account_idx ON login."Mcp_oauth_tokens" ("Account_id");
CREATE INDEX mcp_oauth_tokens_family_idx ON login."Mcp_oauth_tokens" ("Family_id");

-- --- write previews awaiting confirmation (15 minutes) --------------------------
CREATE TABLE login."Mcp_pending_changes" (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    "Account_id"   bigint NOT NULL
        REFERENCES login."Login_accounts"(id) ON DELETE CASCADE,
    "Client_id"    text NOT NULL
        REFERENCES login."Mcp_oauth_clients"("Client_id"),
    "Tool"         text NOT NULL,
    "Payload"      jsonb NOT NULL,
    "Payload_hash" varchar(64) NOT NULL
        CHECK ("Payload_hash" ~ '^[0-9a-f]{64}$'),
    "Preview"      jsonb,
    "Expires_at"   timestamptz NOT NULL,
    "Applied_at"   timestamptz,
    "Cancelled_at" timestamptz,
    "Result"       jsonb,
    "Created_at"   timestamptz NOT NULL DEFAULT now(),
    CHECK ("Applied_at" IS NULL OR "Cancelled_at" IS NULL)
);
CREATE INDEX mcp_pending_changes_account_created_idx
    ON login."Mcp_pending_changes" ("Account_id", "Created_at");

COMMIT;
