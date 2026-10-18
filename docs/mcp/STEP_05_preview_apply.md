# Step 5 — Preview → apply framework

## Goal
No write ever happens in the same call that proposes it. The user sees a preview and confirms.

## Tasks
5.1 Base class `mcp_api/changes.py::WriteTool`:
    - `validate(account, args) -> (normalized_payload, errors, warnings)`
    - `preview(account, payload) -> {summary: str, details: dict}` (human-readable, names not ids)
    - `apply(request, payload) -> {result, links}` (uses dispatcher only)
5.2 Calling a write tool: validate → on errors return `isError` with list → else store `Mcp_pending_changes`
    (payload, sha256 of canonical JSON, preview, expires 15 min, client_id) → return
    `{preview_id, summary, warnings, expires_in_minutes}` and text: "Nothing has been saved yet. Ask the user to
    confirm, then call apply_change with preview_id …".
5.3 Tool `apply_change(preview_id)`:
    - Row exists AND same account (else "not found"), not expired, not applied/cancelled, payload hash matches.
    - Lock row (`select_for_update`), re-run `validate` (world may have changed) → if new errors, mark cancelled,
      return them.
    - Run `apply` inside `versioning.source("mcp:<client>")`; store `result`, `applied_at`.
    - Return summary + LMS deep links (build from `MCP_PUBLIC_BASE_URL` + SPA routes, e.g. module builder URL).
    - Partial failure (multi-call apply like quiz+link+mapping): record which sub-steps succeeded, return a
      clear message listing what exists and what must be finished in the LMS. Do not attempt automatic deletes.
5.4 Tool `cancel_change(preview_id)`.
5.5 Tool `list_my_pending_changes()` — last 10 unapplied, unexpired previews of this account.
5.6 Idempotency: applying the same preview twice returns the stored result, does not write again.

## Tests
Other account → not found; expired; double apply returns same result with one write; tampered payload hash;
re-validation failure; partial failure reporting; cancel then apply refused.

## Acceptance checklist
- [ ] A dummy test write tool goes preview → apply → appears in curriculum revisions with actor + `mcp:` source.
