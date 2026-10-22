# Plan

1. Verify the skill paths exist and check Git tracking before any exclusion change.
2. Add repository-local exclusions only when all paths are confirmed untracked.
3. Inspect existing routing, authentication, scripts, linting, and ignore rules.
4. Add Playwright infrastructure at nonignored paths without changing application source.
5. Add explicit package scripts and an isolated E2E lint command.
6. Validate discovery, each project, the complete smoke suite, TypeScript, lint, and production bundling.
7. Record pre-existing and environmental blockers without broadening scope.

## Rollback

- Remove the new `frontend/tests/` and feature-workspace files.
- Revert only the scoped script and ESLint additions.
- Remove only the three appended lines from `.git/info/exclude` if local skill isolation is no longer desired.
- No application data, migrations, dependencies, or production artifacts require rollback.

