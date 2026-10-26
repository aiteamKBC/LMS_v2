# Design

## File layout

```text
frontend/tests/
├── playwright.config.ts
└── e2e/
    ├── frontend-smoke.spec.ts
    └── support/syntheticSession.ts
```

The new layout avoids `frontend/e2e/` and `frontend/playwright.config.ts`, which the shared `.gitignore` already reserves for a private security suite.

## Isolation model

`syntheticSession.ts` installs a browser-context route before navigation. Same-origin static assets continue to Vite. `/login_api/me/` receives a typed synthetic response or a signed-out response. Other known API prefixes receive a controlled `501`, and every non-local origin is aborted.

This makes the smoke suite deterministic and prevents test execution from reaching backend, database, email, Teams, or paid services.

## Projects and responsive coverage

- learner: mobile portrait
- apprentice: tablet portrait
- staff: desktop
- employer: desktop
- verify: compact mobile

The project labels are execution personas for smoke coverage; they do not claim full role authorization coverage.

