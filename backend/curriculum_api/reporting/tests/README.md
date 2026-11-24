# Reporting regression tests

`parity/` owns six standalone source/behavior contract modules (57 cases).
`fixtures/legacy_snapshots/` owns seven immutable pre-extraction source oracles.
They cover reporting, delivery, statistics, KSB identity, quality assets and
revision history; they are not runtime fallbacks or a second business data source.
Production API/Application/Domain/Infrastructure modules stay in their layers.

From the repository root, without Django or a database:

```powershell
python -B -m unittest discover -s backend/curriculum_api/reporting/tests/parity -p "test*standalone.py" -v
```

Cross-context HTTP/ORM/SQL checks use the existing isolated Docker harness:

```powershell
python -B backend/phase1f_tests/image/run_integration.py
```

The runner verifies isolation before starting Django or disposable PostgreSQL,
uses synthetic data and no host credentials, and removes its own containers.
Do not run these Django checks with host settings or an existing database.
No Teams tests are selected by these commands.
