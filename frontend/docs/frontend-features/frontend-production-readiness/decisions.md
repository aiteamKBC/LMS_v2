# Decisions

## 2026-10-20 — Repository-local skill exclusion

Use `.git/info/exclude` because the skill paths are local workstation resources and must never alter the shared `.gitignore`. This is safe only because `git ls-files` confirmed the paths were untracked first.

## 2026-10-20 — Nonignored Playwright layout

Use `frontend/tests/` because existing shared ignore rules reserve `frontend/e2e/` and `frontend/playwright.config.ts` for an older private suite. This avoids weakening or changing the shared ignore policy.

## 2026-10-20 — Synthetic network boundary

Run Vite without a backend and intercept requests at the browser context. Abort non-local origins and return controlled API responses so tests cannot mutate databases or external services.

## 2026-10-20 — Local list reporter

Use the list reporter locally and add HTML output only in CI. This prevents concurrent local project commands from contending for the same report directory while preserving CI artifacts.

## 2026-10-20 — Separate E2E lint gate

Keep the established source lint command unchanged and add `lint:e2e`. This makes the new infrastructure independently enforceable without hiding or broadening unrelated source lint debt.

