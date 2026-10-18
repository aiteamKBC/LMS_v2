> **STATUS: PARKED — not active. Single developer for now; follow steps in order from README.md.**

# Working as two developers in parallel

Dev A = **Platform & Auth track**. Dev B = **Tools track**. Each runs their own Claude Code session.

## Git setup
- Integration branch: `feature/mcp-server` (from main). Nobody commits to it directly — PRs only.
- Personal branches off it: `mcp/a-<step>` and `mcp/b-<step>`. Small PRs, one sub-plan each.
- Every PR is reviewed by the OTHER developer (A reviews B's tools, B reviews A's auth).

## File ownership (avoids merge conflicts)
| Owner | Files |
|---|---|
| A | `mcp_api/models.py`, `crypto.py`, `auth.py`, `oauth_*.py`, `views.py` (transport), `ratelimit.py`, `changes.py`, `backend/sql/*_mcp_oauth/`, templates |
| B | `mcp_api/dispatch.py`, `tools/*`, `pii.py`, `validators/*` (KSB resolver, question rules, Arabic normaliser) |
| Shared — touched ONLY in Step 1 | `config/settings.py`, `config/urls.py`, `login/api_gate.py` |
| Agreed together in Step 1b, then frozen | `mcp_api/contracts.py` |

## Sequence

### Stage 0 — together (day 1)
- **A:** Step 1 (skeleton, flag, gate exemptions). Merge first.
- **B, at the same time:** Step 1b. Write `mcp_api/contracts.py` with signatures and docstrings only:
  - `resolve_bearer(request) -> (account, token) | None`
  - `@tool(name, description, input_schema, writes)` registry
  - `call_api(request, method, path, *, query, json) -> (status, data)`
  - `WriteTool.validate / preview / apply`
  - `ToolError(message)`

  Also write a test helper that gives a request with a curriculum-staff `login_account` attached, so tools can be tested **without OAuth**. A reviews it, then it is merged and frozen.

### Stage 1 — parallel
| Dev A | Dev B |
|---|---|
| Step 2: tables + RUNBOOK | Step 4b: dispatcher, registry, PII guard (sub-tasks 4.4–4.7). Test it with the helper, not real tokens. |
| Step 3: OAuth | Step 6: all read tools |
| Step 4a: transport — JSON-RPC, bearer, actor, rate limit, logging (4.1–4.3, 4.8, 4.9) | Step 7 part 1: validation + preview logic only. These are pure functions: KSB resolver with suggestions, question rules, duplicate detection, Markdown sanitising. |

**Sync point 1:** merge 4a + 4b, then run MCP Inspector end to end. OAuth → `tools/list` → read tools against the branch DB. Fix together.

### Stage 2 — parallel
| Dev A | Dev B |
|---|---|
| Step 5: preview → apply framework | Step 8 + Step 9 validation/preview parts |
| Then: Step 11.2 admin token list/revoke, 11.8 cleanup scheduling | After Step 5 merges: wire `apply` for Steps 7, 8, 9 |

**Sync point 2:** a full quiz flow from Claude on the branch: preview → confirm → draft quiz linked with KSBs. Check the revisions show actor + `mcp:` source.

### Stage 3 — Phase C, split by entity
| Dev A | Dev B |
|---|---|
| `create_cohort` + `create_group` (dates, coach resolution) | `create_programme` + `create_module` (standard choice, structure additive check) |

### Stage 4 — together
- Step 11 hardening:
  - A does the security review of B's tools.
  - B does the security review of A's auth.
  - Both run the full regression app by app.
- Step 12 pilot:
  - A does deploy, proxy and env.
  - B writes the staff guide and pilots with the curriculum team.

## Test database coordination
- Both developers using the same `security_test` branch with `--keepdb` can collide: one person's test rows break the other's run.
  - **Preferred:** each developer gets their own Neon child branch of `security_test` (own `.env.branch`).
  - **Otherwise:** agree time slots for running the suites.
- Never run plain `manage.py test` or `runserver`. Both connect to production.

## Daily routine
- 10-minute check-in: what merged, which contract changes are needed. A contract change needs both developers to agree, plus a PR to `contracts.py`.
- Each Claude Code session starts with: "Read docs/MCP_PLAN.md, docs/mcp/README.md, docs/mcp/TEAM_SEQUENCE.md and the step file. You are Dev A/B. Only edit files you own."
