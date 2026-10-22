# Frontend Production Readiness

## Summary

Establish a local-only frontend engineering skill boundary and add safe Playwright smoke-test infrastructure for the existing React frontend.

## User outcome

- Codex can continue using the local frontend skill without any skill file becoming a Git candidate.
- Developers can run role-labelled browser smoke checks without a backend, database, or live external service.

## Scope

- Git-local exclusions for `frontend/.agents/`, `frontend/AGENTS.md`, and `frontend/README-FIRST.txt`.
- Playwright configuration, synthetic session routing, smoke specifications, package scripts, and lint coverage for E2E TypeScript.
- No application source, backend, schema, business logic, Tailwind configuration, dependency version, or UI design changes.

## Constraints

- Work in the current folder and branch.
- Do not stage, commit, push, install, or upgrade packages.
- Preserve the existing ignored private E2E paths and all unrelated work.
- Do not contact backend APIs, databases, Microsoft services, or other external origins during smoke tests.

## Acceptance criteria

1. Local skill files exist, remain readable, are untracked, and are excluded by the repository-local Git exclude file.
2. Five Playwright projects can discover and execute deterministic smoke coverage.
3. E2E TypeScript passes its dedicated ESLint gate.
4. TypeScript and production-build evidence is recorded accurately, including pre-existing or environmental blockers.

