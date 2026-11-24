# Directory regression tests

Production code stays in `api/`, `application/`, `domain/` and `infrastructure/`.
`parity/` contains the two standalone source/behavior contract modules (11 cases).
`fixtures/legacy_snapshots/` contains their two immutable pre-extraction source
oracles. These are test evidence, never runtime fallbacks or application data.

From the repository root, without Django or a database:

```powershell
python -B -m unittest discover -s backend/curriculum_api/directory/tests/parity -p "test_*standalone.py" -v
```

Cross-context HTTP/ORM checks remain in the shared isolated harness:

```powershell
python -B backend/phase1f_tests/image/run_integration.py
```

That runner requires the existing reviewed Docker images and proves loopback-only
isolation before starting Django or disposable PostgreSQL. It uses synthetic
fixtures, not host settings, credentials or existing databases. Do not substitute
host Django discovery. No Teams tests are selected by these commands.
