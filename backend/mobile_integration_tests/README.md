# Assigned-course mobile integration tests

Run these tests separately from the application test runner. They import the checked-out backend source, use synthetic data, and do not load production settings or call Microsoft, mail or media providers.

Use Python 3.12 or newer in an isolated virtual environment and install `requirements.txt` from this directory. Provision three distinct, empty PostgreSQL databases on `127.0.0.1`. The rewards and installation databases must have names beginning `kbc_rewards_test_`; the quiz metadata database must begin `kbc_rewards_test_review_`. Store their connection details in private JSON files outside the repository, with `host`, `port`, `dbname`, `user` and `password` fields. The fixtures reject nonempty or non-loopback databases.

From the repository root:

```powershell
$env:KBC_MOBILE_ISOLATED_DB_CONFIG = 'C:\private\quiz-metadata.json'
python backend/mobile_integration_tests/run_tests.py --postgres-config C:\private\rewards.json --install-config C:\private\install.json --report-path C:\private\mobile-test-results.json
```

The complete suite contains **129 checks**: 97 facade/security/download/canonical round-trip checks, including the real PostgreSQL quiz metadata query; 27 PostgreSQL reward checks; and five migration/installation checks. The runner executes the three groups in separate processes. The metadata fixture creates its minimal schema inside a transaction that is rolled back. The rewards and installation fixtures populate their dedicated databases, so create fresh databases for subsequent full runs.

Without `KBC_MOBILE_ISOLATED_DB_CONFIG`, one quiz metadata test is explicitly skipped; that run does not establish all 129 checks. Without both database command arguments, the runner runs only the facade group and reports an incomplete result. For the isolated facade group alone:

```text
python -m unittest discover -s backend/mobile_integration_tests -p "test_mobile*contract.py" -q
```

Coverage includes apprenticeship and commercial learner identity, effective assigned-course IDs, same-title course separation, empty plans, active profiles and access gates, audio/video/choice-quiz admission, standalone quiz identifiers, scoped progress/transcripts, signed timing, and the protected Android download. Assignments, live sessions, unsupported quiz formats and unassigned activities cannot enter the mobile learning endpoints. PMP reward scope remains separate, including rejection of non-PMP and synthetic standalone-quiz observations.

The round-trip cases execute the real maintained audio/video/quiz handlers, quiz grader, signed timing and mobile progress projection. They replace the canonical persistence boundary with an isolated SQLite adapter, so they prove save/readback contracts but do not exercise the complete production ORM, KSB graph or Engagement hooks. Separate PostgreSQL fixtures cover quiz admission SQL, duplicate/concurrent rewards, tutor acceptance, vouchers and default-disabled migration activation. The migration fixture checks its frozen schema checksum.

These checks do not certify physical Android behaviour, live Teams invitations, every published media URL, production signing or authenticated production learner acceptance.

The facade and reward policy remain disabled by default through `KBC_MOBILE_API_ENABLED` and `KBC_SHARED_REWARDS_READY`. `KBC_MOBILE_CALENDAR_WRITES_ENABLED` is a separate gate. Do not enable flags just to pass tests. Production APK storage and scheduler configuration are operational assets, not committed credentials or binaries.
