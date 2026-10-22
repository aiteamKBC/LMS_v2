# Understanding

## Existing architecture

- React 19 and TypeScript application built by Vite 8.
- Vitest covers unit/integration behavior; Playwright is installed but previously had no active tracked configuration or discoverable projects.
- Authentication state is resolved through `/login_api/me/` and route guards.
- The repository intentionally ignores legacy private paths at `frontend/e2e/` and `frontend/playwright.config.ts`.

## Required behavior

The smoke suite must validate public login rendering, authenticated access-required rendering, and protected-route redirection. It must run against the Vite frontend only and use synthetic same-origin API responses so no backend state can be read or mutated.

## Non-goals

- End-to-end validation of backend contracts or real authentication.
- Live Microsoft/Teams validation.
- UI, application routing, Tailwind, or dependency changes.
- Resolution of unrelated repository-wide lint debt.

