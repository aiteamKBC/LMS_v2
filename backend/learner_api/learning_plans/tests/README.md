# Learning Plan membership regression tests

- `unit/`: pure membership, effective-plan policy and public-contract cases.
- `architecture/`: static domain-first dependency and cross-domain import guards.
- `parity/`: 26 standalone caller, writer-guard and read-boundary cases. The file
  named `test_membership_integration_standalone.py` exercises source contracts;
  it does not initialize Django or connect to a database.
- `integration/`: eight real Django import/HTTP cases with synthetic boundaries,
  run only through the Docker launcher below. Database operations remain blocked.
- `fixtures/legacy_snapshots/`: two immutable source oracles, with original hash
  checks retained. No real learner data or runtime fallback sources are stored here.

From the repository root:

```powershell
python -I -B backend/learner_api/learning_plans/tests/unit/test_membership_policy_standalone.py
python -I -B backend/learner_api/learning_plans/tests/unit/test_effective_plan_policy_standalone.py
python -I -B backend/learner_api/learning_plans/tests/unit/test_public_contract_standalone.py
python -I -B backend/learner_api/learning_plans/tests/architecture/test_boundaries_standalone.py
python -I -B backend/learner_api/learning_plans/tests/parity/test_membership_caller_parity_standalone.py
python -I -B backend/learner_api/learning_plans/tests/parity/test_membership_integration_standalone.py
python -I -B backend/learner_api/learning_plans/tests/parity/test_module_membership_standalone.py
python -I -B backend/learner_api/learning_plans/tests/parity/test_effective_plan_extraction_standalone.py
python -B backend/phase1f_tests/image/run_membership_runtime.py
python -B backend/phase1f_tests/image/run_integration.py
```

The last two commands require the existing reviewed Docker images. The runtime
launcher uses `--network none`, no database, no mounts or host credentials, a
read-only root filesystem and a sanitized source-only bundle. The final launcher
adds disposable loopback-only PostgreSQL for real ORM/HTTP transaction checks.
Both prove isolation before Django startup and remove their own containers.
The integration file deliberately refuses discovery: do not run it on the host
or use broad Django discovery. No Teams tests are selected by these commands.
