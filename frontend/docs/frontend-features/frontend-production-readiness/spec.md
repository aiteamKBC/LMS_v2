# Specification

## Local skill isolation

- The three local skill paths must exist and remain readable.
- None may be tracked, staged, committed, or pushed.
- Repository-relative patterns must be present in the actual repository's `.git/info/exclude`.

## Playwright infrastructure

- Provide one tracked Playwright configuration outside the pre-existing ignored private paths.
- Start or reuse the Vite server on `127.0.0.1:4173`.
- Define learner, apprentice, staff, employer, and verify projects with representative mobile, tablet, and desktop viewports.
- Run the same deterministic smoke contract for every project.
- Block service workers and all requests to external origins.
- Stub authentication and API requests locally; unexpected API calls must fail visibly with a controlled response.
- Capture traces/video on failure and screenshots only on failure.
- Use retries and an HTML artifact in CI while retaining readable local output.

## Smoke contract

1. Signed-out users can render the login form and both sign-in routes.
2. Synthetic authenticated users can render the access-required page with the correct account identity.
3. Signed-out users navigating to a protected admin route are redirected to login.

