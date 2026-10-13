# PMP mobile integration regression tests

Run these tests separately from the application test runner. They import the checked-out backend source, use synthetic data, and do not load production settings or call Microsoft, mail or media providers.

Use Python 3.12 or newer in an isolated virtual environment and install `requirements.txt` from this directory. Provision two distinct, empty PostgreSQL databases on `127.0.0.1`, each named with the prefix `kbc_rewards_test_`. Put their connection details in private JSON files outside the repository, with `host`, `port`, `dbname`, `user` and `password` fields. Never reuse a production database or commit these files. Both database suites refuse nonempty databases.

From the repository root:

```text
python backend/mobile_integration_tests/run_tests.py --postgres-config /private/rewards.json --install-config /private/install.json --report-path /private/mobile-test-results.json
```

The runner executes 72 facade/security/download tests, 27 real PostgreSQL reward tests, and five migration/setup tests in separate processes. Without both database arguments it runs only the facade tests and exits with an incomplete result, not a full pass.

Tests cover learner identity and assignment boundaries, guarded Android download, canonical progress and quiz delegation, verified timing, duplicate/concurrent reward processing, tutor acceptance, voucher reservation, and default-disabled migration activation. The fixture schema is deliberately minimal; the migration test checks its frozen schema checksum. This suite does not certify physical Android behaviour, live Teams invitations, all media playback or production signing.

The facade and reward policy remain disabled by default through `KBC_MOBILE_API_ENABLED` and `KBC_SHARED_REWARDS_READY`. `KBC_MOBILE_CALENDAR_WRITES_ENABLED` is a separate gate. Do not enable flags just to pass tests. Production APK storage and scheduler configuration are operational assets, not committed credentials or binaries.
