-- Rollback for 01_create.sql: drops the four MCP tables and every row in them.
-- Signed-in MCP connectors stop working (their tokens are gone); nothing else in
-- the LMS reads these tables. No CASCADE: if anything outside this release has
-- come to depend on them, the DROP fails and nothing is removed.

BEGIN;

DROP TABLE IF EXISTS login."Mcp_pending_changes";
DROP TABLE IF EXISTS login."Mcp_oauth_tokens";
DROP TABLE IF EXISTS login."Mcp_oauth_codes";
DROP TABLE IF EXISTS login."Mcp_oauth_clients";

COMMIT;
